// Rebuilds the landing hero (public/brand/tala-hero-teacher*) from the approved master, as generated: no AI edits,
// no regrade. Plain resizing/cropping with sharp only. Same input -> same bytes.
//   SHARP_PATH=/path/to/node_modules/sharp node scripts/hero-build.cjs [source.png]
// Crops: the master is 2560x1440 with a dark film rim; we trim 1.2% off each edge (the hard black rim), keep the soft
// vignette, and cut the phone variant as a 3:4 window around the teacher (she stands at ~45% from the left).
const path = require('node:path');
const sharp = require(process.env.SHARP_PATH || 'sharp');
const root = path.resolve(__dirname, '..');
const source = process.argv[2] || path.join(root, 'assets-src/tala-hero-teacher-master.jpg');
const out = path.join(root, 'public/brand/');
(async () => {
  const meta = await sharp(source).metadata();
  const W = meta.width,
    H = meta.height;
  const trim = Math.round(W * 0.012);
  const base = sharp(source).extract({
    left: trim,
    top: trim,
    width: W - 2 * trim,
    height: H - 2 * trim,
  });
  const wide = {
    webp: 'tala-hero-teacher-wide.webp',
    jpg: 'tala-hero-teacher-wide.jpg',
    width: 2400,
  };
  const desk = { webp: 'tala-hero-teacher.webp', jpg: 'tala-hero-teacher.jpg', width: 1600 };
  for (const v of [wide, desk]) {
    await base
      .clone()
      .resize({ width: v.width })
      .webp({ quality: 74, effort: 6 })
      .toFile(out + v.webp);
    await base
      .clone()
      .resize({ width: v.width })
      .jpeg({ quality: 74, mozjpeg: true, progressive: true })
      .toFile(out + v.jpg);
  }
  // Phone: 3:4 window centred on the teacher (x ≈ 45%), full trimmed height.
  const th = H - 2 * trim,
    tw = Math.round(th * 0.75),
    cx = trim + Math.round((W - 2 * trim) * 0.45);
  const left = Math.max(trim, Math.min(W - trim - tw, cx - Math.round(tw / 2)));
  // One absolute extract from the source (sharp applies a second extract only after resize).
  const phone = sharp(source)
    .extract({ left, top: trim, width: tw, height: th })
    .resize({ width: 780 });
  await phone
    .clone()
    .webp({ quality: 72, effort: 6 })
    .toFile(out + 'tala-hero-teacher-mobile.webp');
  await phone
    .clone()
    .jpeg({ quality: 72, mozjpeg: true, progressive: true })
    .toFile(out + 'tala-hero-teacher-mobile.jpg');
  const fs = require('node:fs');
  for (const f of [
    wide.webp,
    wide.jpg,
    desk.webp,
    desk.jpg,
    'tala-hero-teacher-mobile.webp',
    'tala-hero-teacher-mobile.jpg',
  ]) {
    const m = await sharp(out + f).metadata();
    console.log(f, `${m.width}x${m.height}`, `${(fs.statSync(out + f).size / 1024).toFixed(0)}KB`);
  }
})();
