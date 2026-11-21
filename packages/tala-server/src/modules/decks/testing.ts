/**
 * Test fixtures for the decks module: a throwaway library on disk with real pack content (the committed sample
 * weeks) and a real, readable built deck per language version, laid out the way the host's /var/lib/tala/packs is.
 * Hermetic: the decks are built here with this module's own writer and invented drawings (small PNGs made on the
 * spot), so no test depends on the batch pipeline's output or on files outside the repository.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { SaxesParser } from 'saxes';
import { PackIndex, PackReview, WeeklyPackContent } from '@hiraia/tala-core';
import type { PackIndexEntry, PackLang, PackVariant } from '@hiraia/tala-core';
import { layoutDeck, layoutInputFromPack } from '@hiraia/tala-core/decks';
import { writeDeckPptx, type DeckDrawingBytes } from './pptx-write';
import { crc32 } from './zip';

export const SAMPLE_LIBRARY = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../tala-packs/library/science-bow-2026'
);
/** Sample weeks that have both languages in the committed library. */
export const SAMPLE_PACKS = existsSync(SAMPLE_LIBRARY)
  ? readdirSync(SAMPLE_LIBRARY)
      .filter(
        (d) =>
          existsSync(join(SAMPLE_LIBRARY, d, 'en', 'pack.json')) &&
          existsSync(join(SAMPLE_LIBRARY, d, 'fil', 'pack.json'))
      )
      .sort()
  : [];

export const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** Strict XML well-formedness, with every namespace prefix declared. The error text, or null when the part is fine. */
export function xmlProblem(xml: string): string | null {
  let problem: string | null = null;
  const parser = new SaxesParser({ xmlns: true });
  parser.on('error', (e) => {
    problem ??= e.message;
  });
  parser.write(xml).close();
  return problem;
}

