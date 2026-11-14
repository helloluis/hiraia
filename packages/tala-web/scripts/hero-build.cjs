// Rebuilds the landing hero from the colour source with the deterministic sepia grade (no AI involved):
//   SHARP_PATH=/path/to/node_modules/sharp node scripts/hero-build.cjs
// Chosen grade: saturation 0.3, sepia 0.8, grain 7 (see hero-sepia-grade.cjs). Same input -> same bytes.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const sharp = require(process.env.SHARP_PATH || 'sharp');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'assets-src/tala-hero-teacher-rev6-color.png');
const graded = path.join(os.tmpdir(), 'tala-hero-graded.png');
const out = path.join(root, 'public/brand/');
execFileSync(
  process.execPath,
  [path.join(__dirname, 'hero-sepia-grade.cjs'), source, graded, '0.3', '0.8', '7'],
  {
    stdio: 'inherit',
    env: process.env,
  }
);
(async () => {
  const meta = await sharp(graded).metadata();
  const desk = sharp(graded);
  await desk
    .clone()
    .webp({ quality: 82, effort: 6 })
    .toFile(out + 'tala-hero-teacher.webp');
  await desk
    .clone()
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out + 'tala-hero-teacher.jpg');
  const cw = Math.round((meta.height * 4) / 3);
  const mob = sharp(graded)
    .extract({ left: Math.round((meta.width - cw) / 2), top: 0, width: cw, height: meta.height })
    .resize(720, 540);
  await mob
    .clone()
    .webp({ quality: 80, effort: 6 })
    .toFile(out + 'tala-hero-teacher-mobile.webp');
  await mob
    .clone()
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(out + 'tala-hero-teacher-mobile.jpg');
})();
