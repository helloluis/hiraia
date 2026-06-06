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
import { readdirSync, statSync, mkdirSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const IN = arg('in', 'assets-png');        // Gemini's raw originals (never modified)
const OUT = arg('out', 'assets-png-min');  // downsized shipping copies (separate folder)
const SIZE = +arg('size', 512);
const COLORS = +arg('colors', 16);
const BACKUP = arg('backup', IN === OUT ? `${IN}-raw` : '');

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (e.toLowerCase().endsWith('.png')) yield p;
  }
}

const files = [...walk(IN)];
let before = 0, after = 0;

if (BACKUP) {
  console.log(`Verifying and backing up originals to: ${BACKUP}`);
  for (const f of files) {
    const backupPath = join(BACKUP, relative(IN, f));
    let shouldBackup = false;
    if (!existsSync(backupPath)) {
      shouldBackup = true;
    } else {
      // If the backup file already exists, only overwrite it if the source file is an original (i.e. not yet downsized)
      try {
        const meta = await sharp(f).metadata();
        if (meta.width > SIZE || meta.height > SIZE) {
          shouldBackup = true;
        }
      } catch (err) {
        // If we can't read metadata, don't overwrite the existing backup
      }
    }

    if (shouldBackup) {
      mkdirSync(dirname(backupPath), { recursive: true });
      copyFileSync(f, backupPath);
    }
  }
}

for (const f of files) {
  const outPath = join(OUT, relative(IN, f));
  const backupPath = BACKUP ? join(BACKUP, relative(IN, f)) : '';
  
  // If a backup exists, use the backup as the source so we always downsize from the original quality
  const srcPath = (backupPath && existsSync(backupPath)) ? backupPath : f;
  const inBytes = statSync(srcPath).size;

  const buf = await sharp(srcPath)
    .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    // levels: ~y = 1.28x - 38  → inputs >=230 clip to white, <=30 clip to black
    .linear(1.28, -38)
    .png({ palette: true, colours: COLORS, effort: 10, compressionLevel: 9 })
    .toBuffer();

  // write
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, buf);
  
  before += inBytes; after += buf.length;
  console.log(`${String(Math.round(inBytes / 1024)).padStart(4)}KB -> ${String(Math.round(buf.length / 1024)).padStart(3)}KB  ${relative(IN, f)}`);
}
console.log(`\n${files.length} files: ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024).toFixed(0)}KB total  (${(100 - after / before * 100).toFixed(1)}% smaller, avg ${(after / files.length / 1024).toFixed(1)}KB)`);

