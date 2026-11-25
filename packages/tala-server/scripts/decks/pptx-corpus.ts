/**
 * Round-trip check of the uploaded-deck engine on a folder of real PowerPoint files (not part of the test suite:
 * the corpus is fetched, not committed).
 *
 *   tsx scripts/decks/pptx-corpus.ts <corpus-dir> <report.json> [--out <dir>]
 *
 * For every file: is it taken or refused (and why); does an export with no edits hold exactly the uploaded parts,
 * byte for byte; do scripted edits (words, an added paragraph, notes, reorder, copy, delete) read back as written;
 * and how many parts did each change touch. With --out the uploaded file's edited variants are written there for
 * rendering and for opening in other software.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { noEdits, type DeckEdits, type DeckInspection } from '@hiraia/tala-core/pptx';
import { readUploadedDeck, sha256Hex, UploadRefused, writeEditedDeck } from '../../src/modules/decks/upload-file';
import { readZip } from '../../src/modules/decks/zip';

const [corpusDir, reportPath] = process.argv.slice(2);
const outIndex = process.argv.indexOf('--out');
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : null;
if (!corpusDir || !reportPath) {
  console.error('usage: pptx-corpus.ts <corpus-dir> <report.json> [--out <dir>]');
  process.exit(2);
}
if (outDir) mkdirSync(outDir, { recursive: true });

interface FileResult {
  file: string;
  bytes: number;
  sha256: string;
  taken: boolean;
  refusal?: string;
  ms?: number;
  kind?: string;
  slides?: number;
  textBlocks?: number;
  editableBlocks?: number;
  features?: Record<string, number>;
  /** Export with no edits: every part identical to the upload, same names in the same order. */
  noopIdentical?: boolean;
  noopBytes?: number;
  /** The upload did not start with `[Content_Types].xml`; the export moves it first. No part changes. */
  contentTypesMoved?: boolean;
  /** `slide` is the 1-based slide whose words changed, `box` where that text sits (fractions of the slide). */
  textEdit?: { ok: boolean; partsChanged: number; slide?: number; box?: { x: number; y: number; w: number; h: number } | null; detail?: string };
  notesEdit?: { ok: boolean; partsChanged: number; added: boolean; detail?: string } | null;
  reorder?: { ok: boolean; partsChanged: number; detail?: string } | null;
  /** `at` is the 0-based position of the slide that was copied (the copy follows it). */
  copy?: { ok: boolean; partsChanged: number; at?: number; detail?: string } | null;
  remove?: { ok: boolean; partsChanged: number; partsRemoved: number; detail?: string } | null;
  combined?: { ok: boolean; detail?: string } | null;
  error?: string;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.byteLength), Buffer.from(b.buffer, b.byteOffset, b.byteLength)) === 0;

function partsIdentical(original: Uint8Array, edited: Uint8Array): { identical: boolean; changed: string[]; added: string[]; removed: string[]; contentTypesMoved: boolean } {
  const a = readZip(original, { inflatedBytes: 1 << 30, entries: 10000 });
  const b = readZip(edited, { inflatedBytes: 1 << 30, entries: 10000 });
  const changed: string[] = [];
  for (const name of a.names) if (b.has(name) && !same(a.read(name), b.read(name))) changed.push(name);
  const added = b.names.filter((n) => !a.has(n));
  const removed = a.names.filter((n) => !b.has(n));
  // The export puts `[Content_Types].xml` first (as Office does); everything else keeps its place.
  const CT = '[Content_Types].xml';
  const order = a.names.filter((n) => b.has(n) && n !== CT).join('\n') === b.names.filter((n) => a.has(n) && n !== CT).join('\n');
  return { identical: !changed.length && !added.length && !removed.length && order, changed, added, removed, contentTypesMoved: a.names[0] !== CT };
}

const titles = (d: DeckInspection) => d.slides.map((s) => s.title);

