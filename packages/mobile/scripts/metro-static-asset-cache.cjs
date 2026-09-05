/**
 * Release-build-only Metro asset index cache. Load with NODE_OPTIONS=--require=... .
 * The shipped catalogue has thousands of siblings; Metro 0.83 rebuilds their entire
 * directory index for EACH image, including during its final asset serialization.
 * This changes only that lookup cost. Asset bytes, hashes, scales and platform choice
 * still come from Metro. Do NOT load into a development watcher: directory contents
 * are intentionally frozen for this one build process. Does not edit node_modules.
 */
const fs = require('node:fs');
const Module = require('node:module');
const original = Module._extensions['.js'];
Module._extensions['.js'] = function (mod, filename) {
  if (!/[\\/]metro[\\/]src[\\/]Assets\.js$/.test(filename)) return original(mod, filename);
  let source = fs.readFileSync(filename, 'utf8');
  const listing = '  const files = await _fs.default.promises.readdir(dir);';
  const indexing = '  const map = buildAssetMap(dir, files, platform);';
  if (!source.includes(listing) || !source.includes(indexing)) {
    throw new Error('Metro Assets.js changed; review the release asset-cache adapter.');
  }
  source = source.replace(listing, '').replace(indexing, '  const map = await hiraiaDirectoryIndex(dir, platform);');
  source += `
const hiraiaDirectoryIndexes = new Map();
function hiraiaDirectoryIndex(dir, platform) {
  const key = JSON.stringify([dir, platform]);
  let promise = hiraiaDirectoryIndexes.get(key);
  if (!promise) {
    promise = _fs.default.promises.readdir(dir).then(files => buildAssetMap(dir, files, platform));
    hiraiaDirectoryIndexes.set(key, promise);
    promise.catch(() => hiraiaDirectoryIndexes.delete(key));
  }
  return promise;
}
`;
  mod._compile(source, filename);
};
