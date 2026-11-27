/**
 * A teacher's saved lesson plan as the source of its slides (pure: no I/O). The server reads the CURRENT saved plan
 * through the records service and uses these to build the model's input and to tell when a lesson changed after its
 * slides were made; the web uses them to show which of a deck's slides are the lesson's.
 */
import type { Lang } from '../contracts/common';
import { BUILTIN_TEMPLATES, type SectionContent, type Template } from '../contracts/content';
import type { DeckSlide } from '../contracts/decks';
import type { Plan, PlanSection } from '../contracts/records';
import { richTextPlainText } from '../plan/text';

/** Sections written after the lesson was taught: never a source of slides, and editing them never makes slides stale. */
export const POST_CLASS_KEYS: readonly string[] = ['results', 'reflection'];

/** The plan's own pre-class sections, in its template's order (then by key). */
export function preClassSections(plan: Pick<Plan, 'id' | 'templateId'>, sections: PlanSection[], template?: Template | null): PlanSection[] {
  const tpl = template ?? BUILTIN_TEMPLATES.find((t) => t.id === plan.templateId) ?? null;
  const outside = new Set<string>([...POST_CLASS_KEYS, ...(tpl ? tpl.sections.filter((s) => s.outsideLock).map((s) => s.key) : [])]);
  const order = tpl ? tpl.sections.map((s) => s.key) : [];
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  return sections
    .filter((s) => s.planId === plan.id && !outside.has(s.key))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
}

/** JSON with object keys in a fixed order, so the same lesson always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * Everything of a lesson its slides are made from, as one stable text: the title, language, grades, competencies,
 * typed objectives and every pre-class section. The server keeps a hash of it with the slides; when the lesson's hash
 * differs later, its slides are "made for an older version of this lesson". Writing the results or the reflection
 * after class, locking, printing or moving the lesson to another date does not count as a change.
 */
