'use strict';
// A separate, flat production install is required by Electron Packager. pnpm 9
// deploy resolves dependencies anew; retain our exact workspace snapshots instead.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const desktop = path.resolve(__dirname, '..');
const root = path.resolve(desktop, '../..');
const stage = path.join(root, 'build/desktop-stage');
const platform = process.env.HIRAIA_PACKAGE_PLATFORM || process.platform;
const arch = process.env.HIRAIA_PACKAGE_ARCH || process.arch;
async function main() {
  if (!fs.existsSync(path.join(desktop, 'renderer/index.html'))) throw new Error('Export the desktop renderer first');
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
  for (const name of ['src', 'scripts', 'assets', 'renderer', 'resources', 'qvac.config.json', 'forge.config.cjs']) {
    if (fs.existsSync(path.join(desktop, name))) fs.cpSync(path.join(desktop, name), path.join(stage, name), { recursive: true });
  }
  const workspace = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(desktop, 'package.json')));
  const identity = JSON.parse(fs.readFileSync(path.join(desktop, 'renderer/build-info.json')));
  const app = JSON.parse(fs.readFileSync(path.join(root, 'packages/mobile/app.json'))).expo;
  if (identity.version !== app.version || identity.versionCode !== app.android.versionCode) throw new Error('Renderer and application versions differ');
  pkg.version = identity.desktopVersion;
  pkg.packageManager = workspace.packageManager; pkg.pnpm = workspace.pnpm;
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2));
  const lock = YAML.parse(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8'));
  lock.importers = { '.': lock.importers['packages/desktop'] };
  fs.writeFileSync(path.join(stage, 'pnpm-lock.yaml'), YAML.stringify(lock));
  fs.writeFileSync(path.join(stage, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");
  fs.writeFileSync(path.join(stage, '.npmrc'), 'node-linker=hoisted\n');
  const install = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['install', '--frozen-lockfile', '--ignore-scripts'],
    { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32' });
  if (install.status !== 0) throw new Error('Locked desktop dependency installation failed');
  // bare-pack roots its graph at cwd. Match projectRoot so the SDK verifier and
  // Forge pruning inspect the same native packages that the worker imports.
  process.chdir(stage);
  const { make } = require('@electron-forge/core').api;
  const results = await make({ dir: stage, platform, arch, outDir: path.join(desktop, 'out') });
  for (const result of results) for (const file of result.artifacts) {
    const sha = crypto.createHash('sha256');
    for await (const block of fs.createReadStream(file)) sha.update(block);
    fs.writeFileSync(file + '.sha256', `${sha.digest('hex')}  ${path.basename(file)}\n`);
    console.log(`Desktop artifact: ${file}`);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
