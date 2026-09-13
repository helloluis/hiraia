#!/usr/bin/env node
/** Package the existing bundled selection as native assets. No cloud/pack inputs change. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function writeChanged(file, bytes) {
  if (fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(bytes))) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return true;
}

export function stageBundledArt(mobile) {
  const mapFile = path.join(mobile, 'src/generated/imageMap.ts');
  const imageRoot = fs.realpathSync(path.resolve(mobile, '../images'));
  const output = path.join(mobile, 'android/app/build/generated/illustrationAssets/illustrations');
  const source = fs.readFileSync(mapFile, 'utf8');
  const matches = [...source.matchAll(/^\s*("[^"\n]+"):\s*require\(("[^"\n]+")\),?\s*$/gm)];
  if (!matches.length || matches.length !== (source.match(/:\s*require\(/g) ?? []).length) {
    throw new Error('Bundled image map is empty or has unsupported entries');
  }
  const seen = new Set();
  // Validate the ENTIRE input before modifying staged files. Existing iOS/Metro map is
  // the source of truth for selection; the native APK must contain exactly the same art.
  const rows = matches.map(([, key, value]) => {
    const slug = JSON.parse(key);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(slug) || seen.has(slug)) throw new Error(`Invalid/duplicate slug: ${slug}`);
    seen.add(slug);
    const input = fs.realpathSync(path.resolve(path.dirname(mapFile), JSON.parse(value)));
    if (!input.startsWith(imageRoot + path.sep) || !input.endsWith('.png')) throw new Error(`Invalid source: ${slug}`);
    const bytes = fs.readFileSync(input);
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error(`Invalid PNG: ${slug}`);
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height) throw new Error(`Invalid dimensions: ${slug}`);
    return { slug, input, width, height, sha256: digest(bytes), bytes: bytes.length };
  }).sort((a, b) => a.slug.localeCompare(b.slug, 'en'));
  fs.mkdirSync(output, { recursive: true });
  let copied = 0, removed = 0;
  for (const row of rows) {
    const dest = path.join(output, row.slug + '.png');
    // Hash equality, not mtimes: equal-size edits and restored timestamps still update.
    if (!fs.existsSync(dest) || digest(fs.readFileSync(dest)) !== row.sha256) {
      fs.copyFileSync(row.input, dest);
      copied++;
    }
  }
  for (const name of fs.readdirSync(output)) {
    if (!seen.has(name.replace(/\.png$/, '')) || !name.endsWith('.png')) {
      fs.rmSync(path.join(output, name), { recursive: true });
      removed++;
    }
  }
  const inventory = { schema: 1, images: rows.map(r => [r.slug, r.width, r.height]) };
  writeChanged(path.join(mobile, 'src/generated/bundledArt.generated.json'), JSON.stringify(inventory) + '\n');
  writeChanged(path.join(mobile, 'android/app/build/generated/illustrationAssets-manifest.json'),
    JSON.stringify(rows.map(({ input, ...row }) => row), null, 2) + '\n');
  return { images: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0), copied, removed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  console.log('Native illustrations:', JSON.stringify(stageBundledArt(mobile)));
}
