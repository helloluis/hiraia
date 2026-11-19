/**
 * From a library pack to deck slides and layout inputs (pure). A teacher's copy starts as `deckSlidesFromPack`;
 * the browser lays the shared original out through the same path, so both look alike.
 */
import type { Deck, DeckSlide } from '../contracts/decks';
import type { PackReview, WeeklyPackContent } from '../contracts/packs';
import { cleanLine, sameText, stripDayPrefix } from './fit';
import { DECK_LABELS } from './labels';
import type { DeckLayoutInput } from './layout';

/** The original's slides as editable deck slides: typed list markers removed, repeated titles dropped. */
export function deckSlidesFromPack(content: WeeklyPackContent): DeckSlide[] {
  return content.slides.map((s) => ({
    id: s.id,
    day: s.day,
    kind: s.kind,
    title: s.kind === 'day' ? stripDayPrefix(s.title) : s.title,
    lines: s.lines.filter((l) => !sameText(l, s.title)).map(cleanLine).filter(Boolean),
    choices: s.choices.map(cleanLine).filter(Boolean),
    revealOf: s.revealOf,
    correctChoice: s.correctChoice,
    image: s.image ? { slug: s.image.slug, alt: s.image.alt } : null,
    notes: s.notes,
    sourceId: s.id,
  }));
}

/** Whole references only; the full list is in the teacher guide. */
export function sourcesLineFromPack(content: WeeklyPackContent): string {
  const refs = content.guide.sources.map((r) => `${r.refId}: ${r.locator}`);
  if (!refs.length) return '';
  let line = `${DECK_LABELS[content.language].sourcesIntro}: ${refs[0]}`;
  for (const r of refs.slice(1)) {
    if (`${line}; ${r}`.length > 380) {
      line += '; …';
      break;
    }
    line += `; ${r}`;
  }
  return line;
}

export const packApproved = (review: Pick<PackReview, 'publication'>): boolean => review.publication === 'approved';

/** Layout input for the shared original. */
export function layoutInputFromPack(content: WeeklyPackContent, review: Pick<PackReview, 'publication' | 'teacherReview'>): DeckLayoutInput {
  return {
    language: content.language,
    grade: content.grade,
    term: content.term,
    week: content.week,
    approved: packApproved(review),
    reviewer: review.teacherReview?.reviewer ?? null,
    sourcesLine: sourcesLineFromPack(content),
    personalCopy: false,
    slides: deckSlidesFromPack(content),
    dayTitles: Object.fromEntries(content.days.map((d) => [d.day, d.title])),
  };
}

/**
 * Layout input for a teacher's own copy. With `baseSlides` (the slides as first copied) the credits say "edited by
 * its teacher" only when the copy really differs; without them the copy is treated as edited.
 */
export function layoutInputFromDeck(
  deck: Pick<Deck, 'language' | 'grade' | 'term' | 'week' | 'sourceApproved' | 'credits' | 'slides'>,
  opts: { editing?: boolean; baseSlides?: DeckSlide[] } = {}
): DeckLayoutInput {
  const c = opts.baseSlides ? deckChanges(deck.slides, opts.baseSlides) : null;
  return {
    language: deck.language,
    grade: deck.grade,
    term: deck.term,
    week: deck.week,
    approved: deck.sourceApproved,
    reviewer: deck.credits.reviewer,
    sourcesLine: deck.credits.sourcesLine,
    personalCopy: c ? c.changed + c.added + c.removed > 0 || c.reordered : true,
    slides: deck.slides,
    dayTitles: Object.fromEntries(deck.slides.filter((s) => s.kind === 'day').map((s) => [s.day, s.title])),
    editing: opts.editing,
  };
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** True when a slide's content differs from the slide it started as (position in the deck does not count). */
export function slideChanged(slide: DeckSlide, base: DeckSlide | undefined): boolean {
  if (!base) return true;
  return (
    slide.title !== base.title ||
    slide.kind !== base.kind ||
    slide.notes !== base.notes ||
    !sameList(slide.lines, base.lines) ||
    !sameList(slide.choices, base.choices) ||
    slide.correctChoice !== base.correctChoice ||
    (slide.image?.slug ?? null) !== (base.image?.slug ?? null)
  );
}

/** How a copy differs from what was copied: edited or added slides, removed slides, and whether the order moved. */
export function deckChanges(slides: DeckSlide[], base: DeckSlide[]): { changed: number; added: number; removed: number; reordered: boolean } {
  const byId = new Map(base.map((s) => [s.id, s]));
  let changed = 0;
  let added = 0;
  const kept: string[] = [];
  for (const s of slides) {
    const b = s.sourceId && s.sourceId === s.id ? byId.get(s.id) : undefined;
    if (!b) added += 1;
    else {
      kept.push(s.id);
      if (slideChanged(s, b)) changed += 1;
    }
  }
  const keptSet = new Set(kept);
  const removed = base.filter((b) => !keptSet.has(b.id)).length;
  const baseOrder = base.map((b) => b.id).filter((id) => keptSet.has(id));
  const reordered = !sameList(kept, baseOrder);
  return { changed, added, removed, reordered };
}

/** Slides that differ from the original they came from, plus slides the teacher added (DeckSummary.changedSlides). */
export function changedSlideCount(slides: DeckSlide[], base: DeckSlide[]): number {
  const c = deckChanges(slides, base);
  return c.changed + c.added;
}
