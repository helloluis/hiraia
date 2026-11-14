const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const previous = '/tmp/tala-apk/tala.apk',
  next = '/tmp/tala-apk/tala-standard-check.apk';
const aapt = path.join(process.env.ANDROID_HOME, 'build-tools/36.0.0/aapt');
function native(apk) {
  return execFileSync('unzip', ['-Z1', apk], { encoding: 'utf8' })
    .split('\n')
    .filter((s) => s.startsWith('lib/'))
    .sort();
}
const oldLibs = native(previous),
  newLibs = native(next);
if (JSON.stringify(oldLibs) !== JSON.stringify(newLibs))
  throw Error('Standard native libraries changed');
if (newLibs.some((s) => /qvac|bare/i.test(s))) throw Error('QVAC/Bare entered standard APK');
const oldManifest = execFileSync(aapt, ['dump', 'xmltree', previous, 'AndroidManifest.xml'], {
  encoding: 'utf8',
});
const newManifest = execFileSync(aapt, ['dump', 'xmltree', next, 'AndroidManifest.xml'], {
  encoding: 'utf8',
});
if (oldManifest !== newManifest) {
  fs.writeFileSync('/tmp/tala-apk/standard-old-manifest.txt', oldManifest);
  fs.writeFileSync('/tmp/tala-apk/standard-new-manifest.txt', newManifest);
  throw Error('Standard manifest changed: inspect saved dumps');
}
console.log(
  JSON.stringify(
    {
      manifestIdentical: true,
      nativeLibrariesIdentical: true,
      nativeLibraryCount: newLibs.length,
      previousBytes: fs.statSync(previous).size,
      currentBytes: fs.statSync(next).size,
    },
    null,
    2
  )
);
