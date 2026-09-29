#!/usr/bin/env node
/** Compile the released QVAC engines for Android Intel/AMD; never copy ARM prebuilds. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { pin, mobile, cache, digest, assertX64, verifiedPort } = require('./qvac-android-x64.cjs');
const work = path.resolve(process.env.HIRAIA_QVAC_BUILD_ROOT || path.join(cache, 'work'));
const source = path.join(work, 'qvac-source');
const vcpkg = path.join(work, 'vcpkg');
const toolchain = path.join(work, 'toolchain');
const overlay = path.join(mobile, 'native/qvac-x64-overlay');
for (const [file, sha256] of Object.entries(pin.fabricOverlay)) {
  if (digest(fs.readFileSync(path.join(mobile, 'native', file))) !== sha256) {
    throw new Error(`Unpinned QVAC native patch: ${file}`);
  }
}
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const ndk = path.join(sdk, 'ndk', pin.ndk);
if (!fs.existsSync(ndk)) throw new Error(`Install Android NDK ${pin.ndk} in ${sdk} first`);
const host = process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
const env = { ...process.env, ANDROID_HOME: sdk, ANDROID_NDK_HOME: ndk, ANDROID_NDK_ROOT: ndk,
  VCPKG_ROOT: vcpkg, VCPKG_DISABLE_METRICS: '1',
  PATH: [path.join(toolchain, 'node_modules/.bin'), path.join(ndk, 'shader-tools', host), process.env.PATH].join(path.delimiter) };
const run = (command, args, cwd = work) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });
const output = (command, args, cwd) => execFileSync(command, args, { cwd, env, encoding: 'utf8' }).trim();
fs.mkdirSync(work, { recursive: true });
if (!fs.existsSync(source)) {
  run('git', ['clone', '--filter=blob:none', '--no-checkout', pin.source, source]);
  run('git', ['sparse-checkout', 'set', 'packages/llm-llamacpp', 'packages/embed-llamacpp', 'vcpkg-overlays', 'cmake'], source);
  run('git', ['checkout', '--detach', pin.commit], source);
}
if (output('git', ['rev-parse', 'HEAD'], source) !== pin.commit) throw new Error('Unexpected QVAC source revision');
if (output('git', ['diff', '--name-only', 'HEAD', '--', 'packages/llm-llamacpp', 'packages/embed-llamacpp', 'vcpkg-overlays', 'cmake'], source)) {
  throw new Error('QVAC native source has local changes; review and pin them before building');
}
if (!fs.existsSync(vcpkg)) {
  run('git', ['clone', 'https://github.com/microsoft/vcpkg.git', vcpkg]);
  run('git', ['checkout', '--detach', pin.vcpkgCommit], vcpkg);
}
if (output('git', ['rev-parse', 'HEAD'], vcpkg) !== pin.vcpkgCommit) throw new Error('Unexpected vcpkg revision');
if (!fs.existsSync(path.join(vcpkg, 'vcpkg'))) run('./bootstrap-vcpkg.sh', ['-disableMetrics'], vcpkg);
fs.mkdirSync(toolchain, { recursive: true });
run('npm', ['install', '--prefix', toolchain, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact',
  `bare-make@${pin.bareMake}`, `cmake-runtime@${pin.cmakeRuntime}`, `ninja-runtime@${pin.ninjaRuntime}`]);

for (const [name, version] of Object.entries(pin.engines)) {
  const dir = path.join(source, 'packages', name.split('/')[1]);
  if (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))).version !== version) throw new Error(`Wrong source version: ${name}`);
  run('npm', ['install', '--workspaces=false', '--ignore-scripts', '--no-audit', '--no-fund', '--no-save',
    `cmake-bare@${pin.cmakeBare}`, `cmake-vcpkg@${pin.cmakeVcpkg}`], dir);
  // cmake-bare defaults to today's headers. 1.32 changed js_set_array_elements' C++
  // const signature after this QVAC release. Pin its contemporary API without changing
  // the engine source or the application's existing Bare runtime.
  const headers = path.join(dir, 'node_modules/cmake-bare/cmake-bare.cmake');
  const cmake = fs.readFileSync(headers, 'utf8');
  const marker = /function\(download_bare_headers result\)[\s\S]*?endfunction\(\)/;
  if (!marker.test(cmake)) throw new Error('cmake-bare header-download function changed');
  fs.writeFileSync(headers, cmake.replace(marker, block => {
    const patched = block.replace('set(ARGV_VERSION "latest")', `set(ARGV_VERSION "${pin.bareHeaders}")`);
    if (!patched.includes(`set(ARGV_VERSION "${pin.bareHeaders}")`)) throw new Error('Could not pin Bare headers');
    return patched;
  }));
  run('bare-make', ['generate', '--platform', 'android', '--arch', 'x64', '--build', 'build/android-x64',
    '--define', `VCPKG_OVERLAY_PORTS=${overlay}`], dir);
  run('bare-make', ['build', '--build', 'build/android-x64'], dir);
  run('bare-make', ['install', '--build', 'build/android-x64', '--strip'], dir);
}

// Link only these two compiled addons. All other addon versions come from the app's
// pnpm lockfile during prebuild, never from this isolated source checkout's npm tree.
const { default: link } = await import('bare-link');
const stage = path.join(cache, 'staging');
fs.rmSync(stage, { recursive: true, force: true });
for (const [name, version] of Object.entries(pin.engines)) {
  const base = path.join(source, 'packages', name.split('/')[1]);
  for await (const file of link(base, { hosts: ['android-x64'], out: stage }, { name, version, addon: true })) {
    assertX64(fs.readFileSync(file), file);
  }
}
const nativeDir = path.join(stage, 'x86_64');
const strip = path.join(ndk, 'toolchains/llvm/prebuilt', host, 'bin/llvm-strip');
const files = {};
for (const name of fs.readdirSync(nativeDir).sort()) {
  run(strip, ['--strip-unneeded', path.join(nativeDir, name)]);
  files[name] = digest(fs.readFileSync(path.join(nativeDir, name)));
}
fs.rmSync(path.join(cache, 'x86_64'), { recursive: true, force: true });
fs.renameSync(nativeDir, path.join(cache, 'x86_64'));
fs.rmSync(stage, { recursive: true, force: true });
const notices = {};
const noticesDir = path.join(cache, 'notices');
fs.rmSync(noticesDir, { recursive: true, force: true });
fs.mkdirSync(noticesDir, { recursive: true });
const copyNotice = (from, name) => {
  const bytes = fs.readFileSync(from);
  fs.writeFileSync(path.join(noticesDir, name), bytes);
  notices[name] = digest(bytes);
};
for (const name of Object.keys(pin.engines)) {
  const engine = name.split('/')[1];
  const base = path.join(source, 'packages', engine);
  for (const file of ['LICENSE', 'NOTICE']) copyNotice(path.join(base, file), `${engine}-${file}.txt`);
  const share = path.join(base, 'build/android-x64/_vcpkg/x64-android/share');
  for (const dep of fs.readdirSync(share).sort()) {
    const file = path.join(share, dep, 'copyright');
    if (fs.existsSync(file)) copyNotice(file, `${engine}-${dep}-copyright.txt`);
  }
}
fs.writeFileSync(path.join(cache, 'manifest.json'), JSON.stringify({ pin, files, notices }, null, 2) + '\n');
verifiedPort();
console.log(`Verified ${Object.keys(files).length} QVAC Android x86_64 libraries: ${cache}`);
