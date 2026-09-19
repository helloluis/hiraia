import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const repo = resolve(root, '../../..');
const assets = resolve(root, 'assets');
const res = resolve(repo, 'packages/tala/android/app/src/main/res');

for (const [density, factor] of [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
]) {
  const mipmap = resolve(res, `mipmap-${density}`);
  await mkdir(mipmap, { recursive: true });
  await sharp(resolve(assets, 'app-icon.svg'))
    .resize(48 * factor)
    .png()
    .toFile(resolve(mipmap, 'ic_launcher.png'));
  await sharp(resolve(assets, 'app-icon.svg'))
    .resize(48 * factor)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${48 * factor}" height="${48 * factor}"><circle cx="${24 * factor}" cy="${24 * factor}" r="${24 * factor}"/></svg>`
        ),
        blend: 'dest-in',
      },
    ])
    .png()
    .toFile(resolve(mipmap, 'ic_launcher_round.png'));
  await sharp(resolve(assets, 'adaptive-icon.svg'))
    .resize(108 * factor)
    .png()
    .toFile(resolve(mipmap, 'ic_launcher_foreground.png'));
}
console.log(`Wrote Tala launcher resources to ${res}`);
