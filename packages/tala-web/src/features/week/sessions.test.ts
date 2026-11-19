import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PackIndex, PackStatus, PackVariant, TimelineEntry } from '@hiraia/tala-core/contracts';
import { buildSessions, packsFor, scienceGrades } from './sessions';

/* A Grade 4 class with Science (Mon–Fri 08:00) and Mathematics (no curriculum), Term 2 starting 14 Sep 2026. */
const C10 = 'science-bow-2026.science.g4.t2.10';
const C9 = 'science-bow-2026.science.g4.t2.9';
const comp = (id: string, shortTitle: string, weekFrom: number, weekTo: number) =>
  ({ id, code: null, learningAreaId: 'science', grade: '4', termIndex: 2, sequence: 1, text: `Text of ${shortTitle}`, textLang: 'en', contentStandard: null, performanceStandard: null, domain: shortTitle, shortTitle, weekFrom, weekTo, weight: null, weightSource: 'estimated' }) as never;
const slot = (id: string, weekday: number, startTime: string | null) => ({ id, weekday, startTime, minutes: 45, rotation: null });
const ws = {
  activeYear: { terms: [{ id: 't2', index: 2, name: 'Term 2', startDate: '2026-09-14', endDate: '2026-12-18' }] },
  classes: [{ id: 'c4', name: 'Grade 4 – Sampaguita', gradeGroups: [{ id: 'g4', grade: '4' }] }],
  assignments: [
    { id: 'sci', classId: 'c4', learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: ['g4'], slots: [1, 2, 3, 4, 5].map((d) => slot(`s${d}`, d, '08:00')) },
    { id: 'math', classId: 'c4', learningAreaId: null, subjectName: 'Mathematics', gradeGroupIds: ['g4'], slots: [1, 2, 3, 4, 5].map((d) => slot(`m${d}`, d, '09:00')) },
  ],
  plans: [{ id: 'p1', title: '  Day 5: Review  ' }],
} as never;
const entry = (date: string, assignmentId: string, slotId: string, ids: string[], more: Partial<TimelineEntry> = {}): TimelineEntry => ({
  date, classId: 'c4', assignmentId, slotId, minutes: 45, subjectName: assignmentId === 'sci' ? 'Science' : 'Mathematics',
  byGroup: { g4: ids }, kind: 'lesson', planId: null, planState: 'none', mark: null, pairing: null, ...more,
});
const variant = (language: 'en' | 'fil', status: PackStatus): PackVariant => ({
  language, status, title: status === 'not_built' ? null : `${language} title`, viewable: status !== 'not_built',
  files: status === 'not_built' ? [] : [{ kind: 'slides', bytes: 1, sha256: 'x' }], slideCount: null, illustratedSlides: null, review: null,
});
const index = {
  packs: [
    { packId: 'sci26-g4-t2-w10', grade: '4', term: 2, week: 10, topic: 'Magnets', competencyIds: [C10], status: 'draft', viewable: true, variants: { en: variant('en', 'needs_work'), fil: variant('fil', 'draft') } },
    { packId: 'sci26-g4-t2-w09', grade: '4', term: 2, week: 9, topic: 'Forces', competencyIds: [C9], status: 'not_built', viewable: false, variants: { en: variant('en', 'not_built'), fil: variant('fil', 'not_built') } },
  ],
} as unknown as PackIndex;
const tl = (entries: TimelineEntry[]) => ({ entries, ws, competencyById: new Map([[C10, comp(C10, 'Magnets', 10, 11)], [C9, comp(C9, 'Forces', 4, 9)]]) }) as never;
const thuEvening = { date: '2026-11-19', minutes: 20 * 60 + 30 };

test('a Science lesson shows its topic, its plan link and the matching pack with the day of the week it lines up with', () => {
  const week = ['16', '17', '18', '19', '20'].map((d, i) => entry(`2026-11-${d}`, 'sci', `s${i + 1}`, [C10]));
  const fri = buildSessions(tl(week), index, 'fil', thuEvening).find((s) => s.date === '2026-11-20')!;
  assert.equal(fri.startTime, '08:00');
  assert.equal(fri.hasTopic, true);
  assert.equal(fri.topics[0]!.title, 'Magnets');
  assert.equal(fri.topics[0]!.text, 'Text of Magnets');
  assert.equal(fri.state, 'none');
  assert.equal(fri.over, false);
  assert.equal(fri.canMark, false); // tomorrow: nothing to mark yet
  assert.match(fri.href, /^\/lessons\/new\?classId=c4&assignmentId=sci&date=2026-11-20&slotId=s5$/);
  const lib = fri.topics[0]!.library!;
  assert.equal(lib.kind, 'pack');
  if (lib.kind !== 'pack') return;
  assert.equal(lib.suggestion.packId, 'sci26-g4-t2-w10');
  assert.equal(lib.suggestion.language, 'fil');
  assert.equal(lib.suggestion.status, 'draft');
  assert.equal(lib.day, 5); // fifth Science lesson of the week
});

