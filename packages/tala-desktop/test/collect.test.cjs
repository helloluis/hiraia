const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collect, hash, required } = require('../scripts/collect.cjs');
test('complete-set gate rejects missing/tampered/mixed builds before writing a release', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tala-release-'));
  const output = path.join(dir, 'complete');
  try {
    assert.throws(() => collect(dir, output));
    assert.equal(fs.existsSync(output), false);
    for (const key of required) {
      const [platform, arch] = key.split('-');
      const file = `Tala-0.1.0-${key}.${platform === 'win32' ? 'exe' : 'dmg'}`;
      const data = Buffer.from('synthetic installer bytes for ' + key);
      fs.writeFileSync(path.join(dir, file), data);
      fs.writeFileSync(path.join(dir, `manifest-${key}.json`), JSON.stringify({ platform, arch, file, bytes: data.length, sha256: hash(data), sourceCommit: 'a'.repeat(40), sourceDirty: false, version: '0.1.0', release: 'test', electron: '45.5.0', hostedOrigin: 'https://tala.hiraia.org' }));
      fs.writeFileSync(path.join(dir, `shell-${key}.json`), JSON.stringify({ platform, arch, packaged: true,
        isolation: { allPeersLoopback: true, fixtureRequests: 8, nonLoopbackConnections: 0, otherDns: 'NOTFOUND', productionApiNegativeControl: '403 from local fixture' },
        results: Array.from({ length: 10 }, () => ({ status: 'passed' })) }));
    }
    const badFile = path.join(dir, 'Tala-0.1.0-win32-x64.exe');
    const original = fs.readFileSync(badFile);
    fs.appendFileSync(badFile, 'corrupted');
    assert.throws(() => collect(dir, output), /Digest\/size/);
    assert.equal(fs.existsSync(output), false);
    fs.writeFileSync(badFile, original);
    const metaPath = path.join(dir, 'manifest-darwin-x64.json');
    const meta = JSON.parse(fs.readFileSync(metaPath));
    fs.writeFileSync(metaPath, JSON.stringify({ ...meta, sourceCommit: 'b'.repeat(40) }));
    assert.throws(() => collect(dir, output), /Mixed sourceCommit/);
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    assert.equal(collect(dir, output).artifacts.length, 3);
    assert.throws(() => collect(dir, output), /EEXIST/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
