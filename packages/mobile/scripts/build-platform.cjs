const platforms = require('../build-platforms.json');

function buildPlatform() {
  const raw = process.env.HIRAIA_APK_VARIANT || 'android';
  // Keep the original private preview command usable during the transition.
  const platform = raw === 'chromeos-preview' ? 'chromeos' : raw;
  if (!Object.hasOwn(platforms, platform)) throw new Error(`Unknown HIRAIA_APK_VARIANT: ${raw}`);
  return platform;
}

module.exports = { platforms, buildPlatform };
