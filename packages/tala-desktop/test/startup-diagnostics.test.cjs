const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupError } = require('./startup-diagnostics.cjs');
test('startup diagnostic retains the first bounded error and codes, never raw logs or credential fields', () => {
  const result = startupError('Next ready\r\n\x1b[31mError: native library failed at C:\\synthetic password="fake password" token=fixture-token\x1b[0m\r\n code: ERR_DLOPEN_FAILED\r\n private body follows', ['C:\\synthetic']);
  assert.match(result.firstErrorLine, /native library failed at <local-path>/);
  assert.doesNotMatch(result.firstErrorLine, /fake password|fixture-token|private body|synthetic/);
  assert.deepEqual(result.errorCodes, ['ERR_DLOPEN_FAILED']);
  assert.ok(startupError('Error: ' + 'x'.repeat(1000)).firstErrorLine.length <= 600);
});
