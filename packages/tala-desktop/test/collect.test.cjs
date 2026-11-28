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
      fs.writeFileSync(path.join(dir, `features-${key}.json`), JSON.stringify({ platform, arch, packaged: true, teardown: 'completed', sourceCommit: 'a'.repeat(40),
        isolation: { allPeersLoopback: true, fixtureRequests: 60, nonLoopbackConnections: 0, healthBuildNonceVerified: true },
        results: Array.from({ length: 14 }, () => ({ status: 'passed' })) }));
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
    assert.throws(() => collect(dir, output), /Missing native local-server feature/);
    const featurePath = path.join(dir, 'features-darwin-x64.json');
    const features = JSON.parse(fs.readFileSync(featurePath));
    fs.writeFileSync(featurePath, JSON.stringify({ ...features, sourceCommit: 'b'.repeat(40) }));
    assert.throws(() => collect(dir, output), /Mixed sourceCommit/);
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    fs.writeFileSync(featurePath, JSON.stringify({ ...features, results: [{ status: 'failed' }] }));
    assert.throws(() => collect(dir, output), /Missing native local-server feature/);
    assert.equal(fs.existsSync(output), false);
    fs.writeFileSync(featurePath, JSON.stringify({ ...features, teardown: 'pending' }));
    assert.throws(() => collect(dir, output), /Missing native local-server feature/);
    assert.equal(fs.existsSync(output), false, 'Passed checks cannot hide a teardown failure');
    fs.writeFileSync(featurePath, JSON.stringify(features));
    assert.equal(collect(dir, output).artifacts.length, 3);
    assert.throws(() => collect(dir, output), /EEXIST/);
    fs.rmSync(output, { recursive: true });
    const release = 'tala-desktop-preview-production-1';
    for (const key of required) {
      const metadata = path.join(dir, `manifest-${key}.json`);
      fs.writeFileSync(metadata, JSON.stringify({ ...JSON.parse(fs.readFileSync(metadata)), release }));
    }
    assert.throws(() => collect(dir, output), /ENOENT/);
    assert.equal(fs.existsSync(output), false, 'A production tag cannot stage the ordinary local-only receipts');
    for (const key of required) {
      const [platform, arch] = key.split('-');
      fs.writeFileSync(path.join(dir, `production-${key}.json`), JSON.stringify({
        mode: 'ephemeral', run: 'unit-test', release, sourceCommit: 'a'.repeat(40), platform, arch,
        account: { id: 'synthetic-unit-test-id', email: `desktop-native-unit-test-${key}-random@example.com` },
        phase: 'completed', cleanup: 'self-delete 200; auth/me 401', totalWriteRequests: 12,
        network: { registrations: 1, deletions: 1, sectionRequests: 1, slideRequests: 1, blocked: 0 },
        checks: [{ status: 'passed' }, { status: 'passed' }],
      }));
    }
    const productionPath = path.join(dir, 'production-darwin-x64.json');
    const production = JSON.parse(fs.readFileSync(productionPath));
    for (const change of [{ cleanup: 'uncertain' }, { totalWriteRequests: undefined }, { release: 'another-tag' }]) {
      fs.writeFileSync(productionPath, JSON.stringify({ ...production, ...change }));
      assert.throws(() => collect(dir, output), /Missing bounded production/);
      assert.equal(fs.existsSync(output), false);
    }
    fs.writeFileSync(productionPath, JSON.stringify(production));
    assert.equal(collect(dir, output).artifacts.length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
