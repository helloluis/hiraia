// Refresh an existing native project without rerunning prebuild or touching downloads.
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../web/node_modules/next/package.json', import.meta.url));
const sharp = require('sharp');
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const repo = resolve(process.argv[2] || '.');
const assets = resolve('packages/brand/assets');
const res = `${repo}/packages/mobile/android/app/src/main/res`;
for (const [density, factor] of [['mdpi',1],['hdpi',1.5],['xhdpi',2],['xxhdpi',3],['xxxhdpi',4]]) {
  const mip = `${res}/mipmap-${density}`;
  await mkdir(mip, {recursive:true});
  await sharp(`${assets}/app-icon.svg`).resize(48*factor).webp({lossless:true}).toFile(`${mip}/ic_launcher.webp`);
  const side=48*factor;
  const circle=Buffer.from(`<svg width="${side}" height="${side}"><circle cx="${side/2}" cy="${side/2}" r="${side/2}"/></svg>`);
  await sharp(`${assets}/app-icon.svg`).resize(side).composite([{input:circle,blend:'dest-in'}]).webp({lossless:true}).toFile(`${mip}/ic_launcher_round.webp`);
  await sharp(`${assets}/adaptive-icon.svg`).resize(108*factor).webp({lossless:true}).toFile(`${mip}/ic_launcher_foreground.webp`);
  const draw=`${res}/drawable-${density}`;
  await mkdir(draw,{recursive:true});
  await sharp({create:{width:288*factor,height:288*factor,channels:4,background:'#00000000'}})
    .composite([{input:await sharp(`${assets}/splash.svg`).resize(200*factor).png().toBuffer(),gravity:'centre'}])
    .png().toFile(`${draw}/splashscreen_logo.png`);
}
