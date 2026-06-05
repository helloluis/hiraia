/**
 * Inject QVAC/bare native addons (.so) into the app's jniLibs so they are
 * packaged into the APK.
 *
 * Why: the on-device worker (react-native-bare-kit) dlopen()s versioned addons
 * like `libbare-abort.2.0.13.so` and the QVAC engine `libqvac__llm-llamacpp.*.so`
 * at runtime. QVAC's gradle-time linker (react-native-bare-kit/android/link.mjs ->
 * src/main/addons) does NOT populate them in our pnpm monorepo, so the APK ships
 * with only `libbare-kit.so` and the worker aborts:
 *   AddonError: dlopen failed: library "libbare-abort.2.0.13.so" not found
 *
 * `bare-link` itself resolves the addons fine, so we run it ourselves at PREBUILD
 * time (which has node + the right cwd) and write into the app module's canonical
 * jniLibs dir, which gradle always packages into lib/<abi>/.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withQvacAddons(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const jniLibs = path.join(
        cfg.modRequest.platformProjectRoot, // android/
        'app',
        'src',
        'main',
        'jniLibs'
      );

      // Use the bundle's allowlist (qvac/addons.manifest.json, written by the
      // @qvac/sdk expo plugin earlier in prebuild) so we only link the engines we
      // actually bundled; fall back to linking everything installed.
      const manifestPath = path.join(projectRoot, 'qvac', 'addons.manifest.json');
      let pkg = null;
      if (fs.existsSync(manifestPath)) {
        const addons = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).addons || [];
        if (addons.length > 0) {
          pkg = {
            name: 'qvac-addons',
            version: '0.0.0',
            dependencies: Object.fromEntries(addons.map((n) => [n, '*'])),
          };
        }
      }

      const { default: link } = await import('bare-link');
      let count = 0;
      for await (const _resource of link(
        projectRoot,
        { hosts: ['android-arm64'], out: jniLibs },
        pkg
      )) {
        count++;
      }
      console.log(`[withQvacAddons] linked ${count} native addon(s) into app/src/main/jniLibs`);
      return cfg;
    },
  ]);
};
