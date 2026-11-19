/**
 * "Where are you now?" for a teacher who sets up in the middle of a term (PRD §7.5), checked against the real
 * Science curriculum: the proposal must be a competency the Budget of Work prints for the current week of term,
 * not an early competency that merely owns one of the term's spare sessions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine } from '@hiraia/tala-core/pacing';
import { DEFAULT_PACING_PARAMS, type Competency, type PacingInput } from '@hiraia/tala-core/contracts';

const DATA = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../data/packs');
const year = {
  id: 'year0001',
  label: '2026-2027',
  schoolName: 'Test school',
  startDate: '2026-06-01',
  endDate: '2027-03-31',
  terms: [
    { id: 'term0001', index: 1, name: 'Term 1', startDate: '2026-06-01', endDate: '2026-09-11' },
    { id: 'term0002', index: 2, name: 'Term 2', startDate: '2026-09-14', endDate: '2026-12-18' },
    { id: 'term0003', index: 3, name: 'Term 3', startDate: '2027-01-04', endDate: '2027-03-31' },
  ],
  teachingWeekdays: [1, 2, 3, 4, 5],
  presetId: null,
  presetVersion: null,
  provisional: true,
};
const weekOfTerm = (termStart: string, date: string) =>
  Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${termStart}T12:00:00Z`)) / (7 * 86400_000)) + 1;

function proposal(grade: string, today: string) {
  const pack = JSON.parse(readFileSync(resolve(DATA, `science-bow-2026-g${grade}.json`), 'utf8')) as { competencies: Competency[] };
  const term = year.terms.find((t) => t.startDate <= today && t.endDate >= today)!;
  const input = {
    track: { id: 'track001', classId: 'class001', assignmentId: 'assign01', gradeGroupId: 'group001', termId: term.id, curriculumVersion: 'science-bow-2026', startPosition: null, params: {}, overrides: {}, allocation: null },
    schoolYear: year,
    term,
    assignment: {
      id: 'assign01', classId: 'class001', learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: ['group001'], language: 'en',
      slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: `slot000${weekday}`, weekday, startTime: '08:00', minutes: 45, rotation: null })),
    },
    calendarDays: [],
    competencies: pack.competencies.filter((c) => c.grade === grade),
    checks: [],
    marks: [],
    today,
    defaults: DEFAULT_PACING_PARAMS,
  } as unknown as PacingInput;
  const p = engine.proposeStartPosition(input);
  const c = pack.competencies.find((x) => x.id === p?.competencyId);
  return { p, c, week: weekOfTerm(term.startDate, today), term: term.index };
}

test('a mid-term set-up starts on a competency printed for the current week, in every Science grade', () => {
  for (const today of ['2026-11-19', '2026-10-07', '2027-02-10']) {
    for (const grade of ['3', '4', '5', '6', '7', '8', '9', '10']) {
      const { p, c, week, term } = proposal(grade, today);
      assert.ok(p && c, `grade ${grade} on ${today}: a proposal`);
      assert.equal(c.termIndex, term, `grade ${grade} on ${today}: this term`);
      // The stock plan may run a session or two ahead of or behind the printed week; never weeks away.
      assert.ok(
        c.weekFrom != null && c.weekTo != null && week >= c.weekFrom - 1 && week <= c.weekTo + 1,
        `grade ${grade} on ${today} (week ${week}): proposed ${c.id}, printed for weeks ${c.weekFrom}–${c.weekTo}`
      );
    }
  }
});

test('before the term starts the proposal is its first competency; the date is never before the term', () => {
  const { p, c } = proposal('4', '2026-09-14');
  assert.equal(c?.weekFrom, 1);
  assert.equal(p?.date, '2026-09-14');
});
