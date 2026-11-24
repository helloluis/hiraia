/**
 * Invented lessons for tests and previews of the combined multi-grade plan: single-grade plans shaped exactly like
 * the ones a Hiraia teaching pack gives a teacher (the five MATATAG phases, "Teacher:" / "Learners:" lines, an exit
 * ticket with its answer, support and extension), and the combined plan made from them, ready to print or export.
 * No real school, teacher or learner appears here.
 */
import type { GradeLevel, Lang } from '../contracts/common';
import { BUILTIN_TEMPLATES, type Block, type SectionContent } from '../contracts/content';
import type { Competency } from '../contracts/curriculum';
import { ClassRecord, Plan, PlanSection, SchoolYear } from '../contracts/records';
import type { RenderPlanOptions } from '../print';
import { buildCombinedPlan, gradeLessonFromPlan, type GradeLesson } from './combine';

const p = (text: string): Block => ({ t: 'p', spans: [{ text }] });
const labelled = (label: string, text: string): Block => ({ t: 'p', spans: [{ text: `${label}: `, b: true }, { text }] });

export const FIXTURE_PHASES: Record<Lang, string[]> = {
  en: ['Activating prior knowledge', 'Establishing lesson purpose', 'Developing and deepening understanding', 'Making generalizations', 'Evaluating learning'],
  fil: ['Pagkuha ng Dating Kaalaman', 'Paglalahad ng Layunin', 'Paglinang at Pagpapalalim', 'Paglalahat', 'Pagtataya'],
};

export const FIXTURE_TOPICS = ['Movement of objects', 'States of matter', 'Heat energy', 'Living things'];

