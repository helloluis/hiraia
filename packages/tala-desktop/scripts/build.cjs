// One native build produces one installer + one manifest. The collection step
// refuses anything except the complete set from exactly the same source tree.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { build, Platform, Arch } = require('electron-builder');
const pkg = require('../package.json');
const config = require('../electron-builder.cjs');
const root = path.resolve(__dirname, '..');
process.chdir(root);
const platform = process.argv[2];
const arch = process.argv[3];
if (!['win32:x64', 'darwin:arm64', 'darwin:x64'].includes(`${platform}:${arch}`)) throw new Error('Usage: npm run build -- win32 x64 | darwin arm64 | darwin x64');
if (platform === 'darwin' && process.platform !== 'darwin') throw new Error('DMGs must be built on native macOS');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const sourceCommit = git('rev-parse', 'HEAD');
const dirty = !!git('status', '--porcelain', '--', '.');
if (process.env.CI && dirty) throw new Error('CI build requires committed desktop sources');
const release = process.env.TALA_RELEASE_TAG || `preview-${sourceCommit.slice(0, 12)}`;
if (!/^(tala-v1-demo\.\d+|tala-desktop-preview-[a-zA-Z0-9.-]+|preview-[a-zA-Z0-9.-]+)$/.test(release)) throw new Error('Invalid release tag');
// Each production release gets a monotonically increasing native version without
// a separate version bump in source; all matrix jobs use the same release tag.
const version = release.startsWith('tala-v1-demo.') ? `0.1.${release.split('.').pop()}` : pkg.version;
const meta = { schemaVersion: 1, version, release, sourceCommit, sourceDirty: dirty,
  buildTime: new Date().toISOString(), electron: pkg.devDependencies.electron,
  hostedOrigin: 'https://tala.hiraia.org', platform, arch,
  signing: platform === 'darwin' ? 'ad-hoc; not notarized' : 'unsigned' };
fs.writeFileSync('build-meta.json', JSON.stringify(meta, null, 2) + '\n');
// Explicitly forbid automatic credential discovery/publishing.
process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
delete process.env.CSC_LINK; delete process.env.WIN_CSC_LINK;
const target = platform === 'darwin' ? Platform.MAC : Platform.WINDOWS;
build({ projectDir: root, targets: target.createTarget(platform === 'darwin' ? 'dmg' : 'nsis', arch === 'arm64' ? Arch.arm64 : Arch.x64),
  publish: 'never', config: { ...config, extraMetadata: { version } } }).then(files => {
  const installers = files.filter(file => file.endsWith(platform === 'darwin' ? '.dmg' : '.exe'));
  if (installers.length !== 1) throw new Error('Expected exactly one installer');
  const file = installers[0];
  const bytes = fs.readFileSync(file);
  const manifest = { ...meta, file: path.basename(file), bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  fs.writeFileSync(path.join('dist', `manifest-${platform}-${arch}.json`), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest));
}).catch(error => { console.error(error); process.exit(1); });
