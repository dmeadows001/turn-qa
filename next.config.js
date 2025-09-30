/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // DO NOT set `output: 'export'` — we need SSR for auth pages
};

module.exports = nextConfig;
