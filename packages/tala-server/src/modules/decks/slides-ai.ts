/**
 * AI slides for a lesson (27 Nov 2026): the model's input, the shape its answer must have, and how an answer becomes
 * deck slides. The model writes words only. The server decides everything else: slide ids, days, which kinds are
 * allowed, the answer slide of every check, and pictures (only the deck's own drawings, by slug; a slug the deck does
 * not have is dropped, never invented). An empty or unusable answer fails validation, so the gateway retries once
 * and then reports `invalid_output`; nothing is written into a deck by any of this (see lessons.ts: proposals).
 *
 * Prompts: prompts/slides/deck.v1.md (a lesson's slides, new or rewritten) and prompts/slides/slide.v1.md (one slide).
 */
import { z } from 'zod';
import { DECK_LIMITS } from '@hiraia/tala-core/contracts';
import type { DeckMedia, DeckSlide, PackLang } from '@hiraia/tala-core/contracts';
import { cleanLine, type LessonForSlides } from '@hiraia/tala-core/decks';
import type { LlmRequest } from '../../kernel/types';

/** Kinds the model may write. Covers, day openers, answer slides and credits are the server's. */
export const AI_KINDS = ['question', 'concept', 'vocabulary', 'activity', 'check', 'summary'] as const;
export type AiKind = (typeof AI_KINDS)[number];

const line = (max: number) => z.string().trim().min(1).max(max);
export const AiSlide = z.object({
  kind: z.enum(AI_KINDS),
  title: line(120),
  lines: z.array(line(220)).max(6),
  /** check only: 2–4 choices. */
  choices: z.array(line(140)).max(4),
  /** check only: index of the right choice. */
  answer: z.number().int().min(0).max(3).nullable(),
  /** check only: one sentence on why. */
  explanation: z.string().max(260),
  /** For the teacher. */
  notes: z.string().max(1200),
  /** A slug from the pictures in the input, or null. */
  picture: z.string().max(120).nullable(),
});
export type AiSlide = z.infer<typeof AiSlide>;

export const DECK_MIN_SLIDES = 4;
export const DECK_MAX_SLIDES = 14;
export const AiDeck = z.object({ slides: z.array(AiSlide).min(DECK_MIN_SLIDES).max(DECK_MAX_SLIDES) });
export type AiDeck = z.infer<typeof AiDeck>;
export const AiOneSlide = z.object({ slide: AiSlide });
export type AiOneSlide = z.infer<typeof AiOneSlide>;

/** Rules a schema cannot say. Codes only (they are sent back to the model as data on the retry). */
export function slideProblems(s: AiSlide, i: number, keepKind?: AiKind): string[] {
  const out: string[] = [];
  if (keepKind && s.kind !== keepKind) out.push(`slide ${i}: kind must stay ${keepKind}`);
  if (s.kind === 'check') {
    if (s.choices.length < 2) out.push(`slide ${i}: a check needs 2 to 4 choices`);
    if (s.answer === null || s.answer >= s.choices.length) out.push(`slide ${i}: answer must be the index of one of its choices`);
  }
  if (s.kind !== 'check' && s.kind !== 'question' && !s.lines.length) out.push(`slide ${i}: needs at least one line`);
  return out;
}

/** What the model sees of a deck slide (words only). */
export function slideForModel(s: DeckSlide, reveal: DeckSlide | null): Record<string, unknown> {
  return {
    kind: s.kind,
    title: s.title,
    lines: s.lines,
    ...(s.kind === 'check' || s.kind === 'question' ? { choices: s.choices } : {}),
    ...(reveal ? { answer: reveal.correctChoice, explanation: reveal.lines.join(' ') } : {}),
    picture: s.image?.slug ?? null,
  };
}

export interface DeckPromptInput {
  language: PackLang;
  lesson: LessonForSlides;
  /** Drawings the slides may show (a copy of a pack); none for a lesson's own deck. */
  pictures: DeckMedia[];
  /** The slides being rewritten (empty for new slides). */
  current: DeckSlide[];
  instruction: string;
  /** Different on every request, so asking again gives a new proposal rather than the cached one. */
  attempt: string;
}

const lessonVar = (lesson: LessonForSlides) => {
  // Empty parts are left out: less to read, nothing for the model to fill in.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(lesson)) if (!(v === '' || (Array.isArray(v) && !v.length))) out[k] = v;
  return out;
};

export function deckRequest(input: DeckPromptInput, opts: { userId: string; version?: number }): LlmRequest<AiDeck> {
  const reveals = new Map(input.current.filter((s) => s.kind === 'reveal' && s.revealOf).map((s) => [s.revealOf!, s]));
  return {
    feature: 'slides.generate',
    promptId: 'slides/deck',
    version: opts.version,
    userId: opts.userId,
    maxOutputTokens: 6000,
    vars: {
      lesson: JSON.stringify({
        language: input.language,
        lesson: lessonVar(input.lesson),
        pictures: input.pictures.map((p) => ({ slug: p.slug, shows: p.alt })),
        currentSlides: input.current.filter((s) => s.kind !== 'reveal' && s.kind !== 'cover' && s.kind !== 'day' && s.kind !== 'credits').map((s) => slideForModel(s, reveals.get(s.id) ?? null)),
      }),
      instruction: input.instruction,
      attempt: input.attempt,
    },
    schema: AiDeck,
    // A picture slug the deck does not have is simply dropped (toDeckSlides): not worth a second paid call.
    check: (value) => value.slides.flatMap((s, i) => slideProblems(s, i)),
  };
}

