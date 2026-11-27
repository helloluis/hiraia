/**
 * A teacher's own copy of a pack's slides ("My copy"; contracts/decks.ts).
 *
 * The Hiraia original stays shared and read-only (the packs module serves it from the library on disk). A copy is
 * a full, self-contained row owned by one account: its slides, the slides as first copied, and the drawings it may
 * show. Nothing here writes to the library, and nothing a teacher does to a copy reaches the original or anyone
 * else's copy. Replacing the library on the host (a new snapshot, a rebuilt pack, a withdrawn pack) leaves every
 * copy readable, presentable and downloadable; `original` on a detail says how the copy now relates to the library.
 *
 * Ownership: every route needs a session, and every read and write names the owner in its SQL. Another teacher's
 * deck id answers `not_found`, exactly like an id that does not exist.
 *
 * Honest labels: neither the credits slide (art credit, "draft / reviewed by", "edited by its teacher") nor the
 * cover (which carries the draft label of a copy made from an unapproved pack; the layout draws it) can be removed
 * through a save.
 * Slide text, speaker notes and emails are never logged.
 */
import { z } from 'zod';
import { DECK_LIMITS, DeckSlide, packSubjectOf } from '@hiraia/tala-core/contracts';
import type {
  DeckDetail,
  DeckMedia,
  DeckOriginalState,
  DeckSaveResult,
  PackLang,
} from '@hiraia/tala-core/contracts';
import {
  changedSlideCount,
  deckSlidesFromPack,
  layoutDeck,
  layoutInputFromDeck,
  packApproved,
  sourcesLineFromPack,
} from '@hiraia/tala-core/decks';
import type { Database } from 'better-sqlite3';
import { HttpError, requireUser, type Ctx, type ServerModule } from '../../kernel/types';
import { PACK_ID, packLibrary, type PacksOptions } from '../packs/library';
import type { DeckDrawing } from './pptx-read';
import { PPTX_CONTENT_TYPE, writeDeckPptx, type DeckDrawingBytes } from './pptx-write';
import {
  createDeckStore,
  decksMigrations,
  rowToDeck,
  type DeckRow,
  type DeckSeed,
  type DeckStore,
} from './store';
import { createUploads, type UploadOptions } from './uploads';
import { createLessons, lessonStoreFor } from './lessons';
import { lessonMigrations } from './lesson-store';

/** `uploads`: limits and the picture renderer for a teacher's own uploaded files (uploads.ts). */
export type DecksOptions = PacksOptions & { uploads?: UploadOptions };

const MESSAGES = {
  notFound: 'We could not find this copy of the slides.',
  rebuilding: 'These slides are being rebuilt. Please try again later.',
  notCopyable: 'These slides cannot be copied yet. Please try again later.',
  conflict: 'This copy was changed somewhere else after you opened it.',
  credits: 'The credits slide stays with every copy.',
  cover: 'The cover slide stays with every copy.',
  duplicate: 'Two slides have the same id.',
  originalGone:
    'The original of these slides is not in the library right now, so your copy was left as it is.',
  lessonDeck: 'These slides were made from your lesson, so there is no original to copy again. Earlier versions are kept under "Earlier versions".',
  noDrawing: 'This drawing is not in your copy.',
} as const;

/** Slide text is one line per field: any run of spaces, tabs or line breaks becomes one space. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const tidyNotes = (text: string) => text.replace(/\r\n?/g, '\n').trim();

/** The same tidying for a fresh copy and for every save, so an untouched slide always equals its original. */
function tidySlide(s: DeckSlide): DeckSlide {
  return {
    id: s.id,
    day: s.day,
    kind: s.kind,
    title: oneLine(s.title),
    lines: s.lines.map(oneLine).filter(Boolean),
    // Choices keep their places (an answer slide points at one by position), even when one is blank for a moment.
    choices: s.choices.map(oneLine),
    revealOf: s.revealOf,
    correctChoice: s.correctChoice,
    image: s.image ? { slug: s.image.slug, alt: oneLine(s.image.alt) } : null,
    notes: tidyNotes(s.notes),
    sourceId: s.sourceId,
  };
}

