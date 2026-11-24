/**
 * One lesson plan for a multi-grade session, made from the separate lessons of its grade groups.
 *
 * A multi-grade teacher often holds one single-grade lesson per grade (her own, or the day of a Hiraia teaching
 * pack). Printing them one after another is not a plan she can teach from: she is one person in one room. This
 * turns them into ONE session on the existing multi-grade model (contracts/content.ts, template
 * `tpl.multigrade.v1`): the room starts together, the teacher takes one grade at a time while the others work on
 * their own or in pairs, and the room finishes together. Objectives, materials and assessment stay per grade.
 *
 * It is deterministic and needs no connection or model: every word in the result is either the teacher's own
 * (taken from the source lessons, never reworded) or one of the short instructions in combine-words.ts. What it
 * produces is a private draft like any other plan: she edits it, saves it, prints it or exports it.
 *
 * Pure: no I/O, no clock, ids from the caller.
 */
import type { GradeLevel, Lang } from '../contracts/common';
import { BUILTIN_TEMPLATES, type Block, type MultigradeBlock, type RichText, type SectionContent, type Span } from '../contracts/content';
import { Plan, PlanSection, type ClassRecord, type PlanLineage, type TeachingAssignment } from '../contracts/records';
import { COMBINE_WORDS, LEARNER_LABELS, PHASE_TITLES, TEACHER_LABELS, type CombineWords } from './combine-words';
import { richTextPlainText } from './text';

export const MULTIGRADE_TEMPLATE_ID = 'tpl.multigrade.v1';

export type LessonRole = 'open' | 'develop' | 'close' | 'assess';

export interface GradeLessonStep {
  role: LessonRole;
  title: string;
  minutes: number;
  /** What the teacher does and says. */
  teacher: RichText;
  /** What learners do. */
  learners: RichText;
  /** Text of the step that names neither. */
  other: RichText;
}

