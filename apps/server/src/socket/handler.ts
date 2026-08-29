import { Server, Socket } from 'socket.io';
import { Matchmaker } from '../services/matchmaker';
import { redis } from '../services/redis';
import { logger } from '../utils/logger';
import { z } from 'zod';

const JoinSchema = z.object({
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  interest: z.enum(['MALE', 'FEMALE', 'OTHER', 'ANY']),
  mode: z.enum(['video', 'text']).optional().default('video'),
});

const SignalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice-candidate']),
  payload: z.any(),
});

export function setupSocketHandlers(io: Server) {
  const broadcastOnlineCount = () => {
    io.emit('online_users', io.engine.clientsCount);
  };

  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');
    broadcastOnlineCount();

    // ─── Join Queue ───────────────────────────────────────────────────────────
    socket.on('join_queue', async (data, ack) => {
      try {
        const { gender, interest, mode } = JoinSchema.parse(data);

        // Store their queue key so we can remove them on disconnect
        const myQueue = interest === 'ANY' ? 'queue:ANY:ANY' : `queue:${gender}:${interest}`;
        await redis.set(`queue_key:${socket.id}`, myQueue, 'EX', 3600);

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

        const match = await Matchmaker.findMatch(socket.id, gender, interest);

        if (match) {
          socket.join(match.roomId);
          const partnerSocket = io.sockets.sockets.get(match.partnerId);
          if (partnerSocket) {
            partnerSocket.join(match.roomId);
            // Store the chat mode so partner knows if video/text
            await redis.set(`mode:${match.roomId}`, mode, 'EX', 3600);
            socket.emit('matched', { roomId: match.roomId, role: 'initiator', mode });
            partnerSocket.emit('matched', { roomId: match.roomId, role: 'receiver', mode });
          } else {
            // Partner socket is gone - clean up and requeue
            await redis.del(`session_room:${socket.id}`, `session_room:${match.partnerId}`, `room:${match.roomId}`);
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
      // Remove from waiting queue
      const queueKey = await redis.get(`queue_key:${socket.id}`);
      if (queueKey) {
        await redis.zrem(queueKey, socket.id);
        await redis.del(`queue_key:${socket.id}`);
      }

      // Notify and clean up active room
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