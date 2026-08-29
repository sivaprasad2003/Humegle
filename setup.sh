#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "Creating random-chat-platform repository structure..."

# Create base directories
mkdir -p random-chat-platform/{infra/{coturn,nginx},packages/{shared,database},apps/server/src/{socket,services,utils},apps/web/src/{app,store,hooks,components}}
cd random-chat-platform

# 1. Root Files
cat << 'EOF' > .env.example
DATABASE_URL="postgresql://chatadmin:securepassword@localhost:5432/randomchat?schema=public"
REDIS_URL="redis://:secure_redis_pass@localhost:6379"
TURN_SECRET="super_secret_turn_key"
NEXT_PUBLIC_WS_URL="ws://localhost:8080"
EOF

cat << 'EOF' > docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: chatadmin
      POSTGRES_PASSWORD: securepassword
      POSTGRES_DB: randomchat
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chatadmin -d randomchat"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass secure_redis_pass
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  coturn:
    image: coturn/coturn:latest
    command: -c /etc/coturn/turnserver.conf
    network_mode: "host"
    volumes:
      - ./infra/coturn/turnserver.conf:/etc/coturn/turnserver.conf

volumes:
  pgdata:
  redisdata:
EOF

# 2. Infrastructure
cat << 'EOF' > infra/coturn/turnserver.conf
# Coturn configuration for WebRTC
listening-port=3478
tls-listening-port=5349
use-auth-secret
static-auth-secret=super_secret_turn_key
realm=chat.yourdomain.com
total-quota=100
bps-capacity=0
stale-nonce
no-loopback-peers
no-multicast-peers
EOF

# 3. Packages
cat << 'EOF' > packages/database/schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Report {
  id          String   @id @default(uuid())
  reporterId  String
  reportedId  String
  reason      String
  createdAt   DateTime @default(now())
  resolved    Boolean  @default(false)

  @@index([reporterId])
  @@index([createdAt])
}

model AnalyticsEvent {
  id        String   @id @default(uuid())
  type      String
  duration  Int?
  createdAt DateTime @default(now())

  @@index([type, createdAt])
}
EOF

# 4. Backend (Server)
cat << 'EOF' > apps/server/src/services/matchmaker.ts
import { redis } from './redis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

const MATCH_SCRIPT = `
local targetQueue = KEYS[1]
local myQueue = KEYS[2]
local mySessionId = ARGV[1]
local timestamp = ARGV[2]

local match = redis.call('ZRANGE', targetQueue, 0, 0)
if match and #match > 0 then
    local matchedSessionId = match[1]
    redis.call('ZREM', targetQueue, matchedSessionId)
    return matchedSessionId
else
    redis.call('ZADD', myQueue, timestamp, mySessionId)
    return nil
end
`;

export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'ANY';

export class Matchmaker {
  static async findMatch(sessionId: string, myGender: Gender, interest: Gender): Promise<{ roomId: string, partnerId: string } | null> {
    const myQueue = `queue:${myGender}:${interest}`;
    const targetQueue = `queue:${interest}:${myGender}`;
    
    const actualTargetQueue = interest === 'ANY' ? `queue:ANY:ANY` : targetQueue;
    const actualMyQueue = interest === 'ANY' ? `queue:ANY:ANY` : myQueue;

    try {
      const partnerId = await redis.eval(
        MATCH_SCRIPT,
        2,
        actualTargetQueue,
        actualMyQueue,
        sessionId,
        Date.now().toString()
      ) as string | null;

      if (partnerId) {
        const roomId = uuidv4();
        await redis.set(`room:${roomId}`, JSON.stringify({ user1: sessionId, user2: partnerId }), 'EX', 86400);
        await redis.set(`session_room:${sessionId}`, roomId, 'EX', 86400);
        await redis.set(`session_room:${partnerId}`, roomId, 'EX', 86400);
        
        logger.info({ roomId, sessionId, partnerId }, 'Match created successfully');
        return { roomId, partnerId };
      }
      return null;
    } catch (error) {
      logger.error({ error, sessionId }, 'Matchmaking error');
      throw new Error('Matchmaking failed');
    }
  }

  static async removeFromQueue(sessionId: string, myGender: Gender, interest: Gender) {
    const myQueue = `queue:${myGender}:${interest}`;
    await redis.zrem(myQueue, sessionId);
  }
}
EOF

cat << 'EOF' > apps/server/src/socket/handler.ts
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

