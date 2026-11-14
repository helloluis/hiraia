const { withSettingsGradle } = require('expo/config-plugins');
module.exports = (config) =>
  withSettingsGradle(config, (mod) => {
    if (process.env.TALA_QVAC === '1') throw Error('Standard isolation plugin in QVAC build');
    const original = 'ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand)';
    const replacement =
      "ex.autolinkLibrariesFromCommand(expoAutolinking.rnConfigCommand + ['--exclude', 'react-native-bare-kit'])";
    if (
      !mod.modResults.contents.includes(original) &&
      !mod.modResults.contents.includes(replacement)
    )
      throw Error('Expo autolinking settings marker changed');
    mod.modResults.contents = mod.modResults.contents.replace(original, replacement);
    return mod;
  });
