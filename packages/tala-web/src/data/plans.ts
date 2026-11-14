/**
 * Plan helpers for the web screens. Blank sections, DOC-1 lock validation and locking come from the shared
 * `@hiraia/tala-core/plan` (worker H); this file adds the web-only glue: template choice, new-plan assembly,
 * week dates for a DLL, display titles. Pure functions (tested in plans.test.ts).
 */
import {
  blankContent,
  blankSections as sharedBlankSections,
  hasSectionContent,
  validatePlanForLock,
} from '@hiraia/tala-core/plan';
import {
  BUILTIN_TEMPLATES,
  type ClassRecord,
  type Lang,
  type Plan,
  type PlanSection,
  type RichText,
  type SectionContent,
  type Template,
  type TemplateSection,
  type TeachingAssignment,
} from '@hiraia/tala-core/contracts';

export function templateById(id: string, custom: Template[] = []): Template | null {
  return BUILTIN_TEMPLATES.find((t) => t.id === id) ?? custom.find((t) => t.id === id) ?? null;
}

export function defaultTemplateFor(
  cls: ClassRecord | null,
  assignment: TeachingAssignment | null
): Template {
  const groups = assignment ? assignment.gradeGroupIds.length : (cls?.gradeGroups.length ?? 1);
  return groups > 1 ? BUILTIN_TEMPLATES[2]! : BUILTIN_TEMPLATES[0]!;
}

export function emptyContent(
  type: TemplateSection['contentType'],
  gradeGroupIds: string[],
  weekDates: Array<{ date: string | null; weekday: number }> = []
): SectionContent {
  const base = blankContent(type, gradeGroupIds);
  if (base.type === 'weekgrid' && weekDates.length)
    return { type: 'weekgrid', days: weekDates.map((d) => ({ ...d, body: [] as RichText })) };
  return base;
}

export function blankSections(
  template: Template,
  planId: string,
  gradeGroupIds: string[],
  newId: () => string,
  weekDates: Array<{ date: string | null; weekday: number }> = []
): PlanSection[] {
  const sections = sharedBlankSections(
    template,
    planId,
    gradeGroupIds.map((id) => ({ id })),
    newId
  );
  if (!weekDates.length) return sections;
  return sections.map((s) =>
    s.content.type === 'weekgrid'
      ? { ...s, content: emptyContent('weekgrid', gradeGroupIds, weekDates) }
      : s
  );
}

export function isSectionEmpty(content: SectionContent, gradeGroupIds: string[] = []): boolean {
  return !hasSectionContent(content, gradeGroupIds);
}

export type LockProblem =
  | { kind: 'empty'; key: string }
  | { kind: 'competency' }
  | { kind: 'other'; message: string };

/** DOC-1 via the shared validator, mapped to what the lock sheet shows. */
export function lockProblems(
  plan: Plan,
  sections: PlanSection[],
  template: Template,
  cls: ClassRecord | null
): LockProblem[] {
  const result = validatePlanForLock(plan, sections, template, cls ?? undefined);
  return result.errors.map((e) =>
    e.code === 'required_section'
      ? { kind: 'empty', key: e.sectionKey ?? '' }
      : e.code === 'competency_required'
        ? { kind: 'competency' }
        : { kind: 'other', message: e.message }
  );
}

export function planDates(plan: Plan): string[] {
  return [...new Set(plan.placements.flatMap((p) => p.dates))].sort();
}

export function sectionLabel(template: Template, key: string, lang: Lang): string {
  const s = template.sections.find((x) => x.key === key);
  return s ? s.label[lang] : key;
}

export interface NewPlanArgs {
  template: Template;
  cls: ClassRecord | null;
  assignment: TeachingAssignment | null;
  dates: string[];
  language: Lang;
  competencies?: Record<string, string[]>;
  curriculumVersion?: string | null;
  title?: string;
  newId: () => string;
}

export function newPlan(a: NewPlanArgs): { plan: Plan; sections: PlanSection[] } {
  const groupIds = a.assignment
    ? a.assignment.gradeGroupIds
    : (a.cls?.gradeGroups.map((g) => g.id) ?? []);
  const grades = (a.cls?.gradeGroups ?? [])
    .filter((g) => groupIds.includes(g.id))
    .map((g) => g.grade);
  const minutes = a.assignment?.slots[0]?.minutes ?? 50;
  const id = a.newId();
  const plan: Plan = {
    id,
    title: a.title ?? '',
    templateId: a.template.id,
    language: a.language,
    subjectName: a.assignment?.subjectName ?? '',
    learningAreaId: a.assignment?.learningAreaId ?? null,
    grades: grades.length ? grades : ['1'],
    gradeGroupIds: groupIds,
    competencies: a.competencies ?? {},
    curriculumVersion: a.curriculumVersion ?? null,
    customObjectives: [],
    durationMinutes: minutes,
    placements: a.cls
      ? [{ classId: a.cls.id, assignmentId: a.assignment?.id ?? null, dates: a.dates.slice(0, 7) }]
      : [],
    state: 'draft',
    lock: null,
    submitted: null,
    aiDraft: false,
    aiAssisted: false,
    lineage: null,
    unitId: null,
    conflictCopyOf: null,
  };
  const weekDates = a.template.span === 'week' ? weekDatesFrom(a.dates[0] ?? null) : [];
  return { plan, sections: blankSections(a.template, id, groupIds, a.newId, weekDates) };
}

function weekDatesFrom(first: string | null): Array<{ date: string | null; weekday: number }> {
  if (!first) return [1, 2, 3, 4, 5].map((weekday) => ({ date: null, weekday }));
  const [y, m, d] = first.split('-').map(Number);
  const base = new Date(Date.UTC(y!, m! - 1, d!, 12));
  const dow = (base.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(base.getTime() - dow * 86400_000);
  return [0, 1, 2, 3, 4].map((i) => {
    const dt = new Date(monday.getTime() + i * 86400_000);
    return { date: dt.toISOString().slice(0, 10), weekday: i + 1 };
  });
}

/** Human title fallback for lists. */
export function displayTitle(plan: Plan, untitled: string): string {
  return plan.title.trim() || (plan.subjectName ? plan.subjectName : untitled);
}
