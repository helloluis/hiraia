const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath } = require('node:url');
const QvacPlugin = require('@qvac/sdk/electron-forge');
const { installNative } = require('./scripts/install-native-deps.cjs');
module.exports = {
  packagerConfig: {
    name: 'Hiraia', executableName: 'Hiraia', asar: false,
    icon: process.platform === 'win32' ? path.join(__dirname, 'assets/hiraia.ico') : undefined,
    appBundleId: 'org.hiraia.desktop', appCopyright: 'Hiraia',
    win32metadata: { CompanyName: 'Hiraia', FileDescription: 'Offline science learning', ProductName: 'Hiraia' },
    afterComplete: [(appPath, _version, platform, _arch, done) => {
      try {
        if (platform === 'win32') {
          const runtime = path.join(appPath, 'resources/app/resources/native/msvc');
          for (const file of ['msvcp140.dll', 'msvcp140_1.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']) {
            if (!fs.existsSync(path.join(runtime, file))) throw new Error(`Missing Microsoft runtime: ${file}`);
          }
          for (const file of fs.readdirSync(runtime)) if (file.endsWith('.dll')) fs.copyFileSync(path.join(runtime, file), path.join(appPath, file));
        }
        done();
      } catch (error) { done(error); }
    }],
    ignore: [/^\/scripts\//, /^\/tests\//, /^\/test-results\//, /^\/build\//, /^\/forge\.config\.cjs$/, /^\/pnpm-workspace\.yaml$/],
    afterPrune: [(buildPath, _version, platform, arch, done) => {
      try {
        const addons = JSON.parse(fs.readFileSync(path.join(buildPath, 'qvac/addons.manifest.json'))).addons;
        for (const engine of ['@qvac/llm-llamacpp', '@qvac/embed-llamacpp']) {
          if (!addons.includes(engine)) throw new Error(`Worker graph omitted ${engine}`);
        }
        // QVAC 0.17 generates absolute SDK import URLs. The shipped entry must
        // resolve inside the extracted application, even after moving the ZIP.
        const worker = path.join(buildPath, 'qvac/worker.entry.mjs');
        const portable = fs.readFileSync(worker, 'utf8').replace(/from "(file:[^"]+)"/g, (_match, url) => {
          const absolute = fileURLToPath(url);
          const relative = path.relative(__dirname, absolute);
          if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('QVAC import leaves the staging app');
          return `from "../${relative.split(path.sep).join('/')}"`;
        });
        fs.writeFileSync(worker, portable);
        if (platform === 'win32') {
          if (arch !== 'x64') throw new Error('Only the verified Windows x64 target is supported');
          installNative(path.join(buildPath, 'node_modules'), path.join(buildPath, 'resources/native'));
        }
        // ONNX ships several OS binaries. Keep this package's actual target only.
        const bin = path.join(buildPath, 'node_modules/onnxruntime-node/bin/napi-v6');
        for (const name of fs.readdirSync(bin)) if (name !== platform) fs.rmSync(path.join(bin, name), { recursive: true, force: true });
        const target = path.join(bin, platform);
        for (const name of fs.readdirSync(target)) if (name !== arch) fs.rmSync(path.join(target, name), { recursive: true, force: true });
        done();
      } catch (error) { done(error); }
    }],
  },
  rebuildConfig: { onlyModules: [] },
  makers: [{ name: '@electron-forge/maker-zip', platforms: ['win32', 'darwin'] }],
  plugins: [new QvacPlugin({ projectDir: __dirname })],
};
