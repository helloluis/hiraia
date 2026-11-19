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
 * Where the library lives and who may open what is in ./library (shared with the decks module).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PackDetail, PackFileKind, PackIndexEntry, PackVariant } from '@hiraia/tala-core/contracts';
import { HttpError, type ServerModule } from '../../kernel/types';
import { packLibrary, type PacksOptions } from './library';

export type { PacksOptions } from './library';

const CONTENT_TYPE: Record<PackFileKind, string> = {
  slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  guide: 'application/pdf',
  plans: 'application/pdf',
};

/** Drawing slugs as the art catalog writes them. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

export function createPacksModule(options: PacksOptions = {}): ServerModule {
  const lib = packLibrary(options);
  const { artifactsDir, isReviewer, loadIndex, manifestFor, canView, entryFor, verifiedBytes } = lib;

  const projectVariant = (v: PackVariant, reviewer: boolean): PackVariant => {
    const can = canView(v, reviewer);
    return { ...v, viewable: can, files: can ? v.files : [], title: can ? v.title : null };
  };

  const project = (entry: PackIndexEntry, reviewer: boolean): PackIndexEntry => {
    const variants = { en: projectVariant(entry.variants.en, reviewer), fil: projectVariant(entry.variants.fil, reviewer) };
    return { ...entry, variants, viewable: variants.en.viewable || variants.fil.viewable };
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
        const content = lib.content(entry.packId, lang);
        const review = lib.review(entry.packId, lang);
        return { entry: project(entry, isReviewer(ctx)), language: lang, content, review };
      },
      'packs.file': (ctx, input) => {
        const lang = input.query.lang;
        const entry = entryFor(ctx, input.params.packId, lang);
        const kind = input.params.kind as PackFileKind;
        if (!(kind in CONTENT_TYPE)) throw new HttpError('not_found', 'Unknown file.');
        const f = lib.builtFile(entry.packId, lang, kind);
        if (!f) throw new HttpError('not_found', 'This file has not been built yet.');
        return {
          binary: verifiedBytes(f.path, f.sha256),
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
        return { binary: new Uint8Array(readFileSync(file)), contentType: 'image/webp', cacheControl: 'private, max-age=3600' };
      },
      /** One drawing exactly as the built deck embeds it (the Hiraia-watermarked derivative). Displays inline. */
      'packs.media': (ctx, input) => {
        const lang = input.query.lang;
        const entry = entryFor(ctx, input.params.packId, lang);
        const slug = input.params.slug;
        if (!SLUG.test(slug)) throw new HttpError('not_found', 'This drawing is not in these slides.');
        const drawings = lib.deckDrawings(entry.packId, lang);
        if (!drawings) throw new HttpError('not_found', 'These slides have not been built yet.');
        const drawing = drawings.get(slug);
        if (!drawing) throw new HttpError('not_found', 'This drawing is not in these slides.');
        return { binary: drawing.bytes, contentType: 'image/png', cacheControl: 'private, max-age=86400' };
      },
    },
  };
}

export const packsModule = createPacksModule();
