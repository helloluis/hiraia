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
    return m;
  });
  const shared = ['version', 'release', 'sourceCommit', 'electron', 'hostedOrigin'];
  for (const key of shared) if (!artifacts.every(m => m[key] === artifacts[0][key])) throw new Error(`Mixed ${key}`);
  const result = { schemaVersion: 1, ...Object.fromEntries(shared.map(key => [key, artifacts[0][key]])),
    status: 'preview-not-for-distribution', verification: 'native packaged shell smoke; see parity matrix for remaining checks', artifacts };
  // Nothing is written until the complete set and every digest/evidence file passes.
  fs.mkdirSync(output, { recursive: true });
  for (const m of artifacts) fs.copyFileSync(path.join(input, m.file), path.join(output, m.file), fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(path.join(output, 'desktop-release.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  return result;
}
if (require.main === module) collect(path.resolve(process.argv[2]), path.resolve(process.argv[3]));
module.exports = { collect, hash, required };
