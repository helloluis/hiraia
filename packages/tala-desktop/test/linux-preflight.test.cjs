const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { missingLibraries } = require('./linux-preflight.cjs');
test('dependency report includes only unresolved library names', () => {
  assert.deepEqual(missingLibraries(' linux-vdso.so.1 (0x123)\n libgtk-3.so.0 => not found\n libpango-1.0.so.0 => not found\n libgtk-3.so.0 => not found\n libokay.so => /private/prefix/libokay.so (0x123)\n'), ['libgtk-3.so.0', 'libpango-1.0.so.0']);
});
test('missing dependencies stop owner mode before credentials, profile or network use', { skip: process.platform !== 'linux' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-ldd-negative-'));
  try {
    fs.writeFileSync(path.join(dir, 'ldd'), '#!/bin/sh\nprintf "libsynthetic-missing.so.1 => not found\\n"\n', { mode: 0o700 });
    const env = { ...process.env, CI: 'false', PATH: dir + path.delimiter + process.env.PATH, TALA_DESKTOP_PRODUCTION_TEST_APPROVAL: 'rq_czqd79ie', TALA_DESKTOP_OWNER_AI_CHECK: '1' };
    delete env.TALA_TEST_EMAIL; delete env.TALA_TEST_PASSWORD;
    const result = spawnSync(process.execPath, [path.join(__dirname, 'production-ai.cjs'), 'owner', 'https://tala.hiraia.org'], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'libsynthetic-missing.so.1');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
