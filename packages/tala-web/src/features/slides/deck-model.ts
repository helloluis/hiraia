/**
 * Pure helpers for the slides screens (no React, no I/O): what a deck looks like to the viewer, how slides are
 * grouped by day, and the few operations a teacher can do on their own copy. Every operation returns a new array and
 * keeps the deck consistent: ids stay unique, an answer slide stays linked to its question, and the slides that give
 * a deck its shape (cover, day dividers, credits) stay where they are.
 */
import { DECK_LIMITS } from '@hiraia/tala-core/contracts';
import type { Deck, DeckSlide, PackDetail, PackLang, SlideKind } from '@hiraia/tala-core/contracts';
import { layoutDeck, layoutInputFromDeck, layoutInputFromPack, slideChanged, type SlideLayout, type TextItem } from '@hiraia/tala-core/decks';

/* ---------------- what the viewer shows ---------------- */

/** A deck ready to draw: the shared original of a pack, or a teacher's own copy. */
export interface DeckView {
  /** Changes whenever the slides do (used as a React key / memo key). */
  key: string;
  kind: 'original' | 'copy';
  title: string;
  language: PackLang;
  /** False while no named teacher has approved the content: the draft label stays visible. */
  approved: boolean;
  layouts: SlideLayout[];
  mediaUrl: (slug: string) => string;
}

const packViews = new WeakMap<PackDetail, DeckView>();

/** The shared original, laid out once per loaded pack (several strips on one page share it). */
export function viewOfPack(detail: PackDetail, mediaUrl: (slug: string) => string): DeckView {
  const hit = packViews.get(detail);
  if (hit) return hit;
  const input = layoutInputFromPack(detail.content, detail.review);
  const view: DeckView = {
    key: `pack:${detail.content.packId}:${detail.language}:${detail.review.contentSha256.slice(0, 12)}`,
    kind: 'original',
    title: detail.content.title,
    language: detail.language,
    approved: input.approved,
    layouts: layoutDeck(input),
    mediaUrl,
  };
  packViews.set(detail, view);
  return view;
}

type DeckForLayout = Pick<Deck, 'id' | 'title' | 'language' | 'grade' | 'term' | 'week' | 'sourceApproved' | 'credits' | 'slides'>;

/**
 * A teacher's copy. `editing` keeps empty text boxes so there is somewhere to click. `baseSlides` (the slides as
 * first copied) lets the credits say "edited by its teacher" only when the copy really differs.
 */
export function viewOfDeck(
  deck: DeckForLayout,
  mediaUrl: (slug: string) => string,
  opts: { editing?: boolean; stamp?: string | number; baseSlides?: DeckSlide[] } = {}
): DeckView {
  return {
    key: `deck:${deck.id}:${opts.stamp ?? ''}`,
    kind: 'copy',
    title: deck.title,
    language: deck.language,
    approved: deck.sourceApproved,
    layouts: layoutDeck(layoutInputFromDeck(deck, { editing: opts.editing, baseSlides: opts.baseSlides })),
    mediaUrl,
  };
}

/** The words of the slide's title box ('' when the slide has none). */
export function slideTitle(layout: SlideLayout): string {
  const t = layout.items.find((i): i is TextItem => i.type === 'text' && i.titlePlaceholder);
  return t ? t.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ') : '';
}

export interface SlideGroup {
  key: string;
  /** 0 = before Day 1 (cover) or the closing "about" slide. */
  day: number;
  part: 'intro' | 'day' | 'about';
  /** The day's own title (from its divider slide), when there is one. */
  title: string;
  layouts: SlideLayout[];
}

/** Slides in order, cut into Introduction, Day 1 … Day 5 and About, so a deck never reads as one endless grid. */
export function groupSlides(layouts: SlideLayout[]): SlideGroup[] {
  const groups: SlideGroup[] = [];
  for (const l of layouts) {
    const part: SlideGroup['part'] = l.day === 0 ? (l.kind === 'credits' ? 'about' : 'intro') : 'day';
    const last = groups[groups.length - 1];
    if (last && last.part === part && last.day === l.day) last.layouts.push(l);
    else groups.push({ key: `${part}-${l.day}-${groups.length}`, day: l.day, part, title: '', layouts: [l] });
  }
  for (const g of groups) {
    const divider = g.layouts.find((l) => l.kind === 'day');
    if (divider) g.title = slideTitle(divider);
  }
  return groups;
}

