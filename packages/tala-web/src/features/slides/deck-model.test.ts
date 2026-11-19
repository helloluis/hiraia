import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeckSaveRequest, DeckSlide, DeckSlideId, WeeklyPackContent } from '@hiraia/tala-core/contracts';
import type { DeckSlide as Slide } from '@hiraia/tala-core/contracts';
import { DECK_LABELS, deckSlidesFromPack, type TextItem } from '@hiraia/tala-core/decks';
import {
  addSlide,
  canDelete,
  canMove,
  changedIds,
  clearDraft,
  deleteSlide,
  duplicateSlide,
  groupSlides,
  historyOf,
  historyPush,
  historyRedo,
  historyUndo,
  moveSlide,
  newSlideId,
  readDraft,
  restoreSlide,
  revealOfCheck,
  setChoices,
  setCorrectChoice,
  slidesForSave,
  slideTitle,
  updateSlide,
  viewOfDeck,
  writeDraft,
  type DraftStorage,
} from './deck-model';

const LIB = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../../tala-packs/library/science-bow-2026');
const pack = WeeklyPackContent.parse(JSON.parse(readFileSync(resolve(LIB, 'sci26-g4-t1-w08/en/pack.json'), 'utf8')));
const base = deckSlidesFromPack(pack);
const deckOf = (slides: Slide[]) => ({
  id: 'deck-1', title: pack.title, language: pack.language, grade: pack.grade, term: pack.term, week: pack.week,
  sourceApproved: false, credits: { reviewer: null, sourcesLine: '' }, slides,
});
const ids = (s: Slide[]) => s.map((x) => x.id);
const unique = (s: Slide[]) => assert.equal(new Set(ids(s)).size, s.length, 'slide ids are unique');
const pair = () => {
  const check = base.find((s) => s.kind === 'check' && revealOfCheck(base, s.id));
  assert.ok(check, 'the sample deck has a question with an answer slide');
  return { check: check!, reveal: revealOfCheck(base, check!.id)! };
};
const plain = base.find((s) => s.kind === 'concept')!;
let seq = 0;
const makeId = (taken: Iterable<string>) => {
  const used = new Set(taken);
  for (;;) {
    const id = `ntest${(seq++).toString(36).padStart(3, '0')}`;
    if (!used.has(id)) return id;
  }
};

test('a deck reads as introduction, days and a closing part', () => {
  const view = viewOfDeck(deckOf(base), (slug) => `/m/${slug}`, { baseSlides: base });
  assert.equal(view.layouts.length, base.length);
  const groups = groupSlides(view.layouts);
  assert.equal(groups[0]!.part, 'intro');
  assert.equal(groups[0]!.layouts[0]!.kind, 'cover');
  assert.equal(groups[groups.length - 1]!.part, 'about');
  const days = groups.filter((g) => g.part === 'day');
  assert.deepEqual(days.map((g) => g.day), [1, 2, 3, 4, 5]);
  for (const g of days) {
    assert.equal(g.layouts[0]!.kind, 'day');
    assert.ok(g.title.length > 0, `day ${g.day} has a title`);
  }
  assert.equal(groups.reduce((n, g) => n + g.layouts.length, 0), base.length);
  assert.equal(slideTitle(view.layouts[0]!), base[0]!.title);
});

test('the credits say "edited" only when the copy really differs', () => {
  const edited = DECK_LABELS.en.creditsEdited;
  const words = (slides: Slide[]) => {
    const credits = viewOfDeck(deckOf(slides), () => '', { baseSlides: base }).layouts.find((l) => l.kind === 'credits')!;
    return credits.items.filter((i): i is TextItem => i.type === 'text').flatMap((i) => i.paragraphs.map((p) => p.runs.map((r) => r.text).join(''))).join('\n');
  };
  assert.ok(!words(base).includes(edited));
  assert.ok(words(updateSlide(base, plain.id, { title: 'My own title' })).includes(edited));
  assert.ok(words(base).includes(DECK_LABELS.en.creditsDraft), 'the honest draft line stays');
});

test('new slide ids fit the contract and never repeat', () => {
  const taken = new Set(ids(base));
  for (let i = 0; i < 200; i++) {
    const id = newSlideId(taken);
    assert.ok(DeckSlideId.safeParse(id).success, id);
    assert.ok(!taken.has(id));
    taken.add(id);
  }
  // A random source that repeats itself still ends with a fresh id.
  let n = 0;
  const rnd = () => (n++ < 16 ? 0 : 0.5);
  const first = newSlideId([], () => 0);
  assert.notEqual(newSlideId([first], rnd), first);
});

