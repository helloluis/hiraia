import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applicationId } = require('../../config.cjs') as {
  applicationId(env?: Record<string, string>): string;
};
test('ordinary V1 builds cannot use the live Tala 0.4 application id', () => {
  assert.equal(applicationId({}), 'com.hiraia.tala.next');
  assert.notEqual(applicationId({}), 'com.hiraia.tala');
  assert.equal(
    applicationId({ TALA_ANDROID_APPLICATION_ID: 'com.hiraia.tala.test' }),
    'com.hiraia.tala.test'
  );
  const config = require('../../app.config.js');
  assert.equal(config.slug, 'tala-next');
  assert.ok(!config.updates);
});