/* ---------------- editing a copy ---------------- */

/** Kinds a teacher can add. */
export const ADDABLE_KINDS = ['concept', 'question', 'activity', 'vocabulary'] as const;
export type AddableKind = (typeof ADDABLE_KINDS)[number];

/** Slides that give the deck its shape: they can be reworded (not the credits) but not moved or deleted. */
export const isAnchor = (s: Pick<DeckSlide, 'kind'>): boolean => s.kind === 'cover' || s.kind === 'day' || s.kind === 'credits';
/** The credits slide carries the art credit and the honest review label: it is not edited in the app. */
export const isLocked = (s: Pick<DeckSlide, 'kind'>): boolean => s.kind === 'credits';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** `n` + 8 random [a-z0-9], never one that is already in the deck. */
export function newSlideId(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    let id = 'n';
    for (let i = 0; i < 8; i++) id += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
    if (!used.has(id)) return id;
  }
}

/** The answer slide of a question slide, if it has one. */
export const revealOfCheck = (slides: DeckSlide[], checkId: string): DeckSlide | null => slides.find((s) => s.kind === 'reveal' && s.revealOf === checkId) ?? null;
/** The question slide an answer slide belongs to, if it is still in the deck. */
export const checkOfReveal = (slides: DeckSlide[], reveal: DeckSlide): DeckSlide | null => (reveal.revealOf ? (slides.find((s) => s.id === reveal.revealOf) ?? null) : null);

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** Limits applied to what a teacher typed, so a save is never refused for length. */
export function tidySlide(s: DeckSlide): DeckSlide {
  return {
    ...s,
    title: clip(s.title.replace(/\s*\n\s*/g, ' '), DECK_LIMITS.title),
    lines: s.lines.map((l) => clip(l.replace(/\s*\n\s*/g, ' '), DECK_LIMITS.line)).slice(0, DECK_LIMITS.lines),
    choices: s.choices.map((c) => clip(c.replace(/\s*\n\s*/g, ' '), DECK_LIMITS.choice)).slice(0, DECK_LIMITS.choices),
    notes: clip(s.notes, DECK_LIMITS.notes),
  };
}

/** What goes to the server: trimmed, empty lines and choices dropped, links to missing slides cleared. */
export function slidesForSave(slides: DeckSlide[]): DeckSlide[] {
  const ids = new Set(slides.map((s) => s.id));
  // Dropping a blank choice must not shift which answer is marked right on the linked answer slide.
  const remap = new Map<string, Array<number | null>>();
  const tidy = slides.map((raw) => {
    const s = tidySlide(raw);
    const choices = s.choices.map((c) => c.trim());
    if (choices.some((c) => !c)) {
      let n = 0;
      remap.set(s.id, choices.map((c) => (c ? n++ : null)));
    }
    return {
      ...s,
      title: s.title.trim(),
      lines: s.lines.map((l) => l.trim()).filter(Boolean),
      choices: choices.filter(Boolean),
      revealOf: s.revealOf && ids.has(s.revealOf) ? s.revealOf : null,
      notes: s.notes.trim(),
    };
  });
  return tidy.map((s) => {
    const map = s.kind === 'reveal' && s.revealOf ? remap.get(s.revealOf) : undefined;
    return map && s.correctChoice !== null ? { ...s, correctChoice: map[s.correctChoice] ?? null } : s;
  });
}

export function updateSlide(slides: DeckSlide[], id: string, patch: Partial<Omit<DeckSlide, 'id'>>): DeckSlide[] {
  return slides.map((s) => (s.id === id ? tidySlide({ ...s, ...patch }) : s));
}

/** Change a question's choices; the linked answer slide keeps pointing at the same choice (or at none if it went). */
export function setChoices(slides: DeckSlide[], checkId: string, choices: string[]): DeckSlide[] {
  const before = slides.find((s) => s.id === checkId)?.choices ?? [];
  const next = choices.slice(0, DECK_LIMITS.choices);
  return slides.map((s) => {
    if (s.id === checkId) return tidySlide({ ...s, choices: next });
    if (s.kind === 'reveal' && s.revealOf === checkId && s.correctChoice !== null) {
      if (next.length === before.length) return s;
      // One choice removed: find which, by the first position where the lists differ.
      if (next.length === before.length - 1) {
        let removed = before.length - 1;
        for (let i = 0; i < next.length; i++)
          if (next[i] !== before[i]) {
            removed = i;
            break;
          }
        if (s.correctChoice === removed) return { ...s, correctChoice: null };
        if (s.correctChoice > removed) return { ...s, correctChoice: s.correctChoice - 1 };
        return s;
      }
      return s.correctChoice < next.length ? s : { ...s, correctChoice: null };
    }
    return s;
  });
}