const stores = new WeakMap<Database, DeckStore>();
function storeFor(db: Database): DeckStore {
  let store = stores.get(db);
  if (!store) {
    store = createDeckStore(db);
    stores.set(db, store);
  }
  return store;
}

const notFound = () => new HttpError('not_found', MESSAGES.notFound, { reason: 'deck_not_found' });

export function createDecksModule(options: DecksOptions = {}): ServerModule {
  const lib = packLibrary(options);
  // A teacher's own uploaded PowerPoint files: their own tables and routes, the same owner-only rule.
  const uploads = createUploads(options.uploads);

  /** Everything a copy takes from the library's current original; throws plainly when it cannot be copied now. */
  const seedFromLibrary = (
    ctx: Ctx,
    packId: string,
    lang: PackLang
  ): { seed: DeckSeed; drawings: DeckDrawing[] } => {
    const entry = lib.entryFor(ctx, packId, lang);
    const review = lib.review(entry.packId, lang);
    const { content, sha256 } = lib.readContent(entry.packId, lang);
    let drawings: Map<string, DeckDrawing> | null;
    try {
      drawings = lib.deckDrawings(entry.packId, lang);
    } catch (err) {
      if (err instanceof HttpError)
        throw new HttpError('unavailable', MESSAGES.rebuilding, { reason: 'deck_rebuilding' });
      throw err;
    }
    // A copy is made only from a consistent original: the content on disk is the content the review record and
    // the built deck are about. Anything else means the library is being updated right now.
    if (!drawings || sha256 !== review.contentSha256)
      throw new HttpError('unavailable', MESSAGES.rebuilding, { reason: 'deck_rebuilding' });

    const altBySlug = new Map<string, string>();
    for (const s of content.slides)
      if (s.image && !altBySlug.has(s.image.slug)) altBySlug.set(s.image.slug, s.image.alt);
    const media: DeckMedia[] = [...drawings.values()].map((d) => ({
      slug: d.slug,
      sha256: d.sha256,
      width: d.width,
      height: d.height,
      alt: oneLine(altBySlug.get(d.slug) ?? d.alt).slice(0, 300),
    }));
    const known = new Set(media.map((m) => m.slug));
    // A drawing the built deck never shows is not embedded in it, so the copy cannot show it either.
    const slides = deckSlidesFromPack(content).map((s) =>
      tidySlide(s.image && !known.has(s.image.slug) ? { ...s, image: null } : s)
    );
    const checked = z.array(DeckSlide).min(1).max(DECK_LIMITS.slides).safeParse(slides);
    if (!checked.success || media.length > 80)
      throw new HttpError('unavailable', MESSAGES.notCopyable, { reason: 'deck_not_copyable' });
    return {
      seed: {
        title: content.title.slice(0, DECK_LIMITS.deckTitle),
        grade: content.grade,
        term: content.term,
        week: content.week,
        sourceApproved: packApproved(review),
        baseContentSha256: review.contentSha256,
        credits: {
          reviewer: review.teacherReview?.reviewer.slice(0, 200) ?? null,
          sourcesLine: sourcesLineFromPack(content).slice(0, 600),
        },
        slides: checked.data,
        media,
      },
      drawings: [...drawings.values()],
    };
  };

  /** How a copy relates to the library as it is now. Never fails: a copy must open whatever happened to its pack. */
  const originalState = (
    ctx: Ctx,
    row: Pick<DeckRow, 'pack_id' | 'language' | 'base_content_sha256' | 'origin'>
  ): DeckOriginalState => {
    // Slides made from a lesson have no original in the library.
    if (row.origin === 'lesson') return { available: false, updated: false };
    try {
      lib.entryFor(ctx, row.pack_id, row.language);
      return {
        available: true,
        updated: lib.review(row.pack_id, row.language).contentSha256 !== row.base_content_sha256,
      };
    } catch (err) {
      if (!(err instanceof HttpError))
        ctx.log.warn('deck_original_unreadable', { packId: row.pack_id, language: row.language });
      return { available: false, updated: false };
    }
  };

  const detail = (ctx: Ctx, row: DeckRow): DeckDetail => ({
    deck: rowToDeck(row),
    baseSlides: JSON.parse(row.base_slides_json) as DeckSlide[],
    original: originalState(ctx, row),
  });

  /** What a save may store: tidy text, drawings only from this copy's own list, no dangling links. */
  const normalise = (input: DeckSlide[], media: DeckMedia[], base: DeckSlide[]): DeckSlide[] => {
    const ids = new Set<string>();
    for (const s of input) {
      if (ids.has(s.id))
        throw new HttpError('invalid_input', MESSAGES.duplicate, { reason: 'duplicate_slide_id' });
      ids.add(s.id);
    }
    if (base.some((b) => b.kind === 'credits') && !input.some((s) => s.kind === 'credits'))
      throw new HttpError('invalid_input', MESSAGES.credits, { reason: 'credits_slide_required' });
    if (base.some((b) => b.kind === 'cover') && !input.some((s) => s.kind === 'cover'))
      throw new HttpError('invalid_input', MESSAGES.cover, { reason: 'cover_slide_required' });
    const mediaBySlug = new Map(media.map((m) => [m.slug, m]));
    const baseIds = new Set(base.map((b) => b.id));
    return input.map((raw) => {
      const s = tidySlide(raw);
      const drawing = s.image ? mediaBySlug.get(s.image.slug) : undefined;
      return {
        ...s,
        image: s.image && drawing ? { slug: drawing.slug, alt: s.image.alt || drawing.alt } : null,
        revealOf: s.revealOf !== null && ids.has(s.revealOf) ? s.revealOf : null,
        sourceId: s.sourceId !== null && baseIds.has(s.sourceId) ? s.sourceId : null,
      };
    });
  };

  const putDrawings = (store: DeckStore, drawings: DeckDrawing[]) => {
    for (const d of drawings)
      store.putMedia({
        sha256: d.sha256,
        bytes: d.bytes,
        width: d.width,
        height: d.height,
        mime: 'image/png',
      });
  };

  /** My copy of a pack's deck in a language: the one I have, else a new one made from the library now. */
  const copyOfPack = (ctx: Ctx, packId: string, lang: PackLang): DeckRow => {
    const user = requireUser(ctx);
    if (!PACK_ID.test(packId))
      throw new HttpError('not_found', 'This teaching pack does not exist.');
    // The Mathematics pilot is shown from its own checked slide pictures. Tala's slide layout was written for
    // the Science decks and would draw a mathematics diagram differently, so no copy is made from it here.
    if (packSubjectOf(packId) !== 'science')
      throw new HttpError(
        'not_found',
        'These slides cannot be copied in Tala yet. Download the PowerPoint file to change them.'
      );
    const store = storeFor(ctx.db);
    // My copy is mine whatever the library does next: it is answered before the library is even looked at.
    const mine = store.latestCopy(user.id, packId, lang);
    if (mine) return mine;
    const { seed, drawings } = seedFromLibrary(ctx, packId, lang);
    const id = ctx.newId();
    const now = ctx.now().toISOString();
    ctx.db.transaction(() => {
      putDrawings(store, drawings);
      store.insert({
        id,
        ownerId: user.id,
        packId,
        language: lang,
        seed,
        now,
      });
    })();
    ctx.log.info('deck_copied', {
      deckId: id,
      packId,
      language: lang,
      slides: seed.slides.length,
    });
    return store.get(user.id, id)!;
  };

  /** A deck and everything kept for it: links to lessons, earlier versions, proposals; then unused drawings. */
  const removeDeck = (db: Database, ownerId: string, deckId: string): boolean =>
    db.transaction(() => {
      const store = storeFor(db);
      const done = store.remove(ownerId, deckId);
      if (done) {
        lessonStoreFor(db).forgetDeck(ownerId, deckId);
        store.sweepMedia();
      }
      return done;
    })();

  // A lesson's presentation: links, AI proposals, earlier versions, multi-grade sessions (lessons.ts).
  const lessons = createLessons({ storeFor, copyOfPack, normalise, detail, removeDeck });

  return {
    name: 'decks',
    migrations: [...decksMigrations, ...uploads.migrations, ...lessonMigrations],
    start: (deps) => {
      const stopUploads = uploads.start?.(deps);
      const stopLessons = lessons.start(deps);
      return () => {
        stopLessons();
        stopUploads?.();
      };
    },
    handlers: {
      ...uploads.handlers,
      ...lessons.handlers,
      'decks.list': (ctx) => ({ decks: storeFor(ctx.db).list(requireUser(ctx).id) }),

      'decks.create': (ctx, { body }) => detail(ctx, copyOfPack(ctx, body.packId, body.lang)),

      'decks.get': (ctx, { params }) => {
        const row = storeFor(ctx.db).get(requireUser(ctx).id, params.deckId);
        if (!row) throw notFound();
        return detail(ctx, row);
      },

      'decks.save': (ctx, { params, body }): DeckSaveResult => {
        const user = requireUser(ctx);
        const store = storeFor(ctx.db);
        const row = store.get(user.id, params.deckId);
        if (!row) throw notFound();
        const stale = () =>
          new HttpError('conflict', MESSAGES.conflict, {
            reason: 'deck_changed_elsewhere',
            rev: row.rev,
            updatedAt: row.updated_at,
          });
        if (!body.force && body.baseRev !== row.rev) throw stale();
        const base = JSON.parse(row.base_slides_json) as DeckSlide[];
        const slides = normalise(body.slides, JSON.parse(row.media_json) as DeckMedia[], base);
        const title = (body.title !== undefined && oneLine(body.title)) || row.title;
        const changedSlides = changedSlideCount(slides, base);
        const rev = row.rev + 1;
        const now = ctx.now().toISOString();
        if (
          !store.save({
            ownerId: user.id,
            id: row.id,
            title,
            slides,
            changedSlides,
            rev,
            now,
            expectRev: body.force ? null : row.rev,
          })
        )
          throw stale();
        return { rev, updatedAt: now, changedSlides };
      },

      'decks.reset': (ctx, { params }) => {
        const user = requireUser(ctx);
        const store = storeFor(ctx.db);
        const row = store.get(user.id, params.deckId);
        if (!row) throw notFound();
        if (row.origin === 'lesson')
          throw new HttpError('not_found', MESSAGES.lessonDeck, { reason: 'lesson_deck' });
        let fresh: ReturnType<typeof seedFromLibrary>;
        try {
          fresh = seedFromLibrary(ctx, row.pack_id, row.language);
        } catch (err) {
          // The pack left the library, or this account may no longer open it: say so, and leave the copy alone.
          if (err instanceof HttpError && err.code === 'not_found')
            throw new HttpError('not_found', MESSAGES.originalGone, {
              reason: 'original_unavailable',
            });
          throw err;
        }
        const now = ctx.now().toISOString();
        ctx.db.transaction(() => {
          // Starting over is undoable: the copy as it was is kept as an earlier version first.
          lessonStoreFor(ctx.db).addRevision({
            id: ctx.newId(),
            ownerId: user.id,
            deckId: row.id,
            reason: 'reset',
            title: row.title,
            slides: JSON.parse(row.slides_json) as DeckSlide[],
            deckRev: row.rev,
            now,
          });
          putDrawings(store, fresh.drawings);
          store.reseed({ ownerId: user.id, id: row.id, seed: fresh.seed, rev: row.rev + 1, now });
          store.sweepMedia();
        })();
        ctx.log.info('deck_reset', { deckId: row.id, packId: row.pack_id, language: row.language });
        return detail(ctx, store.get(user.id, row.id)!);
      },

      'decks.delete': (ctx, { params }) => {
        const user = requireUser(ctx);
        const removed = removeDeck(ctx.db, user.id, params.deckId);
        if (!removed) throw notFound();
        ctx.log.info('deck_deleted', { deckId: params.deckId });
        return { ok: true as const };
      },

      /** A drawing of my copy, exactly as stored (the watermarked derivative). Displays inline. */
      'decks.media': (ctx, { params }) => {
        const store = storeFor(ctx.db);
        const media = store.media(requireUser(ctx).id, params.deckId);
        if (!media) throw notFound();
        const entry = media.find((m) => m.slug === params.slug);
        const stored = entry ? store.getMedia(entry.sha256) : null;
        if (!stored)
          throw new HttpError('not_found', MESSAGES.noDrawing, { reason: 'drawing_not_in_deck' });
        return { binary: stored.bytes, contentType: stored.mime, cacheControl: 'private, max-age=86400' };
      },

      /** My copy as an editable PowerPoint file, from the saved slides and nothing else. */
      'decks.pptx': (ctx, { params }) => {
        const store = storeFor(ctx.db);
        const row = store.get(requireUser(ctx).id, params.deckId);
        if (!row) throw notFound();
        const deck = rowToDeck(row);
        const slides = layoutDeck(layoutInputFromDeck(deck, { baseSlides: JSON.parse(row.base_slides_json) as DeckSlide[] }));
        const shaBySlug = new Map(deck.media.map((m) => [m.slug, m.sha256]));
        const drawings = new Map<string, DeckDrawingBytes>();
        for (const slide of slides)
          for (const item of slide.items) {
            if (
              item.type !== 'image' ||
              item.source.kind !== 'drawing' ||
              drawings.has(item.source.slug)
            )
              continue;
            const sha = shaBySlug.get(item.source.slug);
            const stored = sha ? store.getMedia(sha) : null;
            if (stored)
              drawings.set(item.source.slug, {
                bytes: stored.bytes,
                width: stored.width,
                height: stored.height,
              });
          }
        const lesson = deck.origin === 'lesson';
        return {
          binary: writeDeckPptx({
            title: lesson
              ? `${deck.title} — Grade ${deck.grade} ${deck.subject}`.trim()
              : `${deck.title} — Grade ${deck.grade} Science, Term ${deck.term}, Week ${deck.week}`,
            language: deck.language,
            slides,
            drawings,
            createdAt: deck.createdAt,
            modifiedAt: deck.updatedAt,
          }),
          contentType: PPTX_CONTENT_TYPE,
          filename: lesson
            ? `tala-lesson-${deck.id.replace(/[^A-Za-z0-9-]/g, '').slice(0, 24)}-${deck.language}.pptx`
            : `tala-${deck.packId.replace(/^sci26-/, '')}-${deck.language}-my-copy.pptx`,
        };
      },
    },
    /** A deleted account takes its copies with it; drawings no copy shows any more go too (PRIV-6). */
    onAccountDeleted: (deps, userId) => {
      const store = storeFor(deps.db);
      lessonStoreFor(deps.db).removeOwner(userId);
      if (store.removeOwner(userId) > 0) store.sweepMedia();
      uploads.onAccountDeleted?.(deps, userId);
    },
    /** Two accounts of one teacher joined: the copies follow (both are kept when each had one of the same pack). */
    onAccountMerged: (deps, fromUserId, toUserId) => {
      storeFor(deps.db).moveOwner(fromUserId, toUserId);
      lessonStoreFor(deps.db).moveOwner(fromUserId, toUserId);
      uploads.onAccountMerged?.(deps, fromUserId, toUserId);
    },
  };
}

export const decksModule = createDecksModule();
