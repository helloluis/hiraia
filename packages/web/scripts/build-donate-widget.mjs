#!/usr/bin/env node
// Build the /support crypto checkout (src/donate-widget/entry.tsx) into public/donate-widget/,
// separately from Next — see the header of entry.tsx for why. Runs as part of `pnpm build`.
//
// Output: public/donate-widget/<hashed ESM files> + manifest.json {"entry": "/donate-widget/…"}.
// The directory is generated (git-ignored) and rebuilt from scratch every time.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'public', 'donate-widget');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const started = Date.now();
const result = await build({
  absWorkingDir: web,
  entryPoints: { entry: 'src/donate-widget/entry.tsx' },
  outdir: out,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  jsx: 'automatic',
  minify: true,
  legalComments: 'none',
  entryNames: '[name]-[hash]',
  chunkNames: 'c/[hash]',
  assetNames: 'a/[hash]',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  metafile: true,
  logLevel: 'warning',
});

// With splitting, dynamic-import chunks are entry points too; ours is the named one.
const entry = Object.keys(result.metafile.outputs).find((f) => /(^|\/)entry-[A-Z0-9]+\.js$/.test(f));
if (!entry) throw new Error('donate widget: no entry output');
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(out);
const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
const entryUrl = '/donate-widget/' + relative(out, join(web, entry)).split('\\').join('/');
const entryHash = createHash('sha256').update(readFileSync(join(web, entry))).digest('hex').slice(0, 16);
writeFileSync(join(out, 'manifest.json'), JSON.stringify({ entry: entryUrl, sha256_16: entryHash, built: new Date().toISOString() }) + '\n');
console.log(`donate widget: ${entryUrl} (${files.length} files, ${(bytes / 1e6).toFixed(2)} MB, ${Date.now() - started} ms)`);