/** A counter-based id maker, so fixtures are the same on every run. */
export function fixtureIds(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${String(++n).padStart(5, '0')}`;
}

/** One grade's lesson for one day, as `planFromPackDay` in the web app would write it. */
export function packLikePlan(args: {
  grade: GradeLevel;
  groupId: string;
  topic: string;
  lang: Lang;
  minutes?: number;
  aiDraft?: boolean;
  newId: () => string;
  /** Repeat the body text to make a long lesson (pagination tests). */
  length?: number;
}): { plan: Plan; sections: PlanSection[] } {
  const T = args.lang === 'en' ? 'Teacher' : 'Guro';
  const L = args.lang === 'en' ? 'Learners' : 'Mga mag-aaral';
  const more = (text: string) => Array.from({ length: args.length ?? 1 }, () => text).join(' ');
  const id = args.newId();
  const plan = Plan.parse({
    id,
    title: `Day 2: ${args.topic}`,
    templateId: 'tpl.dlp.v1',
    language: args.lang,
    subjectName: 'Science',
    learningAreaId: 'science',
    grades: [args.grade],
    gradeGroupIds: [args.groupId],
    competencies: { [args.groupId]: [`science-bow-2026.science.g${args.grade}.t2.6`] },
    curriculumVersion: 'science-bow-2026',
    durationMinutes: args.minutes ?? 45,
    placements: [{ classId: 'class001', assignmentId: 'assign01', dates: ['2026-11-24'] }],
    aiDraft: args.aiDraft ?? true,
    aiAssisted: true,
    lineage: { artifactId: `pack.sci26-g${args.grade}-t2-w10`, versionId: 'abcdef0123456789', title: args.topic, authorDisplayName: 'Hiraia teaching pack' },
  });
  const minutes = [5, 3, 22, 7, 8];
  const content: Record<string, SectionContent> = {
    objectives: { type: 'list', items: [`Learners will be able to describe ${args.topic.toLowerCase()} (Grade ${args.grade}).`] },
    content: { type: 'text', blocks: [p(`${args.topic} — Grade ${args.grade} Science, Term 2, Week 10, Day 2.`), p(`Big idea: ${args.topic} can be observed.`)] },
    materials: { type: 'list', items: [`ruler (G${args.grade})`, 'notebook', `Week deck "${args.topic}" (Slides 12–20)`] },
    procedure: {
      type: 'procedure',
      steps: FIXTURE_PHASES[args.lang].map((title, i) => ({
        id: args.newId(),
        title,
        minutes: minutes[i]!,
        body: [labelled(T, more(`G${args.grade} teacher line for step ${i + 1}.`)), labelled(L, more(`G${args.grade} learners line for step ${i + 1}.`)), p(`Slides ${12 + i}`)],
      })),
    },
    assessment: { type: 'text', blocks: [labelled('Exit ticket', `What did you notice about ${args.topic.toLowerCase()}?`), labelled('Answer', `G${args.grade} answer key.`)] },
    differentiation: {
      type: 'text',
      blocks: [labelled('Support', `G${args.grade} support.`), labelled('Extension', `G${args.grade} extension task.`), labelled('Longer period', `G${args.grade} longer.`)],
    },
  };
  const template = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.dlp.v1')!;
  const sections = template.sections.map((s) =>
    PlanSection.parse({ id: args.newId(), planId: id, key: s.key, content: content[s.key] ?? { type: 'text', blocks: [] }, origin: content[s.key] ? 'copied' : 'manual' })
  );
  return { plan, sections };
}

export const fixtureClass = (grades: GradeLevel[]): ClassRecord =>
  ClassRecord.parse({ id: 'class001', schoolYearId: 'year0001', name: 'Multigrade A', gradeGroups: grades.map((grade, i) => ({ id: `group00${i + 1}`, grade })) });

export function fixtureLessons(grades: GradeLevel[], lang: Lang, newId: () => string, opts: { minutes?: number; length?: number } = {}): GradeLesson[] {
  return grades.map((grade, i) => {
    const src = packLikePlan({ grade, groupId: `group00${i + 1}`, topic: FIXTURE_TOPICS[i]!, lang, minutes: opts.minutes, length: opts.length, newId });
    return gradeLessonFromPlan({ plan: src.plan, sections: src.sections, groupId: `group00${i + 1}`, grade });
  });
}

/** The stored curriculum record a fixture competency id stands for (text and source as the real packs carry them). */
export function fixtureCompetency(id: string): Pick<Competency, 'code' | 'text' | 'source'> {
  const grade = /\.g(\d+)\./.exec(id)?.[1] ?? '4';
  return {
    code: null,
    text: `Measure accurately the distance and time when things move using simple equipment (Grade ${grade}).`,
    source: { document: `DepEd Science G${grade}: 2026 Three-Term BOW`, edition: '2026-04-08', page: 7, url: 'https://example.invalid/bow.pdf' },
  };
}

/** A combined plan for a two-, three- or four-grade class, with everything a print or an export needs. */
export function combinedPrintFixture(
  args: { grades?: GradeLevel[]; lang?: Lang; minutes?: number; paper?: 'a4' | 'long'; length?: number } = {}
): RenderPlanOptions & { class: ClassRecord } {
  const grades = args.grades ?? ['4', '5'];
  const lang = args.lang ?? 'en';
  const minutes = args.minutes ?? 45;
  const newId = fixtureIds();
  const cls = fixtureClass(grades);
  const { plan, sections } = buildCombinedPlan({
    cls,
    assignment: { id: 'assign01', subjectName: 'Science', learningAreaId: 'science' },
    lessons: fixtureLessons(grades, lang, newId, { minutes, length: args.length }),
    date: '2026-11-24',
    minutes,
    language: lang,
    newId,
  });
  return {
    plan,
    sections,
    template: BUILTIN_TEMPLATES.find((t) => t.id === plan.templateId)!,
    class: cls,
    schoolYear: SchoolYear.parse({
      id: 'year0001',
      label: '2026–2027',
      schoolName: 'Sample Elementary School',
      startDate: '2026-06-01',
      endDate: '2027-03-31',
      terms: [
        { id: 'term0001', index: 1, name: 'Term 1', startDate: '2026-06-01', endDate: '2026-09-11' },
        { id: 'term0002', index: 2, name: 'Term 2', startDate: '2026-09-14', endDate: '2026-12-18' },
        { id: 'term0003', index: 3, name: 'Term 3', startDate: '2027-01-04', endDate: '2027-03-31' },
      ],
    }),
    teacherName: 'Teacher Peña',
    paper: args.paper ?? 'a4',
    lang,
    competencyLookup: fixtureCompetency,
    layout: 'table',
  };
}
