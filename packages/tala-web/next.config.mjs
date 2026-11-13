/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Both packages ship raw TypeScript (main -> src/index.ts); Next must transpile them.
  transpilePackages: ['@hiraia/tala-core', '@hiraia/tala-server'],
  // Native modules: keep them out of the bundle, server-only.
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  poweredByHeader: false,
  // Linting runs separately (the monorepo root config needs typed-lint setup); the build gates are tsc + tests.
  eslint: { ignoreDuringBuilds: true },
  // One light theme, no runtime font service (BRAND-3/4): nothing to configure here.
  images: { unoptimized: true },
  webpack: config => {
    // The server locates its curriculum data with `new URL('../../../data/', import.meta.url)`. Webpack would try
    // to bundle that directory as an asset; leave URLs alone in the server package so it resolves at runtime.
    config.module.rules.push({ test: /packages[\\/]tala-server[\\/]src[\\/].*\.ts$/, parser: { url: false } });
    return config;
  },
};

export default nextConfig;