test('add: after the slide on show, in its day; after an answer slide; before the credits', () => {
  const a = addSlide(base, plain.id, 'concept', 'nadd0001');
  const at = base.findIndex((s) => s.id === plain.id);
  assert.equal(a.index, at + 1);
  assert.equal(a.slides[a.index]!.day, plain.day);
  assert.equal(a.slides[a.index]!.sourceId, null);
  unique(a.slides);

  const { check, reveal } = pair();
  const b = addSlide(base, check.id, 'question', 'nadd0002');
  assert.equal(ids(b.slides)[b.index - 1], reveal.id, 'a new slide never splits a question from its answer');

  const credits = base[base.length - 1]!;
  assert.equal(credits.kind, 'credits');
  const c = addSlide(base, credits.id, 'activity', 'nadd0003');
  assert.equal(c.slides[c.slides.length - 1]!.kind, 'credits', 'the credits stay last');
  assert.equal(c.index, base.length - 1);
  assert.equal(c.slides[c.index]!.day, 5);

  const d = addSlide(base, base[0]!.id, 'vocabulary', 'nadd0004');
  assert.equal(d.index, 1);
  assert.equal(d.slides[1]!.day, 0, 'right after the cover is still the introduction');
  for (const r of [a, b, c, d]) assert.ok(DeckSaveRequest.safeParse({ baseRev: 1, slides: slidesForSave(r.slides) }).success);
});

test('duplicate: a question brings its answer slide; anchors are not duplicated', () => {
  const d = duplicateSlide(base, plain.id, makeId)!;
  const at = base.findIndex((s) => s.id === plain.id);
  assert.equal(d.index, at + 1);
  assert.equal(d.slides[d.index]!.title, plain.title);
  assert.equal(d.slides[d.index]!.sourceId, null);
  assert.notEqual(d.slides[d.index]!.id, plain.id);
  unique(d.slides);

  const { check, reveal } = pair();
  const p = duplicateSlide(base, check.id, makeId)!;
  assert.equal(p.slides.length, base.length + 2);
  const copy = p.slides[p.index]!;
  const copyReveal = p.slides[p.index + 1]!;
  assert.equal(copy.kind, check.kind);
  assert.equal(copyReveal.kind, 'reveal');
  assert.equal(copyReveal.revealOf, copy.id, 'the copied answer belongs to the copied question');
  assert.equal(revealOfCheck(p.slides, check.id)!.id, reveal.id, 'the original pair is untouched');
  assert.equal(copyReveal.correctChoice, reveal.correctChoice);
  assert.equal(ids(p.slides)[p.index - 1], reveal.id, 'the copies come after the original answer');
  unique(p.slides);

  for (const kind of ['cover', 'day', 'credits'] as const) assert.equal(duplicateSlide(base, base.find((s) => s.kind === kind)!.id, makeId), null);
});

test('delete: a question takes its answer with it; cover, day openers and credits stay', () => {
  const { check, reveal } = pair();
  const r = deleteSlide(base, check.id)!;
  assert.deepEqual(r.removed.sort(), [check.id, reveal.id].sort());
  assert.ok(!ids(r.slides).includes(reveal.id));
  assert.equal(r.slides.length, base.length - 2);
  assert.ok(r.index >= 0 && r.index < r.slides.length);

  const one = deleteSlide(base, reveal.id)!;
  assert.deepEqual(one.removed, [reveal.id]);
  assert.ok(ids(one.slides).includes(check.id));

  for (const kind of ['cover', 'day', 'credits'] as const) {
    const s = base.find((x) => x.kind === kind)!;
    assert.equal(canDelete(base, s.id), false, kind);
    assert.equal(deleteSlide(base, s.id), null);
  }
  assert.equal(deleteSlide(base, 'nope'), null);
});

