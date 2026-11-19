/**
 * Read access to the teaching-pack library on disk: where it lives, who may open which language version, and the
 * built files checked against their build manifest. One implementation, used by the packs module (which serves the
 * library) and the decks module (which copies a pack's deck for a teacher), so both always agree on visibility.
 *
 * Visibility, per language version: only versions a named human approved are public. Drafts are open to reviewers:
 * any signed-in account in a non-production environment; in production, an account whose email is listed in
 * TALA_PACK_REVIEWERS, or every signed-in account when TALA_PACK_DRAFT_PREVIEW=signed-in. Signed-out visitors never
 * see draft content.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PackIndex,
  PackReview,
  WeeklyPackContent,
  type PackFileKind,
  type PackIndexEntry,
  type PackLang,
  type PackVariant,
} from '@hiraia/tala-core/contracts';
import { HttpError, type Ctx } from '../../kernel/types';
import { readDeckDrawings, type DeckDrawing } from '../decks/pptx-read';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIBRARY = resolve(HERE, '../../../../tala-packs/library/science-bow-2026');
const DEFAULT_ARTIFACTS = resolve(HERE, '../../../../tala-packs/build/artifacts');
export const PACK_ID = /^sci26-g(3|4|5|6|7|8|9|10)-t[1-3]-w\d{2}$/;

/** Said whenever a built file is missing or does not match the reviewed content. */
export const REBUILDING = 'This file is being rebuilt. Please try again later.';

export interface PackManifest {
  packId: string;
  language: PackLang;
  contentSha256: string;
  files: Array<{ kind: PackFileKind; name: string; bytes: number; sha256: string }>;
  previews: number;
}

export interface PacksOptions {
  libraryDir?: string;
  artifactsDir?: string;
}

export interface PackLibrary {
  libraryDir(): string;
  artifactsDir(): string;
  isReviewer(ctx: Ctx): boolean;
  canView(v: PackVariant, reviewer: boolean): boolean;
  loadIndex(): PackIndex;
  /** The index entry of a language version the caller may open; `not_found` with a plain reason otherwise. */
  entryFor(ctx: Ctx, packId: string, lang: PackLang): PackIndexEntry;
  manifestFor(packId: string, lang: PackLang): PackManifest | null;
  /** A file's bytes, only when they hash to `expectedSha`; `not_found` ("being rebuilt") otherwise. */
  verifiedBytes(path: string, expectedSha: string): Uint8Array;
  content(packId: string, lang: PackLang): WeeklyPackContent;
  /** The content with the hash of its exact bytes (a review record names the content it is about by this hash). */
  readContent(packId: string, lang: PackLang): { content: WeeklyPackContent; sha256: string };
  review(packId: string, lang: PackLang): PackReview;
  /** The manifest entry of a built file, when it was built for the exact reviewed content; else undefined. */
  builtFile(
    packId: string,
    lang: PackLang,
    kind: PackFileKind,
    review?: PackReview
  ): { name: string; path: string; sha256: string } | undefined;
  /**
   * The drawings embedded in a version's built deck (the Hiraia-watermarked derivatives), by slug. Null when the
   * deck is not built for the reviewed content; throws `not_found` ("being rebuilt") when its bytes do not match.
   */
  deckDrawings(packId: string, lang: PackLang): Map<string, DeckDrawing> | null;
}

/** Parsed decks kept in memory (a deck's drawings are ~150 KB together). */
const DRAWING_CACHE_DECKS = 24;

