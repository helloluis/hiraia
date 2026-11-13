import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name)
      )
    )
  ).flat();
}
const all = await files('dist');
const bundles = all.filter((f) => f.endsWith('.hbc'));
if (!bundles.length)
  throw Error('No exported Hermes bytecode found; run expo export --platform android');
let total = 0;
for (const file of bundles) {
  const content = await readFile(file);
  if (content.subarray(0, 8).toString('hex') !== 'c61fbc03c103191f')
    throw Error('Export is not Hermes bytecode');
  total += content.length;
}
console.log(`Android Hermes bundle: ${total} bytes; aim 4000000; limit 6000000`);
if (total > 6_000_000) process.exitCode = 1;
const fontFiles = (await files('assets')).filter((f) => /\.(ttf|otf|woff2?)$/.test(f));
if (fontFiles.length !== 1 || path.basename(fontFiles[0]) !== 'Fraunces-SemiBold.ttf')
  throw Error('Exactly Fraunces SemiBold must be bundled');
const metadata = JSON.parse(await readFile('dist/metadata.json', 'utf8'));
const exportedAssets = metadata.fileMetadata?.android?.assets;
if (!Array.isArray(exportedAssets)) throw Error('Android asset metadata is missing');
const exportedFonts = exportedAssets.filter((asset) => /^(ttf|otf|woff2?)$/.test(asset.ext));
if (exportedFonts.length !== 1) throw Error('Export must include exactly one font');
if (
  !(await readFile(path.join('dist', exportedFonts[0].path))).equals(
    await readFile('assets/Fraunces-SemiBold.ttf')
  )
)
  throw Error('Exported font differs from Fraunces SemiBold');
let images = 0;
for (const asset of exportedAssets.filter((asset) => /^(png|jpe?g|webp|gif|svg)$/.test(asset.ext)))
  images += (await stat(path.join('dist', asset.path))).size;
console.log(`Exported images: ${images} bytes; limit 1000000`);
if (images > 1_000_000) process.exitCode = 1;
