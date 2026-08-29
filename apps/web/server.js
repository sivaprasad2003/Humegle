/**
 * Custom Next.js server that properly proxies WebSocket (Socket.io) connections
 * to the backend. Next.js rewrites() only handle HTTP, not WebSocket upgrades.
 */
const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const httpProxy = require('http-proxy');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev, hostname: '0.0.0.0', port: 3000 });
const handle = app.getRequestHandler();

// Proxy server that forwards /socket.io/* to the backend
const proxy = httpProxy.createProxyServer({
  target: 'http://localhost:8080',
  ws: true,       // Enable WebSocket proxy support
  changeOrigin: true,
});

proxy.on('error', (err, req, res) => {
  console.error('[Proxy Error]', err.message);
  if (res && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Backend not available. Is the server running on port 8080?');
  }
});

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    // Route socket.io HTTP polling requests to backend
    if (parsedUrl.pathname.startsWith('/socket.io')) {
      proxy.web(req, res);
    } else {
      // All other requests go to Next.js
      handle(req, res, parsedUrl);
    }
  });

  // CRITICAL: Handle WebSocket upgrade requests for socket.io
  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/socket.io')) {
      proxy.ws(req, socket, head);
    }
  });

  server.listen(3000, '0.0.0.0', () => {
    console.log('✅ Custom Next.js server running on http://localhost:3000');
    console.log('✅ WebSocket proxy enabled → http://localhost:8080');
  });

  server.on('error', (err) => {
    console.error('Server error:', err);
  });
});
