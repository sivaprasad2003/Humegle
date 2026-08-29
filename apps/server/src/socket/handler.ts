import { Server, Socket } from 'socket.io';
import { Matchmaker } from '../services/matchmaker';
import type { UserMeta, Gender } from '../services/matchmaker';
import { redis } from '../services/redis';
import { logger } from '../utils/logger';
import { z } from 'zod';
import http from 'http';

const JoinSchema = z.object({
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  interest: z.enum(['MALE', 'FEMALE', 'OTHER', 'ANY']),
  mode: z.enum(['video', 'text']).optional().default('video'),
  language: z.string().max(10).optional().default(''),
  country: z.string().max(5).optional().default(''),
});

const SignalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice-candidate']),
  payload: z.any(),
});

/** Resolve the real client IP from socket, handling proxies. */
function getClientIp(socket: Socket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? '';
  }
  return socket.handshake.address ?? '';
}

/** Fetch country code from ip-api.com for a given IP. Returns '' on failure. */
function fetchCountryCode(ip: string): Promise<string> {
  return new Promise((resolve) => {
    // Skip for localhost / private IPs
    if (!ip || ip === '::1' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.')) {
      resolve('');
      return;
    }

    const url = `http://ip-api.com/json/${ip}?fields=countryCode`;
    http
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.countryCode || '');
          } catch {
            resolve('');
          }
        });
      })
      .on('error', () => resolve(''));
  });
}

export function setupSocketHandlers(io: Server) {
  const broadcastOnlineCount = () => {
    io.emit('online_users', io.sockets.sockets.size);
  };

  io.on('connection', async (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');
    broadcastOnlineCount();

    // ─── Detect country from IP and send to client ────────────────────────────
    const clientIp = getClientIp(socket);
    if (clientIp) {
      fetchCountryCode(clientIp).then((countryCode) => {
        if (countryCode) {
          socket.emit('country_detected', { country: countryCode });
          logger.info({ socketId: socket.id, ip: clientIp, country: countryCode }, 'Country detected');
        }
      });
    }

    // ─── Join Queue ───────────────────────────────────────────────────────────
    socket.on('join_queue', async (data, ack) => {
      try {
        const { gender, interest, mode, language, country } = JoinSchema.parse(data);

        // Store queue registration key for cleanup on disconnect
        await redis.set(`queue_key:${socket.id}`, 'waiting_queue', 'EX', 3600);

        // Clean up any previous ghost room
        const existingRoom = await redis.get(`session_room:${socket.id}`);
        if (existingRoom) {
          socket.leave(existingRoom);
          socket.to(existingRoom).emit('partner_left');
          const roomDataStr = await redis.get(`room:${existingRoom}`);
          if (roomDataStr) {
            try {
              const { user1, user2 } = JSON.parse(roomDataStr);
              await redis.del(`session_room:${user1}`, `session_room:${user2}`, `room:${existingRoom}`);
            } catch (_) {}
          }
        }

        const me: UserMeta = {
          sessionId: socket.id,
          gender: gender as Gender,
          preferredGender: interest as Gender,
          language: (language || '').toLowerCase().trim(),
          country: (country || '').toUpperCase().trim(),
          mode,
          timestamp: Date.now(),
        };

        const match = await Matchmaker.findMatch(me);

        if (match) {
          socket.join(match.roomId);
          const partnerSocket = io.sockets.sockets.get(match.partnerId);
          if (partnerSocket) {
            partnerSocket.join(match.roomId);
            await redis.set(`mode:${match.roomId}`, mode, 'EX', 3600);
            socket.emit('matched', { roomId: match.roomId, role: 'initiator', mode });
            partnerSocket.emit('matched', { roomId: match.roomId, role: 'receiver', mode });
          } else {
            // Partner socket is gone — clean up and re-queue on next attempt
            await redis.del(
              `session_room:${socket.id}`,
              `session_room:${match.partnerId}`,
              `room:${match.roomId}`,
            );
            if (ack) ack({ status: 'queued' });
          }
        } else {
          if (ack) ack({ status: 'queued' });
        }
      } catch (err) {
        logger.error({ err, socketId: socket.id }, 'join_queue error');
        socket.emit('error', { message: 'Invalid join payload' });
      }
    });

    // ─── WebRTC Signaling ─────────────────────────────────────────────────────
    socket.on('webrtc_signal', async (data) => {
      try {
        const { type, payload } = SignalSchema.parse(data);
        const roomId = await redis.get(`session_room:${socket.id}`);
        if (!roomId) return;
        socket.to(roomId).emit('webrtc_signal', { type, payload });
      } catch (err) {
        logger.warn({ socketId: socket.id }, 'Invalid signal payload');
      }
    });

    // ─── Text Chat ────────────────────────────────────────────────────────────
    socket.on('chat_message', async (data) => {
      try {
        const text = data?.text;
        if (!text || typeof text !== 'string' || text.trim() === '') return;
        const roomId = await redis.get(`session_room:${socket.id}`);
        if (!roomId) return;
        socket.to(roomId).emit('chat_message', { text: text.trim() });
      } catch (err) {
        logger.warn({ socketId: socket.id }, 'Invalid chat message');
      }
    });

    // ─── Shared Cleanup Logic ─────────────────────────────────────────────────
    const cleanupSocket = async () => {
      await Matchmaker.removeFromQueue(socket.id);
      await redis.del(`queue_key:${socket.id}`);

      const roomId = await redis.get(`session_room:${socket.id}`);
      if (roomId) {
        socket.to(roomId).emit('partner_left');
        const roomDataStr = await redis.get(`room:${roomId}`);
        if (roomDataStr) {
          try {
            const { user1, user2 } = JSON.parse(roomDataStr);
            await redis.del(`session_room:${user1}`, `session_room:${user2}`, `room:${roomId}`);
          } catch (_) {}
        }
        io.socketsLeave(roomId);
      }
    };

    socket.on('skip', async () => {
      await cleanupSocket();
    });

    socket.on('disconnect', async () => {
      await cleanupSocket();
      broadcastOnlineCount();
      logger.info({ socketId: socket.id }, 'Client disconnected');
    });
  });
}