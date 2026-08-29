import { Server, Socket } from 'socket.io';
import { Matchmaker, Gender } from '../services/matchmaker';
import { redis } from '../services/redis';
import { logger } from '../utils/logger';
import { z } from 'zod';

const JoinSchema = z.object({
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  interest: z.enum(['MALE', 'FEMALE', 'OTHER', 'ANY']),
});

const SignalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice-candidate']),
  payload: z.any(),
});

export const setupSocketHandlers = (io: Server) => {
  
  const broadcastOnlineCount = () => {
    io.emit('online_count', { count: io.engine.clientsCount });
  };

  io.on('connection', (socket: Socket) => {
    logger.info(`User connected: ${socket.id}`);
    
    // Broadcast updated count when someone connects
    broadcastOnlineCount();

    socket.on('join_queue', async (data, ack) => {
      try {
        const { gender, interest } = JoinSchema.parse(data);
        
        // Save what queue they are in so we can remove them if they disconnect
        const myQueue = interest === 'ANY' ? `queue:ANY:ANY` : `queue:${gender}:${interest}`;
        await redis.set(`queue_key:${socket.id}`, myQueue, 'EX', 86400);

        // Remove from old room if exists
        const existingRoom = await redis.get(`session_room:${socket.id}`);
        
        if (existingRoom) {
          socket.leave(existingRoom);
          socket.to(existingRoom).emit('partner_left');
          await redis.del(`session_room:${socket.id}`);
        }

        const match = await Matchmaker.findMatch(socket.id, gender, interest);

        if (match) {
          socket.join(match.roomId);
          const partnerSocket = io.sockets.sockets.get(match.partnerId);
          if (partnerSocket) {
            partnerSocket.join(match.roomId);
            
            // Assign roles: the current user who completed the match is the initiator (creates offer)
            socket.emit('matched', { roomId: match.roomId, role: 'initiator' });
            // The user who was waiting in the queue is the receiver (creates answer)
            partnerSocket.emit('matched', { roomId: match.roomId, role: 'receiver' });
          }
        } else {
          ack({ status: 'queued' });
        }
      } catch (err) {
        socket.emit('error', { message: 'Invalid join payload' });
      }
    });

    socket.on('webrtc_signal', async (data) => {
      const roomId = await redis.get(`session_room:${socket.id}`);
      if (roomId) {
        socket.to(roomId).emit('webrtc_signal', data);
      }
    });

    socket.on('chat_message', async (data) => {
      const roomId = await redis.get(`session_room:${socket.id}`);
      console.log(`[chat_message] from ${socket.id} in room ${roomId}: ${data?.message}`);
      if (roomId && data?.message) {
        // Find the exact partner ID and send it directly to them, bypassing room join issues
        const roomData = await redis.get(`room:${roomId}`);
        if (roomData) {
          const { user1, user2 } = JSON.parse(roomData);
          const partnerId = user1 === socket.id ? user2 : user1;
          socket.to(partnerId).emit('chat_message', { message: data.message });
          console.log(`[chat_message] sent directly to partner ${partnerId}`);
        }
      } else {
        console.log(`[chat_message] failed: roomId=${roomId}, message=${data?.message}`);
      }
    });

    socket.on('skip', async () => {
      const roomId = await redis.get(`session_room:${socket.id}`);
      if (roomId) {
        socket.to(roomId).emit('partner_left');
        await redis.del(`session_room:${socket.id}`);
      }
    });

    socket.on('disconnect', async () => {
      // Broadcast updated count when someone disconnects
      broadcastOnlineCount();

      // Remove from queue and rooms
      const roomId = await redis.get(`session_room:${socket.id}`);
      if (roomId) {
        socket.to(roomId).emit('partner_left');
        await redis.del(`session_room:${socket.id}`);
      }
      
      // Look up what queue they were in and remove them
      const myQueue = await redis.get(`queue_key:${socket.id}`);
      if (myQueue) {
        await redis.zrem(myQueue, socket.id);
        await redis.del(`queue_key:${socket.id}`);
      }
    });
  });
};
