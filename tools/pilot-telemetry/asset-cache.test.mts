import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const mobile =
  process.env.PILOT_MOBILE_PATH ||
  path.resolve(import.meta.dirname, '../../../hiraia-unified/packages/mobile');
const require = createRequire(import.meta.url);
const modulePath = require.resolve(path.resolve(mobile, '../../node_modules/metro/src/Assets.js'));
const original = require(modulePath);
delete require.cache[modulePath];
require(path.join(mobile, 'scripts/metro-static-asset-cache.cjs'));
const cached = require(modulePath);

test('release directory cache preserves Metro hashes, scale and platform selection and shares concurrent listings', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'hiraia-assets-'));
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
    'base64'
  );
  for (const name of ['icon.png', 'icon@2x.png', 'icon.android.png', 'other.png'])
    fs.writeFileSync(path.join(dir, name), pixel);
  const listing = fs.promises.readdir;
  let reads = 0;
  try {
    const expected = [];
    for (const platform of [null, 'android', 'ios'])
      expected.push(
        await original.getAssetData(
          path.join(dir, 'icon.png'),
          'icons/icon.png',
          [],
          platform,
          '/assets'
        )
      );
    fs.promises.readdir = (async (...args: any[]) => {
      if (args[0] === dir) reads++;
      return (listing as any)(...args);
    }) as any;
    for (const [i, platform] of [null, 'android', 'ios'].entries()) {
      const records = await Promise.all(
        Array.from({ length: 20 }, () =>
          cached.getAssetData(path.join(dir, 'icon.png'), 'icons/icon.png', [], platform, '/assets')
        )
      );
      records.forEach((r) => assert.deepEqual(r, expected[i]));
    }
    assert.equal(reads, 3, 'one directory index per platform, rather than 60');
  } finally {
    fs.promises.readdir = listing;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
