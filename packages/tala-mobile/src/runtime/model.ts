import {
  ClassRecord,
  SchoolYear,
  TeachingAssignment,
  PacingTrack,
  Plan,
  PlanSection,
  DEFAULT_PACING_PARAMS,
} from '@hiraia/tala-core/contracts';
import type {
  CalendarPreset,
  GradeLevel,
  SyncEngine,
  TimelineInput,
  CurriculumPack,
} from '@hiraia/tala-core/contracts';
import { engine as pacing } from '@hiraia/tala-core/pacing';
import * as Crypto from 'expo-crypto';
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
export const newId = () => Crypto.randomUUID();
export async function timelineInput(
  engine: SyncEngine,
  packs: CurriculumPack[],
  from: string,
  to: string
): Promise<TimelineInput | null> {
  const years = await engine.list('school_year');
  const year =
    years.find((y) => y.data.startDate <= today() && y.data.endDate >= today())?.data ??
    years[0]?.data;
  if (!year) return null;
  return {
    from,
    to,
    today: today(),
    schoolYear: year,
    classes: (await engine.list('class'))
      .map((r) => r.data)
      .filter((c) => !c.archived && c.schoolYearId === year.id),
    assignments: (await engine.list('assignment')).map((r) => r.data),
    tracks: (await engine.list('pacing_track')).map((r) => r.data),
    calendarDays: (await engine.list('calendar_day')).map((r) => r.data),
    competencies: packs.flatMap((p) => p.competencies),
    checks: (await engine.list('competency_check')).map((r) => r.data),
    marks: (await engine.list('session_mark')).map((r) => r.data),
    plans: (await engine.list('plan')).map((r) => r.data),
    pairingOverrides: (await engine.list('pairing_override')).map((r) => r.data),
    defaults: DEFAULT_PACING_PARAMS,
  };
}
export async function setupClass(
  engine: SyncEngine,
  input: {
    name: string;
    school: string;
    subject: string;
    grades: GradeLevel[];
    preset: CalendarPreset;
    sample: boolean;
    packs: CurriculumPack[];
    starts: Record<string, string>;
  }
) {
  const year = SchoolYear.parse({
    ...input.preset,
    id: newId(),
    schoolName: input.school,
    presetId: input.preset.id,
    presetVersion: input.preset.version,
    terms: input.preset.terms.map((t) => ({ ...t, id: newId() })),
  });
  await engine.put('school_year', year);
  const cls = ClassRecord.parse({
    id: newId(),
    schoolYearId: year.id,
    name: input.name,
    curriculum: input.packs.some((p) => input.grades.includes(p.grade)) ? 'deped' : 'none',
    gradeGroups: input.grades.map((grade) => ({ id: newId(), grade })),
    isSample: input.sample,
  });
  await engine.put('class', cls);
  for (const d of input.preset.days)
    await engine.put('calendar_day', {
      ...d,
      id: newId(),
      schoolYearId: year.id,
      classId: null,
      source: 'preset',
      minutesOverride: null,
      followsWeekday: null,
      assignmentIds: null,
    });
  const assignment = TeachingAssignment.parse({
    id: newId(),
    classId: cls.id,
    learningAreaId: 'science',
    subjectName: input.subject,
    gradeGroupIds: cls.gradeGroups.map((g) => g.id),
    slots: [1, 2, 3, 4, 5].map((weekday) => ({ id: newId(), weekday, minutes: 50 })),
  });
  await engine.put('assignment', assignment);
  for (const group of cls.gradeGroups)
    for (const term of year.terms) {
      let track = PacingTrack.parse({
        id: newId(),
        classId: cls.id,
        assignmentId: assignment.id,
        gradeGroupId: group.id,
        termId: term.id,
        curriculumVersion:
          input.packs.find((p) => p.grade === group.grade)?.curriculumVersion ?? null,
      });
      const competencies = input.packs
        .flatMap((p) => p.competencies)
        .filter(
          (c) =>
            c.grade === group.grade &&
            c.learningAreaId === assignment.learningAreaId &&
            c.termIndex === term.index
        );
      if (term.startDate <= today() && term.endDate >= today()) {
        const proposal = pacing.proposeStartPosition({
          track,
          schoolYear: year,
          term,
          assignment,
          calendarDays: [],
          competencies,
          today: today(),
          defaults: DEFAULT_PACING_PARAMS,
        });
        track = {
          ...track,
          startPosition: input.starts[group.grade]
            ? { competencyId: input.starts[group.grade]!, date: today(), estimated: false }
            : proposal,
        };
      }
      await engine.put('pacing_track', track);
    }
  return cls;
}
export async function createPlan(
  engine: SyncEngine,
  cls: Awaited<ReturnType<typeof setupClass>>,
  date = today(),
  assignmentId: string | null = null
) {
  const plan = Plan.parse({
    id: newId(),
    title: cls.name,
    templateId: cls.gradeGroups.length > 1 ? 'tpl.multigrade.v1' : 'tpl.dlp.v1',
    language: 'fil',
    grades: cls.gradeGroups.map((g) => g.grade),
    gradeGroupIds: cls.gradeGroups.map((g) => g.id),
    durationMinutes: 50,
    placements: [{ classId: cls.id, assignmentId, dates: [date] }],
  });
  await engine.put('plan', plan);
  for (const key of [
    'objectives',
    'materials',
    cls.gradeGroups.length > 1 ? 'multigrade' : 'procedure',
    'assessment',
    'reflection',
  ])
    await engine.put(
      'plan_section',
      PlanSection.parse({
        id: newId(),
        planId: plan.id,
        key,
        content:
          key === 'multigrade'
            ? {
                type: 'multigrade',
                blocks: [
                  {
                    id: newId(),
                    label: '',
                    minutes: 50,
                    teacherWith: 'all',
                    groups: Object.fromEntries(
                      cls.gradeGroups.map((g) => [g.id, { mode: 'shared', activity: [] }])
                    ),
                  },
                ],
              }
            : key === 'procedure'
              ? { type: 'procedure', steps: [{ id: newId(), title: '', minutes: 50, body: [] }] }
              : { type: 'text', blocks: [] },
      })
    );
  return plan;
}
export function samplePreset(): CalendarPreset {
  const d = today();
  const start = `${d.slice(0, 4)}-01-01`,
    end = `${d.slice(0, 4)}-12-31`;
  return {
    id: 'sample-calendar',
    version: '1',
    label: 'Sample',
    provisional: true,
    startDate: start,
    endDate: end,
    terms: [{ index: 1, name: 'Sample', startDate: start, endDate: end }],
    days: [],
    source: 'Fictional demonstration calendar; not a DepEd preset',
  };
}
