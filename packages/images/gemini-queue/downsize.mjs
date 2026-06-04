/**
 * Downsize + clean Gemini line-art PNGs for shipping.
 *
 * Strategy for black-ink line art on a grainy near-white background:
 *   1. resize 1024 -> 512 (file scales with pixels; resampling also softens grain)
 *   2. grayscale (the art has no color)
 *   3. levels: push near-white grain to pure white, deepen the blacks, keep mid-gray
 *      scribble shading -> flat background compresses hugely AND looks cleaner
 *   4. quantize to a small grayscale palette (indexed PNG) + max lossless effort
 *
 *   node gemini-queue/downsize.mjs [--in assets-png] [--out assets-png] [--size 512] [--colors 16]
 *   (run from packages/images so `sharp` resolves)
 */
import sharp from 'sharp';
import { readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const IN = arg('in', 'assets-png');        // Gemini's raw originals (never modified)
const OUT = arg('out', 'assets-png-min');  // downsized shipping copies (separate folder)
const SIZE = +arg('size', 512);
const COLORS = +arg('colors', 16);

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.toLowerCase().endsWith('.png')) yield p;
  }
}

const files = [...walk(IN)];
let before = 0, after = 0;
for (const f of files) {
  const outPath = join(OUT, relative(IN, f));
  mkdirSync(dirname(outPath), { recursive: true });
  const inBytes = statSync(f).size;
  const buf = await sharp(f)
    .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    // levels: ~y = 1.28x - 38  → inputs >=230 clip to white, <=30 clip to black
    .linear(1.28, -38)
    .png({ palette: true, colours: COLORS, effort: 10, compressionLevel: 9 })
    .toBuffer();
  // write
  const { writeFileSync } = await import('node:fs');
  writeFileSync(outPath, buf);
  before += inBytes; after += buf.length;
  console.log(`${String(Math.round(inBytes / 1024)).padStart(4)}KB -> ${String(Math.round(buf.length / 1024)).padStart(3)}KB  ${relative(IN, f)}`);
}
console.log(`\n${files.length} files: ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024).toFixed(0)}KB total  (${(100 - after / before * 100).toFixed(1)}% smaller, avg ${(after / files.length / 1024).toFixed(1)}KB)`);
