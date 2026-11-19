import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { layoutDeck, layoutInputFromPack } from '@hiraia/tala-core/decks';
import { PackReview, WeeklyPackContent } from '@hiraia/tala-core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  pngSize,
  readDeckDrawings,
  relationships,
  resolvePart,
  slideParts,
  xmlUnescape,
} from './pptx-read';
import { fitInside, writeDeckPptx, xmlText } from './pptx-write';
import { SAMPLE_LIBRARY, SAMPLE_PACKS, png, sha, xmlProblem } from './testing';
import { crc32, readZip, writeZip, ZipError } from './zip';

const text = (b: Uint8Array) => Buffer.from(b).toString('utf8');

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(strToU8('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('zip: what the writer writes, the reader and an independent reader read back', () => {
  const files = [
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'ppt/slides/slide1.xml', data: 'x'.repeat(5000) + ' Ñandú — año' },
    { name: 'ppt/media/image1.png', data: png(8, 8, 3) },
    { name: 'empty.txt', data: '' },
  ];
  const bytes = writeZip(files);
  const zip = readZip(bytes);
  assert.deepEqual(
    zip.names,
    files.map((f) => f.name),
    'entry order is kept and no folder entries are added'
  );
  for (const f of files)
    assert.deepEqual(
      Buffer.from(zip.read(f.name)),
      Buffer.from(typeof f.data === 'string' ? strToU8(f.data) : f.data)
    );
  // fflate is a separate implementation: it must agree byte for byte.
  const other = unzipSync(bytes);
  assert.deepEqual(
    Object.keys(other),
    files.map((f) => f.name)
  );
  for (const f of files)
    assert.deepEqual(
      Buffer.from(other[f.name]!),
      Buffer.from(typeof f.data === 'string' ? strToU8(f.data) : f.data)
    );
  // The same input gives the same bytes, every time.
  assert.deepEqual(Buffer.from(writeZip(files)), Buffer.from(bytes));
  // ...and the reader reads archives it did not write (deflated and stored entries, a folder entry).
  const foreign = readZip(
    zipSync({
      'a/': new Uint8Array(0),
      'a/b.xml': [strToU8('<b/>'), { level: 6 }],
      'c.bin': [new Uint8Array([1, 2, 3]), { level: 0 }],
    })
  );
  assert.deepEqual(foreign.names, ['a/b.xml', 'c.bin']);
  assert.equal(foreign.text('a/b.xml'), '<b/>');
  assert.deepEqual([...foreign.read('c.bin')], [1, 2, 3]);
});

test('zip: garbage, damage and oversized archives are refused, not trusted', () => {
  assert.throws(() => readZip(strToU8('PK fake deck')), ZipError);
  assert.throws(() => readZip(new Uint8Array(0)), ZipError);
  const good = writeZip([{ name: 'a.xml', data: 'hello '.repeat(200) }]);
  assert.throws(() => readZip(good).read('missing.xml'), ZipError);
  // Flip one byte of the compressed data: the size or CRC check must notice.
  const damaged = new Uint8Array(good);
  damaged[30 + 'a.xml'.length + 4]! ^= 0xff;
  assert.throws(() => readZip(damaged).read('a.xml'), ZipError);
  // An archive that claims to unpack to more than the ceiling is refused before anything is inflated.
  assert.throws(() => readZip(good, { inflatedBytes: 100 }), /more than is allowed/);
  assert.throws(
    () =>
      readZip(
        writeZip([
          { name: 'a', data: 'x' },
          { name: 'b', data: 'y' },
        ]),
        { entries: 1 }
      ),
    /too many entries/
  );
  // A lying directory (declares 10 bytes, holds far more) cannot make the reader inflate past what it declared.
  const bomb = new Uint8Array(writeZip([{ name: 'a.xml', data: '0123456789' }]));
  const big = deflateRawSync(Buffer.alloc(200_000, 0x41));
  const view = new DataView(bomb.buffer);
  const patched = new Uint8Array(bomb.length - view.getUint32(18, true) + big.length);
  patched.set(bomb.subarray(0, 30 + 5), 0);
  patched.set(big, 35);
  const tail = bomb.subarray(35 + view.getUint32(18, true));
  patched.set(tail, 35 + big.length);
  const pv = new DataView(patched.buffer);
  pv.setUint32(18, big.length, true); // local header: compressed size
  const cd = 35 + big.length;
  pv.setUint32(cd + 20, big.length, true); // central directory: compressed size (declared size stays 10)
  pv.setUint32(patched.length - 22 + 16, cd, true); // end record: directory offset
  assert.throws(() => readZip(patched).read('a.xml'), ZipError);
  assert.throws(() => writeZip([{ name: '../evil', data: 'x' }]), ZipError);
  assert.throws(
    () =>
      writeZip([
        { name: 'a', data: '1' },
        { name: 'a', data: '2' },
      ]),
    ZipError
  );
});

