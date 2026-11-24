import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block } from '../contracts/content';
import { combinedPrintFixture } from '../plan/combine-fixtures';
import { richTextPlainText } from '../plan/text';
import { printFixture } from '../print/fixtures';
import { renderPlanText, type RenderPlanOptions } from '../print';
import { DOCX_CONTENT_TYPE, crc32, planDocxFileName, renderPlanDocx, renderPlanDocxParts, zipStore } from './index';

/* ---------- small readers, written here so the test does not trust the writer ---------- */

/** Entries of a ZIP whose entries are stored: read from the central directory, each checked against its CRC. */
function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50, 'end record');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50, 'central record');
    assert.equal(view.getUint16(at + 10, true), 0, 'stored');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(local, true), 0x04034b50, 'local record');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out.set(name, data);
    at += 46 + nameLength;
  }
  return out;
}

/** Well-formed: one root, every tag closed by its own name, attributes quoted, no stray "<" or "&". */
function assertWellFormed(xml: string, name: string): void {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, '');
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0;
  let roots = 0;
  for (let m = tag.exec(body); m; m = tag.exec(body)) {
    const between = body.slice(last, m.index);
    assert.ok(!between.includes('<'), `${name}: stray "<" near ${between.slice(0, 40)}`);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/.test(between), `${name}: bare "&" near ${between.slice(0, 40)}`);
    if (m[1]) assert.equal(stack.pop(), m[2], `${name}: closing ${m[2]}`);
    else if (!m[4]) stack.push(m[2]!);
    if (!stack.length) roots += 1;
    last = tag.lastIndex;
  }
  assert.equal(stack.length, 0, `${name}: unclosed ${stack.join(',')}`);
  assert.equal(body.slice(last).trim(), '', `${name}: text after the root`);
  assert.equal(roots, 1, `${name}: one root`);
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
/** The words of a document part, one line per paragraph. */
const textOf = (xml: string): string =>
  xml
    .replace(/<w:br\/>/g, '\n')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:instrText[^>]*>[^<]*<\/w:instrText>/g, '')
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map(unescape)
    .join('\n');
