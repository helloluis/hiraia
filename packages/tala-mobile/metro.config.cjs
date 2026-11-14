const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../..')];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../../node_modules'),
];
config.resolver.resolveRequest = (context, name, platform) => {
  if (name === '@hiraia/tala-core' || name.startsWith('@hiraia/tala-core/')) {
    const core = path.resolve(__dirname, '../tala-core');
    const key = '.' + name.slice('@hiraia/tala-core'.length);
    const target = require(path.join(core, 'package.json')).exports[key];
    if (typeof target === 'string')
      return { type: 'sourceFile', filePath: path.resolve(core, target) };
  }
  if (
    process.env.TALA_QVAC === '1' &&
    (name === '@qvac/sdk' || name.startsWith('@qvac/sdk/') || name === 'react-native-bare-kit')
  ) {
    const isolated = require('./qvac-build/resolve.cjs');
    isolated.resolve(
      name === 'react-native-bare-kit'
        ? 'react-native-bare-kit/package.json'
        : '@qvac/sdk/expo-plugin'
    );
    return context.resolveRequest(
      { ...context, originModulePath: path.join(__dirname, 'qvac-build/package.json') },
      name,
      platform
    );
  }
  if (name === './native-engine' && context.originModulePath.includes('/local-ai/')) {
    return {
      type: 'sourceFile',
      filePath: path.join(
        __dirname,
        'src/features/local-ai',
        process.env.TALA_QVAC === '1' ? 'engine.qvac.ts' : 'engine.stub.ts'
      ),
    };
  }
  if (
    name === 'react' ||
    name.startsWith('react/') ||
    name === 'react-dom' ||
    name.startsWith('react-dom/')
  ) {
    return { type: 'sourceFile', filePath: require.resolve(name, { paths: [__dirname] }) };
  }
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