test('move: one place at a time, into the next day across its opener, never past the cover or the credits', () => {
  const at = base.findIndex((s) => s.id === plain.id);
  const m = moveSlide(base, plain.id, 1)!;
  assert.equal(m.index, at + 1);
  assert.deepEqual([...ids(m.slides)].sort(), [...ids(base)].sort());

  // The last slide of Day 1 moves later, past the Day 2 opener: it is now a Day 2 slide.
  const day2 = base.findIndex((s) => s.kind === 'day' && s.day === 2);
  const lastOfDay1 = base[day2 - 1]!;
  assert.equal(lastOfDay1.day, 1);
  const across = moveSlide(base, lastOfDay1.id, 1)!;
  assert.equal(across.slides[across.index]!.day, 2);
  assert.equal(across.slides[across.index - 1]!.kind, 'day');
  // …and back again.
  const back = moveSlide(across.slides, lastOfDay1.id, -1)!;
  assert.equal(back.slides[back.index]!.day, 1);
  assert.deepEqual(ids(back.slides), ids(base));

  const first = base[1]!; // the Day 1 opener is an anchor
  assert.equal(canMove(base, first.id, 1), false);
  const afterOpener = base[2]!;
  const up = moveSlide(base, afterOpener.id, -1)!; // above the Day 1 opener: introduction
  assert.equal(up.slides[up.index]!.day, 0);
  assert.equal(canMove(up.slides, afterOpener.id, -1), false, 'not above the cover');
  const beforeCredits = base[base.length - 2]!;
  assert.equal(canMove(base, beforeCredits.id, 1), false, 'not below the credits');
  assert.equal(moveSlide(base, beforeCredits.id, 1), null);
});

test('put a slide back: its words return, its place stays; "changed" follows', () => {
  let s = updateSlide(base, plain.id, { title: 'Changed title', lines: ['one', 'two'], notes: 'mine' });
  assert.deepEqual([...changedIds(s, base)], [plain.id]);
  s = moveSlide(s, plain.id, 1)!.slides;
  const added = addSlide(s, plain.id, 'concept', 'nmine001').slides;
  assert.deepEqual([...changedIds(added, base)].sort(), ['nmine001', plain.id].sort());
  const restored = restoreSlide(added, plain.id, base);
  const now = restored.find((x) => x.id === plain.id)!;
  assert.equal(now.title, plain.title);
  assert.deepEqual(now.lines, plain.lines);
  assert.equal(now.notes, plain.notes);
  assert.deepEqual([...changedIds(restored, base)], ['nmine001'], 'position alone is not a change to the slide');
  assert.equal(restoreSlide(restored, 'nmine001', base).find((x) => x.id === 'nmine001')!.title, '', 'a slide the teacher added has nothing to go back to');
});

test('choices: the answer slide keeps pointing at the same choice', () => {
  const { check, reveal } = pair();
  assert.ok(check.choices.length >= 3 && reveal.correctChoice !== null);
  const right = check.choices[reveal.correctChoice!]!;
  // Remove a choice before the right one (or after it, when the right one is first).
  const drop = reveal.correctChoice === 0 ? check.choices.length - 1 : 0;
  const s1 = setChoices(base, check.id, check.choices.filter((_, i) => i !== drop));
  const r1 = revealOfCheck(s1, check.id)!;
  assert.equal(s1.find((x) => x.id === check.id)!.choices[r1.correctChoice!], right);
  // Remove the right one: nothing is marked.
  const s2 = setChoices(base, check.id, check.choices.filter((_, i) => i !== reveal.correctChoice));
  assert.equal(revealOfCheck(s2, check.id)!.correctChoice, null);
  // Mark another one.
  const s3 = setCorrectChoice(base, check.id, drop);
  assert.equal(revealOfCheck(s3, check.id)!.correctChoice, drop);
  // Typing in a choice (same count) changes nothing on the answer slide.
  const s4 = setChoices(base, check.id, check.choices.map((c, i) => (i === 0 ? `${c}!` : c)));
  assert.equal(revealOfCheck(s4, check.id)!.correctChoice, reveal.correctChoice);
});

