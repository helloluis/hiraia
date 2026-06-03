/**
 * Download Google Fonts (Caveat Brush, Mansalva, Patrick Hand) as local woff2
 * files so they ship inside the package (works offline / in an Android APK —
 * no runtime CDN dependency). Emits @font-face CSS to stdout.
 *
 *   node scripts/fetch-fonts.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
await mkdir(OUT, { recursive: true });

const CSS_URL =
  'https://fonts.googleapis.com/css2?family=Caveat+Brush&family=Mansalva&family=Patrick+Hand&display=swap';
// modern-browser UA so Google returns woff2 (not ttf)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const KEEP = new Set(['latin', 'latin-ext']); // enough for English + Tagalog + Bisaya
const blocks = [...css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g)];

const out = [];
for (const [, subset, body] of blocks) {
  if (!KEEP.has(subset)) continue;
  const family = body.match(/font-family:\s*'([^']+)'/)[1];
  const weight = (body.match(/font-weight:\s*([^;]+)/) || [])[1]?.trim() || '400';
  const style = (body.match(/font-style:\s*([^;]+)/) || [])[1]?.trim() || 'normal';
  const range = (body.match(/unicode-range:\s*([^;]+)/) || [])[1]?.trim();
  const url = body.match(/src:\s*url\(([^)]+)\)/)[1];
  const file = `${slug(family)}-${subset}.woff2`;
  const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': UA } })).arrayBuffer());
  await writeFile(join(OUT, file), buf);
  console.error(`saved public/fonts/${file} (${(buf.length / 1024).toFixed(1)} KB)`);
  out.push(
    `@font-face {\n  font-family: '${family}';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('/fonts/${file}') format('woff2');${range ? `\n  unicode-range: ${range};` : ''}\n}`
  );
}
console.log('\n/* ---- generated @font-face (self-hosted) ---- */');
console.log(out.join('\n'));
