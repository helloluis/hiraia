import test from 'node:test';
import assert from 'node:assert/strict';
import type { CurriculumIndex } from '@hiraia/tala-core/contracts';
import { curriculumVersionOf, packIdFor, packIdsFor, packIdsOfCompetencies } from './curriculum';

const meta = (curriculumVersion: string, grade: string, learningAreaId: string, extra: Partial<CurriculumIndex['packs'][number]> = {}) => ({
  packId: `${curriculumVersion}:${grade}:${learningAreaId}`,
  curriculumVersion,
  grade: grade as never,
  learningAreaId,
  schoolYears: ['2026-2027'],
  competencyCount: 3,
  dataRevision: 2,
  bytes: 100,
  ...extra,
});
// The order the server lists them in (file names sorted): English and Reading and Literacy come before Science.
const index: CurriculumIndex = {
  learningAreas: [],
  packs: [
    meta('english-bow-2026', '2', 'english', { dataRevision: 4 }),
    meta('english-bow-2026', '4', 'english', { dataRevision: 4 }),
    meta('reading-and-literacy-bow-2026', '1', 'reading-and-literacy', { dataRevision: 3 }),
    meta('science-bow-2026', '4', 'science'),
    meta('fixture-demo-v1', '4', 'science', { dataRevision: 9 }),
  ],
};

test('each learning area keeps its own curriculum version: English listed first never hides Science', () => {
  assert.equal(curriculumVersionOf(index, '2026-2027', '4', 'science'), 'science-bow-2026'); // sourced before sample data
  assert.equal(curriculumVersionOf(index, '2026-2027', '4', 'english'), 'english-bow-2026');
  assert.equal(curriculumVersionOf(index, '2026-2027', '1', 'reading-and-literacy'), 'reading-and-literacy-bow-2026');
  assert.equal(curriculumVersionOf(index, '2026-2027', '1', 'english'), null);
  assert.equal(curriculumVersionOf(index, '2026-2027', '4', null), null);
  // A year with no pack in force keeps using the packs of that grade and area (as before).
  assert.equal(curriculumVersionOf(index, '2027-2028', '4', 'science'), 'science-bow-2026');
  assert.equal(packIdFor(index, '2026-2027', '4', 'science'), 'science-bow-2026:4:science');
  assert.equal(packIdFor(index, '2026-2027', '2', 'english'), 'english-bow-2026:2:english');
  assert.equal(packIdFor(index, '2026-2027', '3', 'english'), null);
  assert.equal(packIdFor(null, '2026-2027', '4', 'science'), null);
});

test('a class with Science and English needs both packs', () => {
  const cls = { id: 'c1', curriculum: 'deped', gradeGroups: [{ id: 'g4', grade: '4', learnerCount: null }] } as never;
  const assignments = [
    { id: 'a1', classId: 'c1', learningAreaId: 'science', gradeGroupIds: ['g4'] },
    { id: 'a2', classId: 'c1', learningAreaId: 'english', gradeGroupIds: ['g4'] },
  ] as never;
  assert.deepEqual(packIdsFor(index, '2026-2027', [cls], assignments), ['english-bow-2026:4:english', 'science-bow-2026:4:science']);
});

test("a plan's tagged competencies name their own packs, whatever the plan's learning area", () => {
  assert.deepEqual(
    packIdsOfCompetencies(index, [
      'reading-and-literacy-bow-2026.reading-and-literacy.g1.t2.20',
      'english-bow-2026.english.g2.t2.17',
      'english-bow-2026.english.g2.t2.18',
    ]),
    ['english-bow-2026:2:english', 'reading-and-literacy-bow-2026:1:reading-and-literacy']
  );
  // Grade 2 is not Grade 20, and an id of a pack that is not listed loads nothing.
  assert.deepEqual(packIdsOfCompetencies(index, ['english-bow-2026.english.g20.t1.1', 'math-x.mathematics.g4.t1.1']), []);
  assert.deepEqual(packIdsOfCompetencies(index, []), []);
});