/** Mark which choice is right. It is stored on the answer slide that belongs to the question. */
export function setCorrectChoice(slides: DeckSlide[], checkId: string, index: number | null): DeckSlide[] {
  return slides.map((s) => (s.kind === 'reveal' && s.revealOf === checkId ? { ...s, correctChoice: index } : s));
}

const blank = (id: string, day: number, kind: SlideKind): DeckSlide => ({
  id, day, kind, title: '', lines: [], choices: [], revealOf: null, correctChoice: null, image: null, notes: '', sourceId: null,
});

/** The day a slide at `index` belongs to: the nearest day divider before it (0 before Day 1). */
function dayAt(slides: DeckSlide[], index: number): number {
  for (let i = index - 1; i >= 0; i--) if (slides[i]!.kind === 'day') return slides[i]!.day;
  return 0;
}

/**
 * A new slide right after `afterId` (after its answer slide when `afterId` is a question that has one; before the
 * credits when `afterId` is the credits), in the same day.
 */
export function addSlide(slides: DeckSlide[], afterId: string, kind: AddableKind, id: string): { slides: DeckSlide[]; index: number } {
  let at = slides.findIndex((s) => s.id === afterId);
  if (at < 0) at = slides.length - 1;
  const after = slides[at]!;
  if (after.kind === 'credits') at -= 1;
  else if (after.kind === 'check' || after.kind === 'question') {
    const r = slides.findIndex((s) => s.kind === 'reveal' && s.revealOf === after.id);
    if (r === at + 1) at = r;
  }
  const next = slides.slice();
  const index = Math.max(0, at + 1);
  next.splice(index, 0, blank(id, 0, kind));
  next[index] = { ...next[index]!, day: dayAt(next, index) };
  return { slides: next, index };
}

/**
 * A copy of a slide right after it. A question is copied together with its answer slide (the copy's answer points
 * at the copied question), so no answer slide ever shows another question's choices.
 */
export function duplicateSlide(slides: DeckSlide[], id: string, makeId: (taken: Iterable<string>) => string): { slides: DeckSlide[]; index: number } | null {
  const at = slides.findIndex((s) => s.id === id);
  const src = slides[at];
  if (!src || isAnchor(src)) return null;
  const taken = new Set(slides.map((s) => s.id));
  const copyId = makeId(taken);
  taken.add(copyId);
  const copy: DeckSlide = { ...src, id: copyId, lines: [...src.lines], choices: [...src.choices], image: src.image ? { ...src.image } : null, sourceId: null };
  const next = slides.slice();
  const reveal = src.kind === 'check' || src.kind === 'question' ? revealOfCheck(slides, src.id) : null;
  if (reveal) {
    const rAt = slides.findIndex((s) => s.id === reveal.id);
    const insert = Math.max(at, rAt) + 1;
    const revealCopy: DeckSlide = { ...reveal, id: makeId(taken), lines: [...reveal.lines], choices: [...reveal.choices], image: reveal.image ? { ...reveal.image } : null, revealOf: copyId, sourceId: null };
    next.splice(insert, 0, copy, revealCopy);
    return { slides: next, index: insert };
  }
  if (src.kind === 'reveal') {
    // An answer slide on its own: the copy answers the same question.
    next.splice(at + 1, 0, copy);
    return { slides: next, index: at + 1 };
  }
  next.splice(at + 1, 0, copy);
  return { slides: next, index: at + 1 };
}

export const canDelete = (slides: DeckSlide[], id: string): boolean => {
  const s = slides.find((x) => x.id === id);
  return Boolean(s) && !isAnchor(s!) && slides.length > 1;
};

/** Remove a slide; a question takes its answer slide with it. Returns what was removed, for Undo. */
export function deleteSlide(slides: DeckSlide[], id: string): { slides: DeckSlide[]; removed: string[]; index: number } | null {
  if (!canDelete(slides, id)) return null;
  const s = slides.find((x) => x.id === id)!;
  const gone = new Set([id]);
  if (s.kind === 'check' || s.kind === 'question') for (const r of slides) if (r.kind === 'reveal' && r.revealOf === id) gone.add(r.id);
  const index = slides.findIndex((x) => x.id === id);
  const next = slides.filter((x) => !gone.has(x.id));
  return { slides: next, removed: [...gone], index: Math.min(index, next.length - 1) };
}

