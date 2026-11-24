import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, changedSlideCount, invalidEdits, noEdits, normaliseEdits, type DeckEdits } from './apply';
import { inspectDeck, type DeckInspection } from './inspect';
import { isSafePartName, PptxError, PptxPackage, relativeTarget, resolveTarget, type PartSource } from './opc';
import { alignParagraphs, commonEnds, readTextBody, textBodySplices } from './text';
import { SYNTHETIC, syntheticDeck, syntheticDeckParts } from './testing';
import { applySplices, attr, cleanXmlText, decodeXml, descendants, escapeXmlText, kid, kids, parseXml, prefixFor, XmlError } from './xml';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

/* ---------------- the XML reader ---------------- */

test('xml: elements, attributes, namespaces and where they sit in the source', () => {
  const src = `<?xml version="1.0"?><!-- c --><r xmlns="urn:d" xmlns:x="urn:x" a="1"><x:k  b = 'two &amp; &#x41;' x:c="3"/><t>one &lt; two<![CDATA[<raw>]]></t></r>`;
  const doc = parseXml(src);
  assert.equal(doc.root.ns, 'urn:d');
  const k = kids(doc.root)[0]!;
  assert.deepEqual([k.name, k.ns, k.local, k.selfClosing], ['x:k', 'urn:x', 'k', true]);
  assert.equal(attr(k, 'b'), 'two & A');
  assert.equal(attr(k, 'c', 'urn:x'), '3');
  assert.equal(src.slice(k.start, k.end), `<x:k  b = 'two &amp; &#x41;' x:c="3"/>`);
  const b = k.attrs.find((a) => a.local === 'b')!;
  assert.equal(src.slice(b.valueStart, b.valueEnd), 'two &amp; &#x41;');
  const t = kids(doc.root)[1]!;
  assert.deepEqual(t.children.map((c) => (c.kind === 'text' ? c.value : '')), ['one < two', '<raw>']);
  assert.equal(src.slice(t.openEnd, t.closeStart), 'one &lt; two<![CDATA[<raw>]]>');
  assert.equal(prefixFor(t, 'urn:x'), 'x');
  assert.equal(prefixFor(t, 'urn:d'), '');
  assert.equal(prefixFor(t, 'urn:none'), null);
});

test('xml: what an uploaded file must not contain is refused, with limits on size, depth and nodes', () => {
  for (const bad of [
    '<!DOCTYPE r [<!ENTITY x "y">]><r>&x;</r>',
    '<!DOCTYPE r SYSTEM "http://evil.invalid/x.dtd"><r/>',
    '<r>&bogus;</r>',
    '<r>&#0;</r>',
    '<r a="1" a="2"/>',
    '<r><a></b></r>',
    '<r>',
    '<r/><r/>',
    '<r a=1/>',
    '<x:r/>',
    'text only',
    '',
  ])
    assert.throws(() => parseXml(bad), XmlError, bad);
  assert.throws(() => parseXml(`${'<a>'.repeat(300)}${'</a>'.repeat(300)}`), /nested too deeply/);
  assert.throws(() => parseXml(`<r>${'<a/>'.repeat(50)}</r>`, { nodes: 20 }), /too many elements/);
  assert.throws(() => parseXml(`<r>${'x'.repeat(100)}</r>`, { chars: 50 }), /too large/);
  // A billion-laughs file never gets as far as expanding anything: the DTD itself is refused.
  assert.throws(() => parseXml('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><lolz>&lol2;</lolz>'), /document type declaration/);
});