test('a topic with no built pack is said plainly, with the grade and term to browse', () => {
  const s = buildSessions(tl([entry('2026-11-20', 'sci', 's5', [C9])]), index, 'en', thuEvening)[0]!;
  assert.deepEqual(s.topics[0]!.library, { kind: 'none', grade: '4', term: 2 });
});

test('a subject without curriculum gets no Library row and no topic', () => {
  const s = buildSessions(tl([entry('2026-11-20', 'math', 'm5', [])]), index, 'en', thuEvening)[0]!;
  assert.equal(s.hasTopic, false);
  assert.equal(s.topics[0]!.library, null);
  assert.equal(s.subject, 'Mathematics');
});

test('nothing is suggested before the library index has loaded, or for a lesson covered before Tala', () => {
  assert.equal(buildSessions(tl([entry('2026-11-20', 'sci', 's5', [C10])]), null, 'en', thuEvening)[0]!.topics[0]!.library, null);
  const before = buildSessions(tl([entry('2026-11-13', 'sci', 's5', [], { kind: 'before_tala', mark: 'before_tala' })]), index, 'en', thuEvening)[0]!;
  assert.equal(before.beforeTala, true);
  assert.equal(before.topics[0]!.library, null);
});

test('a pack for another week still matches the topic but promises no day', () => {
  // The same competency taught in calendar week 13: the week 10 pack is the nearest on this topic.
  const s = buildSessions(tl([entry('2026-12-08', 'sci', 's2', [C10])]), index, 'en', thuEvening)[0]!;
  const lib = s.topics[0]!.library!;
  assert.equal(lib.kind, 'pack');
  if (lib.kind === 'pack') assert.equal(lib.day, null);
});

test('state, plan title and marking follow the timeline', () => {
  const list = buildSessions(
    tl([
      entry('2026-11-16', 'sci', 's1', [C10], { mark: 'taught', planId: 'p1', planState: 'draft' }),
      entry('2026-11-17', 'sci', 's2', [C10], { mark: 'not_taught' }),
      entry('2026-11-18', 'sci', 's3', [C10], { mark: 'assumed_taught' }),
      entry('2026-11-19', 'sci', 's4', [C10], { planId: 'p1', planState: 'locked' }),
    ]),
    index,
    'en',
    thuEvening
  );
  assert.deepEqual(list.map((s) => s.state), ['taught', 'notTaught', 'assumed', 'locked']);
  assert.equal(list[0]!.planTitle, 'Day 5: Review');
  assert.equal(list[0]!.href, '/lessons/p1');
  assert.deepEqual(list.map((s) => s.canMark), [true, true, true, true]); // today and earlier
  assert.deepEqual(list.map((s) => s.over), [true, true, true, true]); // Thursday 8:00 is over by the evening
});

test('sessions come out in time order within a day', () => {
  const list = buildSessions(tl([entry('2026-11-20', 'math', 'm5', []), entry('2026-11-20', 'sci', 's5', [C10])]), index, 'en', thuEvening);
  assert.deepEqual(list.map((s) => s.subject), ['Science', 'Mathematics']);
});

test('packs for the week: one card per pack, with the dates it serves', () => {
  const week = ['19', '20'].map((d, i) => entry(`2026-11-${d}`, 'sci', `s${i + 4}`, [C10]));
  const packs = packsFor(buildSessions(tl(week), index, 'en', thuEvening));
  assert.equal(packs.length, 1);
  assert.equal(packs[0]!.suggestion.packId, 'sci26-g4-t2-w10');
  assert.equal(packs[0]!.from, '2026-11-19');
  assert.equal(packs[0]!.to, '2026-11-20');
});

test('grades of the Science classes, for the browse links', () => {
  assert.deepEqual(scienceGrades(tl([])), ['4']);
});
