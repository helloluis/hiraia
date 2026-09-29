const { buildPlatform } = require('./scripts/build-platform.cjs');

// Expo embeds this in assets/app.config and includes it in the native fingerprint.
// The updater uses the installed distribution, never screen width or CPU guessing.
module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, distributionPlatform: buildPlatform() },
});
