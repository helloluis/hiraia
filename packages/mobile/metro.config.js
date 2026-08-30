const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the workspace root
const workspaceRoot = path.resolve(__dirname, '../..');

const config = getDefaultConfig(__dirname);

// 0. NO 'gguf' HERE, deliberately. The two LoRA adapters (213.5 MB) used to be
// Metro-bundled assets inside the APK; they are now DOWNLOADED from the mirror and
// verified against a declared size + MD5, exactly like the base model and the LaBSE
// embedder (src/config/model.ts REMOTE_ASSETS, src/engine/modelDownload.ts). Adding
// 'gguf' back would put every .gguf under assets/ into the APK again — the files are
// still on disk because they are what gets uploaded to the mirror, so this line is
// all that stands between them and the shipped binary.
// The bundled int8 semantic-vectors blob — Metro packages it so expo-asset can
// read its bytes into an Int8Array at runtime (for the SemanticIndex).
config.resolver.assetExts.push('bin');
// The prebuilt card database. Metro packages it so expo-asset can resolve a path we can copy
// somewhere SQLite is able to open — the APK entry is a compressed zip member, not a file, so
// it has to be materialised once before it can be queried.
config.resolver.assetExts.push('db');

// 1. Watch all files in the workspace
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Keep hierarchical (walk-up) resolution ENABLED. pnpm's store nests
// version-conflicting transitive deps under each package (e.g. reanimated needs
// semver@7 while another dep pins semver@6, which is the one hoisted to root).
// disableHierarchicalLookup would pin Metro to the two flat paths and resolve the
// wrong version; letting it walk up finds each package's own nested deps.

// 4. Resolve NodeNext-style `.js` import specifiers to their `.ts(x)` source.
// @hiraia/shared is authored with explicit `.js` extensions (e.g.
// `export * from './types/index.js'`) per NodeNext; tsc and Vite rewrite those
// to the real `.ts` files, but Metro does not — it would look for a literal
// `.js` that doesn't exist and fail to bundle. Strip the extension on relative
// `.js` imports and let Metro re-resolve (its sourceExts cover ts/tsx, and a
// genuine `.js` still resolves extensionless), falling back to the default.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // fall through to the default resolver below
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