/** A valid greyscale PNG whose bytes depend on `seed` (so every invented drawing hashes differently). */
export function png(width: number, height: number, seed: number): Uint8Array {
  const raw = Buffer.alloc((width + 1) * height, 255);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    raw[y * (width + 1) + 1 + ((seed * 7 + y * 3) % width)] = seed % 251;
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth; colour type 0 (greyscale), default compression, filter and interlace
  const out = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

const seedOf = (text: string) => parseInt(sha(text).slice(0, 6), 16);

export interface VariantSpec {
  packId: string;
  lang: PackLang;
  publication?: 'draft' | 'approved';
  /** Change the content before it is written (a re-generated pack). Must keep it a valid pack. */
  edit?: (content: WeeklyPackContent) => void;
  /** Different number, different drawing bytes (a re-rendered deck). */
  art?: number;
  /** Leave the built deck out (a version whose files are not built yet). */
  withoutDeck?: boolean;
}

export interface BuiltVariant {
  packId: string;
  lang: PackLang;
  content: WeeklyPackContent;
  contentSha256: string;
  deck: Uint8Array | null;
  /** The invented drawings embedded in the built deck, by slug. */
  drawings: Map<string, DeckDrawingBytes & { sha256: string }>;
}

export interface LibraryFixture {
  root: string;
  /** Pass these to createPacksModule / createDecksModule. */
  options: { libraryDir: string; artifactsDir: string };
  variants: BuiltVariant[];
  variant(packId: string, lang: PackLang): BuiltVariant;
  /** SHA-256 of every file under the library and artifacts directories, by relative path. */
  hashes(): Record<string, string>;
  /**
   * Install a new snapshot the way the host does: build it beside the current one, move the current one aside,
   * move the new one in. Returns what the new snapshot holds.
   */
  swap(specs: VariantSpec[]): BuiltVariant[];
  cleanup(): void;
}

function buildInto(dir: string, specs: VariantSpec[]): BuiltVariant[] {
  const library = join(dir, 'library', 'science-bow-2026');
  const artifacts = join(dir, 'artifacts');
  mkdirSync(library, { recursive: true });
  mkdirSync(artifacts, { recursive: true });
  const committed = PackIndex.parse(
    JSON.parse(readFileSync(resolve(SAMPLE_LIBRARY, '..', 'index.json'), 'utf8'))
  );
  const built: BuiltVariant[] = [];
  const entries = new Map<string, PackIndexEntry>();
  const notBuilt = (language: PackLang): PackVariant => ({
    language,
    status: 'not_built',
    title: null,
    viewable: false,
    files: [],
    slideCount: null,
    illustratedSlides: null,
    review: null,
  });

  for (const spec of specs) {
    const src = join(SAMPLE_LIBRARY, spec.packId, spec.lang);
    const content = WeeklyPackContent.parse(
      JSON.parse(readFileSync(join(src, 'pack.json'), 'utf8'))
    );
    spec.edit?.(content);
    const text = JSON.stringify(WeeklyPackContent.parse(content));
    const publication = spec.publication ?? 'draft';
    const review = PackReview.parse(JSON.parse(readFileSync(join(src, 'review.json'), 'utf8')));
    review.contentSha256 = sha(text);
    review.autoChecks.state = 'pass';
    review.modelCritique.state = 'pass';
    review.publication = publication;
    review.teacherReview =
      publication === 'approved'
        ? {
            reviewer: 'Test Teacher',
            role: 'Grade 4 teacher',
            verdict: 'approve',
            notes: '',
            at: '2026-11-19T00:00:00Z',
          }
        : null;
    review.publicationBy = publication === 'approved' ? 'Test Teacher' : null;
    mkdirSync(join(library, spec.packId, spec.lang), { recursive: true });
    writeFileSync(join(library, spec.packId, spec.lang, 'pack.json'), text);
    writeFileSync(join(library, spec.packId, spec.lang, 'review.json'), JSON.stringify(review));

    // The built deck: the pack laid out by the shared layout, with one invented drawing per slug it shows.
    const layout = layoutDeck(layoutInputFromPack(content, review));
    const drawings = new Map<string, DeckDrawingBytes & { sha256: string }>();
    for (const slide of layout)
      for (const item of slide.items)
        if (
          item.type === 'image' &&
          item.source.kind === 'drawing' &&
          !drawings.has(item.source.slug)
        ) {
          const bytes = png(64, 68, seedOf(`${item.source.slug}:${spec.art ?? 0}`));
          drawings.set(item.source.slug, { bytes, width: 64, height: 68, sha256: sha(bytes) });
        }
    const deck = spec.withoutDeck
      ? null
      : writeDeckPptx({
          title: content.title,
          language: content.language,
          slides: layout,
          drawings,
          createdAt: '2026-11-19T00:00:00Z',
          modifiedAt: '2026-11-19T00:00:00Z',
        });
    const out = join(artifacts, spec.packId, spec.lang);
    mkdirSync(join(out, 'previews'), { recursive: true });
    const files = deck
      ? [
          {
            kind: 'slides' as const,
            name: `tala-${spec.packId.slice(6)}-${spec.lang}-slides.pptx`,
            bytes: deck.length,
            sha256: sha(deck),
          },
        ]
      : [];
    if (deck) writeFileSync(join(out, files[0]!.name), deck);
    writeFileSync(
      join(out, 'manifest.json'),
      JSON.stringify({
        packId: spec.packId,
        language: spec.lang,
        contentSha256: review.contentSha256,
        previews: 0,
        files,
      })
    );

    const status: 'approved' | 'draft' = publication === 'approved' ? 'approved' : 'draft';
    const template = committed.packs.find((p) => p.packId === spec.packId)!;
    const entry = entries.get(spec.packId) ?? {
      ...template,
      status,
      viewable: true,
      variants: { en: notBuilt('en'), fil: notBuilt('fil') },
    };
    entry.variants[spec.lang] = {
      language: spec.lang,
      status,
      title: content.title,
      viewable: true,
      files: files.map((f) => ({ kind: f.kind, bytes: f.bytes, sha256: f.sha256 })),
      slideCount: content.slides.length,
      illustratedSlides: layout.filter((s) => s.picture).length,
      review: {
        autoChecks: 'pass',
        modelCritique: 'pass',
        teacherReview: publication === 'approved',
        expertReview: false,
      },
    };
    entries.set(spec.packId, entry);
    built.push({
      packId: spec.packId,
      lang: spec.lang,
      content,
      contentSha256: review.contentSha256,
      deck,
      drawings,
    });
  }
  // One week that is not built at all, so the index always holds more than the fixture's own packs.
  const other = committed.packs.find(
    (p) => !entries.has(p.packId) && !SAMPLE_PACKS.includes(p.packId)
  )!;
  const packs = [
    ...entries.values(),
    {
      ...other,
      status: 'not_built' as const,
      viewable: false,
      variants: { en: notBuilt('en'), fil: notBuilt('fil') },
    },
  ];
  const count = (s: string) =>
    packs.flatMap((p) => [p.variants.en, p.variants.fil]).filter((v) => v.status === s).length;
  const index: PackIndex = {
    subject: 'science',
    curriculumVersion: committed.curriculumVersion,
    libraryVersion: committed.libraryVersion,
    reviewerView: true,
    counts: {
      targets: packs.length * 2,
      approved: count('approved'),
      draft: count('draft'),
      needsWork: 0,
      failed: 0,
      notBuilt: count('not_built'),
    },
    packs,
  };
  writeFileSync(join(dir, 'library', 'index.json'), JSON.stringify(PackIndex.parse(index)));
  return built;
}

export function libraryFixture(specs: VariantSpec[]): LibraryFixture {
  const root = mkdtempSync(join(tmpdir(), 'tala-decks-'));
  let variants = buildInto(root, specs);
  let generation = 0;
  const walk = (dir: string, prefix: string, out: Record<string, string>) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name), `${prefix}${e.name}/`, out);
      else out[`${prefix}${e.name}`] = sha(readFileSync(join(dir, e.name)));
    }
    return out;
  };
  const fixture: LibraryFixture = {
    root,
    options: {
      libraryDir: join(root, 'library', 'science-bow-2026'),
      artifactsDir: join(root, 'artifacts'),
    },
    get variants() {
      return variants;
    },
    variant(packId, lang) {
      const v = variants.find((x) => x.packId === packId && x.lang === lang);
      if (!v) throw new Error(`fixture has no ${packId} ${lang}`);
      return v;
    },
    hashes: () => ({
      ...walk(join(root, 'library'), 'library/', {}),
      ...walk(join(root, 'artifacts'), 'artifacts/', {}),
    }),
    swap(next) {
      generation += 1;
      const staging = join(root, `next-${generation}`);
      const built = buildInto(staging, next);
      for (const part of ['library', 'artifacts']) {
        renameSync(join(root, part), join(root, `${part}.prev-${generation}`));
        renameSync(join(staging, part), join(root, part));
      }
      variants = built;
      return built;
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  return fixture;
}
