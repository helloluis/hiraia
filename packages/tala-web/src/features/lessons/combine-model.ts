/**
 * Choosing what goes into a combined multi-grade lesson plan (no React, no I/O): which classes can have one, which
 * of the teacher's saved lessons could be each grade's part, and turning the choice into one private draft plan.
 * The combining itself is `@hiraia/tala-core/plan` (combine.ts); this is the web's glue around it.
 */
import {
  MULTIGRADE_TEMPLATE_ID,
  blankGradeLesson,
  buildCombinedPlan,
  gradeLessonFromPlan,
  sessionMinutes,
  type CombineWarning,
} from '@hiraia/tala-core/plan';
import type { ClassRecord, Lang, Plan, PlanSection, TeachingAssignment } from '@hiraia/tala-core/contracts';

/** A session can hold two to four grade groups (more would leave each a turn too short to teach in). */
export const MAX_GROUPS = 4;

export const isMultigradeClass = (cls: Pick<ClassRecord, 'gradeGroups'>): boolean => cls.gradeGroups.length >= 2;

/** The grade groups a combined plan is for: the subject's groups when a subject is chosen, else the whole class. */
export function groupsFor(cls: ClassRecord, assignment: Pick<TeachingAssignment, 'gradeGroupIds'> | null): ClassRecord['gradeGroups'] {
  const groups = assignment ? cls.gradeGroups.filter((g) => assignment.gradeGroupIds.includes(g.id)) : cls.gradeGroups;
  return groups.slice(0, MAX_GROUPS);
}

/** Subjects of the class that are taught to at least two of its grade groups together. */
export const multigradeAssignments = (cls: ClassRecord, assignments: TeachingAssignment[]): TeachingAssignment[] =>
  assignments.filter((a) => a.classId === cls.id && cls.gradeGroups.filter((g) => a.gradeGroupIds.includes(g.id)).length >= 2);

/**
 * Which subject the screen shows. Her own choice stands once she has made one, also "all grades, no subject".
 * Before that, a class with exactly one multi-grade subject starts on it. A subject of another class is dropped.
 */
export function subjectFor(args: { assignments: Array<Pick<TeachingAssignment, 'id'>>; current: string; touched: boolean }): string {
  if (args.current && !args.assignments.some((a) => a.id === args.current)) return '';
  if (!args.current && !args.touched && args.assignments.length === 1) return args.assignments[0]!.id;
  return args.current;
}

const planDates = (plan: Plan): string[] => [...new Set(plan.placements.flatMap((p) => p.dates))].sort();

export interface LessonChoice {
  plan: Plan;
  /** Placed on this class on the chosen date. */
  onDate: boolean;
  /** Written for this class's own grade group. */
  ownGroup: boolean;
  /** Its latest date, for the label. */
  date: string | null;
}

/**
 * The saved lessons that could be one grade group's part of the session: a single-grade lesson of that group, or
 * of the same grade in another class. Combined plans and archived lessons are never offered. The lesson placed on
 * this class on the chosen date comes first, then this group's other lessons, newest first.
 */
export function lessonChoices(args: { plans: Plan[]; cls: ClassRecord; groupId: string; date: string | null; subjectName?: string | null }): LessonChoice[] {
  const group = args.cls.gradeGroups.find((g) => g.id === args.groupId);
  if (!group) return [];
  const classGroupIds = new Set(args.cls.gradeGroups.map((g) => g.id));
  return args.plans
    .filter((p) => p.state !== 'archived' && p.templateId !== MULTIGRADE_TEMPLATE_ID)
    .filter((p) => {
      const own = p.gradeGroupIds.length === 1 && p.gradeGroupIds[0] === group.id;
      const elsewhere = !p.gradeGroupIds.some((id) => classGroupIds.has(id)) && p.grades.length === 1 && p.grades[0] === group.grade;
      return own || elsewhere;
    })
    .filter((p) => !args.subjectName || !p.subjectName || p.subjectName === args.subjectName)
    .map((plan): LessonChoice => {
      const dates = planDates(plan);
      const onDate = !!args.date && plan.placements.some((pl) => pl.classId === args.cls.id && pl.dates.includes(args.date!));
      return { plan, onDate, ownGroup: plan.gradeGroupIds[0] === group.id, date: (onDate ? args.date : dates[dates.length - 1]) ?? null };
    })
    .sort(
      (a, b) =>
        Number(b.onDate) - Number(a.onDate) ||
        Number(b.ownGroup) - Number(a.ownGroup) ||
        (b.date ?? '').localeCompare(a.date ?? '') ||
        a.plan.title.localeCompare(b.plan.title) ||
        a.plan.id.localeCompare(b.plan.id)
    );
}

/** What to pre-select for a group: its lesson on the chosen date, if it has exactly that. Otherwise nothing. */
export const suggestedPick = (choices: LessonChoice[]): string | null => {
  const onDate = choices.filter((c) => c.onDate && c.ownGroup);
  return onDate.length === 1 ? onDate[0]!.plan.id : null;
};

/** Minutes of the subject's slot on the weekday of `date` (1 = Monday), else its first slot, else 50. */
export function periodMinutes(assignment: Pick<TeachingAssignment, 'slots'> | null, date: string | null): number {
  if (!assignment?.slots.length) return 50;
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    const weekday = ((new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay() + 6) % 7) + 1;
    const slot = assignment.slots.find((s) => s.weekday === weekday);
    if (slot) return slot.minutes;
  }
  return assignment.slots[0]!.minutes;
}

/** How the period is shared, for the sentence under the minutes field. */
export const timeSplit = (minutes: number, groups: number) => sessionMinutes(minutes, groups);

export interface CombineInput {
  cls: ClassRecord;
  assignment: TeachingAssignment | null;
  date: string | null;
  minutes: number;
  language: Lang;
  /** Grade group id → the saved lesson chosen for it, or null to leave that grade for the teacher to write. */
  picks: Record<string, string | null>;
  plans: Plan[];
  /** Sections of (at least) the chosen plans. */
  sections: PlanSection[];
  newId: () => string;
}

export interface CombineResult {
  plan: Plan;
  sections: PlanSection[];
  warnings: CombineWarning[];
  minutesWithTeacher: number;
}

/** One private draft plan on the multi-grade template, ready to save. Throws when fewer than two grades are in it. */
export function combineSavedLessons(input: CombineInput): CombineResult {
  const groups = groupsFor(input.cls, input.assignment);
  if (groups.length < 2) throw new Error('A combined plan needs at least two grade groups.');
  const lessons = groups.map((g) => {
    const plan = input.plans.find((p) => p.id === input.picks[g.id]);
    return plan
      ? gradeLessonFromPlan({ plan, sections: input.sections.filter((s) => s.planId === plan.id), groupId: g.id, grade: g.grade, date: input.date })
      : blankGradeLesson(g.id, g.grade, input.minutes);
  });
  return buildCombinedPlan({
    cls: { id: input.cls.id, gradeGroups: groups },
    assignment: input.assignment,
    lessons,
    date: input.date,
    minutes: input.minutes,
    language: input.language,
    newId: input.newId,
  });
}
