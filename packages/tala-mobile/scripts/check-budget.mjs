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
let images = 0;
for (const file of all.filter((f) => /\.(png|jpe?g|webp|gif|svg)$/.test(f)))
  images += (await stat(file)).size;
console.log(`Exported images: ${images} bytes; limit 1000000`);
if (images > 1_000_000) process.exitCode = 1;
