const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the workspace root
const workspaceRoot = path.resolve(__dirname, '../..');

const config = getDefaultConfig(__dirname);

// 1. Watch all files in the workspace
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force Metro to resolve workspace packages
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
