/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: true, // <-- enable readable stacks in prod
};

// next.config.js
module.exports = {
  async redirects() {
    return [
      {
        source: '/turn/:id/capture',
        destination: '/turns/:id/capture',
        permanent: true, // or false while testing
      },
    ];
  },
};

module.exports = nextConfig;