test('xml: text helpers escape, decode and clean what a person may type', () => {
  assert.equal(escapeXmlText('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
  assert.equal(decodeXml('&lt;&gt;&amp;&quot;&apos;&#65;&#x1F600;'), '<>&"\'A😀');
  assert.equal(cleanXmlText('ok\u0000\u0008\ttab\nline\uD800 lone 😀'), 'ok\ttab\nline lone 😀');
  assert.equal(applySplices('0123456789', [{ start: 8, end: 9, text: 'X' }, { start: 2, end: 4, text: '' }, { start: 2, end: 2, text: 'ab' }]), '01ab4567X9');
  assert.throws(() => applySplices('0123', [{ start: 0, end: 3, text: '' }, { start: 2, end: 3, text: '' }]), /Overlapping/);
});

/* ---------------- changing words ---------------- */

const body = (inner: string) => parseXml(`<p:txBody xmlns:a="${A}" xmlns:p="urn:p"><a:bodyPr/>${inner}</p:txBody>`);
function retyped(inner: string, next: string[]): string {
  const doc = body(inner);
  const out = applySplices(doc.source, textBodySplices(doc, doc.root, next));
  // Whatever comes out is well-formed and reads as the words that were asked for.
  assert.deepEqual(readTextBody(parseXml(out).root).map((p) => p.text), next.length ? next : ['']);
  return out.slice(out.indexOf('<a:bodyPr/>') + 11, out.lastIndexOf('</p:txBody>'));
}

test('text: an unchanged body is not touched at all', () => {
  const doc = body('<a:p><a:r><a:rPr b="1"/><a:t>Same</a:t></a:r></a:p>');
  assert.deepEqual(textBodySplices(doc, doc.root, ['Same']), []);
});

test('text: typing inside a run changes that run only and keeps its formatting', () => {
  const p = '<a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Plants need </a:t></a:r><a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="2F6360"/></a:solidFill></a:rPr><a:t>sunlight</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t> and water.</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>';
  // A word in the bold coloured run changes: the runs around it are the file's own bytes.
  assert.equal(
    retyped(p, ['Plants need sunshine and water.']),
    '<a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Plants need </a:t></a:r><a:r><a:rPr b="1"><a:solidFill><a:srgbClr val="2F6360"/></a:solidFill></a:rPr><a:t>sunshine</a:t></a:r><a:r><a:rPr lang="en-US"/><a:t> and water.</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>'
  );
  // Words added at the very end continue the last run.
  assert.match(retyped(p, ['Plants need sunlight and water. Also air.']), /<a:r><a:rPr lang="en-US"\/><a:t> and water\. Also air\.<\/a:t><\/a:r><a:endParaRPr/);
  // Words added at the very start take the first run's formatting.
  assert.match(retyped(p, ['All plants need sunlight and water.']), /^<a:p><a:pPr lvl="1"\/><a:r><a:rPr lang="en-US"\/><a:t>All plants need <\/a:t><\/a:r><a:r><a:rPr b="1">/);
});

test('text: a change that spans runs keeps the formatting on both sides of it', () => {
  const p = '<a:p><a:r><a:rPr i="1"/><a:t>one </a:t></a:r><a:r><a:rPr b="1"/><a:t>two</a:t></a:r><a:r><a:rPr u="sng"/><a:t> three</a:t></a:r></a:p>';
  assert.equal(retyped(p, ['one 2 three']), '<a:p><a:r><a:rPr i="1"/><a:t>one 2</a:t></a:r><a:r><a:rPr u="sng"/><a:t> three</a:t></a:r></a:p>');
  assert.equal(retyped(p, ['on—ee']), '<a:p><a:r><a:rPr i="1"/><a:t>on—</a:t></a:r><a:r><a:rPr u="sng"/><a:t>ee</a:t></a:r></a:p>');
});

test('text: line breaks, special characters, emptying and refilling a paragraph', () => {
  const two = '<a:p><a:r><a:rPr lang="en-US"/><a:t>Line one</a:t></a:r><a:br><a:rPr lang="en-US"/></a:br><a:r><a:rPr lang="en-US"/><a:t>line two</a:t></a:r></a:p>';
  assert.deepEqual(readTextBody(body(two).root).map((p) => p.text), ['Line one\nline two']);
  // A break the teacher did not touch is the file's own.
  assert.match(retyped(two, ['Line 1\nline two']), /<a:t>Line 1<\/a:t><\/a:r><a:br><a:rPr lang="en-US"\/><\/a:br><a:r><a:rPr lang="en-US"\/><a:t>line two/);
  // A new line break becomes a real break, not a character.
  assert.match(retyped(two, ['Line one\nline two\nline three']), /line two<\/a:t><\/a:r><a:br><a:rPr lang="en-US"\/><\/a:br><a:r><a:rPr lang="en-US"\/><a:t>line three<\/a:t>/);
  assert.match(retyped(two, ['Line one line two']), /^<a:p><a:r><a:rPr lang="en-US"\/><a:t>Line one line two<\/a:t><\/a:r><\/a:p>$/);
  assert.match(retyped('<a:p><a:r><a:t>x</a:t></a:r></a:p>', ['a < b & "c" ñ 😀']), /<a:t>a &lt; b &amp; "c" ñ 😀<\/a:t>/);
  // An empty placeholder takes its end-of-paragraph formatting; an emptied paragraph keeps its size.
  assert.equal(retyped('<a:p><a:endParaRPr lang="en-US" sz="2000"/></a:p>', ['New words']), '<a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>New words</a:t></a:r><a:endParaRPr lang="en-US" sz="2000"/></a:p>');
  assert.equal(retyped('<a:p/>', ['Typed']), '<a:p><a:r><a:t>Typed</a:t></a:r></a:p>');
  assert.equal(retyped('<a:p><a:r><a:rPr sz="3200" b="1"/><a:t>Gone</a:t></a:r></a:p>', ['']), '<a:p><a:endParaRPr sz="3200" b="1"/></a:p>');
});

test('text: adding, removing and editing paragraphs leaves the others exactly as they are', () => {
  const list = ['A', 'B', 'C'].map((t) => `<a:p><a:pPr marL="1"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2400"/><a:t>${t}</a:t></a:r></a:p>`).join('');
  const one = (t: string) => `<a:p><a:pPr marL="1"><a:buChar char="•"/></a:pPr><a:r><a:rPr sz="2400"/><a:t>${t}</a:t></a:r></a:p>`;
  assert.equal(retyped(list, ['A', 'X', 'B', 'C']), one('A') + one('X') + one('B') + one('C'));
  assert.equal(retyped(list, ['A', 'C']), one('A') + one('C'));
  assert.equal(retyped(list, ['A', 'B', 'C', 'D', 'E']), one('A') + one('B') + one('C') + one('D') + one('E'));
  assert.equal(retyped(list, ['Z', 'A', 'B', 'C']), one('Z') + one('A') + one('B') + one('C'));
  assert.equal(retyped(list, ['A', 'B2', 'new', 'C']), one('A') + one('B2') + one('new') + one('C'));
  assert.equal(retyped(list, []), `<a:p><a:pPr marL="1"><a:buChar char="•"/></a:pPr><a:endParaRPr sz="2400"/></a:p>`);
  assert.deepEqual(alignParagraphs(['A', 'B', 'C'], ['A', 'X', 'B', 'C']), [{ kind: 'keep', from: 0 }, { kind: 'add', like: 0, text: 'X' }, { kind: 'keep', from: 1 }, { kind: 'keep', from: 2 }]);
  assert.deepEqual(commonEnds('a😀b', 'a😁b'), { prefix: 1, suffix: 1 });
});

test('text: a paragraph with a field or unknown markup is read but never rewritten', () => {
  const doc = body('<a:p><a:r><a:t>Page </a:t></a:r><a:fld id="{X}" type="slidenum"><a:t>2</a:t></a:fld></a:p>');
  assert.equal(readTextBody(doc.root)[0]!.editable, false);
  assert.throws(() => textBodySplices(doc, doc.root, ['Page two']), /cannot be edited/);
});

/* ---------------- the package ---------------- */

test('opc: part names and relationship targets', () => {
  assert.equal(resolveTarget('ppt/slides/slide1.xml', '../media/a.png'), 'ppt/media/a.png');
  assert.equal(resolveTarget('ppt/slides/slide1.xml', '/ppt/x.xml'), 'ppt/x.xml');
  assert.equal(resolveTarget('a.xml', '../../etc/passwd'), null);
  assert.equal(relativeTarget('ppt/slides/slide9.xml', 'ppt/notesSlides/notesSlide4.xml'), '../notesSlides/notesSlide4.xml');
  assert.equal(relativeTarget('ppt/presentation.xml', 'ppt/slides/slide9.xml'), 'slides/slide9.xml');
  for (const bad of ['', '/abs.xml', '../up.xml', 'a/../b.xml', 'a\\b.xml', 'a//b.xml', 'dir/', 'C:evil.xml', 'a/./b', 'nul\u0000l'])
    assert.equal(isSafePartName(bad), false, bad);
  assert.equal(isSafePartName('ppt/media/Larawan 1 (ñ).png'), true);
});

const open = (extra: Record<string, string | Uint8Array | null> = {}) => new PptxPackage(syntheticDeck(extra));
const refusal = (source: PartSource): string => {
  try {
    inspectDeck(source);
  } catch (err) {
    return err instanceof PptxError ? err.code : `other:${String(err)}`;
  }
  return 'taken';
};

test('inspect: what the deck holds, what can be edited and what is only carried along', () => {
  const d = inspectDeck(syntheticDeck());
  assert.equal(d.kind, 'presentation');
  assert.deepEqual(d.size, { cx: 12192000, cy: 6858000 });
  assert.equal(d.title, 'Plants — Grade 4');
  assert.deepEqual(d.slides.map((s) => [s.id, s.number, s.title, s.hidden, s.layoutName]), [
    ['s256', 1, 'Parts of a plant', false, 'Title and Content'],
    ['s257', 2, 'Roots & shoots', false, 'Title and Content'],
    ['s258', 3, 'Back to roots', true, 'Title and Content'],
  ]);
  const [one, two, three] = d.slides;
  assert.deepEqual(one!.blocks.map((b) => [b.id, b.role, b.name, b.editable]), [
    ['b0', 'title', 'Title 1', true],
    ['b1', 'body', 'Content Placeholder 2', true],
    ['b2', 'text', 'TextBox 10', true],
  ]);
  assert.deepEqual(one!.blocks[1]!.paragraphs, SYNTHETIC.body1);
  assert.deepEqual(one!.blocks[2]!.paragraphs, ['Line one\nline two']);
  // Where things sit: the title from the master, the body from the layout, the text box through its group (halved).
  assert.deepEqual(one!.blocks[0]!.box, { x: 0.0688, y: 0.0532, w: 0.8625, h: 0.1933 });
  assert.deepEqual(one!.blocks[1]!.box, { x: 0.082, y: 0.2916, w: 0.5, h: 0.5 });
  assert.deepEqual(one!.blocks[2]!.box, { x: 0.5, y: 0.5, w: 0.125, h: 0.125 });
  assert.deepEqual(one!.notes, { exists: true, paragraphs: SYNTHETIC.notes1, editable: true });
  assert.deepEqual(one!.duplicateBlockers, []);
  // Slide 2: four table cells are text; the page-number box is shown but not edited; the chart stops a copy.
  assert.deepEqual(two!.blocks.map((b) => [b.role, b.paragraphs.join('|'), b.editable]), [
    ['title', 'Roots & shoots', true],
    ['cell', 'Part', true],
    ['cell', 'Job', true],
    ['cell', 'Root', true],
    ['cell', 'Takes in water', true],
    ['text', 'Page 2', false],
  ]);
  assert.equal(two!.blocks[4]!.name, 'Table 3 R2C2');
  assert.deepEqual(two!.blocks[4]!.box, { x: 0.2461, y: 0.35, w: 0.164, h: 0.0583 });
  assert.deepEqual(two!.objects.map((o) => o.kind), ['table', 'chart']);
  assert.deepEqual(two!.duplicateBlockers, ['chart']);
  assert.deepEqual([two!.animations, two!.transition], [true, true]);
  // A slide without a notes page can still get notes, because the deck has a notes master.
  assert.deepEqual(three!.notes, { exists: false, paragraphs: [], editable: true });
  assert.deepEqual(Object.fromEntries(d.features.map((f) => [f.feature, [f.count, f.slides]])), {
    animation: [1, [2]],
    chart: [1, [2]],
    customShow: [1, [0]],
    externalLink: [1, [2]],
    hiddenSlide: [1, [3]],
    readOnlyText: [1, [2]],
    sections: [2, [0]],
    transition: [1, [2]],
  });
  assert.deepEqual(d.totals, { slides: 3, textBlocks: 10, editableBlocks: 9, slidesWithEditableText: 3, parts: 22 });
  // Plain data: it survives being stored and read back.
  assert.deepEqual(JSON.parse(JSON.stringify(d)), d);
});

test('inspect: files that must not be taken are refused with a reason, never read on trust', () => {
  const ct = syntheticDeckParts()['[Content_Types].xml'] as string;
  const pres = syntheticDeckParts()['ppt/presentation.xml'] as string;
  const cases: Array<[string, Record<string, string | Uint8Array | null>]> = [
    ['macros', { '[Content_Types].xml': ct.replace('presentationml.presentation.main+xml', 'x').replace('application/vnd.openxmlformats-officedocument.x', 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml') }],
    ['macros', { 'ppt/vbaProject.bin': new Uint8Array([1, 2, 3]) }],
    ['active_content', { 'ppt/activeX/activeX1.xml': '<x/>' }],
    ['signed', { '_xmlsignatures/sig1.xml': '<x/>' }],
    ['strict_ooxml', { 'ppt/presentation.xml': pres.replace('xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"', 'xmlns:p="http://purl.oclc.org/ooxml/presentationml/main"') }],
    ['wrong_office_file', { '[Content_Types].xml': ct.replace('presentationml.presentation.main+xml', 'wordprocessingml.document.main+xml') }],
    ['not_a_presentation', { '[Content_Types].xml': null }],
    ['not_a_presentation', { '_rels/.rels': null }],
    ['damaged', { 'ppt/slides/slide2.xml': null }],
    ['damaged', { 'ppt/slides/slide1.xml': '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><p:sld/>' }],
    ['damaged', { 'ppt/slides/slide1.xml': '<not-closed>' }],
    ['damaged', { 'ppt/presentation.xml': pres.replace('<p:sldId id="257" r:id="rId3"/>', '<p:sldId id="257" r:id="rId2"/>') }],
    ['no_slides', { 'ppt/presentation.xml': pres.replace(/<p:sldIdLst>.*<\/p:sldIdLst>/, '<p:sldIdLst/>') }],
    ['unreadable_text', { 'ppt/slides/slide1.xml': new Uint8Array([0xff, 0xfe, 0x3c, 0x00]) }],
    ['unsafe_part_name', { '../outside.xml': '<x/>' }],
    ['unsafe_part_name', { 'PPT/Presentation.XML': '<x/>' }],
  ];
  for (const [code, extra] of cases) assert.equal(refusal(syntheticDeck(extra)), code, JSON.stringify(Object.keys(extra)));
  assert.equal(refusal({ names: Array.from({ length: 4001 }, (_, i) => `p${i}.xml`), read: () => new Uint8Array() }), 'too_many_parts');
  // A template and a show are taken, and say what they are.
  const as = (type: string) => inspectDeck(syntheticDeck({ '[Content_Types].xml': ct.replace('presentationml.presentation.main+xml', `presentationml.${type}.main+xml`) })).kind;
  assert.deepEqual([as('template'), as('slideshow')], ['template', 'slideshow']);
});

/* ---------------- writing changes back ---------------- */

function apply(edits: DeckEdits, extra: Record<string, string | Uint8Array | null> = {}) {
  const pkg = open(extra);
  const before = new Map(pkg.names().map((n) => [n, pkg.bytes(n)]));
  const report = applyEdits(pkg, edits);
  const after = pkg.entries();
  const changed = after.filter((e) => e.changed).map((e) => e.name);
  // The promise the whole feature rests on: a part that is not reported changed is the uploaded bytes themselves.
  for (const e of after) if (!e.changed) assert.deepEqual(e.data, before.get(e.name), `${e.name} was rewritten`);
  const again = inspectDeck({ names: after.map((e) => e.name), read: (name) => after.find((e) => e.name === name)!.data });
  return { pkg, report, changed, again, text: (name: string) => utf8(pkg.bytes(name)), names: after.map((e) => e.name) };
}
const base = (): DeckInspection => inspectDeck(syntheticDeck());
const identity = () => noEdits(base()).slides;

test('apply: with no edits nothing at all is rewritten', () => {
  const { changed, report, again, names } = apply({ slides: identity() });
  assert.deepEqual(changed, []);
  assert.deepEqual(report.partsChanged, []);
  assert.deepEqual(names, Object.keys(syntheticDeckParts()));
  assert.deepEqual(again, base());
});

test('apply: changed words touch one slide part, and only inside the paragraphs that changed', () => {
  const wanted = ['Plants need sunshine and water.', 'Second point', 'A third point: ñ & <b>', ''];
  const { changed, again, text } = apply({ slides: identity().map((s) => (s.id === 's256' ? { ...s, text: { b1: wanted, b0: ['Mga bahagi ng halaman'] } } : s)) });
  assert.deepEqual(changed, ['ppt/slides/slide1.xml']);
  assert.deepEqual(again.slides[0]!.blocks.map((b) => b.paragraphs), [['Mga bahagi ng halaman'], wanted, ['Line one\nline two']]);
  const xml = text('ppt/slides/slide1.xml');
  // The bold teal run kept its formatting around the changed word; the bullet properties are untouched.
  assert.ok(xml.includes('<a:r><a:rPr lang="en-US" b="1" dirty="0"><a:solidFill><a:srgbClr val="2F6360"/></a:solidFill></a:rPr><a:t>sunshine</a:t></a:r>'));
  assert.ok(xml.includes('<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" i="1"/><a:t>A third point: ñ &amp; &lt;b&gt;</a:t></a:r></a:p>'));
  // Everything else in the slide is the uploaded text: the group, the text box, the creation id.
  const original = syntheticDeckParts()['ppt/slides/slide1.xml'] as string;
  assert.equal(xml.slice(xml.indexOf('<p:grpSp>')), original.slice(original.indexOf('<p:grpSp>')));
  assert.deepEqual(again.slides.slice(1), base().slides.slice(1));
});

test('apply: table cells and text inside a group are edited like any other text', () => {
  const { changed, again } = apply({
    slides: identity().map((s) => (s.id === 's257' ? { ...s, text: { b4: ['Sumisipsip ng tubig'] } } : s.id === 's256' ? { ...s, text: { b2: ['Isang linya'] } } : s)),
  });
  assert.deepEqual(changed.sort(), ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
  assert.deepEqual(again.slides[1]!.blocks[4]!.paragraphs, ['Sumisipsip ng tubig']);
  assert.deepEqual(again.slides[0]!.blocks[2]!.paragraphs, ['Isang linya']);
  assert.deepEqual(again.slides[1]!.objects.map((o) => o.kind), ['table', 'chart']);
});

test('apply: notes are changed where a notes page exists and written where there was none', () => {
  const changedNotes = apply({ slides: identity().map((s) => (s.id === 's256' ? { ...s, notes: ['Bagong paalala.', 'Ikalawa.'] } : s)) });
  assert.deepEqual(changedNotes.changed, ['ppt/notesSlides/notesSlide1.xml']);
  assert.deepEqual(changedNotes.again.slides[0]!.notes.paragraphs, ['Bagong paalala.', 'Ikalawa.']);

  const added = apply({ slides: identity().map((s) => (s.id === 's258' ? { ...s, notes: ['Notes for the hidden slide'] } : s)) });
  assert.deepEqual(added.again.slides[2]!.notes, { exists: true, paragraphs: ['Notes for the hidden slide'], editable: true });
  assert.deepEqual(added.changed.sort(), ['[Content_Types].xml', 'ppt/notesSlides/_rels/notesSlide2.xml.rels', 'ppt/notesSlides/notesSlide2.xml', 'ppt/slides/_rels/slide3.xml.rels']);
  assert.ok(added.text('[Content_Types].xml').includes('<Override PartName="/ppt/notesSlides/notesSlide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>'));
  assert.ok(added.text('ppt/notesSlides/_rels/notesSlide2.xml.rels').includes('Target="../slides/slide3.xml"'));
  // The slide itself is untouched: notes hang on it by a relationship.
  assert.ok(!added.changed.includes('ppt/slides/slide3.xml'));
});

test('apply: a new order rewrites only the slide list', () => {
  const { changed, again, text } = apply({ slides: [...identity()].reverse() });
  assert.deepEqual(changed, ['ppt/presentation.xml']);
  assert.deepEqual(again.slides.map((s) => s.id), ['s258', 's257', 's256']);
  assert.ok(text('ppt/presentation.xml').includes('<p:sldIdLst><p:sldId id="258" r:id="rId4"/><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst>'));
});

test('apply: a copy is a slide of its own (own words, own notes page, own id) sharing layout and pictures', () => {
  const slides: DeckEdits['slides'] = [identity()[0]!, { id: 'ccopy0001', source: 's256', text: { b0: ['Copy with its own title'] } }, ...identity().slice(1)];
  const { again, names, text, changed } = apply({ slides });
  assert.deepEqual(again.slides.map((s) => s.title), ['Parts of a plant', 'Copy with its own title', 'Roots & shoots', 'Back to roots']);
  const copy = again.slides[1]!;
  assert.deepEqual(copy.blocks.slice(1).map((b) => b.paragraphs), base().slides[0]!.blocks.slice(1).map((b) => b.paragraphs));
  assert.deepEqual(copy.notes, base().slides[0]!.notes);
  assert.equal(copy.id, 's259');
  for (const part of ['ppt/slides/slide4.xml', 'ppt/slides/_rels/slide4.xml.rels', 'ppt/notesSlides/notesSlide2.xml', 'ppt/notesSlides/_rels/notesSlide2.xml.rels']) assert.ok(names.includes(part), part);
  assert.ok(text('ppt/slides/_rels/slide4.xml.rels').includes('Target="../notesSlides/notesSlide2.xml"'));
  assert.ok(text('ppt/slides/_rels/slide4.xml.rels').includes('Target="../media/image1.png"'));
  assert.ok(text('ppt/notesSlides/_rels/notesSlide2.xml.rels').includes('Target="../slides/slide4.xml"'));
  // The original keeps its part and its words; the copy has a different creation id; the copy joins its section.
  assert.ok(!changed.includes('ppt/slides/slide1.xml'));
  assert.ok(!text('ppt/slides/slide4.xml').includes('val="1234567890"'));
  assert.ok(text('ppt/presentation.xml').includes('<p14:sldId id="256"/><p14:sldId id="259"/>'));
  assert.ok(text('ppt/presentation.xml').includes('<p:sldId id="256" r:id="rId2"/><p:sldId id="259" r:id="rId7"/><p:sldId id="257" r:id="rId3"/>'));
  // A slide with a chart is not copied in this version: said plainly, before and at apply time.
  assert.equal(invalidEdits(base(), { slides: [...identity(), { id: 'ccopy0002', source: 's257' }] }), 'slide_cannot_be_copied');
  assert.throws(() => applyEdits(open(), { slides: [...identity(), { id: 'ccopy0002', source: 's257' }] }), /cannot be copied/);
});

test('apply: a removed slide takes its own parts with it and leaves nothing dangling', () => {
  // Slide 2 goes: its chart goes with it, slide 3's link to it is taken off (its words stay), sections and the custom show forget it.
  const { again, names, text, report } = apply({ slides: identity().filter((s) => s.id !== 's257') });
  assert.deepEqual(again.slides.map((s) => s.id), ['s256', 's258']);
  for (const gone of ['ppt/slides/slide2.xml', 'ppt/slides/_rels/slide2.xml.rels', 'ppt/charts/chart1.xml']) assert.ok(!names.includes(gone), gone);
  assert.ok(!text('[Content_Types].xml').includes('slide2.xml'));
  assert.ok(!text('[Content_Types].xml').includes('chart1.xml'));
  assert.ok(!text('ppt/_rels/presentation.xml.rels').includes('slides/slide2.xml'));
  assert.ok(!text('ppt/presentation.xml').includes('id="257"'));
  assert.ok(!text('ppt/slides/slide3.xml').includes('hlinkClick'));
  assert.ok(text('ppt/slides/slide3.xml').includes('<a:t>Back to roots</a:t>'));
  assert.ok(!text('ppt/slides/_rels/slide3.xml.rels').includes('slide2.xml'));
  assert.deepEqual(report.linksRemoved, ['s258']);
  // Slide 1 goes: its notes page goes, and the custom show that named it lists only what is left.
  const first = apply({ slides: identity().filter((s) => s.id !== 's256') });
  for (const gone of ['ppt/slides/slide1.xml', 'ppt/notesSlides/notesSlide1.xml', 'ppt/notesSlides/_rels/notesSlide1.xml.rels', 'ppt/media/image1.png']) assert.ok(!first.names.includes(gone), gone);
  assert.ok(first.text('ppt/presentation.xml').includes('<p:sldLst><p:sld r:id="rId4"/></p:sldLst>'));
  assert.ok(first.text('ppt/presentation.xml').includes('<p14:section name="Start" id="{11111111-1111-1111-1111-111111111111}"><p14:sldIdLst></p14:sldIdLst></p14:section>'));
  assert.ok(first.names.includes('ppt/theme/theme1.xml'));
});

test('apply: a template or a show comes out as an ordinary presentation; the same edits always give the same file', () => {
  const ct = syntheticDeckParts()['[Content_Types].xml'] as string;
  const template = { '[Content_Types].xml': ct.replace('presentationml.presentation.main+xml', 'presentationml.template.main+xml') };
  const { changed, again } = apply({ slides: identity() }, template);
  assert.deepEqual(changed, ['[Content_Types].xml']);
  assert.equal(again.kind, 'presentation');
  const edits: DeckEdits = { slides: [{ id: 'ccopy0009', source: 's256', notes: ['n'] }, ...[...identity()].reverse().filter((s) => s.id !== 's257')] };
  const a = apply(edits);
  const b = apply(edits);
  assert.deepEqual(a.names, b.names);
  for (const name of a.names) assert.deepEqual(a.pkg.bytes(name), b.pkg.bytes(name), name);
  // Every part that is written is well-formed XML with every relationship pointing at a part that exists.
  for (const name of a.names) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const doc = parseXml(utf8(a.pkg.bytes(name)));
    if (name.endsWith('.rels'))
      for (const r of kids(doc.root)) if (attr(r, 'TargetMode') !== 'External') assert.ok(a.names.includes(resolveTarget(name.replace(/_rels\/([^/]*)\.rels$/, '$1'), attr(r, 'Target')!)!), `${name} → ${attr(r, 'Target')}`);
  }
  assert.equal([...descendants(parseXml(a.text('ppt/presentation.xml')).root)].filter((d) => d.local === 'sldId' && d.parent?.local === 'sldIdLst' && d.ns.includes('presentationml')).length, 3);
  assert.ok(kid(parseXml(a.text('ppt/presentation.xml')).root, 'http://schemas.openxmlformats.org/presentationml/2006/main', 'sldIdLst'));
});

test('edits: what is stored is only what differs; bad edits are named before anything is written', () => {
  const b = base();
  const noisy: DeckEdits = { slides: identity().map((s) => (s.id === 's256' ? { ...s, text: { b0: [SYNTHETIC.title1], b1: ['Changed', ''] }, notes: [...SYNTHETIC.notes1] } : s)) };
  const clean = normaliseEdits(b, noisy);
  assert.deepEqual(clean.slides[0], { id: 's256', source: 's256', text: { b1: ['Changed', ''] } });
  assert.equal(changedSlideCount(clean), 1);
  assert.equal(changedSlideCount({ slides: [...identity()].reverse() }), 0);
  assert.equal(changedSlideCount({ slides: [...identity(), { id: 'cabcd1234', source: 's256' }] }), 1);
  assert.equal(invalidEdits(b, { slides: identity() }), null);
  const bad: Array<[string, DeckEdits['slides']]> = [
    ['no_slides', []],
    ['unknown_slide', [{ id: 's999', source: 's999' }]],
    ['duplicate_slide_id', [identity()[0]!, identity()[0]!]],
    ['bad_slide_id', [{ id: 's257', source: 's256' }]],
    ['bad_slide_id', [{ id: 'x1', source: 's256' }]],
    ['unknown_block', [{ id: 's256', source: 's256', text: { b9: ['x'] } }]],
    ['block_not_editable', [{ id: 's257', source: 's257', text: { b5: ['Page 9'] } }]],
    ['text_too_long', [{ id: 's256', source: 's256', text: { b0: ['x'.repeat(8001)] } }]],
  ];
  for (const [code, slides] of bad) assert.equal(invalidEdits(b, { slides }), code, code);
  assert.throws(() => applyEdits(open(), { slides: [{ id: 's257', source: 's257', text: { b5: ['Page 9'] } }] }), PptxError);
});
