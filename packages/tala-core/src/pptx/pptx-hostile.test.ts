/**
 * Files made to hurt the reader: each must be read or refused in bounded time and memory, whatever it says.
 *
 * Every case here either took seconds to hours, or memory without end, before the reader had a budget for the whole
 * job (xml.ts `XmlBudget`, opc.ts `PackageLimits`) and before the places that trusted a number or a length from the
 * file were closed. The first two are the files the release owner stopped a rehearsal server with on 24 Nov 2026.
 * The server runs all of this in a worker with a time and a memory limit as well (tala-server: upload-jobs.ts);
 * these tests are about the reader being bounded by itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, inspectDeck, noEdits, PACKAGE_LIMITS, PptxError, PptxPackage, PPTX_LIMITS, XML_LIMITS, xmlBudget, type DeckEdits, type DeckInspection } from './index';
import { syntheticDeck, syntheticDeckParts } from './testing';

/** Generous for a slow machine; the cases below took from seconds to (extrapolated) hours before. */
const QUICK_MS = 2500;

function timed<T>(fn: () => T): { ms: number; value?: T; code?: string } {
  const started = performance.now();
  try {
    const value = fn();
    return { ms: performance.now() - started, value };
  } catch (err) {
    return { ms: performance.now() - started, code: err instanceof PptxError ? err.code : `not a PptxError: ${String(err).slice(0, 120)}` };
  }
}
const part = (name: string): string => syntheticDeckParts()[name] as string;
const quick = (r: { ms: number }, what: string) => assert.ok(r.ms < QUICK_MS, `${what} took ${Math.round(r.ms)} ms`);

test('a table cell that says it spans four thousand million columns is read like any other', () => {
  for (const span of ['1000000000', '4000000000', '999999999999']) {
    const slide = part('ppt/slides/slide2.xml').replace('<a:tc>', `<a:tc gridSpan="${span}" rowSpan="${span}">`);
    const r = timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide2.xml': slide })));
    quick(r, `gridSpan ${span}`);
    const cell = (r.value as DeckInspection).slides[1]!.blocks.find((b) => b.role === 'cell')!;
    // The cell cannot be wider than the table's own two columns.
    assert.equal(cell.box!.w, Math.round((4000000 / 12192000) * 10000) / 10000);
  }
});

test('a slide stuffed with more than a million empty elements is refused, by its size and by its count', () => {
  const stuffed = (n: number) => part('ppt/slides/slide1.xml').replace('<p:extLst>', `<p:extLst><p:ext uri="{stuffing}">${'<p:e/>'.repeat(n)}</p:ext>`);
  // 1,400,000 elements are 8.4 million characters: over what one part may be.
  const bySize = timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide1.xml': stuffed(1_400_000) })));
  assert.equal(bySize.code, 'too_large');
  quick(bySize, 'a part over the size limit');
  // Under the size limit, but more nodes than one part may have.
  const byCount = timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide1.xml': stuffed(XML_LIMITS.nodes + 1000) })));
  assert.equal(byCount.code, 'too_large');
  quick(byCount, 'a part over the node limit');
});

