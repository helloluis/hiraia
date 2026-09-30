import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const desktop = path.join(root, 'packages/desktop');
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', '../desktop/renderer', '--clear'],
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
console.log('Desktop renderer exported with external scripts and desktop accessibility styles.');
