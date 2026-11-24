/**
 * Files made to hurt whoever reads them, and edits made to hurt whoever writes them out. For tests only.
 *
 * Each one either stopped the site or took time or memory without end before 24 Nov 2026, or is the kind of file
 * that would have. The first two rebuild the files the release owner stopped a rehearsal server with: a table cell
 * that says it spans four thousand million columns (the web server's one thread did nothing else for half a
 * minute), and seven slides of 1,400,000 empty elements each (the process ran out of memory and was killed).
 *
 * The same list is run three ways, so that nobody has to take a claim on trust:
 *   - uploads-hostile.test.ts: through the worker and the routes of a test server, with this thread watched;
 *   - packages/tala-web/scripts/uploads-hostile-http.mjs: through the HTTP API of a running site, with its health
 *     route asked all the while;
 *   - `tsx scripts/decks/hostile-files.ts <folder>` writes them out as files, to try by hand.
 * The reader's own limits are tested without a server in tala-core (src/pptx/pptx-hostile.test.ts).
 */
import { randomBytes } from 'node:crypto';
import { syntheticDeckParts } from '@hiraia/tala-core/pptx/testing';
import type { UploadedDeck, UploadSlideEdit } from '@hiraia/tala-core/contracts';
import type { UploadRefusal } from './upload-file';
import { crc32, writeZip } from './zip';

export interface HostileFile {
  /** A short name; with `.pptx` it is the name the file is uploaded under. */
  name: string;
  /** What the file does, in a sentence. */
  about: string;
  /** What reading it must come to: a deck like any other, or a refusal for this reason. Never anything else. */
  expect: 'accepted' | UploadRefusal;
  /** Built when asked for: some are tens of megabytes before they are packed. */
  build(): Uint8Array;
  /** For a file that is accepted: a change to save, and whether the edited file can then be written out. */
  then?: { about: string; edits(deck: Pick<UploadedDeck, 'base'>): UploadSlideEdit[]; download: 'written' | 'refused'; contains?: string };
}

type Parts = Record<string, string | Uint8Array | null>;
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const part = (name: string): string => syntheticDeckParts()[name] as string;
const zipped = (extra: Parts = {}): Uint8Array => writeZip(Object.entries(syntheticDeckParts(extra)).map(([name, data]) => ({ name, data })));
const identity = (deck: Pick<UploadedDeck, 'base'>): UploadSlideEdit[] => deck.base.slides.map((s) => ({ id: s.id, source: s.id }));

/** A slide with a title and nothing else; `inside` goes into the slide's own extension list. */
const plainSlide = (title: string, inside = '', before = ''): string =>
  `${HEAD}<p:sld ${NS}>${before}<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>` +
  `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${inside ? `<p:extLst><p:ext uri="{00000000-0000-0000-0000-000000000000}">${inside}</p:ext></p:extLst>` : ''}</p:sld>`;

