/**
 * What the OTA runtime version covers beyond @expo/fingerprint's defaults.
 *
 * app.json sets `runtimeVersion: { policy: "fingerprint" }`, so a phone accepts an OTA only
 * when the update's runtimeVersion equals the hash baked into ITS APK (assets/fingerprint,
 * written at build time by expo-updates' createReleaseUpdatesResources task). That hash is
 * the on-device guard against shipping JS onto native code it was not built for — but
 * android/ is gitignored here, so both expo-updates and @expo/fingerprint treat the project
 * as "managed" and hash app.json, the config plugins and the autolinked modules only. Every
 * native input that reaches the APK some other way is invisible to the default, and an OTA
 * that disagrees with it breaks AFTER first render, where expo-updates' error recovery
 * cannot roll it back:
 *
 *   QVAC addons  withQvacAddons.js links version-suffixed .so files
 *                (libqvac__llm-llamacpp.0.39.4.so, libbare-tls.3.1.5.so, ...) into jniLibs,
 *                and the worker that dlopen()s them BY THOSE NAMES travels inside the JS
 *                bundle (@qvac/sdk/worker.mobile.bundle). A worker packed against other
 *                addon versions fails at model load with `AddonError: dlopen failed`. So
 *                the worker's bare-pack id and every addon's installed version are hashed.
 *   illustrations  12k PNGs are staged into the APK's assets/illustrations/ by
 *                scripts/stage-bundled-art.mjs; JS only carries the inventory
 *                (bundledArt.generated.json, selected by imageMap.ts). An OTA with a
 *                different inventory would point at pictures the APK does not have.
 *   native patches  post-prebuild.mjs, illustration-assets.gradle, stage-bundled-art.mjs
 *                and native/ (HiraiaMemoryPackage.kt, copied in by withHiraiaMemory.js)
 *                change the binary without touching anything the default hashes.
 *   qvac.config.json  the worker's plugin set.
 *   certs/certificate.pem  the code-signing certificate prebuild inlines into the manifest.
 *
 * FAIL CLOSED. qvac/ is gitignored and written by prebuild; a tree that never ran prebuild
 * has no addons manifest. @expo/fingerprint swallows an error thrown while this file is
 * REQUIRED (Config.js: `catch { rawConfig = {} }`) and would then hash without any of the
 * sources below — a plausible-looking fingerprint that silently matches nothing it should
 * guard. So the sources are computed in a GETTER, which the loader reads outside that
 * try/catch: a missing manifest or addon makes `fingerprint:generate` and the gradle task
 * fail with the reason instead.
 *
 * CommonJS (the package has no "type": "module") and SILENT: the CLI's stdout is the JSON
 * the build and deploy/publish-ota.py parse, so nothing here may print.
 */
const fs = require('fs');
const path = require('path');

/** Committed files whose bytes are native inputs. A missing one is an error, not a skip. */
const FILES = [
  ['qvac.config.json', 'hiraia: QVAC worker plugin set'],
  ['src/generated/bundledArt.generated.json', 'hiraia: bundled illustration inventory (APK assets/illustrations)'],
  ['src/generated/imageMap.ts', 'hiraia: bundled illustration selection'],
  ['scripts/post-prebuild.mjs', 'hiraia: native patches'],
  ['scripts/illustration-assets.gradle', 'hiraia: native patches'],
  ['scripts/stage-bundled-art.mjs', 'hiraia: native patches'],
  ['certs/certificate.pem', 'hiraia: OTA code-signing certificate'],
];
const DIRS = [['native', 'hiraia: native sources copied in by config plugins']];

/** Node's own lookup (walk up through node_modules), minus `exports`, which hides package.json. */
function installedVersion(name) {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    const file = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')).version;
    if (path.dirname(dir) === dir) throw new Error(`fingerprint.config.js: QVAC addon ${name} is not installed`);
  }
}

function qvacNative() {
  const file = path.join(__dirname, 'qvac', 'addons.manifest.json');
  if (!fs.existsSync(file)) {
    throw new Error('fingerprint.config.js: qvac/addons.manifest.json is missing — run `pnpm prebuild` first');
  }
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^[0-9a-f]{64}$/.test(manifest.bundleId ?? '')) {
    throw new Error(`fingerprint.config.js: qvac/addons.manifest.json has no worker bundleId (${manifest.bundleId})`);
  }
  if (!Array.isArray(manifest.addons) || manifest.addons.length === 0) {
    throw new Error('fingerprint.config.js: qvac/addons.manifest.json lists no addons');
  }
  const addons = manifest.addons.map((name) => `${name}@${installedVersion(name)}`).sort();
  return JSON.stringify({ version: manifest.version, bundleId: manifest.bundleId, addons });
}

let sources;
function extraSources() {
  if (sources) return sources;
  for (const [file] of [...FILES, ...DIRS]) {
    if (!fs.existsSync(path.join(__dirname, file))) throw new Error(`fingerprint.config.js: ${file} is missing`);
  }
  sources = [
    { type: 'contents', id: 'hiraia-qvac-native', contents: qvacNative(), reasons: ['hiraia: QVAC addon versions + worker bundleId'] },
    ...FILES.map(([filePath, reason]) => ({ type: 'file', filePath, reasons: [reason] })),
    ...DIRS.map(([filePath, reason]) => ({ type: 'dir', filePath, reasons: [reason] })),
  ];
  return sources;
}

/** @type {import('@expo/fingerprint').Config} */
module.exports = {};
Object.defineProperty(module.exports, 'extraSources', { enumerable: true, get: extraSources });