test('what is saved is tidy and fits the contract', () => {
  const { check, reveal } = pair();
  const blankAt = reveal.correctChoice === 0 ? 1 : 0;
  let s = updateSlide(base, plain.id, { title: '  Spaces  ', lines: ['  first ', '', '   ', 'second'], notes: ' note \n' });
  s = s.map((x) => (x.id === check.id ? { ...x, choices: x.choices.map((c, i) => (i === blankAt ? '  ' : c)) } : x));
  s = deleteSlide(s, base.find((x) => x.kind === 'reveal' && x.id !== reveal.id)!.revealOf!)?.slides ?? s;
  // A dangling link (the question was removed some other way) is cleared, not sent.
  const orphan = s.find((x) => x.kind === 'reveal' && x.id !== reveal.id);
  if (orphan) s = s.map((x) => (x.id === orphan.id ? { ...x, revealOf: 'd9s9' } : x));
  const out = slidesForSave(s);
  const p = out.find((x) => x.id === plain.id)!;
  assert.equal(p.title, 'Spaces');
  assert.deepEqual(p.lines, ['first', 'second']);
  assert.equal(p.notes, 'note');
  const c = out.find((x) => x.id === check.id)!;
  assert.equal(c.choices.length, check.choices.length - 1);
  const r = out.find((x) => x.id === reveal.id)!;
  assert.equal(c.choices[r.correctChoice!], check.choices[reveal.correctChoice!], 'dropping a blank choice does not move the right answer');
  if (orphan) assert.equal(out.find((x) => x.id === orphan.id)!.revealOf, null);
  for (const x of out) assert.ok(DeckSlide.safeParse(x).success, x.id);
  assert.ok(DeckSaveRequest.safeParse({ baseRev: 3, title: 'Mine', slides: out }).success);
  // Over-long typing is clipped instead of refused.
  const long = slidesForSave(updateSlide(base, plain.id, { title: 'x'.repeat(500), lines: Array.from({ length: 20 }, (_, i) => `line ${i} ${'y'.repeat(400)}`), notes: 'n'.repeat(9000) }));
  assert.ok(DeckSaveRequest.safeParse({ baseRev: 1, slides: long }).success);
});

test('undo history: steps, redo, and typing in one field folds into one step', () => {
  let h = historyOf(base);
  const a = updateSlide(base, plain.id, { title: 'A' });
  const ab = updateSlide(a, plain.id, { title: 'AB' });
  const abc = updateSlide(ab, plain.id, { title: 'ABC' });
  h = historyPush(h, a, 'title:x', 1000);
  h = historyPush(h, ab, 'title:x', 1200);
  h = historyPush(h, abc, 'title:x', 1400);
  assert.equal(h.past.length, 1, 'three keystrokes are one undo step');
  h = historyUndo(h);
  assert.equal(h.present, base);
  h = historyRedo(h);
  assert.equal(h.present, abc);
  // A pause, another field, or an untagged change starts a new step.
  h = historyPush(h, updateSlide(abc, plain.id, { title: 'ABCD' }), 'title:x', 9000);
  assert.equal(h.past.length, 2);
  const del = deleteSlide(h.present, plain.id)!.slides;
  h = historyPush(h, del);
  assert.equal(h.past.length, 3);
  assert.equal(historyUndo(h).present.length, base.length);
  assert.equal(historyPush(h, h.present), h, 'no change, no step');
  assert.equal(historyUndo(historyOf(base)).present, base);
  assert.equal(historyRedo(historyOf(base)).present, base);
  // A new change after an undo drops the redo branch.
  assert.equal(historyPush(historyUndo(h), base.slice(0, 5)).future.length, 0);
});

test('unsaved work on the device: kept, read back, cleared; a refusing device is reported', () => {
  const store = new Map<string, string>();
  const storage: DraftStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  const draft = { v: 1 as const, deckId: 'deck-1', baseRev: 4, at: '2026-11-19T12:00:00.000Z', title: 'Mine', slides: updateSlide(base, plain.id, { title: 'Kept' }) };
  assert.equal(readDraft(storage, 'deck-1'), null);
  assert.equal(writeDraft(storage, draft), true);
  assert.deepEqual(readDraft(storage, 'deck-1'), draft);
  assert.equal(readDraft(storage, 'deck-2'), null, 'one copy never reads another copy\'s draft');
  clearDraft(storage, 'deck-1');
  assert.equal(readDraft(storage, 'deck-1'), null);
  store.set('tala.deck-draft.deck-1', '{not json');
  assert.equal(readDraft(storage, 'deck-1'), null);
  store.set('tala.deck-draft.deck-1', JSON.stringify({ ...draft, slides: [] }));
  assert.equal(readDraft(storage, 'deck-1'), null);
  const full: DraftStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
  assert.equal(writeDraft(full, draft), false);
  assert.equal(writeDraft(null, draft), false);
  assert.equal(readDraft(null, 'deck-1'), null);
});
