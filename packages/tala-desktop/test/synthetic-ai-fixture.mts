// Pure data shared by offline validation, isolated UI checks and guarded seeding.
import { randomUUID } from 'node:crypto';
import { SchoolYear, ClassRecord } from '../../tala-core/src/contracts/index.ts';
import { newPlan, defaultTemplateFor } from '../../tala-web/src/data/plans.ts';

export function syntheticAiFixture(mode: 'owner' | 'ephemeral') {
  const marker = mode === 'owner' ? '(desktop real-AI check, synthetic test)' : '(desktop native check, synthetic test)';
  const year = SchoolYear.parse({ id: randomUUID(), label: marker, schoolName: 'Synthetic desktop verification',
    startDate: '2026-01-01', endDate: '2026-12-31', teachingWeekdays: [1, 2, 3, 4, 5],
    terms: [{ id: randomUUID(), index: 1, name: 'Synthetic term', startDate: '2026-01-01', endDate: '2026-12-31' }],
    presetId: null, presetVersion: null, provisional: true });
  const cls = ClassRecord.parse({ id: randomUUID(), schoolYearId: year.id,
    name: 'Synthetic desktop class ' + marker, curriculum: 'none',
    gradeGroups: [{ id: randomUUID(), grade: '4', learnerCount: 0 }], languages: ['en'],
    profile: { materials: ['paper', 'pencils'] }, isSample: false, archived: false });
  const { plan, sections } = newPlan({ template: defaultTemplateFor(cls, null), cls, assignment: null,
    dates: [], language: 'en', newId: randomUUID, title: 'Plant observations ' + marker });
  plan.subjectName = 'Science'; plan.learningAreaId = 'science';
  plan.customObjectives = ['Describe the functions of roots, stems and leaves using a drawing of a plant.'];
  for (const section of sections) {
    if (section.key === 'objectives') section.content = { type: 'list', items: [...plan.customObjectives] };
    if (section.key === 'content') section.content = { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Roots absorb water. Stems support a plant. Leaves use sunlight to make food.' }] }] };
    if (section.key === 'materials') section.content = { type: 'list', items: ['paper', 'pencils'] };
    if (section.content.type === 'procedure') for (const step of section.content.steps) {
      step.title = 'Observe and discuss';
      step.body = [{ t: 'p', spans: [{ text: 'Draw a plant and label its roots, stem and leaves. Explain what each part does.' }] }];
    }
  }
  const changes = [{ op: 'put' as const, entity: 'school_year' as const, data: year },
    { op: 'put' as const, entity: 'class' as const, data: cls },
    { op: 'put' as const, entity: 'plan' as const, data: plan },
    ...sections.map(data => ({ op: 'put' as const, entity: 'plan_section' as const, data }))];
  return { year, cls, plan, sections, changes };
}
