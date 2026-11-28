const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const required = ['win32-x64', 'darwin-arm64', 'darwin-x64'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function collect(input, output) {
  const artifacts = required.map(key => {
    const m = JSON.parse(fs.readFileSync(path.join(input, `manifest-${key}.json`)));
    if (`${m.platform}-${m.arch}` !== key || m.sourceDirty || !/^[a-f0-9]{40}$/.test(m.sourceCommit) ||
        !/^Tala-[a-zA-Z0-9.-]+\.(exe|dmg)$/.test(m.file)) throw new Error(`Invalid metadata: ${key}`);
    const content = fs.readFileSync(path.join(input, m.file));
    if (content.length !== m.bytes || hash(content) !== m.sha256) throw new Error(`Digest/size mismatch: ${key}`);
    const evidence = JSON.parse(fs.readFileSync(path.join(input, `shell-${key}.json`)));
    if (!evidence.packaged || evidence.platform !== m.platform || evidence.arch !== m.arch ||
        evidence.results.length < 10 || evidence.results.some(r => r.status !== 'passed') ||
        !evidence.isolation?.allPeersLoopback || evidence.isolation.fixtureRequests < 5 ||
        evidence.isolation.nonLoopbackConnections !== 0 || evidence.isolation.otherDns !== 'NOTFOUND' ||
        evidence.isolation.productionApiNegativeControl !== '403 from local fixture') throw new Error(`Missing native packaged smoke/isolation checks: ${key}`);
    const features = JSON.parse(fs.readFileSync(path.join(input, `features-${key}.json`)));
    if (!features.packaged || features.teardown !== 'completed' || features.platform !== m.platform || features.arch !== m.arch ||
        features.sourceCommit !== m.sourceCommit || features.results.length < 14 || features.results.some(r => r.status !== 'passed') ||
        !features.isolation?.healthBuildNonceVerified || !features.isolation.allPeersLoopback ||
        features.isolation.fixtureRequests < 30 || features.isolation.nonLoopbackConnections !== 0) {
      throw new Error(`Missing native local-server feature checks: ${key}`);
    }
    if (m.release.startsWith('tala-desktop-preview-production-')) {
      const production = JSON.parse(fs.readFileSync(path.join(input, `production-${key}.json`)));
      if (production.mode !== 'ephemeral' || production.sourceCommit !== m.sourceCommit || production.release !== m.release ||
          production.platform !== m.platform || production.arch !== m.arch || production.phase !== 'completed' ||
          !production.account?.id || !production.account.email?.startsWith(`desktop-native-${production.run}-${key}-`) ||
          !production.account.email?.endsWith('@example.com') ||
          production.cleanup !== 'self-delete 200; auth/me 401' || !Number.isInteger(production.totalWriteRequests) ||
          production.totalWriteRequests < 1 || production.totalWriteRequests > 40 ||
          production.network?.registrations !== 1 || production.network?.deletions !== 1 || production.network?.sectionRequests !== 1 ||
          production.network?.slideRequests !== 1 || production.network?.blocked !== 0 ||
          production.checks?.length !== 2 || production.checks.some(r => r.status !== 'passed')) {
        throw new Error(`Missing bounded production/cleanup checks: ${key}`);
      }
    }
    return m;
  });
  const shared = ['version', 'release', 'sourceCommit', 'electron', 'hostedOrigin'];
  for (const key of shared) if (!artifacts.every(m => m[key] === artifacts[0][key])) throw new Error(`Mixed ${key}`);
  const result = { schemaVersion: 1, ...Object.fromEntries(shared.map(key => [key, artifacts[0][key]])),
    status: 'preview-not-for-distribution', verification: 'native packaged shell and local-server feature checks; see parity matrix for remaining checks', artifacts };
  // Nothing is written until the complete set and every digest/evidence file passes.
  fs.mkdirSync(output, { recursive: true });
  for (const m of artifacts) fs.copyFileSync(path.join(input, m.file), path.join(output, m.file), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output, 'desktop-release.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}
if (require.main === module) collect(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
module.exports = { collect, hash, required };
