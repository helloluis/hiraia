const { buildPlatform } = require('./scripts/build-platform.cjs');

// Expo embeds this in assets/app.config and includes it in the native fingerprint.
// The updater uses the installed distribution, never screen width or CPU guessing.
module.exports = ({ config }) => ({
  ...config,
  ...(process.env.HIRAIA_DESKTOP_BUILD === '1' ? { web: { bundler: 'metro', output: 'single' } } : {}),
  extra: { ...config.extra, distributionPlatform: process.env.HIRAIA_DESKTOP_BUILD === '1' ? 'windows' : buildPlatform() },
});
