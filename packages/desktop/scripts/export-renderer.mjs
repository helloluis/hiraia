import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = path.join(root, 'packages/desktop');
// Metro enumerates every sibling for every image to discover scale variants.
// Shard our 12k selected illustrations instead of repeatedly scanning a 35k-file
// art directory. The exact images and shared lookup keys remain unchanged.
const mapPath = path.join(root, 'packages/mobile/src/generated/imageMap.ts');
const map = fs.readFileSync(mapPath, 'utf8').replace(/require\("([^"\n]+)"\)/g, (_match, relative) => {
  const source = path.resolve(path.dirname(mapPath), relative);
  const hash = crypto.createHash('sha256').update(relative).digest('hex');
  const target = path.join(desktop, '.art-shards', hash.slice(0, 2), hash.slice(2, 18) + path.extname(source));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target, fs.constants.COPYFILE_FICLONE);
  return `require(${JSON.stringify(path.relative(path.dirname(mapPath), target).split(path.sep).join('/'))})`;
});
fs.writeFileSync(mapPath.replace(/\.ts$/, '.web.ts'), map);
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', '../desktop/renderer'],
  { cwd: path.join(root, 'packages/mobile'), stdio: 'inherit', env: { ...process.env, HIRAIA_DESKTOP_BUILD: '1', CI: '1' }, shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status ?? 1);
const htmlPath = path.join(desktop, 'renderer/index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
// Expo's web startup script must be external to keep script-src 'self' (no unsafe-inline).
let index = 0;
html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (tag, attributes, body) => {
  if (!body.trim() || /\bsrc=/.test(attributes)) return tag;
  const name = `desktop-startup-${index++}.js`;
  fs.writeFileSync(path.join(desktop, 'renderer', name), body);
  return `<script${attributes} src="/${name}"></script>`;
});
html = html.replace('</head>', '<link rel="stylesheet" href="/desktop.css"></head>');
fs.writeFileSync(htmlPath, html);
fs.copyFileSync(path.join(desktop, 'src/desktop.css'), path.join(desktop, 'renderer/desktop.css'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'packages/mobile/app.json'))).expo;
fs.writeFileSync(path.join(desktop, 'renderer/build-info.json'), JSON.stringify({
  version: app.version, versionCode: app.android.versionCode, desktopVersion: `${app.version}-preview.1`,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
}, null, 2) + '\n');
console.log('Desktop renderer exported with external scripts and desktop accessibility styles.');
