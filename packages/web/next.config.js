/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @hiraia/shared ships raw TS (main → src/index.ts), so Next must transpile it to
  // import runtime values from it. It is SERVER-ONLY here (the /api/demo/chat RAG path
  // imports RagStore/SemanticIndex/SCIENCE_FACTS/prompt helpers); the client never
  // imports runtime values from it (factoids.ts uses `import type`, erased at build).
  // Safe to transpile: the package has zero dependencies and no @qvac imports (only
  // mentions it in comments), so it cannot drag the bare-runtime browser shims that
  // previously crashed hydration — those only enter the client bundle if a CLIENT
  // module imports shared at runtime, which none do.
  transpilePackages: ['@hiraia/shared'],
  // better-sqlite3 is a native module — keep it out of the bundle (server-only).
  serverExternalPackages: ['better-sqlite3'],
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    // @hiraia/shared is authored in NodeNext TS style — its relative imports carry
    // explicit `.js` extensions (e.g. './rag/index.js') that point at `.ts` source.
    // tsc resolves these, but webpack matches the extension literally and 404s. Map
    // `.js` specifiers to try the TS source first so the transpiled package resolves.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
    };
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
