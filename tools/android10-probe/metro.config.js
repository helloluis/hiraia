const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');
const config = getDefaultConfig(__dirname);
const deps = fs.realpathSync(path.join(__dirname, 'node_modules'));
config.watchFolders = [deps];
config.resolver.nodeModulesPaths = [deps];
// Freeze the exact worker used by unified, without running the QVAC prebuild
// plugin (which would overwrite the SDK bundle in its shared node_modules).
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === '@qvac/sdk/worker.mobile.bundle') {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'build/worker.mobile.bundle.js') };
  }
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
