const { withAndroidManifest, withGradleProperties } = require('expo/config-plugins');
module.exports = (config) => {
  config = withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter((p) => p.key !== 'expo.useLegacyPackaging');
    mod.modResults.push({ type: 'property', key: 'expo.useLegacyPackaging', value: 'true' });
    return mod;
  });
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$['android:usesCleartextTraffic'] = 'false';
    return mod;
  });
};
