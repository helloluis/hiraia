import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
test('budget gate rejects oversize bytecode and hashed image assets', () => {
  const root = mkdtempSync(join(tmpdir(), 'tala-budget-'));
  const script = resolve('scripts/check-budget.mjs');
  try {
    mkdirSync(join(root, 'assets'));
    mkdirSync(join(root, 'dist'));
    copyFileSync(
      resolve('assets/Fraunces-SemiBold.ttf'),
      join(root, 'assets/Fraunces-SemiBold.ttf')
    );
    copyFileSync(resolve('assets/Fraunces-SemiBold.ttf'), join(root, 'dist/font-hash'));
    const metadata = {
      fileMetadata: {
        android: {
          assets: [
            { path: 'font-hash', ext: 'ttf' },
            { path: 'image-hash', ext: 'png' },
          ],
        },
      },
    };
    writeFileSync(join(root, 'dist/metadata.json'), JSON.stringify(metadata));
    const bundle = Buffer.alloc(6_000_001);
    Buffer.from('c61fbc03c103191f', 'hex').copy(bundle);
    writeFileSync(join(root, 'dist/index.hbc'), bundle);
    writeFileSync(join(root, 'dist/image-hash'), Buffer.alloc(1));
    assert.equal(spawnSync(process.execPath, [script], { cwd: root }).status, 1);
    writeFileSync(join(root, 'dist/index.hbc'), bundle.subarray(0, 16));
    writeFileSync(join(root, 'dist/image-hash'), Buffer.alloc(1_000_001));
    assert.equal(spawnSync(process.execPath, [script], { cwd: root }).status, 1);
    writeFileSync(join(root, 'dist/image-hash'), Buffer.alloc(1));
    assert.equal(spawnSync(process.execPath, [script], { cwd: root }).status, 0);
  } finally {
    rmSync(root, { recursive: true });
  }
});
