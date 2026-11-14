const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { withPlugins, withDangerousMod } = require('expo/config-plugins');
const sdkPlugins = require('@qvac/sdk/expo-plugin');

/** A build-local SDK view supplies the worker import map without mutating installed packages. */
function workerSdkView(projectRoot) {
  const sdk = sdkPlugins.resolveSDKPackageDir(projectRoot);
  const stage = path.join(projectRoot, 'qvac', 'sdk-worker-view');
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const name of fs.readdirSync(sdk.dir)) {
    if (name === 'bare-imports.json' || name === 'node_modules') continue;
    if (name === 'package.json') fs.copyFileSync(path.join(sdk.dir, name), path.join(stage, name));
    else fs.symlinkSync(path.join(sdk.dir, name), path.join(stage, name));
  }
  // pnpm SDK dependencies live beside @qvac/sdk, not inside its package directory.
  fs.symlinkSync(path.resolve(sdk.dir, '../..'), path.join(stage, 'node_modules'));
  const imports = JSON.parse(fs.readFileSync(path.join(sdk.dir, 'bare-imports.json'), 'utf8'));
  const processUrl = pathToFileURL(require.resolve('bare-process')).href;
  imports.process = { bare: processUrl, default: 'process' };
  imports['node:process'] = { bare: processUrl, default: 'node:process' };
  fs.writeFileSync(path.join(stage, 'bare-imports.json'), JSON.stringify(imports, null, 2));
  return { sdk, stage };
}
function withWorker(config) {
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const root = sdkPlugins.getProjectRootFromMod(mod);
      const { sdk, stage } = workerSdkView(root);
      const { bundleSdk, verifyBundle, hasErrors, formatVerifyBundleResult } =
        await import('@qvac/sdk/commands');
      const hosts = ['android-arm64', 'ios-arm64', 'ios-arm64-simulator', 'ios-x64-simulator'];
      const result = await bundleSdk({
        projectRoot: root,
        sdkPath: stage,
        configPath: path.join(root, 'qvac.config.json'),
        hosts,
        defer: [
          'expo-file-system',
          'react-native-bare-kit',
          'bare-runtime/spawn',
          `${sdk.name}/worker.mobile.bundle`,
        ],
        quiet: true,
        checkEngines: false,
      });
      const verified = await verifyBundle({
        projectRoot: root,
        addonsSource: result.bundlePath,
        configPath: path.join(root, 'qvac.config.json'),
        hosts: ['android-arm64'],
      });
      if (hasErrors(verified)) throw Error(formatVerifyBundleResult(verified));
      fs.copyFileSync(result.bundlePath, path.join(sdk.dir, 'dist/worker.mobile.bundle.js'));
      const sdkRequire = createRequire(path.join(sdk.dir, 'package.json'));
      const link = sdkRequire('bare-link');
      const kit = path.dirname(require.resolve('react-native-bare-kit/package.json'));
      const out = path.join(kit, 'android/src/main/addons');
      fs.rmSync(out, { recursive: true, force: true });
      const imports = JSON.parse(fs.readFileSync(path.join(stage, 'bare-imports.json'), 'utf8'));
      let linked = 0;
      for await (const resource of link(result.entryPaths.worker, {
        hosts: ['android-arm64'],
        out,
        imports: { process: imports.process, 'node:process': imports['node:process'] },
      }))
        linked++;
      console.log(`QVAC worker-only process map: verified; linked ${linked} addons`);
      return mod;
    },
  ]);
}
module.exports = (config) =>
  withPlugins(config, [
    withWorker,
    sdkPlugins.withDeviceInfo,
    [
      'expo-build-properties',
      {
        android: {
          minSdkVersion: 29,
          ndkVersion: '29.0.14206865',
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          enableMinifyInReleaseBuilds: true,
        },
      },
    ],
    sdkPlugins.withAndroidNdkVersion,
    sdkPlugins.withAndroidArchitecture,
    sdkPlugins.withOpenCL,
  ]);
module.exports.workerSdkView = workerSdkView;
