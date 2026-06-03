/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@hiraia/shared'],
  // better-sqlite3 is a native module — keep it out of the bundle (server-only).
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
