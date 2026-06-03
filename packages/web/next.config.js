/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: do NOT transpile @hiraia/shared here — the web client doesn't import it
  // at runtime, and pulling it in drags @qvac/sdk's bare-runtime browser shims
  // into the client bundle (crashes hydration with "r(...).addon is not a function").
  // better-sqlite3 is a native module — keep it out of the bundle (server-only).
  serverExternalPackages: ['better-sqlite3'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // QVAC's bare-runtime packages (bare-process/stream/url/...) get pulled into
      // the client as the `process`/`stream` polyfills and crash hydration with
      // "r(...).addon is not a function". Stub them + the node builtins they alias
      // out of the browser bundle (the client is fetch-only and needs none of them).
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        'bare-process': false, 'bare-stream': false, 'bare-url': false,
        'bare-events': false, 'bare-buffer': false, 'bare-fs': false,
        'bare-path': false, 'bare-os': false, 'bare-tty': false,
        process: false, stream: false,
      };
    }
    return config;
  },
};

export default nextConfig;
