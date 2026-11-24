/**
 * What differs between an uploaded deck and its export with no edits (should be nothing but the container).
 *   tsx scripts/decks/pptx-diff.ts <file.pptx>...
 */
import { readFileSync } from 'node:fs';
import { noEdits } from '@hiraia/tala-core/pptx';
import { readUploadedDeck, writeEditedDeck } from '../../src/modules/decks/upload-file';
import { readZip } from '../../src/modules/decks/zip';

for (const file of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(file));
  const deck = readUploadedDeck(bytes);
  const out = writeEditedDeck(bytes, noEdits(deck)).pptx;
  const a = readZip(bytes, { inflatedBytes: 1 << 30, entries: 10000 });
  const b = readZip(out, { inflatedBytes: 1 << 30, entries: 10000 });
  const changed = a.names.filter((n) => b.has(n) && Buffer.compare(Buffer.from(a.read(n)), Buffer.from(b.read(n))) !== 0);
  const added = b.names.filter((n) => !a.has(n));
  const removed = a.names.filter((n) => !b.has(n));
  const order = a.names.join('\n') === b.names.join('\n');
  console.log(`${file.split('/').pop()}: kind=${deck.kind} parts ${a.names.length}→${b.names.length} changed=[${changed.join(', ')}] added=[${added.join(', ')}] removed=[${removed.join(', ')}] sameOrder=${order} firstIn=${a.names[0]} firstOut=${b.names[0]}`);
}