test('many parts that are each within the limits are held to one budget for the whole job', () => {
  const stuffed = (name: string, n: number) => part(name).replace('</p:cSld>', `</p:cSld><p:extLst><p:ext uri="{stuffing}">${'<p:e/>'.repeat(n)}</p:ext></p:extLst>`).replace(/<p:extLst><p:ext uri="\{BB962C8B[^]*?<\/p:extLst>/, '');
  const parts = { 'ppt/slides/slide1.xml': stuffed('ppt/slides/slide1.xml', 200_000), 'ppt/slides/slide2.xml': stuffed('ppt/slides/slide2.xml', 200_000), 'ppt/slides/slide3.xml': stuffed('ppt/slides/slide3.xml', 200_000) };
  // Each slide alone is fine; the three together are more than this job may parse.
  const tight = timed(() => inspectDeck(new PptxPackage(syntheticDeck(parts), { budget: xmlBudget(450_000) })));
  assert.equal(tight.code, 'too_large');
  quick(tight, 'a job over its node budget');
  const byChars = timed(() => inspectDeck(new PptxPackage(syntheticDeck(parts), { budget: xmlBudget(2_000_000, 3_000_000) })));
  assert.equal(byChars.code, 'too_large');
  // With the standing budget the same deck is read: 600,000 nodes of stuffing are within what a real deck may need.
  const budget = xmlBudget();
  const roomy = timed(() => inspectDeck(new PptxPackage(syntheticDeck(parts), { budget })));
  assert.equal(roomy.code, undefined);
  quick(roomy, 'reading 600,000 nodes');
  assert.ok(budget.nodes > 1_300_000 && budget.nodes < 1_400_000, `nodes left: ${budget.nodes}`);
  // And a deck with nothing unusual in it uses next to nothing of it.
  const plain = xmlBudget();
  inspectDeck(new PptxPackage(syntheticDeck(), { budget: plain }));
  assert.ok(xmlBudget().nodes - plain.nodes < 2000, `an ordinary small deck used ${xmlBudget().nodes - plain.nodes} nodes`);
});

test('a heavy deck is read one slide at a time: parsed slides are let go, not held all at once', () => {
  const stuffed = (name: string) => part(name).replace('</p:cSld>', `</p:cSld><p:extLst><p:ext uri="{stuffing}">${'<p:e/>'.repeat(150_000)}</p:ext></p:extLst>`).replace(/<p:extLst><p:ext uri="\{BB962C8B[^]*?<\/p:extLst>/, '');
  const pkg = new PptxPackage(syntheticDeck({ 'ppt/slides/slide1.xml': stuffed('ppt/slides/slide1.xml'), 'ppt/slides/slide2.xml': stuffed('ppt/slides/slide2.xml'), 'ppt/slides/slide3.xml': stuffed('ppt/slides/slide3.xml') }), { budget: xmlBudget() });
  inspectDeck(pkg);
  const held = (pkg as unknown as { docNodes: number }).docNodes;
  assert.ok(held <= PACKAGE_LIMITS.cachedNodes + 151_000, `nodes still held after reading: ${held}`);
});

test('white space by the hundred thousand inside a tag does not slow an edit', () => {
  const spaces = ' '.repeat(400_000);
  // A paragraph written as one empty tag with a long run of spaces before an attribute, in a title a teacher edits.
  const slide = part('ppt/slides/slide1.xml').replace(/<a:p><a:r><a:rPr lang="en-US" dirty="0"\/><a:t>Parts of a plant<\/a:t><\/a:r><\/a:p>/, `<a:p${spaces}x="1"/>`);
  const source = syntheticDeck({ 'ppt/slides/slide1.xml': slide });
  const deck = inspectDeck(source);
  const title = deck.slides[0]!.blocks[0]!;
  assert.deepEqual([title.role, title.paragraphs, title.editable], ['title', [''], true]);
  const edits: DeckEdits = { slides: noEdits(deck).slides.map((s, i) => (i === 0 ? { ...s, text: { [title.id]: ['A new title'] } } : s)) };
  const pkg = new PptxPackage(source);
  const r = timed(() => applyEdits(pkg, edits));
  assert.equal(r.code, undefined);
  quick(r, 'editing a paragraph whose tag holds 400,000 spaces');
  assert.ok(pkg.text('ppt/slides/slide1.xml').includes('<a:t>A new title</a:t>'));
  // A paragraph added after it is written "like" it: the long tag is copied once more, quickly.
  const two = new PptxPackage(source);
  const added = timed(() => applyEdits(two, { slides: noEdits(deck).slides.map((s, i) => (i === 0 ? { ...s, text: { [title.id]: ['A new title', 'A second paragraph'] } } : s)) }));
  assert.equal(added.code, undefined);
  quick(added, 'adding a paragraph like one whose tag holds 400,000 spaces');
  assert.ok(two.text('ppt/slides/slide1.xml').includes('<a:t>A second paragraph</a:t>'));
  // Four hundred of them would be 160 MB of spaces: counted before any is built, and refused.
  const many = timed(() => applyEdits(new PptxPackage(source), { slides: noEdits(deck).slides.map((s, i) => (i === 0 ? { ...s, text: { [title.id]: Array.from({ length: 400 }, (_x, k) => `Paragraph ${k}`) } } : s)) }));
  assert.equal(many.code, 'too_large');
  quick(many, '400 paragraphs like one whose tag holds 400,000 spaces');
  // The same in a relationships part that has to be opened up to take a new relationship.
  const rels = `<?xml version="1.0"?>\n<Relationships${spaces}xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
  const pkg2 = new PptxPackage(syntheticDeck({ 'ppt/slides/_rels/slide3.xml.rels': rels }));
  const r2 = timed(() => pkg2.editRels('ppt/slides/slide3.xml', [{ type: 'http://example.invalid/t', target: 'ppt/media/image1.png' }]));
  assert.equal(r2.code, undefined);
  quick(r2, 'opening up an empty relationships tag that holds 400,000 spaces');
  assert.equal(pkg2.rels('ppt/slides/slide3.xml').length, 1);
});

test('thousands of placeholders on a slide and on its layout are matched without comparing each with each', () => {
  const n = 12_000;
  const shape = (i: number, body: boolean) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${i + 10}" name="P"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="${i + 10}"/></p:nvPr></p:nvSpPr><p:spPr/>${body ? '<p:txBody><a:bodyPr/><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody>' : ''}</p:sp>`;
  const many = (body: boolean) => Array.from({ length: n }, (_x, i) => shape(i, body)).join('');
  const slide = part('ppt/slides/slide3.xml').replace('</p:spTree>', `${many(true)}</p:spTree>`);
  const layout = part('ppt/slideLayouts/slideLayout1.xml').replace('</p:spTree>', `${many(false)}</p:spTree>`);
  const r = timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide3.xml': slide, 'ppt/slideLayouts/slideLayout1.xml': layout })));
  // More text boxes than a slide may have here: refused, but only after the whole slide was walked, and quickly.
  assert.equal(r.code, 'too_large');
  quick(r, `${n} placeholders against ${n}`);
});

test('thousands of parts, each with a type of its own, are looked up, not searched for one by one', () => {
  // Just under the most parts a file may have, every one named in the content types.
  const n = 3900;
  const extra: Record<string, string> = {};
  let overrides = '';
  for (let i = 0; i < n; i++) {
    extra[`customXml/item${i}.xml`] = '<?xml version="1.0"?><x/>';
    overrides += `<Override PartName="/customXml/item${i}.xml" ContentType="application/xml"/>`;
  }
  extra['[Content_Types].xml'] = part('[Content_Types].xml').replace('</Types>', `${overrides}</Types>`);
  const r = timed(() => inspectDeck(syntheticDeck(extra)));
  assert.equal(r.code, undefined);
  quick(r, `${n} parts with ${n} content types`);
  assert.equal((r.value as DeckInspection).slides.length, 3);
});

test('a slide list or a relationships list of absurd length is refused before it is worked through', () => {
  const ids = (n: number) => Array.from({ length: n }, (_x, i) => `<p:sldId id="${300 + i}" r:id="rId${100 + i}"/>`).join('');
  const relsFor = (n: number) => Array.from({ length: n }, (_x, i) => `<Relationship Id="rId${100 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>`).join('');
  // 60,000 slides listed, each pointing at a relationship that is not there.
  const listed = timed(() => inspectDeck(syntheticDeck({ 'ppt/presentation.xml': part('ppt/presentation.xml').replace('</p:sldIdLst>', `${ids(60_000)}</p:sldIdLst>`) })));
  assert.equal(listed.code, 'damaged');
  quick(listed, '60,000 listed slides');
  // More slides than a deck may have, all really there: refused as soon as the limit is passed.
  const names: Record<string, string> = {};
  for (let i = 0; i < 500; i++) names[`ppt/slides/s${i}.xml`] = part('ppt/slides/slide3.xml');
  const many = timed(() =>
    inspectDeck(
      syntheticDeck({
        ...names,
        'ppt/presentation.xml': part('ppt/presentation.xml').replace('</p:sldIdLst>', `${ids(500)}</p:sldIdLst>`),
        'ppt/_rels/presentation.xml.rels': part('ppt/_rels/presentation.xml.rels').replace('</Relationships>', `${Array.from({ length: 500 }, (_x, i) => `<Relationship Id="rId${100 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/s${i}.xml"/>`).join('')}</Relationships>`),
      })
    )
  );
  assert.equal(many.code, 'too_many_slides');
  quick(many, '503 slides');
  // A relationships part is a list: 20,000 entries are more than one may hold.
  const longRels = timed(() => inspectDeck(syntheticDeck({ 'ppt/_rels/presentation.xml.rels': part('ppt/_rels/presentation.xml.rels').replace('</Relationships>', `${relsFor(20_000)}</Relationships>`) })));
  assert.equal(longRels.code, 'too_large');
  quick(longRels, 'a relationships part of 20,000 entries');
});

test('what a deck is read into has one size limit, however the text is spread', () => {
  const box = (i: number, text: string) => `<p:sp><p:nvSpPr><p:cNvPr id="${i + 20}" name="T"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
  // 500 text boxes of 5,000 characters on one slide: each is within the limits for a block, together they are not.
  const slide = part('ppt/slides/slide3.xml').replace('</p:spTree>', `${Array.from({ length: 500 }, (_x, i) => box(i, 'w'.repeat(5000))).join('')}</p:spTree>`);
  const r = timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide3.xml': slide })));
  assert.equal(r.code, 'too_large');
  quick(r, '2.5 million characters of text boxes');
  // Thousands of things that are only carried along are counted exactly and listed up to a limit.
  const pic = (i: number) => `<p:pic><p:nvPicPr><p:cNvPr id="${i + 20}" name="Pic"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill/><p:spPr/></p:pic>`;
  const crowded = inspectDeck(syntheticDeck({ 'ppt/slides/slide3.xml': part('ppt/slides/slide3.xml').replace('</p:spTree>', `${Array.from({ length: 5000 }, (_x, i) => pic(i)).join('')}</p:spTree>`) }));
  assert.equal(crowded.slides[2]!.objects.length, PPTX_LIMITS.objectsPerSlide);
  assert.ok(JSON.stringify(crowded).length < 400_000);
});

test('edits cannot make the file grow without end: copies of a large slide, and formatting repeated for every line typed', () => {
  // A slide of one megabyte, copied 40 times.
  const heavy = part('ppt/slides/slide3.xml').replace('<p:cSld>', `<!--${'-'.repeat(0)}${'x'.repeat(1024 * 1024)}--><p:cSld>`);
  const source = syntheticDeck({ 'ppt/slides/slide3.xml': heavy });
  const deck = inspectDeck(source);
  const copies: DeckEdits = { slides: [...noEdits(deck).slides, ...Array.from({ length: 40 }, (_x, i) => ({ id: `ccopy${String(i).padStart(4, '0')}`, source: 's258' }))] };
  const r = timed(() => applyEdits(new PptxPackage(source), copies));
  assert.equal(r.code, 'too_large');
  quick(r, '40 copies of a one-megabyte slide');
  // A few copies of it are fine.
  assert.equal(timed(() => applyEdits(new PptxPackage(source), { slides: copies.slides.slice(0, 8) })).code, undefined);

  // A title whose formatting is a quarter of a megabyte, and a teacher (or a script) who types 4,000 lines into it:
  // each line would carry the formatting again.
  const fat = `<a:rPr lang="en-US" dirty="0"><a:extLst><a:ext uri="{fat}">${'<a:x/>'.repeat(40_000)}</a:ext></a:extLst></a:rPr>`;
  const fatSource = syntheticDeck({ 'ppt/slides/slide1.xml': part('ppt/slides/slide1.xml').replace('<a:rPr lang="en-US" dirty="0"/><a:t>Parts of a plant', `${fat}<a:t>Parts of a plant`) });
  const fatDeck = inspectDeck(fatSource);
  const lines = Array.from({ length: 4000 }, (_x, i) => `line ${i}`).join('\n');
  const typed: DeckEdits = { slides: noEdits(fatDeck).slides.map((s, i) => (i === 0 ? { ...s, text: { b0: [lines] } } : s)) };
  const r2 = timed(() => applyEdits(new PptxPackage(fatSource), typed));
  assert.equal(r2.code, 'too_large');
  quick(r2, '4,000 lines in a title with a quarter of a megabyte of formatting');
  // One line in the same title is written.
  const one = new PptxPackage(fatSource);
  applyEdits(one, { slides: noEdits(fatDeck).slides.map((s, i) => (i === 0 ? { ...s, text: { b0: ['One line'] } } : s)) });
  assert.ok(one.text('ppt/slides/slide1.xml').includes('<a:t>One line</a:t>'));
});

test('nesting, entities and other things XML can be made to do are refused as too large or damaged, never followed', () => {
  const deep = part('ppt/slides/slide3.xml').replace('</p:spTree>', `${'<p:grpSp>'.repeat(5000)}${'</p:grpSp>'.repeat(5000)}</p:spTree>`);
  const r = timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide3.xml': deep })));
  assert.equal(r.code, 'too_large');
  quick(r, '5,000 levels of nesting');
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>${part('ppt/slides/slide3.xml').replace(/^<\?xml[^>]*\?>\n/, '')}`;
  assert.equal(timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide3.xml': laughs }))).code, 'damaged');
  // An attribute repeated more often than an element may have attributes.
  const attrs = part('ppt/slides/slide3.xml').replace('<p:cSld>', `<p:cSld ${Array.from({ length: 300 }, (_x, i) => `a${i}="1"`).join(' ')}>`);
  assert.equal(timed(() => inspectDeck(syntheticDeck({ 'ppt/slides/slide3.xml': attrs }))).code, 'too_large');
});
