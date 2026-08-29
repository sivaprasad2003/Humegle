/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    '192.168.29.89',
    'cube-attic-happiest.ngrok-free.dev',
    '*.ngrok-free.app',
    '*.ngrok.io',
  ],
  async rewrites() {
    return [
      {
        source: '/socket.io/:path*',
        destination: 'http://localhost:8080/socket.io/:path*',
      },
    ];
  },
};

export default nextConfig;
