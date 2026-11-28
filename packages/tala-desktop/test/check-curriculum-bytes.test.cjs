const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkBytes } = require('./check-curriculum-bytes.cjs');
test('real curriculum pack passes unchanged and rejects CRLF conversion or edited metadata', () => {
  const name = 'english-bow-2026-g10.json';
  const raw = fs.readFileSync(path.resolve(__dirname, '../../tala-server/data/packs', name));
  checkBytes(name, raw, raw);
  const crlf = Buffer.from(raw.toString('utf8').replace(/\r?\n/g, '\r\n'));
  assert.ok(crlf.byteLength > raw.byteLength);
  assert.throws(() => checkBytes(name, crlf, raw), /checkout differs/);
  assert.throws(() => checkBytes(name, crlf, crlf), /metadata mismatch/);
});
