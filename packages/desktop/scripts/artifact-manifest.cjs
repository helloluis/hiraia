'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
async function main() {
  const root = path.resolve(__dirname, '../../..');
  const directory = path.join(root, 'packages/desktop/out/make/zip/win32/x64');
  const files = fs.readdirSync(directory).filter(name => name.endsWith('.zip'));
  if (files.length !== 1) throw new Error('Expected exactly one Windows ZIP');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const identity = JSON.parse(fs.readFileSync(path.join(root, 'packages/desktop/renderer/build-info.json')));
  const tests = JSON.parse(fs.readFileSync(path.join(root, 'build/windows-e2e/report.json')));
  if (identity.gitCommit !== commit || tests.gitCommit !== commit || !tests.passed || !tests.packaged || tests.platform !== 'win32' || tests.arch !== 'x64' || tests.native?.embeddingDimensions !== 768 || tests.native?.stats?.backendDevice !== 'cpu' || !tests.voices?.en || !tests.voices?.tl) throw new Error('Windows package lacks complete validation for this source commit');
  const file = path.join(directory, files[0]);
  const hash = crypto.createHash('sha256');
  for await (const block of fs.createReadStream(file)) hash.update(block);
  const manifest = { schema: 1, complete: true, gitCommit: commit, builtAt: new Date().toISOString(),
    artifacts: { windows: { platform: 'windows', arch: 'x64', minimumOS: 'Windows 10',
      versionName: identity.version, versionCode: identity.versionCode, desktopVersion: identity.desktopVersion,
      filename: files[0], bytes: fs.statSync(file).size, sha256: hash.digest('hex'), signed: false,
      validation: tests } } };
  const out = path.join(root, 'build/windows-release');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
