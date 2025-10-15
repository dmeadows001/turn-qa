/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: '/signin',      destination: '/login', permanent: true },
      { source: '/auth/signin', destination: '/login', permanent: true },
    ];
  },
};

module.exports = nextConfig;