test('small helpers: part paths, XML text, PNG size, fitting a drawing', () => {
  assert.equal(resolvePart('ppt/slides', '../media/image1.png'), 'ppt/media/image1.png');
  assert.equal(resolvePart('ppt', 'slides/slide1.xml'), 'ppt/slides/slide1.xml');
  assert.equal(resolvePart('ppt/slides', '/ppt/media/a.png'), 'ppt/media/a.png');
  assert.equal(
    xmlUnescape('A &amp; B &lt;c&gt; &quot;d&quot; &#233; &#x2022;'),
    'A & B <c> "d" é •'
  );
  assert.equal(xmlText('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
  assert.equal(
    xmlText('ok\u0000\u0008\u000b bad'),
    'ok bad',
    'characters XML cannot carry are dropped'
  );
  assert.deepEqual(pngSize(png(64, 68, 1)), { width: 64, height: 68 });
  assert.equal(pngSize(strToU8('not a png at all, just some words')), null);
  // A 512 × 546 drawing in the split layout's picture area sits exactly where the pack renderer puts it.
  const box = fitInside({ x: 8.12, y: 1.17, w: 4.39, h: 5.11 }, { width: 512, height: 546 });
  assert.ok(
    Math.abs(box.w - 4.39) < 1e-9 &&
      Math.abs(box.h - 4.6816) < 1e-3 &&
      Math.abs(box.x - 8.12) < 1e-9 &&
      Math.abs(box.y - 1.3842) < 1e-3,
    JSON.stringify(box)
  );
});

test(
  'a deck written from the shared layout is a well-formed, self-consistent package',
  { skip: SAMPLE_PACKS.length === 0 },
  () => {
    for (const lang of ['en', 'fil'] as const) {
      const dir = join(SAMPLE_LIBRARY, SAMPLE_PACKS[0]!, lang);
      const content = WeeklyPackContent.parse(
        JSON.parse(readFileSync(join(dir, 'pack.json'), 'utf8'))
      );
      const review = PackReview.parse(JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8')));
      const slides = layoutDeck(layoutInputFromPack(content, review));
      const drawings = new Map<string, { bytes: Uint8Array; width: number; height: number }>();
      for (const s of slides)
        for (const i of s.items)
          if (i.type === 'image' && i.source.kind === 'drawing')
            drawings.set(i.source.slug, {
              bytes: png(64, 68, parseInt(sha(i.source.slug).slice(0, 6), 16)),
              width: 64,
              height: 68,
            });
      const input = {
        title: `${content.title} & <more>`,
        language: lang,
        slides,
        drawings,
        createdAt: '2026-11-19T07:57:58.123Z',
        modifiedAt: 'not a date',
      };
      const bytes = writeDeckPptx(input);
      assert.deepEqual(
        Buffer.from(writeDeckPptx(input)),
        Buffer.from(bytes),
        'the same deck always gives the same file'
      );

      const zip = readZip(bytes);
      assert.equal(zip.names[0], '[Content_Types].xml', 'the content types part comes first');
      assert.ok(!zip.names.some((n) => n.endsWith('/')), 'no folder entries');
      assert.deepEqual(
        Object.keys(unzipSync(bytes)),
        zip.names,
        'an independent ZIP reader sees the same entries'
      );

      // Every XML part parses strictly, with its namespaces declared.
      for (const name of zip.names.filter((n) => /\.(xml|rels)$/.test(n)))
        assert.equal(xmlProblem(zip.text(name)), null, name);

      // Every relationship points at a part that exists; every part has a content type.
      const types = zip.text('[Content_Types].xml');
      const overrides = new Set(
        [...types.matchAll(/<Override PartName="\/([^"]+)"/g)].map((m) => m[1]!)
      );
      const defaults = new Set(
        [...types.matchAll(/<Default Extension="([^"]+)"/g)].map((m) => m[1]!)
      );
      for (const name of zip.names) {
        if (name === '[Content_Types].xml') continue;
        assert.ok(
          overrides.has(name) || defaults.has(name.split('.').pop()!),
          `${name} has a content type`
        );
        if (name.endsWith('.rels')) continue;
        for (const rel of relationships(zip, name).values())
          assert.ok(zip.has(rel.target), `${name} → ${rel.target} exists`);
      }
      for (const part of overrides)
        assert.ok(zip.has(part), `content types name ${part}, which exists`);
      assert.ok(
        zip.has('ppt/_rels/presentation.xml.rels') &&
          relationships(zip, 'ppt/presentation.xml').size === slides.length + 6
      );

      // Slides in order, each on one of the three layouts, each with its notes.
      const parts = slideParts(zip);
      assert.equal(parts.length, content.slides.length);
      parts.forEach((part, i) => {
        assert.equal(part, `ppt/slides/slide${i + 1}.xml`);
        const rels = [...relationships(zip, part).values()];
        assert.equal(rels.filter((r) => r.type.endsWith('/slideLayout')).length, 1);
        const notes = rels.find((r) => r.type.endsWith('/notesSlide'));
        assert.ok(
          notes && /<a:t>[^<]*\S/.test(zip.text(notes.target)),
          `slide ${i + 1} has speaker notes`
        );
        assert.match(
          zip.text(part),
          /<p:ph idx="101" type="title"/,
          `slide ${i + 1} keeps its title in the title placeholder`
        );
      });
      assert.match(
        zip.text('ppt/presentation.xml'),
        /<p:sldMasterIdLst>.*<p:notesMasterIdLst>.*<p:sldIdLst>.*<p:sldSz cx="12192000" cy="6858000"\/>/s,
        'presentation children in schema order'
      );
      assert.match(
        zip.text('ppt/slideLayouts/slideLayout2.xml'),
        new RegExp(
          `<a:t>Grade ${content.grade} Science · Term ${content.term} · Week ${content.week}</a:t>`
        ),
        'the layouts carry this deck’s footer'
      );
      assert.match(
        zip.text('docProps/core.xml'),
        /&amp; &lt;more&gt;<\/dc:title>.*2026-11-19T07:57:58Z.*2026-01-01T00:00:00Z/s,
        'title escaped; dates in the form Office writes'
      );
      assert.match(
        zip.text('ppt/slides/slide1.xml'),
        new RegExp(`lang="${lang === 'fil' ? 'fil-PH' : 'en-US'}"`),
        'runs carry the deck language'
      );

      // The drawings come back out byte for byte, each stored once however many slides show it.
      const embedded = readDeckDrawings(bytes);
      assert.deepEqual([...embedded.keys()].sort(), [...drawings.keys()].sort());
      for (const [slug, d] of drawings) {
        assert.equal(
          embedded.get(slug)!.sha256,
          sha(d.bytes),
          `${slug} is embedded exactly as given`
        );
        assert.deepEqual(
          { width: embedded.get(slug)!.width, height: embedded.get(slug)!.height },
          { width: 64, height: 68 }
        );
      }
      assert.equal(
        zip.names.filter((n) => n.startsWith('ppt/media/')).length,
        drawings.size + 2,
        'one part per drawing, plus the two brand marks'
      );
      // Two slugs with the very same bytes share one part (media is stored by content).
      const same = new Map(
        [...drawings.keys()].map((slug) => [slug, { bytes: png(64, 68, 1), width: 64, height: 68 }])
      );
      assert.equal(
        readZip(writeDeckPptx({ ...input, drawings: same })).names.filter((n) =>
          n.startsWith('ppt/media/')
        ).length,
        3
      );

      // A slide whose drawing has no bytes is written without the picture, not with a broken one.
      const without = readZip(writeDeckPptx({ ...input, drawings: new Map() }));
      assert.equal(readDeckDrawings(writeDeckPptx({ ...input, drawings: new Map() })).size, 0);
      for (const name of without.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)))
        for (const rel of relationships(without, name).values()) assert.ok(without.has(rel.target));
    }
  }
);

// Opt-in (never part of an ordinary run): point TALA_DECKS_REAL_DECK_DIR at one built language version, e.g.
// …/artifacts/sci26-g4-t2-w10/en, to check the reader against a deck the pack renderer itself built.
const REAL_DECK_DIR = process.env.TALA_DECKS_REAL_DECK_DIR ?? '';
test(
  'a real deck from the pack renderer is read the same way (opt-in)',
  { skip: !REAL_DECK_DIR || !existsSync(join(REAL_DECK_DIR, 'manifest.json')) },
  () => {
    const dir = REAL_DECK_DIR;
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
      files: Array<{ kind: string; name: string }>;
      images: Array<{ slug: string; embeddedSha256: string }>;
    };
    const drawings = readDeckDrawings(
      readFileSync(join(dir, manifest.files.find((f) => f.kind === 'slides')!.name))
    );
    assert.deepEqual([...drawings.keys()].sort(), manifest.images.map((i) => i.slug).sort());
    for (const i of manifest.images)
      assert.equal(
        drawings.get(i.slug)!.sha256,
        i.embeddedSha256,
        `${i.slug}: the watermarked bytes the build manifest recorded`
      );
  }
);