/** One grade group's lesson, read into the parts a combined session needs. */
export interface GradeLesson {
  groupId: string;
  grade: GradeLevel;
  title: string;
  competencyIds: string[];
  curriculumVersion: string | null;
  objectives: RichText;
  /** What the lesson is and where it comes from (a pack's heading and big idea). */
  context: RichText;
  materials: string[];
  steps: GradeLessonStep[];
  assessment: RichText;
  differentiation: RichText;
  minutes: number;
  source: { planId: string | null; title: string; aiDraft: boolean; aiAssisted: boolean; lineage: PlanLineage | null };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const hasText = (blocks: RichText): boolean => richTextPlainText(blocks).trim().length > 0;
const p = (...spans: Span[]): Block => ({ t: 'p', spans });
const plain = (text: string): Block => p({ text: text.slice(0, 4000) });
const bold = (text: string): Span => ({ text, b: true });
const sameWords = (a: string, b: string) => a.trim().toLocaleLowerCase('en') === b.trim().toLocaleLowerCase('en');

/** Put a bold label in front of some text ("Teacher: …"). A list keeps its own shape under a label line. */
function labelled(label: string, body: RichText): RichText {
  if (!hasText(body)) return [];
  const [first, ...rest] = clone(body);
  if (first && first.t === 'p') return [p(bold(`${label}: `), ...first.spans), ...rest];
  return [p(bold(`${label}:`)), ...(first ? [first] : []), ...rest];
}

/** Split a step's text into the teacher's lines, the learners' lines and the rest, by its bold labels. */
function splitStepBody(body: RichText): Pick<GradeLessonStep, 'teacher' | 'learners' | 'other'> {
  const out = { teacher: [] as RichText, learners: [] as RichText, other: [] as RichText };
  // A bare label line ("Learners:") owns the list right under it; a labelled sentence owns only itself.
  let openLabel: 'teacher' | 'learners' | null = null;
  for (const block of body) {
    if (block.t === 'p' && block.spans.length) {
      const head = block.spans[0]!.text;
      const m = /^\s*([^:]{1,24})\s*:\s*/.exec(head);
      const label = m?.[1]?.trim() ?? '';
      const who = TEACHER_LABELS.some((l) => sameWords(l, label)) ? 'teacher' : LEARNER_LABELS.some((l) => sameWords(l, label)) ? 'learners' : null;
      if (m && who) {
        const restOfHead = head.slice(m[0].length);
        const spans = [...(restOfHead ? [{ ...block.spans[0]!, text: restOfHead, b: undefined }] : []), ...block.spans.slice(1)].map((s) => {
          const copy: Span = { text: s.text };
          if (s.b) copy.b = true;
          if (s.i) copy.i = true;
          return copy;
        });
        const said = spans.some((s) => s.text.trim());
        if (said) out[who].push({ t: 'p', spans });
        openLabel = said ? null : who;
        continue;
      }
    }
    if (openLabel && block.t !== 'p') out[openLabel].push(clone(block));
    else out.other.push(clone(block));
    openLabel = null;
  }
  return out;
}

function roleOf(title: string, index: number, count: number): LessonRole {
  for (const phase of PHASE_TITLES) if (phase.titles.some((t) => sameWords(t, title))) return phase.role;
  // A reworded or hand-written lesson: go by where the step sits.
  if (count <= 1) return 'develop';
  if (count === 2) return index === 0 ? 'develop' : 'close';
  return index === 0 ? 'open' : index === count - 1 ? 'close' : 'develop';
}

const listToRich = (items: string[]): RichText => {
  const kept = items.map((i) => i.trim()).filter(Boolean);
  return kept.length ? [{ t: 'ul', items: kept.map((text) => [{ text: text.slice(0, 4000) }]) }] : [];
};

function sectionRich(content: SectionContent | undefined, groupId: string): RichText {
  if (!content) return [];
  switch (content.type) {
    case 'text':
      return clone(content.blocks);
    case 'list':
      return listToRich(content.items);
    case 'pergroup':
      return clone(content.groups[groupId] ?? Object.values(content.groups)[0] ?? []);
    default:
      return [];
  }
}

function sectionLines(content: SectionContent | undefined, groupId: string): string[] {
  if (!content) return [];
  if (content.type === 'list') return content.items.map((i) => i.trim()).filter(Boolean);
  return sectionRich(content, groupId).flatMap((b) =>
    b.t === 'p'
      ? b.spans.map((s) => s.text).join('').split('\n')
      : b.items.map((spans) => spans.map((s) => s.text).join(''))
  ).map((l) => l.trim()).filter(Boolean);
}

/**
 * Read a teacher's single-grade plan (written by hand, drafted with AI, or copied from a teaching pack) into the
 * parts of a lesson. `date` picks the day of a week plan (DLL).
 */
export function gradeLessonFromPlan(args: {
  plan: Plan;
  sections: PlanSection[];
  groupId: string;
  grade: GradeLevel;
  date?: string | null;
}): GradeLesson {
  const { plan, groupId } = args;
  const own = args.sections.filter((s) => s.planId === plan.id);
  const byKey = (key: string) => own.find((s) => s.key === key)?.content;
  // A plan made for another class keys its per-group text by that class's group id: take its own group.
  const sourceGroup = plan.gradeGroupIds.includes(groupId) ? groupId : (plan.gradeGroupIds[0] ?? groupId);
  const procedure = byKey('procedure');
  const weekgrid = byKey('weekgrid');
  let steps: GradeLessonStep[] = [];
  if (procedure?.type === 'procedure') {
    const kept = procedure.steps.filter((s) => s.title.trim() || hasText(s.body));
    steps = kept.map((s, i) => ({ role: roleOf(s.title, i, kept.length), title: s.title.trim(), minutes: s.minutes, ...splitStepBody(s.body) }));
  } else if (weekgrid?.type === 'weekgrid') {
    const day = weekgrid.days.find((d) => args.date && d.date === args.date) ?? weekgrid.days.find((d) => hasText(d.body));
    if (day && hasText(day.body)) steps = [{ role: 'develop', title: '', minutes: day.minutes ?? plan.durationMinutes, ...splitStepBody(day.body) }];
  }
  return {
    groupId,
    grade: args.grade,
    title: plan.title.trim() || plan.subjectName.trim(),
    competencyIds: [...(plan.competencies[sourceGroup] ?? Object.values(plan.competencies)[0] ?? [])],
    curriculumVersion: plan.curriculumVersion,
    objectives: [...sectionRich(byKey('objectives'), sourceGroup), ...listToRich(plan.customObjectives)],
    context: sectionRich(byKey('content'), sourceGroup),
    materials: sectionLines(byKey('materials'), sourceGroup),
    steps,
    assessment: sectionRich(byKey('assessment'), sourceGroup),
    differentiation: sectionRich(byKey('differentiation'), sourceGroup),
    minutes: plan.durationMinutes,
    source: { planId: plan.id, title: plan.title.trim(), aiDraft: plan.aiDraft, aiAssisted: plan.aiAssisted, lineage: plan.lineage },
  };
}

/** A grade group with no lesson yet: its column is left for the teacher to write. */
export function blankGradeLesson(groupId: string, grade: GradeLevel, minutes: number): GradeLesson {
  return {
    groupId, grade, title: '', competencyIds: [], curriculumVersion: null, objectives: [], context: [], materials: [], steps: [],
    assessment: [], differentiation: [], minutes,
    source: { planId: null, title: '', aiDraft: false, aiAssisted: false, lineage: null },
  };
}

const GRADE_ORDER: GradeLevel[] = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
const gradeRank = (g: GradeLevel) => GRADE_ORDER.indexOf(g);

export interface CombineOptions {
  /** Two to four lessons, one per grade group, in the class's own group order. */
  lessons: GradeLesson[];
  /** Length of the session in minutes. */
  minutes: number;
  language: Lang;
  /** Group ids in the order they get the teacher. Default: the youngest grade first (it can wait alone least). */
  turnOrder?: string[];
  newId: () => string;
  words?: CombineWords;
}

export interface CombineWarning {
  code:
    | 'short_turns' // under 8 minutes with the teacher
    | 'many_groups' // three or four grades in one period
    | 'empty_box' // a grade has nothing to do in a block: the teacher must write it
    | 'no_lesson'; // a grade had no source lesson
  groupId?: string;
  blockId?: string;
}

export interface CombinedSession {
  title: string;
  sections: Array<{ key: 'objectives' | 'materials' | 'multigrade' | 'assessment'; content: SectionContent }>;
  warnings: CombineWarning[];
  /** Minutes each grade has with the teacher (the shortest turn). */
  minutesWithTeacher: number;
}

/** Opening, one turn per group, closing: whole minutes that add up to the period exactly. */
export function sessionMinutes(total: number, groups: number): { opening: number; turns: number[]; closing: number } {
  const t = Math.max(1, Math.floor(total));
  let shared = t >= 40 ? 5 : t >= 30 ? 4 : t >= 20 ? 3 : 2;
  while (shared > 0 && Math.floor((t - 2 * shared) / groups) < Math.min(5, Math.floor(t / groups))) shared--;
  if (t - 2 * shared < groups) shared = 0;
  const rest = t - 2 * shared;
  const base = Math.floor(rest / groups);
  const extra = rest - base * groups;
  return { opening: shared, closing: shared, turns: Array.from({ length: groups }, (_, i) => Math.max(1, base + (i < extra ? 1 : 0))) };
}

function stepLines(step: GradeLessonStep, w: CombineWords, withTitle: boolean): RichText {
  return [
    ...(withTitle && step.title ? [p(bold(step.title))] : []),
    ...labelled(w.teacher, step.teacher),
    ...labelled(w.learners, step.learners),
    ...clone(step.other),
  ];
}

/** The short label ("Day 1") that two or more titles all begin with, followed by ": " and more words. Else ''. */
export function sharedLead(titles: string[]): string {
  if (titles.length < 2) return '';
  const lead = /^([^:]{1,24}): \S/.exec(titles[0]!)?.[1] ?? '';
  return lead && titles.every((t) => t.startsWith(`${lead}: `) && t.slice(lead.length + 2).trim()) ? lead : '';
}

const firstLine = (blocks: RichText): string => (richTextPlainText(blocks).split('\n').map((l) => l.replace(/^[•\d.]+\s*/, '').trim()).find(Boolean) ?? '').slice(0, 400);

/** Combine the lessons into one session. Throws only for a call that is not a multi-grade session at all. */
export function combineLessons(o: CombineOptions): CombinedSession {
  const w = o.words ?? COMBINE_WORDS[o.language];
  const lessons = o.lessons;
  if (lessons.length < 2 || lessons.length > 4) throw new Error('A combined plan needs two to four grade groups.');
  if (new Set(lessons.map((l) => l.groupId)).size !== lessons.length) throw new Error('Each grade group can appear once.');
  const warnings: CombineWarning[] = [];
  const order = (
    o.turnOrder?.length === lessons.length && o.turnOrder.every((id) => lessons.some((l) => l.groupId === id)) && new Set(o.turnOrder).size === lessons.length
      ? o.turnOrder
      : [...lessons].sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade)).map((l) => l.groupId)
  ).map((id) => lessons.find((l) => l.groupId === id)!);
  const time = sessionMinutes(o.minutes, lessons.length);
  const gradeLabel = (l: GradeLesson) => w.gradeLabel(l.grade);

  const stepsOf = (l: GradeLesson, role: LessonRole) => l.steps.filter((s) => s.role === role);
  const exitPrompt = (l: GradeLesson): RichText => {
    const fromSteps = stepsOf(l, 'assess').flatMap((s) => clone(s.learners));
    if (hasText(fromSteps)) return fromSteps;
    // The first paragraph of the assessment is the question; what follows is the answer, which stays in the
    // Assessment section for the teacher.
    const first = l.assessment.find((b) => hasText([b]));
    return first ? [clone(first)] : [];
  };

  const openingCell = (l: GradeLesson): RichText => {
    const fromSteps = stepsOf(l, 'open').flatMap((s) => stepLines(s, w, false));
    if (hasText(fromSteps)) return fromSteps;
    const goal = firstLine(l.objectives);
    return goal ? [p(bold(`${w.goal}: `), { text: goal })] : [];
  };
  const directCell = (l: GradeLesson): RichText => {
    const develop = stepsOf(l, 'develop');
    const steps = develop.length ? develop : l.steps.filter((s) => s.role !== 'open' && s.role !== 'close');
    return steps.flatMap((s) => stepLines(s, w, steps.length > 1));
  };
  const prepareCell = (l: GradeLesson, nth: number): { mode: 'independent' | 'peer'; activity: RichText } => {
    if (nth > 0) return { mode: 'peer', activity: [plain(w.prepareInPairs)] };
    const goal = firstLine(l.objectives);
    return {
      mode: 'independent',
      activity: [
        plain(w.prepare),
        ...(goal ? [p(bold(`${w.goal}: `), { text: goal })] : []),
        ...(l.materials.length ? [p(bold(`${w.materials}: `), { text: l.materials.join('; ').slice(0, 1200) })] : []),
      ],
    };
  };
  const afterCell = (l: GradeLesson, nth: number, last: boolean): { mode: 'independent' | 'peer'; activity: RichText } => {
    const activity: RichText = [];
    if (nth === 0) {
      const own = stepsOf(l, 'develop').flatMap((s) => clone(s.learners));
      if (hasText(own)) activity.push(p(bold(`${w.carryOn}:`)), ...own);
    }
    if (last) {
      const exit = exitPrompt(l);
      if (hasText(exit)) activity.push(...labelled(w.exitTicket, exit));
      // "Extension: …" from the lesson's own differentiation notes is what a group does when it is done.
      const extension = l.differentiation.filter((b) => b.t === 'p' && /^\s*(extension|dagdag na hamon)\s*:/i.test(b.spans[0]?.text ?? ''));
      for (const b of extension) {
        if (b.t !== 'p') continue;
        const text = b.spans.map((s) => s.text).join('').replace(/^\s*[^:]{1,24}:\s*/, '');
        if (text.trim()) activity.push(p(bold(`${w.finishedEarly}: `), { text }));
      }
    }
    if (hasText(activity)) return { mode: 'independent', activity };
    return { mode: 'peer', activity: [plain(w.checkWithPartner)] };
  };
  const closingCell = (l: GradeLesson, hadTimeAfterTurn: boolean): RichText => {
    const close = stepsOf(l, 'close').flatMap((s) => stepLines(s, w, false));
    const out: RichText = [...close];
    if (!hadTimeAfterTurn) out.push(...labelled(w.exitTicket, exitPrompt(l)));
    if (!hasText(out)) out.push(plain(w.handIn));
    return out;
  };

  const blocks: MultigradeBlock[] = [];
  const groupsOf = (cell: (l: GradeLesson) => MultigradeBlock['groups'][string]) => Object.fromEntries(lessons.map((l) => [l.groupId, cell(l)]));
  if (time.opening > 0)
    blocks.push({
      id: o.newId(), label: w.opening, minutes: time.opening, transitionMinutes: 0, teacherWith: 'all', pairedGroupIds: [],
      groups: groupsOf((l) => ({ mode: 'shared', activity: openingCell(l) })),
    });
  order.forEach((turn, k) => {
    const minutes = time.turns[k]!;
    blocks.push({
      id: o.newId(), label: w.turn(gradeLabel(turn)), minutes, transitionMinutes: minutes >= 8 ? 1 : 0, teacherWith: turn.groupId, pairedGroupIds: [],
      groups: groupsOf((l) => {
        const own = order.indexOf(l);
        if (own === k) return { mode: 'direct', activity: directCell(l) };
        if (own > k) return prepareCell(l, k);
        return afterCell(l, k - own - 1, k === order.length - 1);
      }),
    });
  });
  if (time.closing > 0)
    blocks.push({
      id: o.newId(), label: w.closing, minutes: time.closing, transitionMinutes: 0, teacherWith: 'all', pairedGroupIds: [],
      groups: groupsOf((l) => ({ mode: 'shared', activity: closingCell(l, order.indexOf(l) < order.length - 1) })),
    });

  for (const l of lessons) if (!l.source.planId && !l.steps.length && !hasText(l.objectives)) warnings.push({ code: 'no_lesson', groupId: l.groupId });
  for (const b of blocks) for (const l of lessons) if (!hasText(b.groups[l.groupId]?.activity ?? [])) warnings.push({ code: 'empty_box', groupId: l.groupId, blockId: b.id });
  const minutesWithTeacher = Math.min(...time.turns);
  if (lessons.length >= 3) warnings.push({ code: 'many_groups' });
  if (minutesWithTeacher < 8) warnings.push({ code: 'short_turns' });

  // The title names each grade's lesson. A label every lesson's title starts with ("Day 1: …" on each grade's pack
  // lesson) is said once at the front, not once per grade.
  const lead = sharedLead(lessons.filter((l) => l.title).map((l) => l.title));
  const titlePart = (l: GradeLesson): string => {
    const own = lead ? l.title.slice(lead.length + 2).trim() : l.title;
    return own ? `${gradeLabel(l)}: ${own}` : gradeLabel(l);
  };

  // The note says what kind of plan this is, where it came from and what to watch (PRD §9.3), within its limit.
  const sources = lessons.filter((l) => l.source.title).map((l) => `${gradeLabel(l)}: ${l.source.title.slice(0, 70)}`);
  const extras = [...(lessons.length >= 3 ? [w.noteManyGroups] : []), ...(minutesWithTeacher < 8 ? [w.noteShortTurns] : [])];
  const grades = lessons.map(gradeLabel);
  let note = [w.note({ grades, minutesEach: minutesWithTeacher, sources }), ...extras].join(' ');
  if (note.length > 600) note = [w.note({ grades, minutesEach: minutesWithTeacher, sources: [] }), ...extras].join(' ');
  note = note.slice(0, 600);

  const perGroup = (cell: (l: GradeLesson) => RichText): SectionContent => ({ type: 'pergroup', groups: Object.fromEntries(lessons.map((l) => [l.groupId, cell(l)])) });
  return {
    title: w.planTitle([...(lead ? [lead] : []), ...lessons.map(titlePart)]).slice(0, 200),
    minutesWithTeacher,
    warnings,
    sections: [
      { key: 'objectives', content: perGroup((l) => [...clone(l.objectives), ...clone(l.context)]) },
      { key: 'materials', content: perGroup((l) => listToRich(l.materials)) },
      { key: 'multigrade', content: { type: 'multigrade', blocks, note } },
      {
        key: 'assessment',
        content: perGroup((l) => [...clone(l.assessment), ...(hasText(l.differentiation) ? [p(bold(w.supportHeading)), ...clone(l.differentiation)] : [])]),
      },
    ],
  };
}