export function createPackLibrary(options: PacksOptions = {}): PackLibrary {
  const libraryDir = () =>
    process.env.TALA_PACKS_LIBRARY_DIR || options.libraryDir || DEFAULT_LIBRARY;
  const artifactsDir = () =>
    process.env.TALA_PACKS_ARTIFACTS_DIR || options.artifactsDir || DEFAULT_ARTIFACTS;
  const verified = new Map<string, string>(); // path+mtime+size → sha256 already checked
  const drawings = new Map<string, Map<string, DeckDrawing>>(); // path+mtime+size → drawings, oldest first

  const isReviewer = (ctx: Ctx) => {
    if (!ctx.user) return false;
    if (ctx.config.environment !== 'production') return true;
    if ((process.env.TALA_PACK_DRAFT_PREVIEW ?? '').trim() === 'signed-in') return true;
    const list = (process.env.TALA_PACK_REVIEWERS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    return list.includes(ctx.user.email.toLowerCase());
  };

  const loadIndex = (): PackIndex => {
    const file = resolve(libraryDir(), '..', 'index.json');
    if (!existsSync(file))
      throw new HttpError('not_found', 'The teaching pack library is not available yet.');
    return PackIndex.parse(JSON.parse(readFileSync(file, 'utf8')));
  };

  const manifestFor = (packId: string, lang: PackLang): PackManifest | null => {
    const file = resolve(artifactsDir(), packId, lang, 'manifest.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as PackManifest) : null;
  };

  const canView = (v: PackVariant, reviewer: boolean) =>
    v.status === 'approved' || (reviewer && (v.status === 'draft' || v.status === 'needs_work'));

  const entryFor = (ctx: Ctx, packId: string, lang: PackLang) => {
    if (!PACK_ID.test(packId))
      throw new HttpError('not_found', 'This teaching pack does not exist.');
    const entry = loadIndex().packs.find((p) => p.packId === packId);
    if (!entry) throw new HttpError('not_found', 'This teaching pack does not exist.');
    const v = entry.variants[lang];
    if (!canView(v, isReviewer(ctx)))
      throw new HttpError(
        'not_found',
        v.status === 'not_built' || v.status === 'failed'
          ? 'This week does not have a teaching pack in this language yet.'
          : 'This pack is still being reviewed and is not available yet.'
      );
    return entry;
  };

  const verifiedBytes = (path: string, expectedSha: string): Uint8Array => {
    const st = statSync(path);
    const key = `${path}:${st.mtimeMs}:${st.size}`;
    const bytes = readFileSync(path);
    if (verified.get(key) !== expectedSha) {
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedSha) throw new HttpError('not_found', REBUILDING);
      verified.set(key, actual);
    }
    return new Uint8Array(bytes);
  };

  const readContent = (packId: string, lang: PackLang) => {
    const bytes = readFileSync(resolve(libraryDir(), packId, lang, 'pack.json'));
    return {
      content: WeeklyPackContent.parse(JSON.parse(bytes.toString('utf8'))),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  };
  const content = (packId: string, lang: PackLang) => readContent(packId, lang).content;
  const review = (packId: string, lang: PackLang) =>
    PackReview.parse(
      JSON.parse(readFileSync(resolve(libraryDir(), packId, lang, 'review.json'), 'utf8'))
    );

  const builtFile = (packId: string, lang: PackLang, kind: PackFileKind, known?: PackReview) => {
    const manifest = manifestFor(packId, lang);
    const r = known ?? review(packId, lang);
    const f =
      manifest?.contentSha256 === r.contentSha256
        ? manifest.files.find((x) => x.kind === kind)
        : undefined;
    return f
      ? { name: f.name, path: resolve(artifactsDir(), packId, lang, f.name), sha256: f.sha256 }
      : undefined;
  };

  const deckDrawings = (packId: string, lang: PackLang) => {
    const f = builtFile(packId, lang, 'slides');
    if (!f || !existsSync(f.path)) return null;
    const st = statSync(f.path);
    const key = `${f.path}:${st.mtimeMs}:${st.size}:${f.sha256}`;
    const hit = drawings.get(key);
    if (hit) return hit;
    let parsed: Map<string, DeckDrawing>;
    try {
      parsed = readDeckDrawings(verifiedBytes(f.path, f.sha256));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // A deck that hashes right but cannot be read is not something a retry by the teacher fixes; say it plainly.
      throw new HttpError('not_found', REBUILDING);
    }
    drawings.set(key, parsed);
    while (drawings.size > DRAWING_CACHE_DECKS)
      drawings.delete(drawings.keys().next().value as string);
    return parsed;
  };

  return {
    libraryDir,
    artifactsDir,
    isReviewer,
    canView,
    loadIndex,
    entryFor,
    manifestFor,
    verifiedBytes,
    content,
    readContent,
    review,
    builtFile,
    deckDrawings,
  };
}

const shared = new Map<string, PackLibrary>();
/** One library per pair of directories, so modules given the same options share its caches. */
export function packLibrary(options: PacksOptions = {}): PackLibrary {
  const key = `${options.libraryDir ?? ''}\n${options.artifactsDir ?? ''}`;
  let lib = shared.get(key);
  if (!lib) {
    lib = createPackLibrary(options);
    shared.set(key, lib);
  }
  return lib;
}
