import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TEMPLATES, type ClassRecord, type Student } from '@hiraia/tala-core/contracts';
import { prePostReview } from './community';
import { newPlan } from './plans';

let n = 0;
const newId = () => `p${++n}`;
const cls: ClassRecord = {
  id: 'c',
  schoolYearId: 'y',
  name: 'Grade 3 Sampaguita',
  curriculum: 'deped',
  gradeGroups: [{ id: 'g3', grade: '3', learnerCount: null }],
  languages: ['fil'],
  profile: {
    materials: [],
    textbooks: [],
    electricity: null,
    projector: null,
    printing: null,
    outdoorSpace: null,
    notes: '',
  },
  isSample: false,
  archived: false,
};
const student = (displayName: string, givenName: string, familyName: string): Student => ({
  id: newId(),
  classId: 'c',
  gradeGroupId: 'g3',
  displayName,
  familyName,
  givenName,
  middleName: '',
  suffix: '',
  sex: null,
  localId: null,
  order: 0,
  importId: null,
});

test('pre-post review strips reflection and dates and flags a learner name from the roster as blocking', () => {
  const dlp = BUILTIN_TEMPLATES[0]!;
  const { plan, sections } = newPlan({
    template: dlp,
    cls,
    assignment: null,
    dates: ['2026-11-18'],
    language: 'fil',
    newId,
  });
  const filled = sections.map((s) => {
    if (s.key === 'assessment')
      return {
        ...s,
        content: {
          type: 'text' as const,
          blocks: [
            {
              t: 'p' as const,
              spans: [{ text: 'Tawagin si Juan Miguel Dela Cruz para sumagot.' }],
            },
          ],
        },
      };
    if (s.key === 'reflection')
      return {
        ...s,
        content: {
          type: 'text' as const,
          blocks: [{ t: 'p' as const, spans: [{ text: 'private remarks' }] }],
        },
      };
    return s;
  });
  const review = prePostReview({
    plan: { ...plan, state: 'locked' },
    sections: filled,
    template: dlp,
    cls,
    schoolName: 'Mabini Elementary School',
    teacherName: 'Gng. Reyes',
    includeSchoolName: false,
    students: [student('Juan Miguel Dela Cruz', 'Juan Miguel', 'Dela Cruz')],
    title: 'Matter',
    summary: '',
  });
  assert.equal(
    review.snapshot.sections.some((s) => s.key === 'reflection'),
    false,
    'outside-lock sections are not public'
  );
  assert.ok(
    review.findings.some((f) => f.kind === 'roster_name'),
    'roster name detected'
  );
  assert.equal(review.blocking, true);
  const clean = prePostReview({
    plan: { ...plan, state: 'locked' },
    sections,
    template: dlp,
    cls,
    schoolName: '',
    teacherName: '',
    includeSchoolName: false,
    students: [],
    title: 'Matter',
    summary: '',
  });
  assert.equal(clean.blocking, false);
});