/**
 * The rules a session flow must keep to be teachable by one teacher (the same ones generated plans are held to,
 * generation/index.ts): the blocks fill the period exactly, she is with one group at a time unless groups are
 * explicitly paired, a group taught directly has her, and a shared block has the whole room.
 * Returns a code per problem; an empty list means the flow is sound. An empty box is not a problem here: a
 * teacher may still be writing it.
 */
export function checkSessionFlow(content: SectionContent, groupIds: string[], minutes: number): string[] {
  if (content.type !== 'multigrade') return ['not_multigrade'];
  const problems: string[] = [];
  if (content.blocks.reduce((n, b) => n + b.minutes, 0) !== minutes) problems.push('minutes_do_not_add_up');
  for (const b of content.blocks) {
    if (b.transitionMinutes > b.minutes) problems.push(`transition_too_long:${b.id}`);
    if (b.teacherWith !== 'all' && b.teacherWith !== 'none' && !groupIds.includes(b.teacherWith)) problems.push(`unknown_teacher_focus:${b.id}`);
    if (b.pairedGroupIds.some((id) => !groupIds.includes(id))) problems.push(`unknown_paired_group:${b.id}`);
    const direct = groupIds.filter((id) => b.groups[id]?.mode === 'direct');
    if (direct.length > 1 && !direct.every((id) => b.pairedGroupIds.includes(id))) problems.push(`teacher_with_two_groups:${b.id}`);
    for (const id of groupIds) {
      const a = b.groups[id];
      if (!a) {
        problems.push(`group_missing:${b.id}:${id}`);
        continue;
      }
      if (a.mode === 'direct' && b.teacherWith !== id && !(b.pairedGroupIds.includes(id) && b.pairedGroupIds.includes(b.teacherWith)))
        problems.push(`direct_without_teacher:${b.id}:${id}`);
      if (a.mode === 'shared' && b.teacherWith !== 'all') problems.push(`shared_without_whole_room:${b.id}:${id}`);
    }
  }
  return problems;
}

