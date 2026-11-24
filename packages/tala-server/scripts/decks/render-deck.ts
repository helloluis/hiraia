/**
 * Draw every slide of a .pptx the way the server does, for checking fidelity by eye and by pixel: the file is read
 * and written out as an upload would be, then handed to the sandboxed drawing service over its socket
 * (packages/tala-server/deploy/render). Nothing is drawn any other way.
 *   TALA_DECKS_PREVIEW_SOCKET=/path/render.sock tsx scripts/decks/render-deck.ts <out-dir> <file.pptx>...
 * On a developer's machine the socket comes from `node deploy/render/dev-units.mjs start` and needs
 * TALA_DECKS_PREVIEW_SHARED_USER=1 as well. Writes <out-dir>/<file-stem>/slide-<n>.jpg and prints one line per file.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { noEdits } from '@hiraia/tala-core/pptx';
import { readUploadedDeck, writeEditedDeck } from '../../src/modules/decks/upload-file';
import { RenderError, rendererFromEnv } from '../../src/modules/decks/upload-render';

const [outDir, ...files] = process.argv.slice(2);
const renderer = rendererFromEnv();
if (!outDir || !files.length || !renderer) {
  console.error('usage: TALA_DECKS_PREVIEW_SOCKET=/path/render.sock render-deck.ts <out-dir> <file.pptx>...');
  process.exit(2);
}
for (const file of files) {
  const stem = basename(file).replace(/\.[a-z]+$/i, '');
  const started = performance.now();
  try {
    const bytes = new Uint8Array(readFileSync(file));
    const deck = readUploadedDeck(bytes);
    const { pptx } = writeEditedDeck(bytes, noEdits(deck));
    let pages: Uint8Array[] | null = null;
    for (let attempt = 1; !pages; attempt++) {
      try {
        pages = await renderer.render(pptx, deck.slides.length);
      } catch (err) {
        // One job at a time: the previous one may still be on its way out.
        if (!(err instanceof RenderError) || err.kind !== 'busy' || attempt >= 20) throw err;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    mkdirSync(join(outDir, stem), { recursive: true });
    pages.forEach((picture, i) => writeFileSync(join(outDir, stem, `slide-${String(i + 1).padStart(3, '0')}.jpg`), picture));
    // Where the reader says each text block sits (fractions of the slide), to lay over the pictures (pptx-boxes.py).
    writeFileSync(join(outDir, stem, 'boxes.json'), JSON.stringify(deck.slides.map((s) => ({ slide: s.number, blocks: s.blocks.map((b) => ({ id: b.id, role: b.role, name: b.name, editable: b.editable, box: b.box, words: b.paragraphs.join(' / ').slice(0, 60) })) })), null, 1));
    console.log(`${basename(file)}\t${pages.length} slides\t${Math.round(performance.now() - started)} ms\t${pages.reduce((n, p) => n + p.length, 0)} bytes`);
  } catch (err) {
    console.log(`${basename(file)}\tFAILED\t${Math.round(performance.now() - started)} ms\t${String((err as Error).message).split('\n')[0]!.slice(0, 200)}`);
  }
}
