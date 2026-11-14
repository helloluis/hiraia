// JS flags alone cannot undo a native minSdk/ABI requirement.
module.exports = {
  dependencies:
    process.env.TALA_QVAC === '1'
      ? {}
      : { 'react-native-bare-kit': { platforms: { android: null, ios: null } } },
};