const tables = (xml: string): string[] => xml.match(/<w:tbl>.*?<\/w:tbl>/gs) ?? [];
const rows = (tbl: string): string[] => tbl.match(/<w:tr>.*?<\/w:tr>/gs) ?? [];
const cells = (row: string): string[] => row.match(/<w:tc>.*?<\/w:tc>/gs) ?? [];
const cellTexts = (row: string): string[] => cells(row).map((c) => textOf(c).trim());
const flowTable = (xml: string, firstHeader: string): string => tables(xml).find((t) => cellTexts(rows(t)[0]!)[0] === firstHeader)!;
const gridWidths = (tbl: string): number[] => [...tbl.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
const doc = (o: RenderPlanOptions): string => renderPlanDocxParts(o)['word/document.xml']!;

test('the file is a ZIP that any reader can open, and the same plan always gives the same bytes', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const o = combinedPrintFixture();
  const bytes = renderPlanDocx(o);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const files = unzip(bytes);
  assert.deepEqual([...files.keys()], ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/_rels/document.xml.rels', 'word/styles.xml', 'word/numbering.xml', 'word/footer1.xml', 'docProps/core.xml']);
  for (const [name, data] of files) assertWellFormed(new TextDecoder().decode(data), name);
  // Every part named in a relationship or a content-type override is in the package.
  const types = new TextDecoder().decode(files.get('[Content_Types].xml')!);
  for (const m of types.matchAll(/PartName="\/([^"]+)"/g)) assert.ok(files.has(m[1]!), m[1]);
  const rels = new TextDecoder().decode(files.get('word/_rels/document.xml.rels')!);
  for (const m of rels.matchAll(/Target="([^"]+)"/g)) assert.ok(files.has(`word/${m[1]}`), m[1]);
  assert.deepEqual(renderPlanDocx(combinedPrintFixture()), bytes);
  assert.equal(DOCX_CONTENT_TYPE, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.deepEqual(unzip(zipStore([{ name: 'ñ/a.txt', data: new Uint8Array([1, 2, 3]) }])).get('ñ/a.txt'), new Uint8Array([1, 2, 3]));
});

test('two grades: the session is one real table, a row per time block, a column per grade, and who the teacher is with', () => {
  const o = combinedPrintFixture({ grades: ['4', '5'] });
  const xml = doc(o);
  const flow = o.sections.find((s) => s.content.type === 'multigrade')!.content;
  assert.equal(flow.type, 'multigrade');
  if (flow.type !== 'multigrade') return;
  const table = flowTable(xml, 'Time');
  const all = rows(table);
  assert.deepEqual(cellTexts(all[0]!), ['Time', 'Teacher is with', 'Grade 4', 'Grade 5']);
  assert.ok(all[0]!.includes('<w:tblHeader/>'), 'the heading row repeats on every page');
  assert.equal(all.length, 1 + flow.blocks.length);
  flow.blocks.forEach((b, i) => {
    const row = cellTexts(all[i + 1]!);
    assert.ok(row[0]!.startsWith(b.label) && row[0]!.includes(`${b.minutes} min`), row[0]);
    // Each grade's box holds that grade's activity, word for word.
    ['group001', 'group002'].forEach((id, k) => {
      const words = richTextPlainText(b.groups[id]!.activity).split('\n').filter((line) => line.trim());
      for (const line of words) assert.ok(row[2 + k]!.includes(line.replace(/^[•\d.]+\s*/, '').trim()), `${b.label} ${id}: ${line}`);
    });
    assert.ok(all[i + 1]!.includes('<w:cantSplit/>'), 'a time block stays on one page');
  });
  assert.deepEqual(cellTexts(all[1]!).slice(1, 2), ['All groups']);
  assert.ok(cellTexts(all[2]!)[1] === 'Grade 4', 'the youngest grade has the teacher first');
  // Portrait A4 for two grades; the columns fill the text width exactly.
  assert.ok(xml.includes('<w:pgSz w:w="11906" w:h="16838"/>'));
  assert.equal(gridWidths(table).reduce((a, b) => a + b, 0), 11906 - 2 * 680);
  // Objectives, materials and assessment are side by side, one column per grade.
  const perGrade = tables(xml).filter((t) => cellTexts(rows(t)[0]!).join('|') === 'Grade 4|Grade 5');
  assert.ok(perGrade.length >= 3, `${perGrade.length} per-grade tables`);
});

test('three grades: landscape, three grade columns, on A4 and on long bond', () => {
  const a4 = doc(combinedPrintFixture({ grades: ['3', '4', '5'], paper: 'a4' }));
  assert.ok(a4.includes('<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>'));
  const table = flowTable(a4, 'Time');
  assert.deepEqual(cellTexts(rows(table)[0]!), ['Time', 'Teacher is with', 'Grade 3', 'Grade 4', 'Grade 5']);
  assert.equal(gridWidths(table).reduce((a, b) => a + b, 0), 16838 - 2 * 680);
  assert.equal(rows(table).length, 1 + 5, 'start, three turns, finish');
  const long = doc(combinedPrintFixture({ grades: ['3', '4', '5'], paper: 'long' }));
  assert.ok(long.includes('<w:pgSz w:w="18720" w:h="12240" w:orient="landscape"/>'));
  assert.ok(doc(combinedPrintFixture({ paper: 'long' })).includes('<w:pgSz w:w="12240" w:h="18720"/>'));
});

test('curriculum references, the draft label and the AI-draft notice travel into the document', () => {
  const o = combinedPrintFixture({ grades: ['4', '5'] });
  const text = textOf(doc(o));
  assert.ok(text.includes('Grade 4: Measure accurately the distance and time when things move using simple equipment (Grade 4). [DepEd Science G4: 2026 Three-Term BOW (2026-04-08), p. 7]'), 'reference of grade 4');
  assert.ok(text.includes('[DepEd Science G5: 2026 Three-Term BOW (2026-04-08), p. 7]'), 'reference of grade 5');
  assert.ok(text.split('\n').includes('DRAFT'));
  // The lessons it was combined from were AI drafts, so the combined plan says so too.
  assert.equal(o.plan.aiDraft, true);
  assert.ok(text.includes('Drafted with AI and not yet checked by the teacher.'));
  assert.ok(!textOf(doc({ ...o, plan: { ...o.plan, aiDraft: false } })).includes('Drafted with AI'), 'a plan the teacher wrote herself is not called an AI draft');
  assert.ok(!textOf(doc({ ...o, plan: { ...o.plan, state: 'locked' } })).split('\n').includes('DRAFT'), 'a finished plan is not marked DRAFT');
  // The header says who, where and when, as the printed page does.
  for (const line of ['School: Sample Elementary School', 'Teacher: Teacher Peña', 'Grade: 4, 5', 'Learning area: Science', 'Dates: 2026-11-24', 'Term: Term 2']) assert.ok(text.includes(line), line);
  const footer = textOf(renderPlanDocxParts(o)['word/footer1.xml']!);
  assert.ok(footer.includes('Tala lesson plan · Hiraia'));
});

test('Filipino: labels are Filipino and the lesson’s own words are untouched', () => {
  const o = combinedPrintFixture({ grades: ['4', '5'], lang: 'fil' });
  const xml = doc(o);
  assert.deepEqual(cellTexts(rows(flowTable(xml, 'Oras'))[0]!), ['Oras', 'Kasama ng guro', 'Baitang 4', 'Baitang 5']);
  const text = textOf(xml);
  for (const word of ['Guro: Teacher Peña', 'Paaralan: Sample Elementary School', 'Sabay-sabay na simula', 'Lahat ng pangkat']) assert.ok(text.includes(word), word);
});

test('what the teacher changed is what the document says, including awkward characters', () => {
  const o = combinedPrintFixture({ grades: ['4', '5'] });
  const sections = o.sections.map((s) => {
    if (s.content.type !== 'multigrade') return s;
    const blocks = s.content.blocks.map((b, i) =>
      i !== 1
        ? b
        : {
            ...b,
            label: 'My own block <1> & "2"',
            groups: {
              ...b.groups,
              group001: {
                ...b.groups.group001!,
                activity: [
                  { t: 'p', spans: [{ text: 'Sukatin ang layo: ñ, é, 5 < 7 & 7 > 5.\nSecond line.\u0007', b: true }] },
                  { t: 'ol', items: [[{ text: 'Una' }], [{ text: 'Ikalawa 😀' }]] },
                  { t: 'ol', items: [[{ text: 'Another list' }]] },
                  { t: 'ul', items: [[{ text: 'A bullet' }]] },
                ] as Block[],
              },
            },
          }
    );
    return { ...s, content: { ...s.content, note: 'My note for this class.', blocks } };
  });
  const parts = renderPlanDocxParts({ ...o, sections });
  const xml = parts['word/document.xml']!;
  assertWellFormed(xml, 'document');
  const row = rows(flowTable(xml, 'Time'))[2]!;
  const text = cellTexts(row);
  assert.ok(text[0]!.startsWith('My own block <1> & "2"'));
  assert.ok(text[2]!.includes('Sukatin ang layo: ñ, é, 5 < 7 & 7 > 5.\nSecond line.'), text[2]);
  assert.ok(!xml.includes('\u0007'), 'a control character is dropped, not written');
  assert.ok(text[2]!.includes('Ikalawa 😀'));
  assert.ok(cells(row)[2]!.includes('<w:b/>'), 'bold stays bold');
  assert.ok(textOf(xml).includes('My note for this class.'));
  // Two numbered lists are two lists (each starts at 1); bullets share one definition.
  const ids = [...cells(row)[2]!.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['2', '2', '3', '1']);
  assert.equal((parts['word/numbering.xml']!.match(/<w:startOverride w:val="1"\/>/g) ?? []).length, 2);
  assertWellFormed(parts['word/numbering.xml']!, 'numbering');
});

test('every kind of plan exports: daily, weekly and a multi-grade plan written by hand, with the words of the print', () => {
  for (const kind of ['dlp', 'dll', 'multigrade'] as const) {
    const o = printFixture(kind);
    const parts = renderPlanDocxParts(o);
    for (const [name, xml] of Object.entries(parts)) assertWellFormed(xml, `${kind} ${name}`);
    const text = textOf(parts['word/document.xml']!);
    for (const words of ['Mga halaman: ñ, á, é, í, ó, ú', 'Obserbahan ang halaman. Ihambing ang mga dahon.', 'Guro: Guro Peña', 'S3 — Identify plant parts.']) assert.ok(text.includes(words), `${kind}: ${words}`);
    // After-class sections with nothing written get lines to write on, as on paper.
    assert.ok(parts['word/document.xml']!.includes('<w:pBdr><w:bottom'), `${kind}: writing lines`);
    // Nothing the plain-text export says is missing from the document.
    const plain = renderPlanText(o).split('\n').map((l) => l.trim()).filter((l) => l && !/^_+$/.test(l) && !/: _+$/.test(l));
    const squashed = text.replace(/\s+/g, ' ');
    for (const line of plain) {
      const found = squashed.includes(line.replace(/\s+/g, ' ')) || line.split(/[:()]/).every((bit) => squashed.includes(bit.trim()));
      assert.ok(found || /^(Lahat ng pangkat|Pangkat|Baitang \d|group\d+)/.test(line) || textOf(parts['word/footer1.xml']!).includes(line), `${kind}: "${line}"`);
    }
  }
  assert.ok(doc(printFixture('dlp')).includes('Pagmamasid (20 min)'));
  assert.equal(gridWidths(tables(doc(printFixture('dll'))).find((t) => rows(t).length === 2 && cells(rows(t)[0]!).length === 5)!).length, 5);
});

test('the file name is safe on any device', () => {
  const o = combinedPrintFixture();
  assert.match(planDocxFileName(o), /^[A-Za-z0-9-]+\.docx$/);
  assert.equal(planDocxFileName({ plan: { ...o.plan, title: 'Mga halaman: ñ / "Baitang 4"' } }), 'Mga-halaman-n-Baitang-4.docx');
  assert.equal(planDocxFileName({ plan: { ...o.plan, title: '   ' } }), 'lesson-plan.docx');
  assert.ok(planDocxFileName({ plan: { ...o.plan, title: 'x'.repeat(300) } }).length <= 85);
});
