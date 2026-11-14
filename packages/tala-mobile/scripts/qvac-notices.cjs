const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (process.env.TALA_QVAC !== '1') throw Error('Notices are QVAC-variant only');
const root = path.resolve(__dirname, '..');
const names = JSON.parse(
  fs.readFileSync(path.join(root, 'qvac/addons.manifest.json'), 'utf8')
).addons;
const rootRequire = require('../qvac-build/resolve.cjs');
const sdkFile = rootRequire.resolve('@qvac/sdk/expo-plugin');
const sdkRequire = createRequire(path.resolve(path.dirname(sdkFile), '../../../../package.json'));
const seen = new Set(),
  inventory = [],
  texts = [];
function walk(name, from, depth = 0) {
  let file;
  for (const spec of [name + '/package', name + '/package.json', name]) {
    try {
      file = from.resolve(spec);
      break;
    } catch {}
  }
  if (!file) throw Error('Cannot inventory ' + name);
  let dir = path.dirname(file);
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw Error('Package root missing');
    dir = parent;
  }
  dir = fs.realpathSync(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (seen.has(dir)) return;
  seen.add(dir);
  const licenseFiles = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        /^(licen[cs]e|notice|copying|copyright)(\.|$)/i.test(f) &&
        fs.statSync(path.join(dir, f)).isFile()
    );
  inventory.push({
    name: pkg.name,
    version: pkg.version,
    license: pkg.license ?? null,
    files: licenseFiles,
  });
  for (const f of licenseFiles)
    texts.push(
      `\n===== ${pkg.name}@${pkg.version} / ${f} =====\n` +
        fs.readFileSync(path.join(dir, f), 'utf8')
    );
  if (depth < 12)
    for (const dep of Object.keys(pkg.dependencies ?? {}))
      walk(dep, createRequire(path.join(dir, 'package.json')), depth + 1);
}
walk('@qvac/sdk', rootRequire);
walk('react-native-bare-kit', rootRequire);
for (const name of names) walk(name, sdkRequire);
const extra = path.join(root, 'native/local-ai/notices');
for (const f of fs.readdirSync(extra))
  texts.push(`\n===== ${f} =====\n` + fs.readFileSync(path.join(extra, f), 'utf8'));
const output = path.join(root, 'android/app/src/main/assets/qvac-licenses');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'NOTICES.txt'), texts.join('\n'));
console.log(
  `Packaged QVAC licence inventory: ${inventory.length} packages, ${texts.length} licence/notice texts`
);
