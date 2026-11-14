// Deterministic sepia grade for the Tala hero. Plain image processing (sharp): no AI, no randomness
// beyond a fixed-seed film grain. Usage: node sepia-grade.cjs <in.png> <out.png> [saturation] [sepia] [grain]
const sharp = require(process.env.SHARP_PATH || 'sharp');
const [input, output, satArg, sepiaArg, grainArg] = process.argv.slice(2);
const saturation = Number(satArg ?? 0.25); // 1 = original colour, 0 = monochrome
const sepia = Number(sepiaArg ?? 0.65); // 0 = none, 1 = full classic sepia matrix
const grain = Number(grainArg ?? 7); // standard deviation of luminance grain, 0-255 scale

// Luminance-preserving sepia: every output channel is the pixel's luminance times a warm brown tone, so
// highlights are not pushed past white (the classic sepia matrix brightens and clips them).
const LUMA = [0.299, 0.587, 0.114];
const TONE = [1.1, 0.95, 0.72];
const I = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const matrix = I.map((row, r) => row.map((v, c) => (1 - sepia) * v + sepia * TONE[r] * LUMA[c]));

// mulberry32: tiny seeded generator, so the grain is identical on every run.
function prng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

(async () => {
  const meta = await sharp(input).metadata();
  // 1. desaturate, 2. warm sepia matrix, 3. a touch of faded-print contrast (lifted blacks, soft highlights).
  const graded = await sharp(input)
    .removeAlpha()
    .modulate({ saturation })
    .recomb(matrix)
    // faded print: gentler contrast, blacks lifted towards warm brown, paper-toned highlights
    .linear([0.88, 0.88, 0.86], [24, 17, 8])
    .raw()
    .toBuffer();
  // 4. film grain: the same gaussian offset on R, G and B (luminance grain), fixed seed.
  const rand = prng(20261114);
  const out = Buffer.alloc(graded.length);
  for (let i = 0; i < graded.length; i += 3) {
    const u = Math.max(rand(), 1e-9);
    const g = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()) * grain;
    out[i] = Math.max(0, Math.min(255, graded[i] + g));
    out[i + 1] = Math.max(0, Math.min(255, graded[i + 1] + g));
    out[i + 2] = Math.max(0, Math.min(255, graded[i + 2] + g));
  }
  await sharp(out, { raw: { width: meta.width, height: meta.height, channels: 3 } })
    .png()
    .toFile(output);
})();