function check(file: string): FileResult {
  const bytes = new Uint8Array(readFileSync(join(corpusDir!, file)));
  const result: FileResult = { file, bytes: bytes.length, sha256: sha256Hex(bytes), taken: false };
  const started = performance.now();
  let deck: DeckInspection;
  try {
    deck = readUploadedDeck(bytes);
  } catch (err) {
    result.refusal = err instanceof UploadRefused ? err.reason : `crash:${(err as Error).message}`;
    result.ms = Math.round(performance.now() - started);
    return result;
  }
  result.taken = true;
  result.ms = Math.round(performance.now() - started);
  result.kind = deck.kind;
  result.slides = deck.totals.slides;
  result.textBlocks = deck.totals.textBlocks;
  result.editableBlocks = deck.totals.editableBlocks;
  result.features = Object.fromEntries(deck.features.map((f) => [f.feature, f.count]));
  const stem = file.replace(/\.[a-z]+$/i, '');
  const save = (suffix: string, pptx: Uint8Array) => {
    if (outDir) writeFileSync(join(outDir, `${stem}.${suffix}.pptx`), pptx);
  };

  // 1. No edits: the uploaded parts, untouched.
  const noop = writeEditedDeck(bytes, noEdits(deck));
  // A template or a show is turned into a presentation, which changes one line of [Content_Types].xml and nothing else.
  const noopDiff = partsIdentical(bytes, noop.pptx);
  result.noopIdentical = deck.kind === 'presentation' ? noopDiff.identical : noopDiff.changed.join() === '[Content_Types].xml' && !noopDiff.added.length && !noopDiff.removed.length;
  result.noopBytes = noop.pptx.length;
  result.contentTypesMoved = noopDiff.contentTypesMoved;
  save('noop', noop.pptx);

  // 2. Change words: the first editable block that has words gets a changed first paragraph and a new last one.
  const target = deck.slides.flatMap((s) => s.blocks.filter((b) => b.editable && b.paragraphs.some((p) => p.trim())).map((b) => ({ s, b })))[0];
  if (target) {
    const wanted = [...target.b.paragraphs];
    const first = wanted.findIndex((p) => p.trim());
    wanted[first] = `${wanted[first]} — pinalitan ng guro`;
    wanted.push('Bagong talata: ñ, é, <&> "quotes" 😀');
    const edits: DeckEdits = { slides: deck.slides.map((s) => (s.id === target.s.id ? { id: s.id, source: s.id, text: { [target.b.id]: wanted } } : { id: s.id, source: s.id })) };
    try {
      const out = writeEditedDeck(bytes, edits);
      const again = readUploadedDeck(out.pptx);
      const got = again.slides.find((s) => s.id === target.s.id)?.blocks.find((b) => b.id === target.b.id)?.paragraphs;
      const others =
        JSON.stringify(again.slides.map((s) => s.blocks.filter((b) => !(s.id === target.s.id && b.id === target.b.id)).map((b) => b.paragraphs))) ===
        JSON.stringify(deck.slides.map((s) => s.blocks.filter((b) => !(s.id === target.s.id && b.id === target.b.id)).map((b) => b.paragraphs)));
      const diff = partsIdentical(bytes, out.pptx);
      const expectChanged = deck.kind === 'presentation' ? 1 : 2;
      const ok = JSON.stringify(got) === JSON.stringify(wanted) && others && diff.changed.length === expectChanged && !diff.added.length && !diff.removed.length;
      result.textEdit = { ok, partsChanged: diff.changed.length, slide: target.s.number, box: target.b.box, ...(ok ? {} : { detail: `got=${JSON.stringify(got)?.slice(0, 200)} others=${others} changed=${diff.changed.join(',')}` }) };
      save('text', out.pptx);
    } catch (err) {
      result.textEdit = { ok: false, partsChanged: -1, detail: String((err as Error).message ?? err) };
    }
  }

  // 3. Notes: change them where a slide has a notes page, write them where the deck can take a new one.
  const notesSlide = deck.slides.find((s) => s.notes.editable);
  result.notesEdit = null;
  if (notesSlide) {
    const wanted = ['Paalala ng guro: tanungin muna ang klase.', 'Ikalawang linya.'];
    try {
      const out = writeEditedDeck(bytes, { slides: deck.slides.map((s) => (s.id === notesSlide.id ? { id: s.id, source: s.id, notes: wanted } : { id: s.id, source: s.id })) });
      const again = readUploadedDeck(out.pptx);
      const got = again.slides.find((s) => s.id === notesSlide.id)?.notes.paragraphs;
      const diff = partsIdentical(bytes, out.pptx);
      const ok = JSON.stringify(got) === JSON.stringify(wanted) && JSON.stringify(titles(again)) === JSON.stringify(titles(deck));
      result.notesEdit = { ok, partsChanged: diff.changed.length + diff.added.length, added: !notesSlide.notes.exists, ...(ok ? {} : { detail: `got=${JSON.stringify(got)?.slice(0, 200)}` }) };
      save('notes', out.pptx);
    } catch (err) {
      result.notesEdit = { ok: false, partsChanged: -1, added: !notesSlide.notes.exists, detail: String((err as Error).message ?? err) };
    }
  }

  // 4. Order, copy, delete.
  result.reorder = null;
  result.copy = null;
  result.remove = null;
  result.combined = null;
  const identity = noEdits(deck).slides;
  if (deck.slides.length > 1) {
    try {
      const out = writeEditedDeck(bytes, { slides: [...identity].reverse() });
      const again = readUploadedDeck(out.pptx);
      const diff = partsIdentical(bytes, out.pptx);
      const ok = JSON.stringify(again.slides.map((s) => s.id)) === JSON.stringify([...deck.slides].reverse().map((s) => s.id)) && !diff.added.length && !diff.removed.length;
      result.reorder = { ok, partsChanged: diff.changed.length, ...(ok ? {} : { detail: diff.changed.join(',') }) };
      save('reversed', out.pptx);
    } catch (err) {
      result.reorder = { ok: false, partsChanged: -1, detail: String((err as Error).message ?? err) };
    }
    try {
      const gone = deck.slides[deck.slides.length - 1]!;
      const out = writeEditedDeck(bytes, { slides: identity.slice(0, -1) });
      const again = readUploadedDeck(out.pptx);
      const diff = partsIdentical(bytes, out.pptx);
      const ok = again.slides.length === deck.slides.length - 1 && !again.slides.some((s) => s.id === gone.id) && JSON.stringify(titles(again)) === JSON.stringify(titles(deck).slice(0, -1));
      result.remove = { ok, partsChanged: diff.changed.length, partsRemoved: diff.removed.length, ...(ok ? {} : { detail: `slides=${again.slides.length}` }) };
      save('removed-last', out.pptx);
    } catch (err) {
      result.remove = { ok: false, partsChanged: -1, partsRemoved: -1, detail: String((err as Error).message ?? err) };
    }
  }
  const copyable = deck.slides.find((s) => !s.duplicateBlockers.length);
  if (copyable) {
    try {
      const at = deck.slides.indexOf(copyable);
      const slides = [...identity.slice(0, at + 1), { id: 'ccopy0001', source: copyable.id }, ...identity.slice(at + 1)];
      const out = writeEditedDeck(bytes, { slides });
      const again = readUploadedDeck(out.pptx);
      const copy = again.slides[at + 1];
      const diff = partsIdentical(bytes, out.pptx);
      const ok =
        again.slides.length === deck.slides.length + 1 &&
        JSON.stringify(copy?.blocks.map((b) => b.paragraphs)) === JSON.stringify(copyable.blocks.map((b) => b.paragraphs)) &&
        JSON.stringify(copy?.notes.paragraphs) === JSON.stringify(copyable.notes.paragraphs) &&
        !diff.removed.length;
      result.copy = { ok, partsChanged: diff.changed.length, at, ...(ok ? {} : { detail: `slides=${again.slides.length} added=${diff.added.join(',')}` }) };
      save('copied', out.pptx);
    } catch (err) {
      result.copy = { ok: false, partsChanged: -1, detail: String((err as Error).message ?? err) };
    }
  }

  // 5. Everything at once, twice (the result must be the same bytes both times).
  if (target && deck.slides.length > 1) {
    try {
      const wanted = ['Isang linya lang.'];
      const slides: DeckEdits['slides'] = [...identity].reverse().map((e) => (e.id === target.s.id ? { ...e, text: { [target.b.id]: wanted } } : e));
      if (copyable) slides.push({ id: 'ccopy0002', source: copyable.id, ...(copyable.id === target.s.id ? { text: { [target.b.id]: ['Kopya na may ibang salita.'] } } : {}) });
      const one = writeEditedDeck(bytes, { slides });
      const two = writeEditedDeck(bytes, { slides });
      const again = readUploadedDeck(one.pptx);
      const got = again.slides.find((s) => s.id === target.s.id)?.blocks.find((b) => b.id === target.b.id)?.paragraphs;
      const ok = same(one.pptx, two.pptx) && JSON.stringify(got) === JSON.stringify(wanted) && again.slides.length === slides.length;
      result.combined = { ok, ...(ok ? {} : { detail: `deterministic=${same(one.pptx, two.pptx)} got=${JSON.stringify(got)?.slice(0, 120)} slides=${again.slides.length}/${slides.length}` }) };
      save('combined', one.pptx);
    } catch (err) {
      result.combined = { ok: false, detail: String((err as Error).message ?? err) };
    }
  }
  return result;
}

