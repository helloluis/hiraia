import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, qrPngDataUri } from './qr';

test('a Tala-sized QR payload encodes to a valid-looking symbol with finder patterns and quiet zone', () => {
  const payload = JSON.stringify({
    v: 1,
    kind: 'hiraia-tala',
    class_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
    class_name: 'Grade 6 Perseverance',
    public_key: 'A'.repeat(392),
  });
  const symbol = encodeQr(payload, 'M');
  assert.ok(symbol.size >= 85 && symbol.size <= 101, `size ${symbol.size}`);
  assert.equal((symbol.size - 17) % 4, 0);
  // Finder pattern corners: dark 7x7 border with a dark 3x3 centre at each of three corners.
  for (const [cx, cy] of [
    [3, 3],
    [symbol.size - 4, 3],
    [3, symbol.size - 4],
  ]) {
    assert.equal(symbol.modules[cy!]![cx!], true);
    assert.equal(symbol.modules[cy! - 3]![cx! - 3], true);
    assert.equal(symbol.modules[cy! - 2]![cx! - 2], false);
    assert.equal(symbol.modules[cy! - 1]![cx! - 1], true);
  }
  // Timing patterns alternate along row/column 6 between the finders.
  for (let i = 8; i < symbol.size - 8; i++) {
    assert.equal(symbol.modules[6]![i], i % 2 === 0);
    assert.equal(symbol.modules[i]![6], i % 2 === 0);
  }
  // Dark module at (8, size-8).
  assert.equal(symbol.modules[symbol.size - 8]![8], true);
});

test('small payloads pick small versions; the data uri is a PNG of the expected size', () => {
  const tiny = encodeQr('hello', 'M');
  assert.equal(tiny.size, 21);
  const uri = qrPngDataUri(tiny, 4, 4);
  assert.ok(uri.startsWith('data:image/png;base64,iVBORw0KGgo'));
  const bytes = Buffer.from(uri.slice('data:image/png;base64,'.length), 'base64');
  const width = bytes.readUInt32BE(16);
  assert.equal(width, (21 + 8) * 4);
  assert.equal(bytes.subarray(bytes.length - 12).toString('latin1'), '\0\0\0\0IEND\xaeB`\x82');
  assert.throws(() => encodeQr('x'.repeat(3000), 'M'));
});

test('encoding is deterministic', () => {
  // Independent decoding was verified with zxing-cpp (see modules/tala-activity/README.md): the
  // Tala-sized payload decodes byte-for-byte at L, M, Q and H. Here we only pin determinism.
  const a = encodeQr('Hello, world!', 'M');
  const b = encodeQr('Hello, world!', 'M');
  assert.deepEqual(a.modules, b.modules);
  assert.equal(a.size, 21);
});
