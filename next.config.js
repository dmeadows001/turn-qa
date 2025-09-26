/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      // Old gates → new turns list
      { source: '/managers/login', destination: '/managers/turns', permanent: false },
      { source: '/admin/login', destination: '/managers/turns', permanent: false },
      { source: '/admin/turns', destination: '/managers/turns', permanent: false },
    ];
  },
};

module.exports = nextConfig;