const files = readdirSync(corpusDir).filter((f) => /\.(pptx|potx|ppsx|pptm|potm|ppsm)$/i.test(f)).sort();
const results: FileResult[] = [];
for (const file of files) {
  try {
    results.push(check(file));
  } catch (err) {
    results.push({ file, bytes: 0, sha256: '', taken: false, error: String((err as Error).stack ?? err).slice(0, 600) });
  }
}
const taken = results.filter((r) => r.taken);
const count = (pick: (r: FileResult) => { ok: boolean } | null | undefined) => {
  const tried = taken.map(pick).filter((x): x is { ok: boolean } => !!x);
  return { tried: tried.length, ok: tried.filter((x) => x.ok).length };
};
const refusals: Record<string, number> = {};
for (const r of results) if (!r.taken) refusals[r.refusal ?? 'error'] = (refusals[r.refusal ?? 'error'] ?? 0) + 1;
const summary = {
  files: results.length,
  taken: taken.length,
  refused: results.length - taken.length,
  refusals,
  crashes: results.filter((r) => r.error || r.refusal?.startsWith('crash:')).length,
  slides: taken.reduce((n, r) => n + (r.slides ?? 0), 0),
  textBlocks: taken.reduce((n, r) => n + (r.textBlocks ?? 0), 0),
  editableBlocks: taken.reduce((n, r) => n + (r.editableBlocks ?? 0), 0),
  noopIdentical: { tried: taken.length, ok: taken.filter((r) => r.noopIdentical).length },
  contentTypesMoved: taken.filter((r) => r.contentTypesMoved).length,
  textEdit: count((r) => r.textEdit),
  notesEdit: count((r) => r.notesEdit),
  reorder: count((r) => r.reorder),
  copy: count((r) => r.copy),
  remove: count((r) => r.remove),
  combined: count((r) => r.combined),
  slowestMs: Math.max(0, ...results.map((r) => r.ms ?? 0)),
};
writeFileSync(reportPath, JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
for (const r of results) {
  const bad = [
    r.error && `ERROR ${r.error.split('\n')[0]}`,
    r.refusal?.startsWith('crash:') && r.refusal,
    r.taken && !r.noopIdentical && 'noop differs',
    r.textEdit && !r.textEdit.ok && `text: ${r.textEdit.detail}`,
    r.notesEdit && !r.notesEdit.ok && `notes: ${r.notesEdit.detail}`,
    r.reorder && !r.reorder.ok && `reorder: ${r.reorder.detail}`,
    r.copy && !r.copy.ok && `copy: ${r.copy.detail}`,
    r.remove && !r.remove.ok && `remove: ${r.remove.detail}`,
    r.combined && !r.combined.ok && `combined: ${r.combined.detail}`,
  ].filter(Boolean);
  if (bad.length) console.log(`${r.file}: ${bad.join(' | ').slice(0, 500)}`);
}
