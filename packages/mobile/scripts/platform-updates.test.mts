import assert from 'node:assert/strict';
import {test} from 'node:test';
import {acceptsManifestPlatform, distributionPlatform, platformManifestUrl} from '../src/updates/platform';

test('distribution comes from the installed build and cannot fall back on an unknown value', () => {
  assert.equal(distributionPlatform(undefined), 'android');
  assert.equal(distributionPlatform('chromeos'), 'chromeos');
  assert.throws(() => distributionPlatform('windows'));
});
test('ChromeOS never accepts the phone update, including an old unlabelled server', () => {
  for (const value of [{app: {}}, {platform: 'android'}, {platform: 'windows'}, null]) {
    assert.equal(acceptsManifestPlatform(value, 'chromeos'), false);
  }
  assert.equal(acceptsManifestPlatform({platform: 'chromeos'}, 'chromeos'), true);
  assert.equal(acceptsManifestPlatform({platform: 'chromeos'}, 'android'), false);
  assert.equal(acceptsManifestPlatform({app: {}}, 'android'), true);
});
test('manifest overrides preserve staging parameters but cannot override the installed platform', () => {
  assert.equal(platformManifestUrl('https://example.org/manifest?ring=test&platform=android', 'chromeos'),
    'https://example.org/manifest?ring=test&platform=chromeos');
  assert.throws(() => platformManifestUrl('http://example.org/manifest', 'android'));
});
