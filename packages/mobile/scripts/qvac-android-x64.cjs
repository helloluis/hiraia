/** Private mixed-fleet build inputs. No node_modules mutations or renamed ARM binaries. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pin = require('../native/qvac-android-x64.json');
const mobile = path.resolve(__dirname, '..');
const cache = path.resolve(mobile, '../../build/qvac-android-x64');
const { buildPlatform, platforms } = require('./build-platform.cjs');

function chromeOSBuild() {
  return buildPlatform() === 'chromeos';
}
function architectures() { return platforms[buildPlatform()].abis; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function assertX64(bytes, name) {
  if (bytes.length < 20 || bytes.toString('hex', 0, 4) !== '7f454c46' ||
      bytes[4] !== 2 || bytes[5] !== 1 || bytes.readUInt16LE(18) !== 62) {
    throw new Error(`${name}: expected an actual Android x86_64 ELF library`);
  }
}
function installedPackage(name) {
  for (let dir = mobile; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (path.dirname(dir) === dir) throw new Error(`Missing native dependency ${name}`);
  }
}
function verifiedPort() {
  for (const [file, sha256] of Object.entries(pin.fabricOverlay)) {
    if (digest(fs.readFileSync(path.join(mobile, 'native', file))) !== sha256) {
      throw new Error(`Unpinned QVAC native patch: ${file}`);
    }
  }
  const manifestPath = path.join(cache, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error('Missing QVAC x86_64 build: run node scripts/build-qvac-android-x64.mjs');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (JSON.stringify(manifest.pin) !== JSON.stringify(pin)) throw new Error('QVAC x86_64 source/toolchain pins changed — rebuild the native port');
  for (const [name, version] of Object.entries(pin.engines)) {
    if (installedPackage(name).version !== version) throw new Error(`${name}: native x86_64 port does not match installed worker version`);
  }
  const required = [
    ...Object.entries(pin.engines).map(([name, version]) => `lib${name.slice(1).replace('/', '__')}.${version}.so`),
    'libqvac-ggml-cpu-x64.so', 'libqvac-ggml-vulkan.so', 'libqvac-ggml-opencl.so',
  ];
  for (const file of required) if (!manifest.files?.[file]) throw new Error(`QVAC x86_64 build lacks ${file}`);
  const actual = fs.readdirSync(path.join(cache, 'x86_64')).sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('QVAC x86_64 cache inventory differs from its manifest');
  for (const [name, sha256] of Object.entries(manifest.files)) {
    if (path.basename(name) !== name || !name.endsWith('.so')) throw new Error(`Invalid native cache filename: ${name}`);
    const bytes = fs.readFileSync(path.join(cache, 'x86_64', name));
    assertX64(bytes, name);
    if (digest(bytes) !== sha256) throw new Error(`QVAC x86_64 cache changed: ${name}`);
  }
  if (!manifest.notices || Object.keys(manifest.notices).length < 4) throw new Error('QVAC native notices missing — rerun the port build');
  for (const [name, sha256] of Object.entries(manifest.notices)) {
    if (path.basename(name) !== name || digest(fs.readFileSync(path.join(cache, 'notices', name))) !== sha256) {
      throw new Error(`QVAC native notice changed: ${name}`);
    }
  }
  return manifest;
}
function checkLinked(jniLibs) {
  if (!chromeOSBuild()) return;
  const manifest = verifiedPort();
  for (const [name, sha256] of Object.entries(manifest.files)) {
    const file = path.join(jniLibs, 'x86_64', name);
    if (!fs.existsSync(file) || digest(fs.readFileSync(file)) !== sha256) {
      throw new Error(`Stale/missing linked ${name} — run HIRAIA_APK_VARIANT=chromeos-preview pnpm prebuild`);
    }
  }
  checkWorkerBindings(jniLibs);
}
function checkWorkerBindings(jniLibs) {
  // SDK 0.17.1's bundler host list mentions ARM Android, but bare-pack --linked
  // emits platform-level Android .so resolutions. Verify that actual output instead
  // of assuming a host list either proves or prevents x86_64 compatibility.
  const parser = require(path.resolve(path.dirname(require.resolve('@qvac/sdk/expo-plugin')),
    '../../commands/bundle/manifest.js'));
  const header = parser.extractBarePackHeader(parser.extractPackedString(
    fs.readFileSync(path.join(mobile, 'qvac/worker.bundle.js'), 'utf8')));
  const addonManifest = JSON.parse(fs.readFileSync(path.join(mobile, 'qvac/addons.manifest.json'), 'utf8'));
  if (header.id !== addonManifest.bundleId) throw new Error('QVAC worker and addon manifest disagree');
  const links = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'arm64' || key === 'x64' || key.startsWith('android-')) {
        throw new Error(`QVAC worker contains architecture-specific resolution ${key}; review the mixed-fleet bundle`);
      }
      if (key === 'android' && typeof child === 'string' && child.startsWith('linked:')) {
        const name = child.slice('linked:'.length);
        if (path.basename(name) !== name || !name.endsWith('.so')) throw new Error(`Unsupported Android addon binding: ${child}`);
        links.add(name);
      }
      walk(child);
    }
  }
  walk(header.resolutions);
  if (links.size !== addonManifest.addons.length) throw new Error('QVAC worker has unresolved/unexpected native addon bindings');
  for (const abi of architectures()) for (const name of links) {
    if (!fs.existsSync(path.join(jniLibs, abi, name))) throw new Error(`QVAC worker requires missing ${abi}/${name}`);
  }
  return { bundleId: header.id, androidBindings: links.size, abis: architectures() };
}
module.exports = { pin, mobile, cache, chromeOSBuild, architectures, digest, assertX64, installedPackage, verifiedPort, checkLinked, checkWorkerBindings };
if (require.main === module) checkLinked(path.join(mobile, 'android/app/src/main/jniLibs'));
