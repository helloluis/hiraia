import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DOWNLOAD_PLATFORMS, platformRelease, validRelease} from './platforms';

test('unpublished or unknown platforms cannot fall back to the Android binary', () => {
  assert.ok(platformRelease('android'));
  const fixture = {android: platformRelease('android'), chromeos: null};
  for (const platform of ['chromeos', 'windows', 'unknown', 'constructor', '__proto__']) {
    assert.equal(platformRelease(platform, fixture), null);
  }
  assert.equal(platformRelease('chromeos', {chromeos: fixture.android}), null);
  assert.equal(new Set(DOWNLOAD_PLATFORMS.map(p => p.id)).size, DOWNLOAD_PLATFORMS.length);
});
test('download links require complete measured metadata and immutable CDN URLs', () => {
  const android = platformRelease('android')!;
  for (const fields of [{bytes: 0}, {sha256: ''}, {md5: ''}, {signingCertSha256: ''},
    {url: 'javascript:alert(1)'}, {url: 'https://example.org/app.apk'}, {versionCode: 0}]) {
    assert.equal(validRelease({...android, ...fields}), false);
  }
  assert.equal(validRelease(android), true);
});
