import { Id, type Lang } from '../contracts/common';
import { BUILTIN_TEMPLATES, type RichText } from '../contracts/content';
import { DEFAULT_PACING_PARAMS, type Competency } from '../contracts/curriculum';
import { ClassRecord, TeachingAssignment, PacingTrack, Student, Plan, PlanSection, SchoolYear, type CalendarDay, type RecordData } from '../contracts/records';
import { engine, allocationFromPlan } from '../pacing';
import { ordinal } from '../pacing/dates';
import { blankSections, lockPlan } from '../plan';
import { buildSampleCompetencies, SAMPLE_CURRICULUM_VERSION } from './competencies';
export { buildSampleCompetencies, SAMPLE_CURRICULUM_VERSION } from './competencies';

type SampleEntity = 'class' | 'assignment' | 'pacing_track' | 'student' | 'plan' | 'plan_section';
/** Discriminated persistence payload. No timestamps/envelopes: the sync engine supplies those. */
export type SampleRecord = { [E in SampleEntity]: { entity: E; data: RecordData<E>; isSample: true } }[SampleEntity];
export interface SampleClassBundle {
  isSample: true;
  label: string;
  schoolYear: SchoolYear;
  classRecord: ClassRecord;
  assignments: TeachingAssignment[];
  tracks: PacingTrack[];
  students: Student[];
  plans: Plan[];
  sections: PlanSection[];
  calendarDays: CalendarDay[];
  competencies: Competency[];
  records: SampleRecord[];
  /** Out-of-year dates use the nearest term as a preview, without changing the supplied calendar. */
  preview: 'current' | 'upcoming' | 'completed' | 'no_sessions';
}

