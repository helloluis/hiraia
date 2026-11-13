import { Plan, PlanSection, ClassRecord, SchoolYear } from '../contracts/records';
import { BUILTIN_TEMPLATES, type SectionContent } from '../contracts/content';
import type { RenderPlanOptions } from './index';
export function printFixture(kind: 'dlp' | 'dll' | 'multigrade'): RenderPlanOptions {
  const template = BUILTIN_TEMPLATES.find((t) => t.kind === kind)!;
  const gradeGroups = (kind === 'multigrade' ? ['3', '4', '5'] : ['3']).map((grade, i) => ({
    id: `group00${i + 1}`,
    grade,
  }));
  const plan = Plan.parse({
    id: 'plan0001',
    title: 'Mga halaman: ñ, á, é, í, ó, ú',
    templateId: template.id,
    language: 'fil',
    grades: gradeGroups.map((g) => g.grade),
    gradeGroupIds: gradeGroups.map((g) => g.id),
    durationMinutes: 50,
    subjectName: 'Science',
    competencies: { group001: ['science.plants'] },
    placements: [{ classId: 'class001', assignmentId: null, dates: ['2026-11-13'] }],
  });
  const body = [
    {
      t: 'p' as const,
      spans: [
        { text: 'Obserbahan ang halaman. ', b: true },
        { text: 'Ihambing ang mga dahon.', i: true },
      ],
    },
  ];
  let content: SectionContent;
  let key: string;
  if (kind === 'dll') {
    key = 'weekgrid';
    content = {
      type: 'weekgrid',
      days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, date: null, body })),
    };
  } else if (kind === 'multigrade') {
    key = 'multigrade';
    content = {
      type: 'multigrade',
      blocks: [
        {
          id: 'block001',
          label: 'Pagmamasid',
          minutes: 20,
          transitionMinutes: 2,
          teacherWith: 'group001',
          pairedGroupIds: [],
          groups: Object.fromEntries(
            gradeGroups.map((g) => [
              g.id,
              { mode: g.id === 'group001' ? 'direct' : 'independent', activity: body },
            ])
          ),
        },
      ],
    };
  } else {
    key = 'procedure';
    content = {
      type: 'procedure',
      steps: [{ id: 'step0001', title: 'Pagmamasid', minutes: 20, body }],
    };
  }
  return {
    plan,
    sections: [PlanSection.parse({ id: 'section1', planId: plan.id, key, content })],
    template,
    class: ClassRecord.parse({
      id: 'class001',
      schoolYearId: 'year0001',
      name: 'Class A',
      gradeGroups,
    }),
    schoolYear: SchoolYear.parse({
      id: 'year0001',
      label: '2026–2027',
      schoolName: 'Sample School',
      startDate: '2026-06-01',
      endDate: '2027-03-31',
      terms: [
        {
          id: 'term0001',
          index: 1,
          name: 'Term 1',
          startDate: '2026-06-01',
          endDate: '2027-03-31',
        },
      ],
    }),
    teacherName: 'Guro Peña',
    paper: 'a4',
    lang: 'fil',
    competencyLookup: () => ({ code: 'S3', text: 'Identify plant parts.' }),
    includeImages: true,
  };
}
