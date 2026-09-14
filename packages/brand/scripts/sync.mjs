// node packages/brand/scripts/sync.mjs /path/to/web-checkout /path/to/mobile-checkout
import { copyFile, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const brand=fileURLToPath(new URL('../',import.meta.url));
const web=resolve(process.argv[2] || '.', 'packages/web');
const mobile=resolve(process.argv[3] || process.argv[2] || '.', 'packages/mobile');
for (const dir of [`${web}/src/components/brand`,`${web}/public/brand`,`${mobile}/src/components/brand`]) await mkdir(dir,{recursive:true});
for (const consumer of [web,mobile]) await copyFile(`${brand}/brand.generated.json`,`${consumer}/src/components/brand/brand.generated.json`);
await cp(`${brand}/assets`,`${web}/public/brand`,{recursive:true});
await copyFile(`${brand}/assets/favicon.png`,`${web}/src/app/icon.png`);
await copyFile(`${brand}/assets/apple-icon.png`,`${web}/src/app/apple-icon.png`);
for (const [src,dst] of [['app-icon.png','icon.png'],['adaptive-icon.png','adaptive-icon.png'],['splash.png','splash.png']]) await copyFile(`${brand}/assets/${src}`,`${mobile}/assets/${dst}`);
// Full display font is separate from the outlined wordmark's small source subset.
await copyFile(`${brand}/fonts/Fraunces-SemiBold.ttf`,`${mobile}/assets/fonts/Fraunces-SemiBold.ttf`);
await copyFile(`${brand}/fonts/fraunces-semibold.woff2`,`${web}/public/fonts/fraunces-semibold.woff2`);
for (const dir of [`${mobile}/assets/fonts`,`${web}/public/fonts`]) await copyFile(`${brand}/fonts/Fraunces-OFL.txt`,`${dir}/Fraunces-OFL.txt`);
