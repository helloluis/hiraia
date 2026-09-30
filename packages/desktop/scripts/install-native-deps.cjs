'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const native = path.resolve(__dirname, '../resources/native');
function installNative(directory, nativeDirectory = native) {
  const dll = path.join(nativeDirectory, 'vulkan-1.dll');
  if (!fs.existsSync(dll)) throw new Error('Build the pinned Vulkan loader before packaging');
  const visited = new Set();
  let copied = 0;
  function visit(dir) {
    const real = fs.realpathSync(dir);
    if (visited.has(real)) return;
    visited.add(real);
    for (const entry of fs.readdirSync(real, { withFileTypes: true })) {
      const file = path.join(real, entry.name);
      if (entry.name === 'win32-x64' && fs.statSync(file).isDirectory() && real.includes('@qvac')) {
        if (fs.readdirSync(file).some(n => n.endsWith('.bare'))) { fs.copyFileSync(dll, path.join(file, 'vulkan-1.dll')); copied++; }
      } else if ((entry.isDirectory() || entry.isSymbolicLink()) && entry.name !== '.cache') {
        try { if (fs.statSync(file).isDirectory()) visit(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      }
    }
  }
  visit(directory);
  if (copied < 2) throw new Error('The Windows QVAC engines were not found');
  console.log(`Installed Vulkan loader beside ${copied} native QVAC addons.`);
}
if (require.main === module) installNative(path.join(root, 'node_modules'));
module.exports = { installNative };
