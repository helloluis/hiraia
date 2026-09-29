const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');

// Reading and local inference do not require phone hardware. Optional features must
// be explicit: camera/Bluetooth permissions otherwise imply Play device filters.
const OPTIONAL_FEATURES = [
  'touchscreen', 'touchscreen.multitouch', 'touchscreen.multitouch.distinct',
  'faketouch', 'camera', 'camera.autofocus', 'camera.any', 'microphone',
  'bluetooth', 'bluetooth_le', 'location', 'location.gps', 'location.network',
  'sensor.accelerometer', 'sensor.gyroscope', 'telephony', 'wifi',
];

function applyAdaptiveWindow(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  activity.$['android:resizeableActivity'] = 'true';
  activity.$['android:screenOrientation'] = 'unspecified';
  const changes = new Set((activity.$['android:configChanges'] || '').split('|').filter(Boolean));
  // RN 0.81 does not fully relayout live font-scale changes. Let Android recreate
  // the Activity and apply its font metrics; readingSession retains the JS UI state.
  changes.delete('fontScale');
  for (const change of ['orientation', 'screenSize', 'smallestScreenSize', 'screenLayout',
    'density', 'keyboard', 'keyboardHidden', 'navigation', 'uiMode']) changes.add(change);
  activity.$['android:configChanges'] = [...changes].join('|');
  const features = manifest.manifest['uses-feature'] ??= [];
  for (const feature of OPTIONAL_FEATURES) {
    const name = `android.hardware.${feature}`;
    const existing = features.find((item) => item.$?.['android:name'] === name);
    if (existing) existing.$['android:required'] = 'false';
    else features.push({ $: { 'android:name': name, 'android:required': 'false' } });
  }
  return manifest;
}

function applyFontBootstrap(source) {
  const marker = '    loadReactNative(this)';
  const call = '    HiraiaFontScale.install()';
  if (source.includes(call)) return source;
  if (!source.includes(marker)) throw new Error('Cannot install font-scale bootstrap before React startup');
  return source.replace(marker, `${marker}\n${call}`);
}

module.exports = (config) => {
  config = withAndroidManifest(config, (cfg) => {
    cfg.modResults = applyAdaptiveWindow(cfg.modResults);
    return cfg;
  });
  return withDangerousMod(config, ['android', async (cfg) => {
    const mobile = cfg.modRequest.projectRoot;
    if (!require('react-native/package.json').version.startsWith('0.81.')) {
      throw new Error('Review/remove the RN 0.81 font-scale compatibility shim for this React Native version');
    }
    const dir = path.join(mobile, 'android/app/src/main/java/com/hiraia/app');
    const app = path.join(dir, 'MainApplication.kt');
    fs.writeFileSync(app, applyFontBootstrap(fs.readFileSync(app, 'utf8')));
    fs.copyFileSync(path.join(mobile, 'native/window/HiraiaFontScale.kt'), path.join(dir, 'HiraiaFontScale.kt'));
    return cfg;
  }]);
};
module.exports.applyAdaptiveWindow = applyAdaptiveWindow;
module.exports.applyFontBootstrap = applyFontBootstrap;
