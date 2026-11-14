// Optional local verification bootstrap when the workspace node_modules was removed.
// Exposes ONLY standard manifest dependencies in the app; never writes root node_modules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
function link(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    const stat = fs.lstatSync(target);
    if (fs.existsSync(target) && !stat.isSymbolicLink() && !target.includes('/.bin/')) return;
    if (!stat.isSymbolicLink() && !stat.isFile())
      throw Error('Refusing to replace directory ' + target);
    fs.unlinkSync(target);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  fs.symlinkSync(source, target);
}
for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
  const source =
    name === '@hiraia/tala-core'
      ? path.resolve(root, '../tala-core')
      : path.join(__dirname, 'node_modules', name);
  if (!fs.existsSync(source)) throw Error('Install isolated toolchain first: ' + name);
  link(source, path.join(root, 'node_modules', name));
}
for (const [name, file] of Object.entries({
  expo: 'expo/bin/cli',
  tsc: 'typescript/bin/tsc',
  tsx: 'tsx/dist/cli.mjs',
}))
  link(path.join(__dirname, 'node_modules', file), path.join(root, 'node_modules/.bin', name));