test('reading a deck: only pictures named as drawings count, and unreadable files are refused', () => {
  assert.throws(() => readDeckDrawings(strToU8('PK fake deck')), ZipError);
  assert.throws(
    () => readDeckDrawings(writeZip([{ name: 'word/document.xml', data: '<w/>' }])),
    /no slides/
  );
  const slide = (pics: string) => `<p:sld><p:cSld><p:spTree>${pics}</p:spTree></p:cSld></p:sld>`;
  const pic = (name: string, rid: string) =>
    `<p:pic><p:nvPicPr><p:cNvPr id="2" name="${name}" descr="An &amp; alt"/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill></p:pic>`;
  const rels = `<Relationships><Relationship Id="rId1" Type="t/image" Target="../media/a.png"/><Relationship Id="rId2" Type="t/image" Target="../media/b.png"/><Relationship Id="rId3" Type="t/image" Target="../media/c.txt"/></Relationships>`;
  const deck = writeZip([
    {
      name: 'ppt/slides/slide1.xml',
      data: slide(
        pic('illustration magnet-poles', 'rId1') +
          pic('Image 0', 'rId2') +
          pic('illustration not-a-png', 'rId3') +
          pic('illustration missing-part', 'rId9')
      ),
    },
    { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels },
    { name: 'ppt/media/a.png', data: png(10, 12, 5) },
    { name: 'ppt/media/b.png', data: png(10, 12, 6) },
    { name: 'ppt/media/c.txt', data: 'words' },
  ]);
  const found = readDeckDrawings(deck);
  assert.deepEqual(
    [...found.keys()],
    ['magnet-poles'],
    'brand marks, non-PNG parts and dangling pictures are not drawings'
  );
  assert.equal(found.get('magnet-poles')!.alt, 'An & alt');
  assert.deepEqual([found.get('magnet-poles')!.width, found.get('magnet-poles')!.height], [10, 12]);
  assert.equal(text(found.get('magnet-poles')!.bytes).length > 0, true);
});