export function setupSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Client connected');

    socket.on('join_queue', async (data, ack) => {
      try {
        const { gender, interest } = JoinSchema.parse(data);
        const existingRoom = await redis.get(`session_room:${socket.id}`);
        
        if (existingRoom) {
          socket.leave(existingRoom);
          await redis.del(`session_room:${socket.id}`);
        }

        const match = await Matchmaker.findMatch(socket.id, gender, interest);

        if (match) {
          socket.join(match.roomId);
          const partnerSocket = io.sockets.sockets.get(match.partnerId);
          if (partnerSocket) {
            partnerSocket.join(match.roomId);
            io.to(match.roomId).emit('matched', { roomId: match.roomId, role: 'initiator' });
          }
        } else {
          ack({ status: 'queued' });
        }
      } catch (err) {
        socket.emit('error', { message: 'Invalid join payload' });
      }
    });

    socket.on('webrtc_signal', async (data) => {
      try {
        const { type, payload } = SignalSchema.parse(data);
        const roomId = await redis.get(`session_room:${socket.id}`);
        
        if (!roomId) return socket.emit('error', { message: 'Not in a room' });
        socket.to(roomId).emit('webrtc_signal', { type, payload, sender: socket.id });
      } catch (err) {
        logger.warn({ socketId: socket.id }, 'Invalid signal payload');
      }
    });

    socket.on('skip', async () => {
      const roomId = await redis.get(`session_room:${socket.id}`);
      if (roomId) {
        const deleted = await redis.del(`room:${roomId}`);
        if (deleted === 1) {
          socket.to(roomId).emit('partner_left');
          io.socketsLeave(roomId);
        }
        await redis.del(`session_room:${socket.id}`);
      }
    });

    socket.on('disconnect', async () => {
      const roomId = await redis.get(`session_room:${socket.id}`);
      if (roomId) {
        const deleted = await redis.del(`room:${roomId}`);
        if (deleted === 1) {
          socket.to(roomId).emit('partner_left');
        }
        await redis.del(`session_room:${socket.id}`);
      } else {
        await Matchmaker.removeFromQueue(socket.id, 'MALE', 'FEMALE');
      }
    });
  });
}
EOF

# 5. Frontend (Web)
cat << 'EOF' > apps/web/src/store/chat-store.ts
import { create } from 'zustand';

type AppState = 'IDLE' | 'SEARCHING' | 'MATCHED' | 'CONNECTING' | 'CONNECTED' | 'PARTNER_DISCONNECTED' | 'ERROR';

interface ChatStore {
  state: AppState;
  roomId: string | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  setState: (state: AppState) => void;
  setStreams: (local: MediaStream | null, remote: MediaStream | null) => void;
  reset: () => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  state: 'IDLE',
  roomId: null,
  localStream: null,
  remoteStream: null,
  setState: (state) => set({ state }),
  setStreams: (local, remote) => set({ localStream: local, remoteStream: remote }),
  reset: () => set({ state: 'IDLE', roomId: null, remoteStream: null }),
}));
EOF

cat << 'EOF' > apps/web/src/hooks/useWebRTC.ts
import { useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useChatStore } from '../store/chat-store';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ],
};

export const useWebRTC = (socket: Socket) => {
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const { localStream, setStreams, setState } = useChatStore();

  const initWebRTC = async (isInitiator: boolean) => {
    peerConnection.current = new RTCPeerConnection(ICE_SERVERS);

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        peerConnection.current?.addTrack(track, localStream);
      });
    }

    peerConnection.current.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        setStreams(localStream, event.streams[0]);
        setState('CONNECTED');
      }
    };

    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc_signal', { type: 'ice-candidate', payload: event.candidate });
      }
    };

    peerConnection.current.onconnectionstatechange = () => {
      if (peerConnection.current?.connectionState === 'failed') {
        setState('ERROR');
      }
    };

    if (isInitiator) {
      const offer = await peerConnection.current.createOffer();
      await peerConnection.current.setLocalDescription(offer);
      socket.emit('webrtc_signal', { type: 'offer', payload: offer });
    }
  };

  useEffect(() => {
    socket.on('matched', async ({ role }) => {
      setState('CONNECTING');
      await initWebRTC(role === 'initiator');
    });

    socket.on('webrtc_signal', async ({ type, payload }) => {
      if (!peerConnection.current) return;

      if (type === 'offer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);
        socket.emit('webrtc_signal', { type: 'answer', payload: answer });
      } else if (type === 'answer') {
        await peerConnection.current.setRemoteDescription(new RTCSessionDescription(payload));
      } else if (type === 'ice-candidate') {
        await peerConnection.current.addIceCandidate(new RTCIceCandidate(payload));
      }
    });

    socket.on('partner_left', () => {
      peerConnection.current?.close();
      peerConnection.current = null;
      setState('PARTNER_DISCONNECTED');
    });

    return () => {
      socket.off('matched');
      socket.off('webrtc_signal');
      socket.off('partner_left');
    };
  }, [socket, localStream]);

  const endConnection = () => {
    peerConnection.current?.close();
    peerConnection.current = null;
  };

  return { endConnection };
};
EOF

# 6. Touch empty files for structure completeness
touch packages/shared/types.ts
touch packages/shared/constants.ts
touch apps/server/src/index.ts
touch apps/server/src/services/redis.ts
touch apps/server/src/utils/logger.ts
touch apps/web/src/app/page.tsx
touch apps/web/src/app/layout.tsx
touch apps/web/src/app/globals.css
touch apps/web/src/components/VideoPlayer.tsx
touch apps/web/src/components/ChatBox.tsx
touch apps/web/src/components/MatchControls.tsx

echo "✅ Generation complete. Navigate to 'random-chat-platform' to view the structure."