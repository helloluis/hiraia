/**
 * A teacher's own copy of a teaching pack's slide deck ("My copy"; Luis, 19 Nov 2026: "allow each teacher to go in
 * and make edits to a slide right inside the platform … Those edits are unique to their copy of the slides and will
 * not propagate anywhere else").
 *
 * The Hiraia original (packs.ts) is shared, read-only reference content. A personal deck is a full, self-contained
 * copy owned by one account: it keeps working when the library is refreshed, replaced or the pack is withdrawn.
 * It is never public and never shared; every read, write and export is checked against the owning account on the
 * server. Drawings are referenced by slug and resolved from the deck's own media list (the Hiraia-watermarked
 * derivative embedded in the original deck), so the watermark travels with every copy.
 *
 * OWNER: teacher-portal UI rework (branch tala-v1-teacher-ui).
 */
import { z } from 'zod';
import { Id, IsoDateTime } from './common';
import { PackLang, SlideKind } from './packs';

/** Limits for what a teacher may type. Wider than the generation limits (packs.ts): the layout shrinks text to fit. */
export const DECK_LIMITS = {
  slides: 120,
  title: 140,
  line: 260,
  lines: 8,
  choice: 200,
  choices: 4,
  notes: 6000,
  deckTitle: 160,
} as const;

/** Slide ids: the original's `d<day>s<n>`, or `n<random>` for a slide the teacher added or duplicated. */
export const DeckSlideId = z.string().regex(/^(d[0-5]s\d{1,2}|n[a-z0-9]{4,16})$/);

export const DeckSlide = z.object({
  id: DeckSlideId,
  day: z.number().int().min(0).max(5),
  kind: SlideKind,
  /** May be empty while a teacher is typing; an empty title is simply not drawn. */
  title: z.string().max(DECK_LIMITS.title),
  lines: z.array(z.string().max(DECK_LIMITS.line)).max(DECK_LIMITS.lines).default([]),
  choices: z.array(z.string().max(DECK_LIMITS.choice)).max(DECK_LIMITS.choices).default([]),
  /** For `reveal`: the id of the `check` slide it answers (kept when slides move; null when that slide is gone). */
  revealOf: z.string().nullable().default(null),
  correctChoice: z.number().int().min(0).max(3).nullable().default(null),
  /** A drawing from this deck's media list, or none. Teachers can remove or re-add a drawing, not upload one. */
  image: z.object({ slug: z.string().max(120), alt: z.string().max(300) }).nullable().default(null),
  /** Teacher-only speaker notes. */
  notes: z.string().max(DECK_LIMITS.notes).default(''),
  /** The original slide this one started from; null for a slide the teacher added. */
  sourceId: z.string().nullable().default(null),
});
export type DeckSlide = z.infer<typeof DeckSlide>;

export const DeckMedia = z.object({
  slug: z.string().max(120),
  /** SHA-256 of the exact embedded bytes (the watermarked derivative), also its key in the media store. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  alt: z.string().max(300),
});
export type DeckMedia = z.infer<typeof DeckMedia>;

export const Deck = z.object({
  id: Id,
  packId: z.string(),
  language: PackLang,
  /** The teacher's name for this copy; starts as the pack title. */
  title: z.string().max(DECK_LIMITS.deckTitle),
  grade: z.string(),
  term: z.number().int(),
  week: z.number().int(),
  /** Whether the original was approved by a named teacher when this copy was made (drives the draft label). */
  sourceApproved: z.boolean(),
  /** Content hash of the original this copy was made from. */
  baseContentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Printed on the credits slide: who reviewed the original (if anyone) and where its sources are listed. */
  credits: z.object({ reviewer: z.string().max(200).nullable(), sourcesLine: z.string().max(600) }),
  slides: z.array(DeckSlide).min(1).max(DECK_LIMITS.slides),
  /** Drawings this deck may show, by slug. */
  media: z.array(DeckMedia).max(80),
  /** Bumped by the server on every save; a save must name the rev it started from. */
  rev: z.number().int().min(1),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Deck = z.infer<typeof Deck>;

export const DeckSummary = z.object({
  id: Id,
  packId: z.string(),
  language: PackLang,
  title: z.string(),
  grade: z.string(),
  term: z.number().int(),
  week: z.number().int(),
  slideCount: z.number().int(),
  /** Slides that differ from the original they came from, plus slides the teacher added. */
  changedSlides: z.number().int(),
  rev: z.number().int(),
  updatedAt: IsoDateTime,
});
export type DeckSummary = z.infer<typeof DeckSummary>;

/** How the copy relates to the library's current original (for "the original was updated" notices). */
export const DeckOriginalState = z.object({
  /** The pack still exists in the library and the caller may open this language version. */
  available: z.boolean(),
  /** The original's content changed since this copy was made. */
  updated: z.boolean(),
});
export type DeckOriginalState = z.infer<typeof DeckOriginalState>;

export const DeckDetail = z.object({
  deck: Deck,
  /** The slides exactly as copied, for "what did I change?" and "put this slide back". Never changed by a save. */
  baseSlides: z.array(DeckSlide).max(DECK_LIMITS.slides),
  original: DeckOriginalState,
});
export type DeckDetail = z.infer<typeof DeckDetail>;

/** A save answers small: autosave runs often, on slow connections. */
export const DeckSaveResult = z.object({ rev: z.number().int(), updatedAt: IsoDateTime, changedSlides: z.number().int() });
export type DeckSaveResult = z.infer<typeof DeckSaveResult>;

export const DeckList = z.object({ decks: z.array(DeckSummary) });
export type DeckList = z.infer<typeof DeckList>;

export const DeckCreateRequest = z.object({ packId: z.string().max(40), lang: PackLang });
export type DeckCreateRequest = z.infer<typeof DeckCreateRequest>;

export const DeckSaveRequest = z.object({
  /** The rev this edit started from. A different stored rev answers `conflict` with `details: { rev, updatedAt }`. */
  baseRev: z.number().int().min(1),
  title: z.string().max(DECK_LIMITS.deckTitle).optional(),
  slides: z.array(DeckSlide).min(1).max(DECK_LIMITS.slides),
  /** Save even though the stored rev is newer (the teacher chose "keep my version"). */
  force: z.boolean().default(false),
});
export type DeckSaveRequest = z.infer<typeof DeckSaveRequest>;
