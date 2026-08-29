/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['192.168.29.89'],
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