/** Pure demo factory. newId must return fresh ids; all returned record ids get a sample: prefix. */
export function buildSampleClass(input: { schoolYear: SchoolYear; today: string; newId: () => string; lang: Lang }): SampleClassBundle {
  const year = SchoolYear.parse(input.schoolYear);
  ordinal(input.today);
  const seen = new Set<string>();
  const newId = () => {
    const id = Id.parse(`sample:${input.newId()}`);
    if (seen.has(id) || id === year.id || year.terms.some(t => t.id === id)) throw new Error('Sample identifiers must be fresh and unique.');
    seen.add(id); return id;
  };
  const L = (en: string, fil: string) => input.lang === 'fil' ? fil : en;
  const label = L('SAMPLE DATA ONLY', 'HALIMBAWANG DATOS LAMANG');
  const text = (en: string, fil: string): RichText => [{ t: 'p', spans: [{ text: `${label}: ${L(en, fil)}` }] }];
  const groups = [{ id: newId(), grade: '2' as const, learnerCount: 3 }, { id: newId(), grade: '4' as const, learnerCount: 3 }];
  const cls = ClassRecord.parse({ id: newId(), schoolYearId: year.id, name: `${label} — Grade 2 + Grade 4`, curriculum: 'deped', gradeGroups: groups, languages: [input.lang], isSample: true,
    profile: { materials: [L('Sample: counters and paper', 'Halimbawa: mga pananda at papel')], notes: L('Fictional demonstration class and learners. Not an official curriculum.', 'Kathang-isip na klase at mga mag-aaral. Hindi opisyal na kurikulum.') } });
  const assignment = TeachingAssignment.parse({ id: newId(), classId: cls.id, learningAreaId: 'mathematics', subjectName: L('Mathematics — SAMPLE', 'Matematika — HALIMBAWA'), gradeGroupIds: groups.map(g => g.id), language: input.lang,
    slots: [...new Set(year.teachingWeekdays)].sort((a, b) => a - b).map(weekday => ({ id: newId(), weekday, startTime: '09:00', minutes: 50 })) });
  const terms = [...year.terms].sort((a, b) => a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.index - b.index);
  const term = engine.termForDate(year, input.today) ?? terms.find(t => t.startDate >= input.today) ?? terms[terms.length - 1]!;
  const sessions = engine.enumerateSessions(year, term, assignment, []);
  const firstSession = sessions.find(s => s.date >= input.today) ?? sessions[sessions.length - 1];
  const startDate = firstSession?.date ?? term.startDate;
  const competencies = groups.flatMap(g => buildSampleCompetencies(g.grade, year.terms.map(t => t.index)));
  const tracks = groups.map(group => {
    const track = PacingTrack.parse({ id: newId(), classId: cls.id, assignmentId: assignment.id, gradeGroupId: group.id, termId: term.id, curriculumVersion: SAMPLE_CURRICULUM_VERSION,
      params: { bufferRatio: 0, assessmentSessionsPerTerm: 0 } });
    const pacingInput = { schoolYear: year, term, assignment, track, competencies: competencies.filter(c => c.grade === group.grade), calendarDays: [], checks: [], marks: [], today: startDate, defaults: DEFAULT_PACING_PARAMS };
    track.startPosition = engine.proposeStartPosition(pacingInput);
    track.allocation = allocationFromPlan(engine.computePacing(pacingInput));
    return track;
  });
  const students = groups.flatMap(group => [1, 2, 3].map((n, order) => Student.parse({ id: newId(), classId: cls.id, gradeGroupId: group.id,
    displayName: L(`Sample Learner G${group.grade}-${n} (fictional)`, `Halimbawang Mag-aaral G${group.grade}-${n} (kathang-isip)`), localId: `SAMPLE-G${group.grade}-${n}`, order })));
  const template = BUILTIN_TEMPLATES.find(t => t.kind === 'multigrade')!;
  const timeline = engine.buildTimeline({ from: startDate, to: term.endDate, today: input.today, schoolYear: year, classes: [cls], assignments: [assignment], tracks, calendarDays: [], competencies, checks: [], marks: [], plans: [], pairingOverrides: [], defaults: DEFAULT_PACING_PARAMS });
  const plans: Plan[] = [], sections: PlanSection[] = [];
  for (let i = 0; i < 3; i++) {
    const entry = timeline[i];
    const plan = Plan.parse({ id: newId(), title: `${label} — ${L(['Compare collections', 'Describe a pattern', 'Explain your grouping'][i]!, ['Paghambingin ang mga pangkat', 'Ilarawan ang padron', 'Ipaliwanag ang pagpapangkat'][i]!)}`,
      templateId: template.id, language: input.lang, subjectName: assignment.subjectName, learningAreaId: 'mathematics', grades: groups.map(g => g.grade), gradeGroupIds: groups.map(g => g.id), curriculumVersion: SAMPLE_CURRICULUM_VERSION,
      competencies: entry?.byGroup ?? Object.fromEntries(groups.map(g => [g.id, [competencies.find(c => c.grade === g.grade && c.termIndex === term.index)!.id]])),
      durationMinutes: 50, placements: [{ classId: cls.id, assignmentId: assignment.id, dates: entry ? [entry.date] : [] }] });
    const planSections = blankSections(template, plan.id, groups, newId);
    for (const section of planSections) {
      if (section.content.type === 'pergroup') {
        section.content.groups = Object.fromEntries(groups.map(g => [g.id, section.key === 'objectives'
          ? text(`Grade ${g.grade}: describe and compare a collection of objects.`, `Baitang ${g.grade}: ilarawan at paghambingin ang mga pangkat ng bagay.`)
          : section.key === 'materials' ? text('Paper, pencils and ten counters.', 'Papel, lapis at sampung pananda.')
          : text('Show one way to group the objects and explain your choice.', 'Ipakita ang isang paraan ng pagpapangkat at ipaliwanag ang iyong pinili.')]));
      } else if (section.content.type === 'multigrade') {
        section.content.blocks = [
          { id: newId(), label: `${label}: ${L('Explore together', 'Sama-samang tumuklas')}`, minutes: 10, transitionMinutes: 0, teacherWith: 'all', pairedGroupIds: groups.map(g => g.id), groups: Object.fromEntries(groups.map(g => [g.id, { mode: 'shared' as const, activity: text('Notice and describe the objects.', 'Obserbahan at ilarawan ang mga bagay.') }])) },
          ...groups.map((focus, index) => ({ id: newId(), label: `${label}: Grade ${focus.grade}`, minutes: 15, transitionMinutes: 2, teacherWith: focus.id, pairedGroupIds: [], groups: Object.fromEntries(groups.map((g, j) => [g.id, { mode: j === index ? 'direct' as const : 'independent' as const, activity: j === index ? text('Explain your grouping to the teacher.', 'Ipaliwanag sa guro ang iyong pagpapangkat.') : text('Draw and label a collection on your paper.', 'Iguhit at lagyan ng pangalan ang pangkat sa iyong papel.') }])) })),
          { id: newId(), label: `${label}: ${L('Share', 'Magbahagi')}`, minutes: 10, transitionMinutes: 0, teacherWith: 'all', pairedGroupIds: groups.map(g => g.id), groups: Object.fromEntries(groups.map(g => [g.id, { mode: 'shared' as const, activity: text('Share what you noticed.', 'Ibahagi ang iyong napansin.') }])) },
        ];
      } else if (section.content.type === 'text') section.content.blocks = text('Example reflection; no real learners or observations.', 'Halimbawang pagninilay; walang tunay na mag-aaral o obserbasyon.');
    }
    sections.push(...planSections);
    plans.push(i === 0 ? lockPlan({ plan, sections: planSections, template, class: cls, teacherName: L('Sample Teacher (fictional)', 'Halimbawang Guro (kathang-isip)'), at: `${input.today}T00:00:00.000Z`, revision: null }) : plan);
  }
  const records: SampleRecord[] = [
    { entity: 'class', data: cls, isSample: true },
    { entity: 'assignment', data: assignment, isSample: true },
    ...tracks.map(data => ({ entity: 'pacing_track' as const, data, isSample: true as const })),
    ...students.map(data => ({ entity: 'student' as const, data, isSample: true as const })),
    // Sections are synced before the locked plan so the server can capture the complete snapshot.
    ...sections.map(data => ({ entity: 'plan_section' as const, data, isSample: true as const })),
    ...plans.map(data => ({ entity: 'plan' as const, data, isSample: true as const })),
  ];
  return { isSample: true, label, schoolYear: year, classRecord: cls, assignments: [assignment], tracks, students, plans, sections, calendarDays: [], competencies, records,
    preview: !sessions.length ? 'no_sessions' : input.today < term.startDate ? 'upcoming' : input.today > term.endDate ? 'completed' : 'current' };
}