/** The combined session as records ready to save: a draft plan on the multi-grade template and all its sections. */
export function buildCombinedPlan(args: {
  cls: Pick<ClassRecord, 'id' | 'gradeGroups'>;
  assignment: Pick<TeachingAssignment, 'id' | 'subjectName' | 'learningAreaId'> | null;
  lessons: GradeLesson[];
  date: string | null;
  minutes: number;
  language: Lang;
  turnOrder?: string[];
  newId: () => string;
  words?: CombineWords;
}): { plan: Plan; sections: PlanSection[]; warnings: CombineWarning[]; minutesWithTeacher: number } {
  const template = BUILTIN_TEMPLATES.find((t) => t.id === MULTIGRADE_TEMPLATE_ID)!;
  // The class's own order decides the columns; only its groups can be in the plan.
  const lessons = args.cls.gradeGroups.map((g) => args.lessons.find((l) => l.groupId === g.id)).filter((l): l is GradeLesson => !!l);
  const session = combineLessons({ lessons, minutes: args.minutes, language: args.language, turnOrder: args.turnOrder, newId: args.newId, words: args.words });
  const planId = args.newId();
  const versions = [...new Set(lessons.map((l) => l.curriculumVersion).filter((v): v is string => !!v))];
  const lineages = lessons.map((l) => l.source.lineage);
  const sameLineage = lineages.every((x) => x && lineages[0] && x.artifactId === lineages[0].artifactId && x.versionId === lineages[0].versionId);
  const groupIds = lessons.map((l) => l.groupId);
  const plan = Plan.parse({
    id: planId,
    title: session.title,
    templateId: template.id,
    language: args.language,
    subjectName: args.assignment?.subjectName ?? '',
    learningAreaId: args.assignment?.learningAreaId ?? null,
    grades: lessons.map((l) => l.grade),
    gradeGroupIds: groupIds,
    competencies: Object.fromEntries(lessons.filter((l) => l.competencyIds.length).map((l) => [l.groupId, [...l.competencyIds]])),
    // One version when the grades agree; a plan cannot name two.
    curriculumVersion: versions.length === 1 ? versions[0] : null,
    customObjectives: [],
    durationMinutes: args.minutes,
    placements: [{ classId: args.cls.id, assignmentId: args.assignment?.id ?? null, dates: args.date ? [args.date] : [] }],
    state: 'draft',
    // Honest labels travel with the words: a combined plan is an AI draft while any lesson it was made from is.
    aiDraft: lessons.some((l) => l.source.aiDraft),
    aiAssisted: lessons.some((l) => l.source.aiAssisted),
    lineage: sameLineage ? lineages[0] : null,
  });
  const copied = new Map(session.sections.map((s) => [s.key as string, s.content]));
  const sections = template.sections.map((spec) => {
    const content = copied.get(spec.key);
    return PlanSection.parse({
      id: args.newId(),
      planId,
      key: spec.key,
      content: content ?? (spec.contentType === 'pergroup' ? { type: 'pergroup', groups: Object.fromEntries(groupIds.map((id) => [id, []])) } : { type: 'text', blocks: [] }),
      origin: content ? 'copied' : 'manual',
    });
  });
  return { plan, sections, warnings: session.warnings, minutesWithTeacher: session.minutesWithTeacher };
}
