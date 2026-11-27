/**
 * The lesson plan's slides panel, without React or I/O: which pack's slides fit a lesson and which day of them is the
 * lesson's, what a lesson's slide list offers to rewrite, and how an AI request is doing.
 */
import { packSubjectOf, type PackIndex, type PackLang, type PackStatus, type Plan, type SlidesJob } from '@hiraia/tala-core/contracts';
import { packDayOfPlan } from '@hiraia/tala-core/decks';
import { MULTIGRADE_TEMPLATE_ID } from '@hiraia/tala-core/plan';
import { suggestPack, termWeekFor } from '@/data/recommend';

const WEEK = [1, 2, 3, 4, 5];

export interface PackChoice {
  packId: string;
  /** The language version to copy (the lesson's own when that version can be opened). */
  lang: PackLang;
  /** The day of the week's slides that is this lesson's; 0 = not known (the whole week, until she chooses). */
  day: number;
  title: string;
  status: PackStatus;
  otherLanguage: boolean;
  /** lineage: the lesson was made from this pack; topic: same grade and competency; calendar: same week. */
  match: 'lineage' | 'topic' | 'calendar';
}

const weekday = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return ((new Date(Date.UTC(y!, m! - 1, d!, 12)).getUTCDay() + 6) % 7) + 1;
};

/**
 * The pack whose slides fit a single lesson, or null: the pack the lesson was made from (its lineage), else for a
 * Science lesson the pack the This Week page would suggest (same grade and competency, the closest week). Only Science
 * packs can be copied into Tala (the Mathematics pilot keeps its own checked pictures).
 */
export function packChoiceForLesson(args: {
  plan: Plan;
  index: Pick<PackIndex, 'packs'> | null;
  year: { terms: Array<{ index: number; startDate: string; endDate: string }> } | null;
}): PackChoice | null {
  const { plan, index } = args;
  if (!index || plan.templateId === MULTIGRADE_TEMPLATE_ID || plan.grades.length !== 1) return null;
  const lang: PackLang = plan.language;
  const fromPack = plan.lineage?.artifactId.startsWith('pack.') ? plan.lineage.artifactId.slice('pack.'.length) : null;
  if (fromPack) {
    if (packSubjectOf(fromPack) !== 'science') return null;
    const entry = index.packs.find((p) => p.packId === fromPack);
    const v = entry ? (entry.variants[lang].viewable ? entry.variants[lang] : entry.variants[lang === 'fil' ? 'en' : 'fil'].viewable ? entry.variants[lang === 'fil' ? 'en' : 'fil'] : null) : null;
    if (!entry || !v) return null;
    return { packId: fromPack, lang: v.language, day: packDayOfPlan(plan, WEEK), title: v.title ?? entry.topic, status: v.status, otherLanguage: v.language !== lang, match: 'lineage' };
  }
  if (plan.learningAreaId !== 'science') return null;
  const date = plan.placements[0]?.dates[0] ?? null;
  const where = date ? termWeekFor(args.year, date) : null;
  const s = suggestPack(index, { grade: plan.grades[0]!, competencyIds: Object.values(plan.competencies).flat(), term: where?.term ?? null, week: where?.week ?? null, lang });
  if (!s || packSubjectOf(s.packId) !== 'science') return null;
  return {
    packId: s.packId,
    lang: s.language,
    // Only a pack for the lesson's very week lines its Day 1–5 up with the lesson's weekday.
    day: s.sameWeek && date && weekday(date) <= 5 ? weekday(date) : 0,
    title: s.title,
    status: s.status,
    otherLanguage: s.otherLanguage,
    match: s.match,
  };
}

/** The request is still being worked on. */
export const jobBusy = (job: SlidesJob | null | undefined): boolean => job?.status === 'queued' || job?.status === 'running';

/** Seconds since a request began (for "Writing your slides… 12 s"). */
export const secondsSince = (iso: string, now: number): number => Math.max(0, Math.round((now - Date.parse(iso)) / 1000));

/** Whether this device still holds edits the server has not got (the slides are made from the lesson as saved there). */
export const unsent = (records: Array<{ dirty?: boolean } | null | undefined>): boolean => records.some((r) => Boolean(r?.dirty));
