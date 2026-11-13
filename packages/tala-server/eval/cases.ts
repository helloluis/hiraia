import { GenerationInput } from '@hiraia/tala-core';
export const evaluationCases = [
  { id: 'g2-g4-en', grades: ['2', '4'], language: 'en', minutes: 50 },
  { id: 'g2-g4-fil', grades: ['2', '4'], language: 'fil', minutes: 50 },
  { id: 'three-group-fil', grades: ['1', '2', '3'], language: 'fil', minutes: 50 },
  { id: 'four-group-en', grades: ['1', '2', '3', '4'], language: 'en', minutes: 50 },
  {
    id: 'no-electricity-fil',
    grades: ['2', '4'],
    language: 'fil',
    minutes: 50,
    electricity: false,
  },
  { id: 'short-period-en', grades: ['2', '4'], language: 'en', minutes: 30 },
  { id: 'custom-objectives-fil', grades: ['2'], language: 'fil', minutes: 30, custom: true },
  { id: 'single-dlp-en', grades: ['4'], language: 'en', minutes: 50 },
  { id: 'weekly-dll-fil', grades: ['4'], language: 'fil', minutes: 40, week: true },
].map((c) => ({
  id: c.id,
  input: GenerationInput.parse({
    kind: 'full',
    templateId: c.grades.length > 1 ? 'tpl.multigrade.v1' : c.week ? 'tpl.dll.v1' : 'tpl.dlp.v1',
    language: c.language,
    subjectName: 'Science',
    learningAreaId: 'science',
    timeBudgetMinutes: c.minutes,
    sessions: c.week ? 5 : 1,
    gradeGroups: c.grades.map((grade) => ({ id: `group-00${grade}`, grade, learnerCount: 10 })),
    competencies: c.custom
      ? {}
      : Object.fromEntries(c.grades.map((grade) => [`group-00${grade}`, [`C${grade}`]])),
    curriculumVersion: c.custom ? null : 'eval.v1',
    customObjectives: c.custom ? ['Ilarawan ang mga halaman.'] : [],
    classProfile: {
      materials: ['paper', 'pencils'],
      electricity: c.electricity ?? true,
      printing: false,
    },
  }),
}));
export const objectivesFor = (input: (typeof evaluationCases)[number]['input']) =>
  Object.fromEntries(
    input.gradeGroups.map((g) => [
      g.id,
      (input.competencies[g.id] ?? []).map((id) =>
        input.language === 'fil' ? 'Ilarawan ang mga halaman.' : 'Describe plants.'
      ),
    ])
  );
