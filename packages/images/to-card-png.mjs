/**
 * Convert card illustrations into the bundle format: 512px indexed-grayscale PNG.
 *
 * Same treatment downsize.mjs gives the clip-art library, pointed at the card engravings:
 * grayscale (the art has no colour), a levels push so near-white grain goes pure white and
 * the ink deepens, then quantise to an 8-entry grayscale palette. Measured on the factoid
 * bank that is 15.5 KB against 30.9 KB for the same image as WebP — half the bytes, and the
 * levels pass actually sharpens the cross-hatching rather than costing anything visible.
 *
 * Everything lands in ONE flat directory named by the card's slug, because that is what makes
 * this survive the rest of the image batch arriving later: gen-image-map.mjs walks the
 * directory, so a new file IS a new wired illustration. Converting the remaining images is
 * then a re-run of this script plus a re-run of the map, with no back-tracking and no
 * re-processing of anything already here (existing outputs are skipped).
 *
 * Prefer a RAW source over an already-compressed one. The factoid bank only exists locally as
 * WebP so it takes a second lossy step, which line art tolerates; the freshly generated cards
 * still have their 1024px PNGs, so those convert straight across and skip the round trip.
 *
 *   node to-card-png.mjs --in factoid-webp --only /tmp/wanted.txt
 *   node to-card-png.mjs --in ../../hiraia/rag/pipeline/imagegen/raw
 *   (run from packages/images so `sharp` resolves)
 */
import sharp from 'sharp';
import { readdirSync, statSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const IN = arg('in', 'factoid-webp');
const OUT = arg('out', 'cards-png');
const SIZE = +arg('size', 512);
const COLORS = +arg('colors', 8);
const ONLY = arg('only', '');

const wanted = ONLY
  ? new Set(readFileSync(ONLY, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))
  : null;

mkdirSync(OUT, { recursive: true });

const src = readdirSync(IN)
  .filter((f) => /\.(png|webp|jpe?g)$/i.test(f))
  .filter((f) => !wanted || wanted.has(basename(f, extname(f))))
  .sort();

let done = 0, skipped = 0, failed = 0, bytesIn = 0, bytesOut = 0;
const t0 = Date.now();

for (const f of src) {
  const slug = basename(f, extname(f));
  const dst = join(OUT, `${slug}.png`);
  if (existsSync(dst)) { skipped++; continue; }
  try {
    const inPath = join(IN, f);
    bytesIn += statSync(inPath).size;
    await sharp(inPath)
      .resize(SIZE, SIZE, { fit: 'inside', withoutEnlargement: true })
      .grayscale()
      .linear(1.25, -12)                       // whites to white, ink deeper, mid-greys kept
      .png({ palette: true, colours: COLORS, effort: 10, compressionLevel: 9 })
      .toFile(dst);
    bytesOut += statSync(dst).size;
    done++;
    if (done % 500 === 0) {
      const s = (Date.now() - t0) / 1000;
      console.log(`  ...${done.toLocaleString()} converted  (${(done / s).toFixed(0)}/s)`);
    }
  } catch (e) {
    failed++;
    console.error(`  FAIL ${slug}: ${e.message}`);
  }
}

const all = readdirSync(OUT).filter((f) => f.endsWith('.png'));
const total = all.reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`\n${done.toLocaleString()} converted, ${skipped.toLocaleString()} already present, ${failed} failed`);
if (done) console.log(`  ${(bytesIn / done / 1024).toFixed(1)} KB -> ${(bytesOut / done / 1024).toFixed(1)} KB each (${(bytesOut / bytesIn * 100).toFixed(0)}%)`);
console.log(`  ${OUT}/ now holds ${all.length.toLocaleString()} images, ${(total / 1e6).toFixed(0)} MB`);
