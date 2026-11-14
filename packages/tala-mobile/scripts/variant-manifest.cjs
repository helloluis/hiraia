const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const variant = process.argv[2];
if (!['with-qvac', 'standard-check'].includes(variant)) throw Error('Invalid variant');
const file = `/tmp/tala-apk/tala-${variant}.apk`;
const config = JSON.parse(
  execFileSync('unzip', ['-p', file, 'assets/app.config'], { encoding: 'utf8' })
);
const qvac = variant === 'with-qvac';
if (
  config.extra.qvac !== qvac ||
  config.android.package !== (qvac ? 'com.hiraia.tala.next.qvac' : 'com.hiraia.tala.next')
)
  throw Error('Wrong native build identity');
const bytes = fs.readFileSync(file);
const manifest = {
  file: `/download/tala-${variant}.apk`,
  version: config.version,
  versionCode: config.android.versionCode,
  buildDate: config.extra.buildDate,
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
  minAndroid: qvac ? '12 (API 31)' : '7.0 (API 24)',
  applicationId: config.android.package,
  ...(qvac
    ? {
        note: 'Experimental on-device AI, side by side with standard Tala. No model bundled; opt-in 639.4 MB publisher download. Physical-phone inference verification required.',
        requires:
          'Android 12 or newer; arm64-v8a; sufficient free storage and memory (6 GB+ RAM recommended). QVAC vendor does not support inference on emulators.',
      }
    : {}),
};
fs.writeFileSync(
  `/tmp/tala-apk/tala-${variant}-apk.json`,
  JSON.stringify(manifest, null, 2) + '\n'
);
