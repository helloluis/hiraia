const base = require('./app.json').expo;
const { applicationId } = require('./config.cjs');
const qvac = process.env.TALA_QVAC === '1';
module.exports = {
  ...base,
  version: '1.0.0-demo.1',
  name: qvac ? 'Tala (on-device AI)' : base.name,
  plugins: [
    ...base.plugins,
    './plugins/with-demo-manifest.cjs',
    ...(qvac
      ? [
          ['expo-build-properties', { android: { minSdkVersion: 31 } }],
          './plugins/with-qvac-worker.cjs',
          './plugins/with-local-ai-support.cjs',
        ]
      : ['./plugins/with-standard-isolation.cjs']),
  ],
  android: {
    ...base.android,
    package: qvac ? 'com.hiraia.tala.next.qvac' : applicationId(process.env),
    versionCode: 1,
    usesCleartextTraffic: false,
    blockedPermissions: [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.VIBRATE',
    ],
  },
  extra: {
    qvac,
    buildDate: process.env.TALA_BUILD_DATE || 'development',
    apiBase: 'https://tala.hiraia.org',
    bundleBytes: Number(process.env.TALA_BUNDLE_BYTES || 0),
  },
};
