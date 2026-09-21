import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SemanticIndex } from '../../shared/src/rag/SemanticIndex';
import { readVectorSlice } from '../src/engine/readVectorSlice';
function file(bytes: Uint8Array, advertised = bytes.length) {
  let closed = 0;
  const reads: number[] = [];
  const handle = { offset: 0, readBytes(length: number) {
    reads.push(length);
    const result = bytes.slice(this.offset, this.offset + length);
    this.offset += result.length;
    return result;
  }, close() { closed++; } };
  return { file: { size: advertised, open: () => handle }, reads, closed: () => closed, handle };
}
test('only the selected language slice is read, preserving signed bytes across chunk boundaries', async () => {
  const bytes = Uint8Array.from({ length: 900_000 }, (_, i) => i % 256);
  const f = file(bytes);
  const result = await readVectorSlice(f.file, bytes.length, 300_000, 300_000);
  assert.deepEqual(result, new Int8Array(bytes.slice(300_000, 600_000).buffer));
  assert.ok(Math.max(...f.reads) <= 256 * 1024);
  assert.equal(f.reads.reduce((a, b) => a + b), 300_000);
  assert.equal(f.closed(), 1);
});
test('wrong size is rejected before opening and truncated reads close the handle', async () => {
  const f = file(new Uint8Array(10));
  await assert.rejects(readVectorSlice(f.file, 20, 0, 10), /mismatch/);
  assert.equal(f.reads.length, 0);
  const short = file(new Uint8Array(10), 20);
  await assert.rejects(readVectorSlice(short.file, 20, 0, 20), /Truncated/);
  assert.equal(short.closed(), 1);
});
test('cancellation during a chunk read releases the file and does not return partial vectors', async () => {
  const f = file(new Uint8Array(900_000));
  const controller = new AbortController();
  const read = f.handle.readBytes.bind(f.handle);
  f.handle.readBytes = length => { const bytes = read(length); controller.abort(); return bytes; };
  await assert.rejects(readVectorSlice(f.file, 900_000, 0, 900_000, controller.signal), /cancelled/);
  assert.equal(f.closed(), 1);
  assert.equal(f.reads.length, 1);
});

test('language slices produce exactly the same rankings as the full multilingual index', async () => {
  const data = new Int8Array([1, 9, 9, 1, 4, 2, 2, 4, -2, 8, 8, -2]);
  const langs = ['tl', 'bis', 'en'] as const;
  const full = new SemanticIndex({ dims: 2, count: 2, scale: 0.1, langs: [...langs], data });
  for (const [index, language] of ['tagalog', 'cebuano', 'english'].entries()) {
    const f = file(new Uint8Array(data.buffer));
    const slice = await readVectorSlice(f.file, 12, index * 4, 4);
    const selected = new SemanticIndex({ dims: 2, count: 2, scale: 0.1, langs: [langs[index]!], data: slice });
    assert.deepEqual(selected.search(new Float32Array([1, 0]), language as any, 2),
      full.search(new Float32Array([1, 0]), language as any, 2));
  }
});
