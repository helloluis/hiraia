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

/** Printed on the credits slide: who reviewed the original (if anyone) and where its sources are listed. */
export const DeckCredits = z.object({ reviewer: z.string().max(200).nullable(), sourcesLine: z.string().max(600) });
export type DeckCredits = z.infer<typeof DeckCredits>;

/**
 * Where a deck's slides came from: `pack` = a teacher's copy of a pack's deck; `lesson` = slides Tala made with AI
 * from one of the teacher's own lesson plans (a lesson with no pack: English, Reading and Literacy, Grade 11 …).
 */
export const DeckOrigin = z.enum(['pack', 'lesson']);
export type DeckOrigin = z.infer<typeof DeckOrigin>;

export const Deck = z.object({
  id: Id,
  /** The pack a copy was made from; '' for a deck made from a lesson. */
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
  credits: DeckCredits,
  slides: z.array(DeckSlide).min(1).max(DECK_LIMITS.slides),
  /** Drawings this deck may show, by slug. */
  media: z.array(DeckMedia).max(80),
  /** Bumped by the server on every save; a save must name the rev it started from. */
  rev: z.number().int().min(1),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** Additive (27 Nov 2026). Older rows are copies of packs. */
  origin: DeckOrigin.default('pack'),
  /** The subject printed on a lesson's deck ('Science' for every pack copy). */
  subject: z.string().max(120).default('Science'),
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

/* ===================== a lesson's presentation (Luis, 27 Nov 2026) =====================
 * "Presentations should be displayed prominently in the Lesson Plan view, so the teacher already knows that they need
 * to edit it to coincide with their lesson plan. There should be an AI regeneration button on the slides too."
 * "Multigrade presentations should be dynamically assembled in the Lesson Plan view."
 *
 * A lesson plan (a synced record) is linked on the server to one of the teacher's own decks: her copy of the pack the
 * lesson fits, or slides Tala made with AI from the lesson itself. AI never writes into a deck by itself: it answers a
 * proposal the teacher looks at first; applying one keeps the deck as it was in the deck's revisions, so every earlier
 * version can be put back. When the lesson changes after its slides were made, the presentation says so (`stale`) and
 * changes nothing. A multi-grade session plan has no deck of its own: its slides are put together from each grade's
 * own lesson slides, in the order of the session's time blocks (decks/assemble.ts), every time they are shown.
 */

/** Which deck a lesson plan uses, and which of its slides are the lesson's. */
export const LessonLink = z.object({
  planId: Id,
  deckId: Id,
  /** 0: every slide of the deck is this lesson's; 1–5: only that day's slides (a copy of a pack holds a whole week). */
  day: z.number().int().min(0).max(5),
  linkedAt: IsoDateTime,
  /** When the slides were last made to match the lesson as it was saved then (linked, made or rewritten with AI, or checked by the teacher). */
  matchedAt: IsoDateTime,
});
export type LessonLink = z.infer<typeof LessonLink>;

/** One lesson's slides as the lesson uses them, with what the shared layout needs to draw them. */
export const LessonSlides = z.object({
  deckId: Id,
  origin: DeckOrigin,
  packId: z.string(),
  language: PackLang,
  /** The deck's name (her copy's title). */
  title: z.string(),
  grade: z.string(),
  term: z.number().int(),
  week: z.number().int(),
  subject: z.string(),
  sourceApproved: z.boolean(),
  credits: DeckCredits,
  /** The slides of this lesson, in deck order (a day's slides and the credits slide; or the whole deck). */
  slides: z.array(DeckSlide).max(DECK_LIMITS.slides),
  /** Slides in the whole deck. */
  deckSlideCount: z.number().int(),
  /** Days the deck has slides for (a copy of a pack: 1–5), for choosing which day is this lesson's. */
  days: z.array(z.number().int().min(1).max(5)).max(5),
  media: z.array(DeckMedia).max(80),
  /** The deck differs from what was first copied or made (the credits then say it was edited by its teacher). */
  edited: z.boolean(),
  rev: z.number().int(),
  updatedAt: IsoDateTime,
});
export type LessonSlides = z.infer<typeof LessonSlides>;

/** One grade's part of a multi-grade session: that grade's own lesson and its slides. */
export const SessionPart = z.object({
  groupId: Id,
  grade: z.string(),
  /** The grade's own lesson the part comes from; null when none could be found (she can choose one). */
  source: z
    .object({
      planId: Id,
      title: z.string().max(200),
      /** auto: the grade's lesson placed on the same class and day (or with the same competencies); teacher: her choice. */
      chosen: z.enum(['auto', 'teacher']),
    })
    .nullable(),
  link: LessonLink.nullable(),
  /** Null when that lesson has no slides yet. */
  slides: LessonSlides.nullable(),
  /** That lesson changed after its slides were made. */
  stale: z.boolean(),
});
export type SessionPart = z.infer<typeof SessionPart>;

/** What an AI request covers: new slides for a lesson that has none, all of a lesson's slides, or one slide. */
export const SlidesAiScope = z.enum(['new', 'lesson', 'slide']);
export type SlidesAiScope = z.infer<typeof SlidesAiScope>;

/** Why an AI request gave no proposal. Every one leaves the slides exactly as they were. */
export const SlidesAiFailure = z.enum([
  /** AI help is switched off on this server. */
  'disabled',
  /** No model answered (network, provider down, timeout). */
  'providers_unavailable',
  /** The model's answer was empty or unusable, also after a retry. */
  'invalid_output',
  /** Today's AI allowance for this teacher is used up. */
  'quota_exceeded',
  /** This month's AI budget is used up. */
  'budget_exceeded',
  /** The server restarted while the request was being worked on. */
  'interrupted',
  /** The lesson or its slides are no longer there. */
  'gone',
]);
export type SlidesAiFailure = z.infer<typeof SlidesAiFailure>;

export const SlidesJob = z.object({
  id: Id,
  planId: Id,
  /** The deck the proposal is for; null for new slides (the deck is made when the proposal is applied). */
  deckId: Id.nullable(),
  scope: SlidesAiScope,
  slideId: z.string().nullable(),
  /** queued/running: being worked on · ready: a proposal waits for the teacher · applied/discarded: she chose · failed. */
  status: z.enum(['queued', 'running', 'ready', 'failed', 'applied', 'discarded']),
  createdAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  /** ready: what would replace what. Nothing is written until the teacher applies it. */
  proposal: z
    .object({
      language: PackLang,
      slides: z.array(DeckSlide).max(DECK_LIMITS.slides),
      /** Ids of the slides these replace (empty for new slides). */
      replaces: z.array(z.string()).max(DECK_LIMITS.slides),
    })
    .nullable(),
  failure: z.object({ reason: SlidesAiFailure, message: z.string().max(400) }).nullable(),
});
export type SlidesJob = z.infer<typeof SlidesJob>;

export const LessonPresentation = z.object({
  planId: Id,
  /** `session`: a multi-grade plan; its slides are put together from `parts` every time they are shown. */
  kind: z.enum(['lesson', 'session']),
  link: LessonLink.nullable(),
  slides: LessonSlides.nullable(),
  /** The lesson changed after its slides were made to match it. A cue only: nothing is changed by it. */
  stale: z.boolean(),
  /** A session's grades, in the plan's order (empty for a single lesson). */
  parts: z.array(SessionPart).max(4),
  /** The newest AI request for this lesson that is still being worked on or waits to be looked at. */
  job: SlidesJob.nullable(),
});
export type LessonPresentation = z.infer<typeof LessonPresentation>;

/** Use my copy of a pack's deck for this lesson (the copy is made when I have none); `day` 0 = the whole deck. */
export const LessonLinkRequest = z.object({
  packId: z.string().max(40),
  lang: PackLang,
  day: z.number().int().min(0).max(5),
});
export type LessonLinkRequest = z.infer<typeof LessonLinkRequest>;

/** A grade's lesson for a session part; null = let Tala find it again. */
export const SessionSourceRequest = z.object({ planId: Id.nullable() });
export type SessionSourceRequest = z.infer<typeof SessionSourceRequest>;

export const SlidesAiRequest = z.object({
  scope: SlidesAiScope,
  /** For `slide`: which slide. */
  slideId: DeckSlideId.optional(),
  /** Optional words from the teacher ("use simpler words"). Passed to the model as data. */
  instruction: z.string().max(300).default(''),
});
export type SlidesAiRequest = z.infer<typeof SlidesAiRequest>;

export const SlidesApplyRequest = z.object({
  /** Apply although the slides it replaces changed after the proposal was made (the teacher chose to). */
  force: z.boolean().default(false),
});
export type SlidesApplyRequest = z.infer<typeof SlidesApplyRequest>;

/** An earlier version of a deck, kept before AI slides were applied, a version was put back, or the copy started over. */
export const DeckRevisionMeta = z.object({
  id: Id,
  reason: z.enum(['ai', 'restore', 'reset']),
  createdAt: IsoDateTime,
  title: z.string(),
  slideCount: z.number().int(),
});
export type DeckRevisionMeta = z.infer<typeof DeckRevisionMeta>;

export const DeckRevisionList = z.object({ revisions: z.array(DeckRevisionMeta).max(50) });
export type DeckRevisionList = z.infer<typeof DeckRevisionList>;
