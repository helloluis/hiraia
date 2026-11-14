const fs = require('node:fs');
const crypto = require('node:crypto');
const bytes = fs.readFileSync('/tmp/tala-apk/tala.apk');
const config = require('../app.config.js');
fs.writeFileSync(
  '/tmp/tala-apk/tala-apk.json',
  JSON.stringify(
    {
      file: '/download/tala.apk',
      version: config.version,
      versionCode: config.android.versionCode,
      buildDate: process.env.TALA_BUILD_DATE || new Date().toISOString(),
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      minAndroid: '7.0 (API 24)',
      applicationId: config.android.package,
    },
    null,
    2
  ) + '\n'
);
