// Run from the repository root after generate.py.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/node_modules/next/package.json', import.meta.url));
const sharp = require('sharp');
import { fileURLToPath } from 'node:url';
const assets = fileURLToPath(new URL('../assets/', import.meta.url));
for (const [name, size] of [['app-icon',1024], ['adaptive-icon',1024], ['splash',1024], ['favicon',512], ['wordmark',1600], ['wordmark-reversed',1600]]) {
  await sharp(`${assets}${name}.svg`).resize(size).png().toFile(`${assets}${name}.png`);
}
await sharp(`${assets}favicon.svg`).resize(180).png().toFile(`${assets}apple-icon.png`);

await sharp(`${assets}wordmark.svg`).resize(1600).png().toFile(fileURLToPath(new URL('../logo.png', import.meta.url)));
await sharp(`${assets}wordmark.svg`).resize(1400).extend({top:100,bottom:100,left:100,right:100,background:'#00000000'}).png().toFile(fileURLToPath(new URL('../logo-with-padding.png', import.meta.url)));
