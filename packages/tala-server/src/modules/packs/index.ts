/**
 * Teaching packs library (read-only reference content, like curriculum). Serves the coverage index, a pack's
 * content in English or Filipino, and its prebuilt files (PPTX deck, teacher guide PDF, lesson plans PDF, slide
 * previews) per language.
 *
 * Visibility, per language version: only versions a named human approved (`publication: approved` with passing
 * checks) are public. Drafts are visible to reviewers: any signed-in account in a non-production environment; in
 * production, an account whose email is listed in TALA_PACK_REVIEWERS, or every signed-in account when
 * TALA_PACK_DRAFT_PREVIEW=signed-in (the early preview Luis put on the live site on 19 Nov 2026; drafts stay labelled
 * as drafts everywhere). Signed-out visitors never see draft content. Everyone sees honest per-week status.
 *
 * Files are served only when their bytes match the build manifest for the exact reviewed content.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PackIndex,
  PackReview,
  WeeklyPackContent,
  type PackDetail,
  type PackFileKind,
  type PackIndexEntry,
  type PackLang,
  type PackVariant,
} from '@hiraia/tala-core/contracts';
import { HttpError, type Ctx, type ServerModule } from '../../kernel/types';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LIBRARY = resolve(HERE, '../../../../tala-packs/library/science-bow-2026');
const DEFAULT_ARTIFACTS = resolve(HERE, '../../../../tala-packs/build/artifacts');
const ID = /^sci26-g(3|4|5|6|7|8|9|10)-t[1-3]-w\d{2}$/;

const CONTENT_TYPE: Record<PackFileKind, string> = {
  slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  guide: 'application/pdf',
  plans: 'application/pdf',
};

interface Manifest {
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

export function createPacksModule(options: PacksOptions = {}): ServerModule {
  const libraryDir = () => process.env.TALA_PACKS_LIBRARY_DIR || options.libraryDir || DEFAULT_LIBRARY;
  const artifactsDir = () => process.env.TALA_PACKS_ARTIFACTS_DIR || options.artifactsDir || DEFAULT_ARTIFACTS;
  const verified = new Map<string, string>(); // path+mtime+size → sha256 already checked

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
    if (!existsSync(file)) throw new HttpError('not_found', 'The teaching pack library is not available yet.');
    return PackIndex.parse(JSON.parse(readFileSync(file, 'utf8')));
  };

  const manifestFor = (packId: string, lang: PackLang): Manifest | null => {
    const file = resolve(artifactsDir(), packId, lang, 'manifest.json');
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : null;
  };

  const canView = (v: PackVariant, reviewer: boolean) => v.status === 'approved' || (reviewer && (v.status === 'draft' || v.status === 'needs_work'));

  const projectVariant = (v: PackVariant, reviewer: boolean): PackVariant => {
    const can = canView(v, reviewer);
    return { ...v, viewable: can, files: can ? v.files : [], title: can ? v.title : null };
  };

  const project = (entry: PackIndexEntry, reviewer: boolean): PackIndexEntry => {
    const variants = { en: projectVariant(entry.variants.en, reviewer), fil: projectVariant(entry.variants.fil, reviewer) };
    return { ...entry, variants, viewable: variants.en.viewable || variants.fil.viewable };
  };

  const entryFor = (ctx: Ctx, packId: string, lang: PackLang) => {
    if (!ID.test(packId)) throw new HttpError('not_found', 'This teaching pack does not exist.');
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
      if (actual !== expectedSha) throw new HttpError('not_found', 'This file is being rebuilt. Please try again later.');
      verified.set(key, actual);
    }
    return new Uint8Array(bytes);
  };

  return {
    name: 'packs',
    migrations: [],
    handlers: {
      'packs.index': (ctx) => {
        const index = loadIndex();
        const reviewer = isReviewer(ctx);
        return { ...index, reviewerView: reviewer, packs: index.packs.map((p) => project(p, reviewer)) };
      },
      'packs.detail': (ctx, input): PackDetail => {
        const lang = input.query.lang;
        const entry = entryFor(ctx, input.params.packId, lang);
        const dir = resolve(libraryDir(), entry.packId, lang);
        const content = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(dir, 'pack.json'), 'utf8')));
        const review = PackReview.parse(JSON.parse(readFileSync(resolve(dir, 'review.json'), 'utf8')));
        return { entry: project(entry, isReviewer(ctx)), language: lang, content, review };
      },
      'packs.file': (ctx, input) => {
        const lang = input.query.lang;
        const entry = entryFor(ctx, input.params.packId, lang);
        const kind = input.params.kind as PackFileKind;
        if (!(kind in CONTENT_TYPE)) throw new HttpError('not_found', 'Unknown file.');
        const manifest = manifestFor(entry.packId, lang);
        const review = PackReview.parse(JSON.parse(readFileSync(resolve(libraryDir(), entry.packId, lang, 'review.json'), 'utf8')));
        const f = manifest?.contentSha256 === review.contentSha256 ? manifest.files.find((x) => x.kind === kind) : undefined;
        if (!f) throw new HttpError('not_found', 'This file has not been built yet.');
        return {
          binary: verifiedBytes(resolve(artifactsDir(), entry.packId, lang, f.name), f.sha256),
          contentType: CONTENT_TYPE[kind],
          filename: f.name,
        };
      },
      'packs.preview': (ctx, input) => {
        const lang = input.query.lang;
        const entry = entryFor(ctx, input.params.packId, lang);
        const n = Number(input.params.slide);
        const manifest = manifestFor(entry.packId, lang);
        if (!manifest || !Number.isInteger(n) || n < 1 || n > manifest.previews) throw new HttpError('not_found', 'No preview for this slide.');
        const file = resolve(artifactsDir(), entry.packId, lang, 'previews', `thumb-${String(n).padStart(2, '0')}.webp`);
        if (!existsSync(file)) throw new HttpError('not_found', 'No preview for this slide.');
        // No filename: previews display inline.
        return { binary: new Uint8Array(readFileSync(file)), contentType: 'image/webp' };
      },
    },
  };
}

export const packsModule = createPacksModule();
