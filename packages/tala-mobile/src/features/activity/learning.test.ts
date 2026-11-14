import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParsedCatalog } from './catalog';
import {
  NO_SUBCATEGORY,
  avatarFor,
  dayActivity,
  displayNames,
  rosterCards,
  schoolPeriods,
  totalsOf,
  isoDay,
  dayBounds,
  type LearningEvent,
} from './learning';
import { sha256Sync } from './nodeCrypto';
import { CATALOG_FIXTURE } from './fixtures';

const view = (cardId: string): LearningEvent => ({
  name: 'card_viewed',
  occurredAt: 0,
  correct: false,
  cardId,
  questionId: '',
});
const quiz = (fact: string, correct: boolean): LearningEvent => ({
  name: 'quiz_graded',
  occurredAt: 0,
  correct,
  cardId: '',
  questionId: fact,
});
const sha = async (b: Uint8Array) => sha256Sync(b);

test('totals count distinct curated cards and correct quizzes', () => {
  assert.deepEqual(
    totalsOf([
      view('ffct-00001'),
      view('ffct-00001'),
      view(''),
      view('ffct-00002'),
      quiz('storm-g4', true),
      quiz('storm-g4', false),
    ]),
    { viewed: 4, unique: 2, quizzes: 2, correct: 1 }
  );
  assert.deepEqual(totalsOf([]), { viewed: 0, unique: 0, quizzes: 0, correct: 0 });
});

test('a day lists its subcategories busiest first, with what could not be placed last', async () => {
  const catalog = ParsedCatalog.parse(CATALOG_FIXTURE);
  const day = await dayActivity(
    '2026-09-24',
    [
      view('ffct-00001'),
      view('ffct-00001'),
      view('ffct-00002'),
      view('dcard-00003'),
      view(''),
      quiz('storm-g4', true),
      quiz('butterfly-g5', false),
      quiz('unknown-fact', true),
    ],
    catalog
  );
  assert.deepEqual(day.totals, { viewed: 5, unique: 3, quizzes: 3, correct: 2 });
  assert.deepEqual(day.subcategories, [
    { label: 'Insects', totals: { viewed: 3, unique: 2, quizzes: 1, correct: 0 } },
    { label: 'Mammals', totals: { viewed: 1, unique: 1, quizzes: 1, correct: 1 } },
    { label: 'Weather Types', totals: { viewed: 1, unique: 1, quizzes: 1, correct: 1 } },
    { label: NO_SUBCATEGORY, totals: { viewed: 1, unique: 0, quizzes: 1, correct: 1 } },
  ]);
  assert.deepEqual(await dayActivity('2026-09-24', [], catalog), {
    date: '2026-09-24',
    totals: { viewed: 0, unique: 0, quizzes: 0, correct: 0 },
    subcategories: [],
  });
});

test('school periods: today, the last school day, and the last finished Monday–Friday week', () => {
  // Thursday 24 Sept 2026 (local time).
  const thursday = new Date(2026, 8, 24, 10, 30).getTime();
  const periods = schoolPeriods(thursday);
  assert.equal(isoDay(periods[0]!.start), '2026-09-24');
  assert.equal(isoDay(periods[1]!.start), '2026-09-23');
  assert.equal(isoDay(periods[2]!.start), '2026-09-14');
  assert.equal(isoDay(periods[2]!.end - 1), '2026-09-18');
  // Monday: last school day is Friday; on a weekend the week just gone counts.
  const monday = new Date(2026, 8, 21, 8).getTime();
  assert.equal(isoDay(schoolPeriods(monday)[1]!.start), '2026-09-18');
  const sunday = new Date(2026, 8, 27, 8).getTime();
  assert.equal(isoDay(schoolPeriods(sunday)[2]!.start), '2026-09-21');
  assert.equal(isoDay(schoolPeriods(sunday)[1]!.start), '2026-09-25');
  const bounds = dayBounds('2026-09-24');
  assert.equal(bounds.end - bounds.start, 24 * 3600 * 1000);
});

test('display names number duplicates stably; avatars depend only on the student phone ids', async () => {
  const first = {
    installationId: 'installation-123456789',
    profileId: 'student-profile-111111111',
    name: 'Luis',
  };
  const second = {
    installationId: 'installation-123456789',
    profileId: 'student-profile-222222222',
    name: 'luis ',
  };
  const names = displayNames([second, first]);
  assert.equal(names.get(first), 'Luis');
  assert.equal(names.get(second), 'luis-2');
  const cards = await rosterCards([first, second], sha);
  // The same indexes Tala 0.4.4's RosterIdentity test asserts: Luis → animal 2 colour 2,
  // "luis " → animal 11 colour 2 (TalaStorageTest.animalColorsAndDuplicateNamesAreStableAcrossTeacherPhones).
  assert.equal(cards[0]!.animalIndex, 2);
  assert.equal(cards[0]!.colorIndex, 2);
  assert.equal(cards[1]!.animalIndex, 11);
  assert.equal(cards[1]!.colorIndex, 2);
  const renamed = await avatarFor({ ...first, name: 'Luis Santos' }, sha);
  assert.deepEqual(renamed, { animalIndex: 2, colorIndex: 2 });
  const guestA = await avatarFor({ ...first, profileId: 'guest', name: 'Guest-Q3K7B2' }, sha);
  const guestB = await avatarFor(
    { ...first, profileId: 'guest-profile-123456789', name: 'Guest-T6M4P8' },
    sha
  );
  assert.deepEqual(guestA, guestB);
});
