const { withAndroidManifest, withAppBuildGradle, withDangerousMod, AndroidConfig } =
  require('@expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

const PERMISSIONS = [
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_WIFI_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.BLUETOOTH_ADVERTISE',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.NEARBY_WIFI_DEVICES',
];

const DESUGAR = "coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'";
const KEEP = `
# Hiraia Tala Nearby (plugins/withTalaNearby.js)
-keep class expo.modules.hiraiatala.** { *; }
-keep class com.google.android.gms.nearby.** { *; }
`;

function ensurePermission(manifest, name) {
  const uses = manifest.manifest['uses-permission'] ?? [];
  if (uses.some((p) => p.$?.['android:name'] === name)) return;
  uses.push({ $: { 'android:name': name } });
  manifest.manifest['uses-permission'] = uses;
}

function embedDebugBundle(src) {
  if (src.includes('debuggableVariants = []')) return src;
  return src.replace(
    /\/\/ debuggableVariants = \["liteDebug", "prodDebug"\]/,
    'debuggableVariants = []'
  );
}

function applyDesugar(src) {
  let out = src;
  if (!out.includes('coreLibraryDesugaringEnabled')) {
    if (/compileOptions\s*\{/.test(out)) {
      out = out.replace(
        /compileOptions\s*\{/,
        'compileOptions {\n        coreLibraryDesugaringEnabled true'
      );
    } else {
      out = out.replace(
        /android\s*\{/,
        `android {
    compileOptions {
        coreLibraryDesugaringEnabled true
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
    }`
      );
    }
  }
  if (!out.includes('desugar_jdk_libs')) {
    out = out.replace(/dependencies\s*\{/, `dependencies {\n    ${DESUGAR}`);
  }
  return out;
}

function pinKotlin(src) {
  return src.replace(
    /classpath\(['"]org\.jetbrains\.kotlin:kotlin-gradle-plugin[^'"]*['"]\)/,
    "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.2.20')"
  );
}

function withTalaNearby(config) {
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    for (const name of PERMISSIONS) ensurePermission(manifest, name);
    const uses = manifest.manifest['uses-permission'] ?? [];
    for (const p of uses) {
      const n = p.$?.['android:name'];
      if (n === 'android.permission.BLUETOOTH_SCAN' || n === 'android.permission.NEARBY_WIFI_DEVICES') {
        p.$['android:usesPermissionFlags'] = 'neverForLocation';
      }
    }
    return config;
  });
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = embedDebugBundle(applyDesugar(config.modResults.contents));
    return config;
  });
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const root = path.join(config.modRequest.platformProjectRoot, 'build.gradle');
      if (fs.existsSync(root)) {
        fs.writeFileSync(root, pinKotlin(fs.readFileSync(root, 'utf8')));
      }
      return config;
    },
  ]);
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const pro = path.join(config.modRequest.projectRoot, 'android/app/proguard-rules.pro');
      if (fs.existsSync(pro)) {
        const body = fs.readFileSync(pro, 'utf8');
        if (!body.includes('expo.modules.hiraiatala')) fs.appendFileSync(pro, KEEP);
      }
      return config;
    },
  ]);
  return config;
}

module.exports = withTalaNearby;
module.exports.applyDesugar = applyDesugar;
