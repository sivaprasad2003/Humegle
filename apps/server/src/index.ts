import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupSocketHandlers } from './socket/handler';
import { logger } from './utils/logger';

// Create a basic HTTP server
const httpServer = createServer((req, res) => {
  res.writeHead(200);
  res.end('Random Chat API is running');
});

// Attach Socket.io for real-time WebSocket communication
const io = new Server(httpServer, {
  cors: {
    origin: "*", // In production, replace with your frontend URL
    methods: ["GET", "POST"]
  }
});

// Initialize our matchmaking and signaling logic
setupSocketHandlers(io);

const PORT = process.env.PORT || 8080;

httpServer.listen(PORT, () => {
  logger.info(`🚀 Signaling server is running on http://localhost:${PORT}`);
});