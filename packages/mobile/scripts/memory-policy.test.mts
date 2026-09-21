import assert from 'node:assert/strict';
import { GiB, memoryBlock, semanticMemoryBlock, canLoadSemantic } from '../src/engine/memoryPolicy';
const jambo = { totalBytes: 3.666 * GiB, availableBytes: 1.7 * GiB, thresholdBytes: 0.2 * GiB, freeStorageBytes: 3 * GiB, lowMemory: false, lowRamDevice: false };
assert.equal(memoryBlock(jambo, true), 'unsupported', '4 GB must never download/load the LLM');
assert.equal(semanticMemoryBlock(jambo, true), null, '4 GB supports standalone LaBSE');
assert.equal(canLoadSemantic(jambo), true);
const large = { ...jambo, totalBytes: 7.8 * GiB, availableBytes: 3.5 * GiB };
assert.equal(memoryBlock(large, true), null);
assert.equal(memoryBlock({ ...large, availableBytes: 2 * GiB }), 'pressure', 'LLM must leave headroom after LaBSE');
for (const policy of [memoryBlock, semanticMemoryBlock]) {
  assert.equal(policy(null), 'unknown');
  assert.equal(policy({ ...large, availableBytes: NaN }), 'unknown');
  assert.equal(policy({ ...large, totalBytes: 0 }), 'unknown');
  assert.equal(policy({ ...large, lowMemory: true }), 'pressure');
  assert.equal(policy({ ...large, lowRamDevice: true }), 'unsupported');
  assert.equal(policy({ ...large, totalBytes: 2.91 * GiB }), 'unsupported');
  assert.equal(policy({ ...large, availableBytes: 0.7 * GiB }), 'pressure');
  assert.equal(policy({ ...large, freeStorageBytes: 0.5 * GiB }, true), 'storage');
  assert.equal(policy({ ...large, freeStorageBytes: 0.5 * GiB }, false), null, 'cached assets need no download space');
  assert.equal(policy({ ...large, thresholdBytes: 3.4 * GiB }), 'pressure');
}
assert.equal(semanticMemoryBlock({ ...jambo, availableBytes: GiB }), 'pressure');
assert.equal(semanticMemoryBlock(jambo), null, 'headroom recovery is not cached');
console.log('Memory policy checks passed');
