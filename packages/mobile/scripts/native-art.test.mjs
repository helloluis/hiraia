import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageBundledArt } from './stage-bundled-art.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hiraia-art-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mobile = path.join(root, 'mobile');
  fs.mkdirSync(path.join(mobile, 'src/generated'), { recursive: true });
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  const png = Buffer.alloc(25);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(512, 16); png.writeUInt32BE(442, 20);
  fs.writeFileSync(path.join(root, 'images/leaf.png'), png);
  const map = path.join(mobile, 'src/generated/imageMap.ts');
  fs.writeFileSync(map, 'export const IMAGE_MAP = {\n  "leaf": require("../../../images/leaf.png"),\n};\n');
  return { mobile, map, input: path.join(root, 'images/leaf.png'), output: path.join(mobile, 'android/app/build/generated/illustrationAssets/illustrations/leaf.png') };
}

test('native staging preserves bytes/dimensions, does no writes when unchanged, and detects same-size edits', t => {
  const f = fixture(t);
  assert.equal(stageBundledArt(f.mobile).copied, 1);
  const before = fs.statSync(f.output).mtimeMs;
  const inventory = path.join(f.mobile, 'src/generated/bundledArt.generated.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(inventory)).images, [['leaf', 512, 442]]);
  assert.equal(stageBundledArt(f.mobile).copied, 0);
  assert.equal(fs.statSync(f.output).mtimeMs, before);
  const bytes = fs.readFileSync(f.input), stat = fs.statSync(f.input);
  bytes[24] = 17; fs.writeFileSync(f.input, bytes); fs.utimesSync(f.input, stat.atime, stat.mtime);
  assert.equal(stageBundledArt(f.mobile).copied, 1);
  assert.deepEqual(fs.readFileSync(f.output), bytes);
});

test('removed selections are pruned and missing inputs fail before touching the last valid assets', t => {
  const f = fixture(t);
  stageBundledArt(f.mobile);
  const stale = path.join(path.dirname(f.output), 'removed.png');
  fs.writeFileSync(stale, 'old');
  assert.equal(stageBundledArt(f.mobile).removed, 1);
  assert.equal(fs.existsSync(stale), false);
  const before = fs.readFileSync(f.output);
  fs.appendFileSync(f.map, '  "missing": require("../../../images/missing.png"),\n');
  assert.throws(() => stageBundledArt(f.mobile), /ENOENT/);
  assert.deepEqual(fs.readFileSync(f.output), before);
});

test('malformed manifests and unsafe slugs are rejected', t => {
  const f = fixture(t);
  fs.writeFileSync(f.map, 'export const IMAGE_MAP = {};');
  assert.throws(() => stageBundledArt(f.mobile), /empty/);
  fs.writeFileSync(f.map, '  "../leaf": require("../../../images/leaf.png"),\n');
  assert.throws(() => stageBundledArt(f.mobile), /Invalid/);
});
