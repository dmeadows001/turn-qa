/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  productionBrowserSourceMaps: true, // <-- enable readable stacks in prod
};

module.exports = nextConfig;