export interface SlidePromptInput {
  language: PackLang;
  lesson: LessonForSlides;
  pictures: DeckMedia[];
  slide: DeckSlide;
  reveal: DeckSlide | null;
  before: DeckSlide | null;
  after: DeckSlide | null;
  instruction: string;
  attempt: string;
}

export function slideRequest(input: SlidePromptInput, opts: { userId: string; version?: number }): LlmRequest<AiOneSlide> {
  const kind = input.slide.kind as AiKind;
  return {
    feature: 'slides.rewrite',
    promptId: 'slides/slide',
    version: opts.version,
    userId: opts.userId,
    maxOutputTokens: 1500,
    vars: {
      slide: JSON.stringify({
        language: input.language,
        slide: slideForModel(input.slide, input.reveal),
        slideBefore: input.before ? { kind: input.before.kind, title: input.before.title } : null,
        slideAfter: input.after ? { kind: input.after.kind, title: input.after.title } : null,
        pictures: input.pictures.map((p) => ({ slug: p.slug, shows: p.alt })),
      }),
      lesson: JSON.stringify(lessonVar(input.lesson)),
      instruction: input.instruction,
      attempt: input.attempt,
    },
    schema: AiOneSlide,
    check: (value) => slideProblems(value.slide, 0, kind),
  };
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** `n` + 8 random [a-z0-9], never one already taken (the editor makes the same kind of id). */
export function slideIdMaker(taken: Iterable<string>, random: () => number = Math.random): () => string {
  const used = new Set(taken);
  return () => {
    for (;;) {
      let id = 'n';
      for (let i = 0; i < 8; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max).trimEnd() : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The model's slides as deck slides: every check followed by its answer slide, lines tidied to the deck's limits,
 * pictures only from the deck's own drawings. `original`: the slides count as the deck's own "as made" slides (a
 * lesson's deck); otherwise they are new slides in a copy of a pack (which keeps the Hiraia original as its base).
 */
export function toDeckSlides(slides: AiSlide[], opts: { day: number; media: DeckMedia[]; newId: () => string; original: boolean }): DeckSlide[] {
  const bySlug = new Map(opts.media.map((m) => [m.slug, m]));
  const out: DeckSlide[] = [];
  for (const s of slides) {
    const id = opts.newId();
    const drawing = s.picture ? bySlug.get(s.picture) : undefined;
    const lines = s.lines.map((l) => clip(cleanLine(oneLine(l)), DECK_LIMITS.line)).filter(Boolean).slice(0, DECK_LIMITS.lines);
    const check = s.kind === 'check';
    out.push({
      id,
      day: opts.day,
      kind: s.kind,
      title: clip(oneLine(s.title), DECK_LIMITS.title),
      lines,
      choices: check ? s.choices.map((c) => clip(cleanLine(oneLine(c)), DECK_LIMITS.choice)).filter(Boolean).slice(0, DECK_LIMITS.choices) : [],
      revealOf: null,
      correctChoice: null,
      image: drawing && !check ? { slug: drawing.slug, alt: drawing.alt } : null,
      notes: clip(s.notes.replace(/\r\n?/g, '\n').trim(), DECK_LIMITS.notes),
      sourceId: opts.original ? id : null,
    });
    if (check) {
      const rid = opts.newId();
      out.push({
        id: rid,
        day: opts.day,
        kind: 'reveal',
        title: clip(oneLine(s.title), DECK_LIMITS.title),
        lines: s.explanation.trim() ? [clip(oneLine(s.explanation), DECK_LIMITS.line)] : [],
        choices: [],
        revealOf: id,
        correctChoice: s.answer !== null && s.answer < s.choices.length ? s.answer : null,
        image: null,
        notes: '',
        sourceId: opts.original ? rid : null,
      });
    }
  }
  return out;
}

/** One rewritten slide in place of the old one: same id, day and origin; a check's answer slide updated with it. */
export function rewrittenSlide(old: DeckSlide, reveal: DeckSlide | null, s: AiSlide, media: DeckMedia[]): DeckSlide[] {
  const drawing = s.picture ? media.find((m) => m.slug === s.picture) : undefined;
  const check = old.kind === 'check';
  const next: DeckSlide = {
    ...old,
    title: clip(oneLine(s.title), DECK_LIMITS.title),
    lines: s.lines.map((l) => clip(cleanLine(oneLine(l)), DECK_LIMITS.line)).filter(Boolean).slice(0, DECK_LIMITS.lines),
    choices: check || old.kind === 'question' ? s.choices.map((c) => clip(cleanLine(oneLine(c)), DECK_LIMITS.choice)).filter(Boolean).slice(0, DECK_LIMITS.choices) : [],
    image: drawing && !(check && s.choices.length) ? { slug: drawing.slug, alt: drawing.alt } : null,
    notes: clip(s.notes.replace(/\r\n?/g, '\n').trim(), DECK_LIMITS.notes),
  };
  if (!reveal) return [next];
  return [
    next,
    {
      ...reveal,
      title: next.title,
      lines: s.explanation.trim() ? [clip(oneLine(s.explanation), DECK_LIMITS.line)] : reveal.lines,
      correctChoice: s.answer !== null && s.answer < next.choices.length ? s.answer : null,
    },
  ];
}
