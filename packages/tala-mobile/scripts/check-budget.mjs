import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
async function files(dir) { return (await Promise.all((await readdir(dir, {withFileTypes:true})).map(e => e.isDirectory() ? files(path.join(dir,e.name)) : path.join(dir,e.name)))).flat(); }
const all = await files('dist');
const bundles = all.filter(f => /\.(hbc|bundle|js)$/.test(f));
if (!bundles.length) throw Error('No exported Hermes bundle found');
let total = 0;
for (const file of bundles) total += (await stat(file)).size;
console.log(`Android Hermes bundle: ${total} bytes; aim 4000000; limit 6000000`);
if (total > 6_000_000) process.exitCode = 1;
const fontFiles = (await files('assets')).filter(f => /\.(ttf|otf|woff2?)$/.test(f));
if (fontFiles.length !== 1) throw Error('Exactly one bundled font is required');