/** The invented deck with exactly these slides in place of its own three. */
function deckOf(slides: string[], more: Parts = {}, slideName = (i: number) => `slide${i + 1}.xml`): Uint8Array {
  const base = syntheticDeckParts();
  const types = (base['[Content_Types].xml'] as string)
    .replace(/<Override PartName="\/ppt\/(slides|notesSlides|charts)\/[^>]*\/>/g, '')
    .replace('</Types>', `${slides.map((_s, i) => `<Override PartName="/ppt/slides/${slideName(i)}" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`);
  const presentation = (base['ppt/presentation.xml'] as string)
    .replace(/<p:sldIdLst>[^]*?<\/p:sldIdLst>/, `<p:sldIdLst>${slides.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rId${100 + i}"/>`).join('')}</p:sldIdLst>`)
    .replace(/<p:custShowLst>[^]*?<\/p:custShowLst>/, '')
    .replace(/<p:extLst>[^]*?<\/p:extLst>/, '');
  const presentationRels = (base['ppt/_rels/presentation.xml.rels'] as string)
    .replace(/<Relationship Id="rId[234]"[^>]*\/>/g, '')
    .replace('</Relationships>', `${slides.map((_s, i) => `<Relationship Id="rId${100 + i}" Type="${OD}/slide" Target="slides/${slideName(i)}"/>`).join('')}</Relationships>`);
  const parts: Parts = {
    'ppt/slides/slide1.xml': null,
    'ppt/slides/slide2.xml': null,
    'ppt/slides/slide3.xml': null,
    'ppt/slides/_rels/slide1.xml.rels': null,
    'ppt/slides/_rels/slide2.xml.rels': null,
    'ppt/slides/_rels/slide3.xml.rels': null,
    'ppt/notesSlides/notesSlide1.xml': null,
    'ppt/notesSlides/_rels/notesSlide1.xml.rels': null,
    'ppt/charts/chart1.xml': null,
    'ppt/media/image1.png': null,
    '[Content_Types].xml': types,
    'ppt/presentation.xml': presentation,
    'ppt/_rels/presentation.xml.rels': presentationRels,
  };
  slides.forEach((xml, i) => {
    parts[`ppt/slides/${slideName(i)}`] = xml;
    parts[`ppt/slides/_rels/${slideName(i)}.rels`] = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${OD}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`;
  });
  return zipped({ ...parts, ...more });
}

/* ---------------- a ZIP put together by hand, to say things an honest writer would not ---------------- */

interface HandEntry {
  /** The name in the directory. */
  name: string;
  data: Uint8Array;
  /** The name in the entry's own header, when it is to differ. */
  headerName?: string;
}
const bytesOf = (v: string | Uint8Array): Uint8Array => (typeof v === 'string' ? new Uint8Array(Buffer.from(v, 'utf8')) : v);
function localHeader(name: string, data: { crc: number; size: number }, extra = 0): Buffer {
  const n = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(30 + n.length + extra);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt32LE(data.crc, 14);
  h.writeUInt32LE(data.size, 18);
  h.writeUInt32LE(data.size, 22);
  h.writeUInt16LE(n.length, 26);
  h.writeUInt16LE(extra, 28);
  n.copy(h, 30);
  return h;
}
function directoryEntry(name: string, data: { crc: number; size: number }, offset: number): Buffer {
  const n = Buffer.from(name, 'utf8');
  const d = Buffer.alloc(46 + n.length);
  d.writeUInt32LE(0x02014b50, 0);
  d.writeUInt16LE(20, 4);
  d.writeUInt16LE(20, 6);
  d.writeUInt32LE(data.crc, 16);
  d.writeUInt32LE(data.size, 20);
  d.writeUInt32LE(data.size, 24);
  d.writeUInt16LE(n.length, 28);
  d.writeUInt32LE(offset, 42);
  n.copy(d, 46);
  return d;
}
function endOfZip(count: number, directoryBytes: number, directoryAt: number): Buffer {
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(count, 8);
  e.writeUInt16LE(count, 10);
  e.writeUInt32LE(directoryBytes, 12);
  e.writeUInt32LE(directoryAt, 16);
  return e;
}
/**
 * Every entry stored as it is. `shared`: that many extra names, all pointing at ONE run of bytes (their headers
 * are stacked in front of it, each skipping the ones after it as its "extra field").
 */
function handZip(entries: HandEntry[], shared?: { names: string[]; data: Uint8Array }): Uint8Array {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const info = { crc: crc32(e.data), size: e.data.length };
    const header = localHeader(e.headerName ?? e.name, info);
    directory.push(directoryEntry(e.name, info, offset));
    chunks.push(header, Buffer.from(e.data));
    offset += header.length + e.data.length;
  }
  if (shared) {
    const info = { crc: crc32(shared.data), size: shared.data.length };
    const plain = shared.names.map((name) => 30 + Buffer.byteLength(name, 'utf8'));
    shared.names.forEach((name, i) => {
      const after = plain.slice(i + 1).reduce((sum, n) => sum + n, 0);
      directory.push(directoryEntry(name, info, offset));
      const header = localHeader(name, info, after);
      // The "extra field" is the headers that follow: only this header's own bytes are written here.
      const own = header.subarray(0, 30 + Buffer.byteLength(name, 'utf8'));
      chunks.push(Buffer.from(own));
      offset += own.length;
    });
    chunks.push(Buffer.from(shared.data));
    offset += shared.data.length;
  }
  const dir = Buffer.concat(directory);
  const out = Buffer.concat([...chunks, dir, endOfZip(directory.length, dir.length, offset)]);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
const handEntries = (extra: Parts = {}): HandEntry[] => Object.entries(syntheticDeckParts(extra)).map(([name, data]) => ({ name, data: bytesOf(data) }));

/* ---------------- the files ---------------- */

const empties = (n: number): string => '<p:e/>'.repeat(n);
const tableSpanning = (span: string): Uint8Array => zipped({ 'ppt/slides/slide2.xml': part('ppt/slides/slide2.xml').replace('<a:tc>', `<a:tc gridSpan="${span}" rowSpan="${span}">`) });
const heavySlides = (count: number, elements: number): Uint8Array => deckOf(Array.from({ length: count }, (_x, i) => plainSlide(`Slide ${i + 1}`, empties(elements))));

export const HOSTILE_FILES: HostileFile[] = [
  {
    name: 'cell-spanning-4000000000-columns',
    about: 'a table cell that says it spans 4,000,000,000 columns and rows (the 63 KB file of 24 Nov, rebuilt)',
    expect: 'accepted',
    build: () => tableSpanning('4000000000'),
    then: { about: 'a word changed in that table', edits: (deck) => identity(deck).map((s, i) => (i === 1 ? { ...s, text: { [deck.base.slides[1]!.blocks.find((b) => b.role === 'cell')!.id]: ['Organ'] } } : s)), download: 'written', contains: 'Organ' },
  },
  { name: 'cell-spanning-999999999999-columns', about: 'the same with the largest number twelve digits can say', expect: 'accepted', build: () => tableSpanning('999999999999') },
  {
    name: 'seven-slides-of-1400000-elements',
    about: 'seven slides, each with 1,400,000 empty elements in an extension list, and half a megabyte of noise to look ordinary (the 542 KB file of 24 Nov, rebuilt)',
    expect: 'too_large',
    build: () => deckOf(Array.from({ length: 7 }, (_x, i) => plainSlide(`Slide ${i + 1}`, empties(1_400_000))), { 'ppt/media/noise.png': new Uint8Array(randomBytes(500_000)) }),
  },
  {
    name: 'nine-slides-each-within-the-limits',
    about: 'nine slides of 240,000 elements: no part is over any limit for a part, the file as a whole is more than one job may read',
    expect: 'too_large',
    build: () => heavySlides(9, 240_000),
  },
  {
    name: 'eight-slides-each-within-the-limits',
    about: 'eight such slides: the heaviest file that is still read (1.9 million elements)',
    expect: 'accepted',
    build: () => heavySlides(8, 240_000),
    then: { about: 'a new title on every one of them', edits: (deck) => identity(deck).map((s, i) => ({ ...s, text: { [deck.base.slides[i]!.blocks[0]!.id]: [`New title ${i + 1}`] } })), download: 'written', contains: 'New title 8' },
  },
  {
    name: 'ten-slides-of-seven-megabytes',
    about: 'ten slides that are each seven megabytes of one comment: few elements, but 70 MB of text in all',
    expect: 'too_large',
    build: () => deckOf(Array.from({ length: 10 }, (_x, i) => plainSlide(`Slide ${i + 1}`, '', `<!--${'x'.repeat(7 * 1024 * 1024)}-->`))),
  },
  {
    name: 'slide-under-another-name',
    about: 'a slide of nine megabytes stored under a name that does not end in .xml (the size limit for text parts used to go by the name)',
    expect: 'too_large',
    build: () => deckOf([plainSlide('Slide 1', '', `<!--${'x'.repeat(9 * 1024 * 1024)}-->`)], {}, () => 'slide1.bin'),
  },
  {
    name: 'spaces-inside-a-tag',
    about: 'a title paragraph written as one tag with 400,000 spaces in it',
    expect: 'accepted',
    build: () => zipped({ 'ppt/slides/slide1.xml': part('ppt/slides/slide1.xml').replace(/<a:p><a:r><a:rPr lang="en-US" dirty="0"\/><a:t>Parts of a plant<\/a:t><\/a:r><\/a:p>/, `<a:p${' '.repeat(400_000)}x="1"/>`) }),
    then: { about: 'that title typed in', edits: (deck) => identity(deck).map((s, i) => (i === 0 ? { ...s, text: { [deck.base.slides[0]!.blocks[0]!.id]: ['A new title'] } } : s)), download: 'written', contains: 'A new title' },
  },
  {
    name: 'twelve-thousand-placeholders',
    about: '12,000 placeholders on a slide and 12,000 on its layout, each to be matched with one of the others',
    expect: 'too_large',
    build: () => {
      const shape = (i: number, body: boolean) =>
        `<p:sp><p:nvSpPr><p:cNvPr id="${i + 10}" name="P"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="${i + 10}"/></p:nvPr></p:nvSpPr><p:spPr/>${body ? '<p:txBody><a:bodyPr/><a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody>' : ''}</p:sp>`;
      const many = (body: boolean) => Array.from({ length: 12_000 }, (_x, i) => shape(i, body)).join('');
      return zipped({
        'ppt/slides/slide3.xml': part('ppt/slides/slide3.xml').replace('</p:spTree>', `${many(true)}</p:spTree>`),
        'ppt/slideLayouts/slideLayout1.xml': part('ppt/slideLayouts/slideLayout1.xml').replace('</p:spTree>', `${many(false)}</p:spTree>`),
      });
    },
  },
  {
    name: 'one-megabyte-type-for-four-thousand-parts',
    about: '3,900 parts that all share one "content type" a megabyte long (reading it took 7.6 s, and as long again for every download)',
    expect: 'damaged',
    build: () => {
      const extra: Parts = {};
      for (let i = 0; i < 3900; i++) extra[`customXml/item${i}.zzz`] = 'x';
      extra['[Content_Types].xml'] = part('[Content_Types].xml').replace('<Default Extension="xml"', `<Default Extension="zzz" ContentType="application/x-${'a'.repeat(1_000_000)}"/><Default Extension="xml"`);
      return zipped(extra);
    },
  },
  {
    name: 'sixty-thousand-slides-listed',
    about: 'a slide list of 60,000 entries, none of which is there',
    expect: 'damaged',
    build: () => zipped({ 'ppt/presentation.xml': part('ppt/presentation.xml').replace('</p:sldIdLst>', `${Array.from({ length: 60_000 }, (_x, i) => `<p:sldId id="${300 + i}" r:id="rId${100 + i}"/>`).join('')}</p:sldIdLst>`) }),
  },
  {
    name: 'twenty-thousand-relationships',
    about: 'a relationships part of 20,000 entries',
    expect: 'too_large',
    build: () =>
      zipped({
        'ppt/_rels/presentation.xml.rels': part('ppt/_rels/presentation.xml.rels').replace('</Relationships>', `${Array.from({ length: 20_000 }, (_x, i) => `<Relationship Id="rId${100 + i}" Type="${OD}/slide" Target="slides/slide1.xml"/>`).join('')}</Relationships>`),
      }),
  },
  {
    name: 'text-of-two-and-a-half-million-characters',
    about: '500 text boxes of 5,000 characters on one slide: each within the limits for a text box, together more than a deck is read into',
    expect: 'too_large',
    build: () => {
      const box = (i: number) => `<p:sp><p:nvSpPr><p:cNvPr id="${i + 20}" name="T"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>${'w'.repeat(5000)}</a:t></a:r></a:p></p:txBody></p:sp>`;
      return zipped({ 'ppt/slides/slide3.xml': part('ppt/slides/slide3.xml').replace('</p:spTree>', `${Array.from({ length: 500 }, (_x, i) => box(i)).join('')}</p:spTree>`) });
    },
  },
  {
    name: 'five-thousand-levels-deep',
    about: 'groups nested 5,000 deep',
    expect: 'too_large',
    build: () => zipped({ 'ppt/slides/slide3.xml': part('ppt/slides/slide3.xml').replace('</p:spTree>', `${'<p:grpSp>'.repeat(5000)}${'</p:grpSp>'.repeat(5000)}</p:spTree>`) }),
  },
  {
    name: 'entities-that-multiply',
    about: 'a document type with entities that expand into each other',
    expect: 'damaged',
    build: () => zipped({ 'ppt/slides/slide3.xml': `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>${part('ppt/slides/slide3.xml').replace(/^<\?xml[^>]*\?>\n/, '')}` }),
  },
  {
    name: 'one-name-twice',
    about: 'a ZIP that holds two different slides under one name (one program would read the first, another the second)',
    expect: 'unsafe_part_name',
    build: () => handZip([...handEntries(), { name: 'ppt/slides/slide1.xml', data: bytesOf(part('ppt/slides/slide3.xml')) }]),
  },
  {
    name: 'a-header-that-names-another-part',
    about: 'a ZIP whose directory calls an entry slide 1 while the entry itself says it is something else',
    expect: 'unsafe_part_name',
    build: () => handZip(handEntries().map((e) => (e.name === 'ppt/slides/slide1.xml' ? { ...e, headerName: 'ppt/slides/slide9.xml' } : e))),
  },
  {
    name: 'sixty-names-for-one-megabyte',
    about: 'a ZIP in which sixty names all point at the same megabyte, so that a file of one megabyte would be written out as sixty',
    expect: 'unsafe_part_name',
    build: () => handZip(handEntries(), { names: Array.from({ length: 60 }, (_x, i) => `ppt/media/shared${i}.png`), data: new Uint8Array(randomBytes(1024 * 1024)) }),
  },
  {
    name: 'a-directory-that-claims-two-gigabytes',
    about: 'a ZIP whose directory says one part unpacks to two gigabytes',
    expect: 'zip_bomb',
    build: () => {
      const file = zipped();
      const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength);
      // The first directory entry's "size when unpacked".
      buf.writeUInt32LE(0x7fffffff, buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
      return file;
    },
  },
  {
    name: 'forty-copies-of-a-large-slide',
    about: 'a deck with one slide of a megabyte',
    expect: 'accepted',
    build: () => zipped({ 'ppt/slides/slide3.xml': part('ppt/slides/slide3.xml').replace('<p:cSld>', `<!--${'x'.repeat(1024 * 1024)}--><p:cSld>`) }),
    then: {
      about: 'that slide copied forty times',
      edits: (deck) => [...identity(deck), ...Array.from({ length: 40 }, (_x, i) => ({ id: `ccopy${String(i).padStart(4, '0')}`, source: deck.base.slides[2]!.id }))],
      download: 'refused',
    },
  },
  {
    name: 'formatting-repeated-for-every-line',
    about: 'a title whose formatting alone is a quarter of a megabyte',
    expect: 'accepted',
    build: () =>
      zipped({
        'ppt/slides/slide1.xml': part('ppt/slides/slide1.xml').replace(
          '<a:rPr lang="en-US" dirty="0"/><a:t>Parts of a plant',
          `<a:rPr lang="en-US" dirty="0"><a:extLst><a:ext uri="{00000000-0000-0000-0000-000000000000}">${'<a:x/>'.repeat(40_000)}</a:ext></a:extLst></a:rPr><a:t>Parts of a plant`
        ),
      }),
    then: {
      about: 'four thousand lines typed into that title, each of which would carry the formatting again',
      edits: (deck) => identity(deck).map((s, i) => (i === 0 ? { ...s, text: { [deck.base.slides[0]!.blocks[0]!.id]: [Array.from({ length: 3999 }, () => 'x').join('\n')] } } : s)),
      download: 'refused',
    },
  },
];