export function lessonDigestSource(plan: Plan, sections: PlanSection[], template?: Template | null): string {
  return stableJson({
    title: plan.title.trim(),
    language: plan.language,
    grades: plan.grades,
    competencies: plan.competencies,
    customObjectives: plan.customObjectives,
    sections: preClassSections(plan, sections, template).map((s) => ({ key: s.key, content: s.content })),
  });
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const tidy = (s: string) => s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

export interface LessonForSlides {
  title: string;
  language: Lang;
  subject: string;
  /** The grade the slides are for. */
  grade: string;
  minutes: number;
  objectives: string[];
  /** Curriculum wording of the lesson's competencies (from the stored curriculum, never from a model). */
  competencies: Array<{ code: string | null; text: string }>;
  content: string;
  materials: string[];
  /** The lesson's steps in order (a week plan: its days). */
  procedure: Array<{ title: string; minutes: number | null; text: string }>;
  assessment: string;
  support: string;
  /** Other pre-class sections (assignment, custom sections). */
  other: Array<{ key: string; text: string }>;
}

function textOf(content: SectionContent | undefined, groupId: string | null): string {
  if (!content) return '';
  switch (content.type) {
    case 'text':
      return tidy(richTextPlainText(content.blocks));
    case 'list':
      return tidy(content.items.join('\n'));
    case 'pergroup': {
      const own = (groupId && content.groups[groupId]) || Object.values(content.groups)[0] || [];
      return tidy(richTextPlainText(own));
    }
    default:
      return '';
  }
}
function linesOf(content: SectionContent | undefined, groupId: string | null): string[] {
  if (!content) return [];
  if (content.type === 'list') return content.items.map((i) => i.trim()).filter(Boolean);
  return textOf(content, groupId)
    .split('\n')
    .map((l) => l.replace(/^[•\-–*]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * The lesson as the model's input: plain text only, cut to sensible lengths. `date` picks the day of a week plan;
 * `groupId` the grade group of per-grade sections. Post-class sections are never included.
 */
export function lessonForSlides(args: {
  plan: Plan;
  sections: PlanSection[];
  template?: Template | null;
  groupId?: string | null;
  date?: string | null;
  competencies?: Array<{ code: string | null; text: string }>;
}): LessonForSlides {
  const { plan } = args;
  const groupId = args.groupId ?? plan.gradeGroupIds[0] ?? null;
  const pre = preClassSections(plan, args.sections, args.template);
  const byKey = (key: string) => pre.find((s) => s.key === key)?.content;
  const procedure: LessonForSlides['procedure'] = [];
  const proc = byKey('procedure');
  const week = byKey('weekgrid');
  if (proc?.type === 'procedure')
    for (const step of proc.steps.slice(0, 16)) {
      const text = tidy(richTextPlainText(step.body));
      if (step.title.trim() || text) procedure.push({ title: clip(step.title.trim(), 200), minutes: step.minutes || null, text: clip(text, 1500) });
    }
  else if (week?.type === 'weekgrid') {
    const days = args.date && week.days.some((d) => d.date === args.date) ? week.days.filter((d) => d.date === args.date) : week.days;
    for (const d of days.slice(0, 7)) {
      const text = tidy(richTextPlainText(d.body));
      if (text) procedure.push({ title: d.date ?? `Day ${d.weekday}`, minutes: d.minutes ?? null, text: clip(text, 1500) });
    }
  }
  const known = new Set(['objectives', 'content', 'materials', 'procedure', 'weekgrid', 'multigrade', 'assessment', 'differentiation']);
  return {
    title: clip(plan.title.trim(), 200),
    language: plan.language,
    subject: plan.subjectName.trim(),
    grade: plan.grades[0] ?? '',
    minutes: plan.durationMinutes,
    objectives: [...linesOf(byKey('objectives'), groupId), ...plan.customObjectives].map((l) => clip(l, 400)).slice(0, 12),
    competencies: (args.competencies ?? []).slice(0, 8).map((c) => ({ code: c.code, text: clip(c.text, 600) })),
    content: clip(textOf(byKey('content'), groupId), 2500),
    materials: linesOf(byKey('materials'), groupId).map((l) => clip(l, 200)).slice(0, 25),
    procedure,
    assessment: clip(textOf(byKey('assessment'), groupId), 1500),
    support: clip(textOf(byKey('differentiation'), groupId), 1200),
    other: pre
      .filter((s) => !known.has(s.key))
      .map((s) => ({ key: s.key, text: clip(textOf(s.content, groupId), 800) }))
      .filter((o) => o.text)
      .slice(0, 4),
  };
}

/** True when a lesson has nothing slides could be made from yet (no objectives, competencies, content or steps). */
export function lessonIsEmpty(l: LessonForSlides): boolean {
  return !l.objectives.length && !l.competencies.length && !l.content && !l.procedure.length && !l.assessment;
}

/** The slides of a deck that are one lesson's: that day's slides and the deck's credits slide; day 0 = every slide. */
export function lessonSlidesOf(slides: DeckSlide[], day: number): DeckSlide[] {
  if (!day) return slides;
  return slides.filter((s) => s.day === day || s.kind === 'credits');
}

/** Days 1–5 a deck has slides for, in order. */
export function deckDays(slides: Pick<DeckSlide, 'day'>[]): number[] {
  return [...new Set(slides.map((s) => s.day).filter((d) => d >= 1 && d <= 5))].sort((a, b) => a - b);
}

/**
 * Which day of a pack's week a lesson made from that pack is. Tala names those lessons "Day n: …" ("Araw n: …"), and
 * places the five of them Monday to Friday of the week they were added for. So: the day in the title; else the
 * weekday of the lesson's date when the pack has that day; else 0 (the whole week, for the teacher to choose).
 */
export function packDayOfPlan(plan: Pick<Plan, 'title' | 'placements'>, days: number[]): number {
  const m = /^\s*(?:day|araw)\s*([1-5])\b/i.exec(plan.title);
  if (m && days.includes(Number(m[1]))) return Number(m[1]);
  const date = plan.placements[0]?.dates[0];
  if (date) {
    const [y, mo, d] = date.split('-').map(Number);
    const weekday = ((new Date(Date.UTC(y!, mo! - 1, d!, 12)).getUTCDay() + 6) % 7) + 1;
    if (weekday <= 5 && days.includes(weekday)) return weekday;
  }
  return 0;
}
