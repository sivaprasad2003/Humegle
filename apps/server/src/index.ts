import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupSocketHandlers } from './socket/handler';
import { logger } from './utils/logger';
import { redis } from './services/redis';

// Create a basic HTTP server
const httpServer = createServer((req, res) => {
  res.writeHead(200);
  res.end('Humegle API is running');
});

// Attach Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Initialize matchmaking and signaling
setupSocketHandlers(io);

const PORT = process.env.PORT || 8080;

async function start() {
  // Flush all stale queue/session/room data from any previous crashed run
  // This prevents ghost matches where users are matched with disconnected socket IDs
  try {
    const keys = await redis.keys('queue:*');
    const sessionKeys = await redis.keys('session_room:*');
    const roomKeys = await redis.keys('room:*');
    const queueKeyKeys = await redis.keys('queue_key:*');
    const allStaleKeys = [...keys, ...sessionKeys, ...roomKeys, ...queueKeyKeys];
    if (allStaleKeys.length > 0) {
      await redis.del(...allStaleKeys);
      logger.info(`🧹 Cleared ${allStaleKeys.length} stale Redis keys from previous session`);
    }
  } catch (err) {
    logger.warn('Could not flush Redis on startup (Redis may not be running)');
  }

  httpServer.listen(PORT, () => {
    logger.info(`🚀 Signaling server running on http://localhost:${PORT}`);
  });
}

start();