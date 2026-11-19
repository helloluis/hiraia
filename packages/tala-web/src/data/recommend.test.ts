import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PackIndexEntry, PackStatus, PackVariant } from '@hiraia/tala-core/contracts';
import { suggestPack, termWeekFor, weekOfTerm } from './recommend';

const variant = (language: 'en' | 'fil', status: PackStatus, title: string | null, viewable = status === 'draft' || status === 'needs_work' || status === 'approved'): PackVariant => ({
  language,
  status,
  title: viewable ? title : null,
  viewable,
  files: viewable ? [{ kind: 'slides', bytes: 1, sha256: 'x' }] : [],
  slideCount: viewable ? 50 : null,
  illustratedSlides: viewable ? 10 : null,
  review: null,
});
const pack = (grade: string, term: number, week: number, competencyIds: string[], en: PackStatus, fil: PackStatus): PackIndexEntry => ({
  packId: `sci26-g${grade}-t${term}-w${String(week).padStart(2, '0')}`,
  grade,
  term,
  week,
  topic: `Topic ${grade}.${term}.${week}`,
  competencyIds,
  status: en,
  viewable: true,
  variants: { en: variant('en', en, `EN ${week}`), fil: variant('fil', fil, `FIL ${week}`) },
});
const c = (grade: string, term: number, n: number) => `science-bow-2026.science.g${grade}.t${term}.${n}`;

const index = {
  packs: [
    pack('4', 2, 9, [c('4', 2, 4), c('4', 2, 9)], 'not_built', 'not_built'),
    pack('4', 2, 10, [c('4', 2, 10), c('4', 2, 11)], 'needs_work', 'draft'),
    pack('4', 2, 11, [c('4', 2, 10), c('4', 2, 11)], 'draft', 'needs_work'),
    pack('4', 2, 12, [], 'not_built', 'not_built'),
    pack('5', 2, 10, [c('5', 2, 10)], 'draft', 'not_built'),
    pack('4', 3, 1, [c('4', 3, 1)], 'approved', 'approved'),
  ],
};

test('week of term counts Monday-to-Sunday weeks from the week the term starts in', () => {
  assert.equal(weekOfTerm('2026-09-14', '2026-09-14'), 1);
  assert.equal(weekOfTerm('2026-09-14', '2026-09-20'), 1); // Sunday of week 1
  assert.equal(weekOfTerm('2026-09-14', '2026-09-21'), 2);
  assert.equal(weekOfTerm('2026-09-14', '2026-11-19'), 10);
  assert.equal(weekOfTerm('2026-09-16', '2026-09-21'), 2); // a term that starts mid-week
});

test('term and week for a date; null between terms', () => {
  const year = {
    terms: [
      { index: 2, startDate: '2026-09-14', endDate: '2026-12-18' },
      { index: 3, startDate: '2027-01-04', endDate: '2027-03-31' },
    ],
  };
  assert.deepEqual(termWeekFor(year, '2026-11-20'), { term: 2, week: 10 });
  assert.deepEqual(termWeekFor(year, '2027-01-04'), { term: 3, week: 1 });
  assert.equal(termWeekFor(year, '2026-12-25'), null);
  assert.equal(termWeekFor(null, '2026-11-20'), null);
});

test('a lesson gets the pack of its grade that shares a competency, in the interface language', () => {
  const s = suggestPack(index, { grade: '4', competencyIds: [c('4', 2, 10)], term: 2, week: 10, lang: 'fil' });
  assert.equal(s?.packId, 'sci26-g4-t2-w10');
  assert.equal(s?.match, 'topic');
  assert.equal(s?.language, 'fil');
  assert.equal(s?.otherLanguage, false);
  assert.equal(s?.title, 'FIL 10');
  assert.equal(s?.status, 'draft'); // the status of the version offered, not softened
  assert.equal(s?.sameWeek, true);
  assert.equal(suggestPack(index, { grade: '4', competencyIds: [c('4', 2, 10)], term: 2, week: 10, lang: 'en' })?.status, 'needs_work');
});

test('a competency that runs over two weeks: the pack closest to the lesson\'s own week wins', () => {
  const q = { grade: '4', competencyIds: [c('4', 2, 11)], term: 2, lang: 'en' as const };
  assert.equal(suggestPack(index, { ...q, week: 10 })?.packId, 'sci26-g4-t2-w10');
  assert.equal(suggestPack(index, { ...q, week: 11 })?.packId, 'sci26-g4-t2-w11');
  // A teacher running late (calendar week 13) still gets the nearest week of the same topic, not a calendar guess.
  const late = suggestPack(index, { ...q, week: 13 });
  assert.equal(late?.packId, 'sci26-g4-t2-w11');
  assert.equal(late?.sameWeek, false);
  // No calendar at all: the first week of the topic.
  assert.equal(suggestPack(index, { ...q, term: null, week: null })?.packId, 'sci26-g4-t2-w10');
  // Across a term boundary the nearest week is the last one of the earlier term.
  assert.equal(suggestPack(index, { ...q, term: 3, week: 1 })?.packId, 'sci26-g4-t2-w11');
});

test('the other language is offered, and said, when the interface language has no version', () => {
  const s = suggestPack(index, { grade: '5', competencyIds: [c('5', 2, 10)], term: 2, week: 10, lang: 'fil' });
  assert.equal(s?.language, 'en');
  assert.equal(s?.otherLanguage, true);
  assert.equal(s?.title, 'EN 10');
});

test('never another grade, never a pack that cannot be opened', () => {
  assert.equal(suggestPack(index, { grade: '6', competencyIds: [c('4', 2, 10)], term: 2, week: 10, lang: 'en' }), null);
  // Week 9 exists in the index but is not built.
  assert.equal(suggestPack(index, { grade: '4', competencyIds: [c('4', 2, 4)], term: 2, week: 9, lang: 'en' }), null);
  assert.equal(suggestPack(null, { grade: '4', competencyIds: [c('4', 2, 10)], term: 2, week: 10, lang: 'en' }), null);
});

test('a lesson with a topic never falls back to the calendar week (it may teach something else)', () => {
  // Teaching the weeks 4–9 topic during calendar week 10: the week 10 pack is about magnets, so nothing is offered.
  assert.equal(suggestPack(index, { grade: '4', competencyIds: [c('4', 2, 9)], term: 2, week: 10, lang: 'en' }), null);
});

test('a session with no competency falls back to the same grade, term and calendar week', () => {
  const s = suggestPack(index, { grade: '4', competencyIds: [], term: 2, week: 11, lang: 'en' });
  assert.equal(s?.packId, 'sci26-g4-t2-w11');
  assert.equal(s?.match, 'calendar');
  assert.equal(suggestPack(index, { grade: '4', competencyIds: [], term: 2, week: 12, lang: 'en' }), null); // not built
  assert.equal(suggestPack(index, { grade: '4', competencyIds: [], term: null, week: null, lang: 'en' }), null);
});
