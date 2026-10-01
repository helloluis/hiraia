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

test('Windows offers a measured unsigned x64 ZIP without weakening APK verification', () => {
  const windows = platformRelease('windows');
  assert.ok(windows);
  assert.equal(DOWNLOAD_PLATFORMS.find(p => p.id === 'windows')?.status, 'preview');
  assert.equal('signingCertSha256' in windows, false);
  for (const fields of [{bytes: 0}, {sha256: ''}, {versionName: ''}, {publishedAt: ''},
    {format: 'apk'}, {arch: 'arm64'}, {signed: true}, {signed: undefined},
    {url: 'https://assets.hiraia.org/models/app.apk'}, {url: 'https://example.org/app.zip'}]) {
    assert.equal(validRelease({...windows, ...fields}), false);
  }
  const android = platformRelease('android')!;
  assert.equal(validRelease({...android, url: windows.url}), false);
  assert.equal(validRelease({...android, signingCertSha256: undefined, signed: false}), false);
  assert.equal(platformRelease('android', {android: windows}), null);
  assert.equal(platformRelease('windows', {windows: android}), null);
});
