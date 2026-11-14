const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const localRequire = createRequire(path.join(__dirname, 'package.json'));
function resolve(specifier) {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!fs.existsSync(path.join(__dirname, 'node_modules', name, 'package.json'))) {
    const error = new Error(`Install frozen qvac-build dependencies first: ${name}`);
    error.code = 'MODULE_NOT_FOUND';
    throw error;
  }
  return localRequire.resolve(specifier);
}
function isolatedRequire(specifier) {
  return require(resolve(specifier));
}
isolatedRequire.resolve = resolve;
// Configuration identity remains inspectable in a standard-only installation.
// Actual QVAC prebuild/build is guarded and requires the frozen island install.
isolatedRequire.forConfig = (specifier) => {
  try {
    return resolve(specifier);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return path.join(__dirname, 'node_modules', specifier);
  }
};
module.exports = isolatedRequire;
