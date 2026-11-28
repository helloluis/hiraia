const { test } = require('node:test');
const assert = require('node:assert/strict');
const { desktopManifest } = require('./desktop-manifest-proposal.ts');
test('download proposal shows only a matching complete set from the approved immutable prefix', () => {
  const base = 'https://tala.hiraia.org/download/desktop';
  const identity = { version: '0.1.21', release: 'tala-v1-demo.21', sourceCommit: 'a'.repeat(40), electron: '45.5.0', hostedOrigin: 'https://tala.hiraia.org' };
  const m = { schemaVersion: 1, status: 'released', ...identity, artifacts: [
    ['win32', 'x64'], ['darwin', 'arm64'], ['darwin', 'x64'],
  ].map(([platform, arch]) => {
    const file = `Tala-${identity.version}-${platform === 'win32' ? 'win' : 'mac'}-${arch}.${platform === 'win32' ? 'exe' : 'dmg'}`;
    return { ...identity, platform, arch, file, bytes: 12345, sha256: 'b'.repeat(64), sourceDirty: false,
      url: `${base}/${identity.release}/${identity.sourceCommit}/${file}` };
  }) };
  assert.equal(desktopManifest(m, base).artifacts.length, 3);
  for (const mutate of [
    x => x.artifacts.pop(), x => { x.artifacts[2] = x.artifacts[0]; },
    x => { x.artifacts[0].sourceCommit = 'c'.repeat(40); },
    x => { x.artifacts[0].url = 'https://evil.example/installer.exe'; },
    x => { x.artifacts[0].url += '?new=1'; },
    x => { x.artifacts[0].bytes = -1; }, x => { x.artifacts[0].sourceDirty = true; },
    x => { x.status = 'preview-not-for-distribution'; },
  ]) {
    const changed = structuredClone(m); mutate(changed);
    assert.equal(desktopManifest(changed, base), null);
  }
});
