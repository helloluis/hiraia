const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const bytes = fs.readFileSync('/tmp/tala-apk/tala.apk');
// Read the packaged public config, not a possibly different shell environment.
const config = JSON.parse(
  execFileSync('unzip', ['-p', '/tmp/tala-apk/tala.apk', 'assets/app.config'], { encoding: 'utf8' })
);
if (
  config.android.package !== 'com.hiraia.tala.next' ||
  config.extra.apiBase !== 'https://tala.hiraia.org'
)
  throw Error('Unexpected demo identity or server');
if (!Number.isFinite(Date.parse(config.extra.buildDate)))
  throw Error('Missing packaged build date');
fs.writeFileSync(
  '/tmp/tala-apk/tala-apk.json',
  JSON.stringify(
    {
      file: '/download/tala.apk',
      version: config.version,
      versionCode: config.android.versionCode,
      buildDate: config.extra.buildDate,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      minAndroid: '7.0 (API 24)',
      applicationId: config.android.package,
    },
    null,
    2
  ) + '\n'
);