/** A slide can move one place when it and the slide it would pass are not the cover or the credits. */
export function canMove(slides: DeckSlide[], id: string, dir: -1 | 1): boolean {
  const at = slides.findIndex((s) => s.id === id);
  const s = slides[at];
  const other = slides[at + dir];
  if (!s || !other || isAnchor(s)) return false;
  return other.kind !== 'cover' && other.kind !== 'credits';
}

/** Move one place earlier or later. Passing a day divider moves the slide into that day. */
export function moveSlide(slides: DeckSlide[], id: string, dir: -1 | 1): { slides: DeckSlide[]; index: number } | null {
  if (!canMove(slides, id, dir)) return null;
  const at = slides.findIndex((s) => s.id === id);
  const next = slides.slice();
  const [s] = next.splice(at, 1);
  next.splice(at + dir, 0, s!);
  next[at + dir] = { ...s!, day: dayAt(next, at + dir) };
  return { slides: next, index: at + dir };
}

/** The slide as it was when the copy was made (same place in the deck), or null when it was added by the teacher. */
export function baseOf(slide: DeckSlide, base: DeckSlide[]): DeckSlide | null {
  return slide.sourceId && slide.sourceId === slide.id ? (base.find((b) => b.id === slide.id) ?? null) : null;
}

export function restoreSlide(slides: DeckSlide[], id: string, base: DeckSlide[]): DeckSlide[] {
  return slides.map((s) => {
    if (s.id !== id) return s;
    const b = baseOf(s, base);
    return b ? { ...b, day: s.day } : s;
  });
}

/** Ids of slides that differ from what was copied, and of slides the teacher added. */
export function changedIds(slides: DeckSlide[], base: DeckSlide[]): Set<string> {
  const byId = new Map(base.map((b) => [b.id, b]));
  const out = new Set<string>();
  for (const s of slides) {
    const b = s.sourceId && s.sourceId === s.id ? byId.get(s.id) : undefined;
    if (!b || slideChanged(s, b)) out.add(s.id);
  }
  return out;
}

export const sameSlides = (a: DeckSlide[], b: DeckSlide[]): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/* ---------------- undo history ---------------- */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Consecutive edits with the same tag inside the window fold into one undo step (typing in one field). */
  tag: string | null;
  at: number;
}
const HISTORY_MAX = 60;
const COALESCE_MS = 1500;

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [], tag: null, at: 0 });

export function historyPush<T>(h: History<T>, next: T, tag: string | null = null, now = Date.now()): History<T> {
  if (next === h.present) return h;
  if (tag && tag === h.tag && now - h.at < COALESCE_MS && h.past.length) return { ...h, present: next, future: [], at: now };
  return { past: [...h.past, h.present].slice(-HISTORY_MAX), present: next, future: [], tag, at: now };
}
export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future], tag: null, at: 0 };
}
export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), tag: null, at: 0 };
}

/* ---------------- unsaved work kept on the device ---------------- */

export interface DeckDraft {
  v: 1;
  deckId: string;
  /** The server rev the edits started from. */
  baseRev: number;
  at: string;
  title: string;
  slides: DeckSlide[];
}
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const draftKey = (deckId: string) => `tala.deck-draft.${deckId}`;

export function readDraft(storage: DraftStorage | null, deckId: string): DeckDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(draftKey(deckId));
    if (!raw) return null;
    const d = JSON.parse(raw) as DeckDraft;
    if (d?.v !== 1 || d.deckId !== deckId || !Array.isArray(d.slides) || !d.slides.length || typeof d.baseRev !== 'number') return null;
    return d;
  } catch {
    return null;
  }
}
/** Returns false when the device refused (storage full or private mode): the caller must not claim it is kept. */
export function writeDraft(storage: DraftStorage | null, draft: DeckDraft): boolean {
  if (!storage) return false;
  try {
    storage.setItem(draftKey(draft.deckId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
export function clearDraft(storage: DraftStorage | null, deckId: string): void {
  try {
    storage?.removeItem(draftKey(deckId));
  } catch {
    /* nothing to clear */
  }
}
