/**
 * Feed weighting — pure functions, no app or storage dependencies.
 * Ruleset: rag/pipeline/FEED-WEIGHTING.md. Calendar: rag/pipeline/sy-calendar.json.
 *
 *   w = curriculum(tag, grade, quarterNow) × recency × seenCard × seenCompetency
 *
 * Heaviest: the student's grade in the curriculum quarter inferred from the device date.
 * Lightest: cards/competencies already seen (a decaying weight, never zero, never a blocklist).
 */
import type { GradeLevel } from '../types/index.js';
import type { Quarter } from './index.js';

// ---------------------------------------------------------------- calendar

export interface SchoolTerm {
  readonly term: number;
  readonly start: string; // ISO date, inclusive
  readonly end: string; // ISO date, inclusive (end of the end-of-term block)
  readonly instruction: readonly [string, string]; // instructional window, inclusive
}

export interface SchoolCalendar {
  readonly schoolYear: string;
  readonly source: string;
  readonly opens: string;
  readonly closes: string;
  readonly terms: readonly SchoolTerm[];
}

/** DepEd Order No. 009, s. 2026 — the three-term SY 2026-27 calendar. */
export const SY_2026_27: SchoolCalendar = {
  schoolYear: '2026-2027',
  source: 'DepEd Order No. 009, s. 2026 (three-term school calendar)',
  opens: '2026-06-08',
  closes: '2027-04-08',
  terms: [
    { term: 1, start: '2026-06-08', end: '2026-09-15', instruction: ['2026-06-15', '2026-09-01'] },
    { term: 2, start: '2026-09-16', end: '2026-12-18', instruction: ['2026-09-16', '2026-12-04'] },
    { term: 3, start: '2027-01-04', end: '2027-04-08', instruction: ['2027-01-04', '2027-03-23'] },
  ],
};

function localDate(iso: string): Date {
  const [y = 0, m = 1, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Inclusive count of Mon–Fri days between two dates. */
export function weekdaysBetween(a: Date, b: Date): number {
  let n = 0;
  const cur = dayStart(a);
  const stop = dayStart(b);
  while (cur <= stop) {
    const wd = cur.getDay();
    if (wd !== 0 && wd !== 6) n += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/** Known DepEd calendars, most recent first. Add each new DepEd Order here; dates outside every known
 * calendar fall back to genericCalendar() so the feed keeps rolling over school years unattended. */
export const KNOWN_CALENDARS: readonly SchoolCalendar[] = [SY_2026_27];

function nthMondayOfJune(year: number, n: number): Date {
  const d = new Date(year, 5, 1);
  const offset = (8 - d.getDay()) % 7; // days to the first Monday
  return new Date(year, 5, 1 + offset + 7 * (n - 1));
}

function iso(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Generic Philippine school year for a start year with no DepEd Order on file: opens the second
 * Monday of June (RA 11480 window; SY 2026-27 opened June 8), closes the second Friday of April,
 * one continuous instructional window. Only the elapsed-fraction matters for quarter inference,
 * so term breaks are not modelled. An approximation — replace by adding the real calendar.
 */
export function genericCalendar(startYear: number): SchoolCalendar {
  const opens = nthMondayOfJune(startYear, 2);
  const april = new Date(startYear + 1, 3, 1);
  const firstFriday = 1 + ((5 - april.getDay() + 7) % 7);
  const closes = new Date(startYear + 1, 3, firstFriday + 7);
  return {
    schoolYear: `${startYear}-${startYear + 1}`,
    source: 'generic PH school-year model (no DepEd Order on file)',
    opens: iso(opens),
    closes: iso(closes),
    terms: [{ term: 1, start: iso(opens), end: iso(closes), instruction: [iso(opens), iso(closes)] }],
  };
}

/** The calendar a date belongs to: a known one if the date falls inside it, else the generic model
 * for that school year (June–April → the year the SY opened; the summer gap resolves to no quarter). */
export function calendarFor(date: Date, known: readonly SchoolCalendar[] = KNOWN_CALENDARS): SchoolCalendar {
  const d = dayStart(date);
  for (const cal of known) {
    if (d >= localDate(cal.opens) && d <= localDate(cal.closes)) return cal;
  }
  const startYear = d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
  return genericCalendar(startYear);
}

export interface QuarterInference {
  /** MATATAG curriculum quarter most likely being taught; null outside the school year. */
  quarter: Quarter | null;
  /** Fraction of the school year's instructional weekdays already elapsed (0–1). */
  fraction: number;
  inSchoolYear: boolean;
}

/**
 * MATATAG competencies are organised in FOUR quarters; SY 2026-27 runs THREE terms and DepEd has
 * published no quarter→term pacing guide. We infer the curriculum quarter from the fraction of
 * instructional weekdays elapsed: Q = ⌊4·f⌋ + 1. End-of-term blocks count as the end of that
 * term's instruction. Outside the school year there is no current quarter.
 */
export function inferCurriculumQuarter(date: Date, cal: SchoolCalendar = calendarFor(date)): QuarterInference {
  const d = dayStart(date);
  if (d < localDate(cal.opens) || d > localDate(cal.closes)) {
    return { quarter: null, fraction: 0, inSchoolYear: false };
  }
  let total = 0;
  let done = 0;
  for (const t of cal.terms) {
    const a = localDate(t.instruction[0]);
    const b = localDate(t.instruction[1]);
    const e = localDate(t.end);
    const n = weekdaysBetween(a, b);
    total += n;
    if (d > e) done += n;
    else if (d >= a) done += weekdaysBetween(a, d < b ? d : b);
  }
  const fraction = total > 0 ? done / total : 0;
  const quarter = Math.min(4, Math.floor(fraction * 4) + 1) as Quarter;
  return { quarter, fraction, inSchoolYear: true };
}

// ---------------------------------------------------------------- curriculum factor

/**
 * One grade-quarter cell a card serves. strength 2 = agreed by two labelers or a confident
 * label; 1 = weak (capped at the adjacent-quarter level). norm = per-competency normalisation of
 * the code that produced this cell, sqrt(median_n / n_code) clamped — applied only to the lift
 * above the ×1 baseline, so a fat competency cannot swamp its cell and no tagged card ever drops
 * below an untagged one.
 */
export interface CurriculumCell {
  grade: number;
  quarter: number;
  strength?: 1 | 2;
  norm?: number;
}

/**
 * A card's MATATAG tag (rag/pipeline/assemble-competency-labels.py, v2 multi-label). `competency`
 * is the primary code; `cells` every grade-quarter cell the card's codes imply (a spiral
 * curriculum revisits ideas, so most cards have two). `codes` = every competency code the card
 * serves, best first (used for competency_seen).
 */
export interface CurriculumTag {
  competency: string; // e.g. "G5-L-5"
  grade: number;
  quarter: number;
  /** 0–1. Below minConfidence the tag is treated as off-curriculum. */
  confidence: number;
  cells?: readonly CurriculumCell[];
  codes?: readonly string[];
}

export interface CurriculumWeights {
  sameGradeCurrentQuarter: number;
  sameGradeAdjacentQuarter: number;
  sameGradeOtherQuarter: number;
  adjacentGradeCurrentQuarter: number;
  /** School out: every cell of the student's own grade, weighted equally. */
  schoolOutSameGrade: number;
  other: number;
  offCurriculum: number;
  minConfidence: number;
}

/** Re-fitted on the v2 multi-label tags: a Grade-5 student in Q2 gets ~25-32% of draws from cards carrying the current cell (FEED-WEIGHTING.md). */
export const DEFAULT_CURRICULUM_WEIGHTS: CurriculumWeights = {
  sameGradeCurrentQuarter: 6,
  sameGradeAdjacentQuarter: 3,
  sameGradeOtherQuarter: 1.5,
  adjacentGradeCurrentQuarter: 2,
  schoolOutSameGrade: 6,
  other: 1,
  offCurriculum: 0.4,
  minConfidence: 0.2,
};

function cellMultiplier(
  cell: CurriculumCell,
  studentGrade: GradeLevel,
  currentQuarter: Quarter | null,
  w: CurriculumWeights,
): number {
  const sameGrade = cell.grade === studentGrade;
  if (currentQuarter === null) {
    // School is out (outside the DepEd school year). There is no quarter to favour, so the
    // student's WHOLE grade is equally relevant and carries the in-quarter weight: over the break
    // the feed reviews the year they just finished, evenly, instead of drifting into other grades.
    return sameGrade ? w.schoolOutSameGrade : w.other;
  }
  if (sameGrade) {
    if (cell.quarter === currentQuarter) return w.sameGradeCurrentQuarter;
    if (Math.abs(cell.quarter - currentQuarter) === 1) return w.sameGradeAdjacentQuarter;
    return w.sameGradeOtherQuarter;
  }
  if (Math.abs(cell.grade - studentGrade) === 1 && cell.quarter === currentQuarter) {
    return w.adjacentGradeCurrentQuarter;
  }
  return w.other;
}

/**
 * The curriculum factor of a card = MAX over its cells of (cell multiplier, weak cells capped at
 * the adjacent-quarter level, with the lift above ×1 scaled by that cell's own norm). A tag
 * without `cells` is the single-label v1 shape and behaves as one strong un-normalised cell.
 * Always ≥ w.other for a tagged card, so off-curriculum (×0.4) stays the lightest band.
 * When school is out there is no current quarter: every cell of the student's grade weighs the
 * same (schoolOutSameGrade), so the break reviews their whole year rather than favouring a month.
 */
export function curriculumMultiplier(
  tag: CurriculumTag | null | undefined,
  studentGrade: GradeLevel,
  currentQuarter: Quarter | null,
  w: CurriculumWeights = DEFAULT_CURRICULUM_WEIGHTS,
): number {
  if (!tag || !(tag.confidence >= w.minConfidence)) return w.offCurriculum;
  const cells: readonly CurriculumCell[] = tag.cells?.length
    ? tag.cells
    : [{ grade: tag.grade, quarter: tag.quarter, strength: 2 }];
  let best = 0;
  for (const cell of cells) {
    let m = cellMultiplier(cell, studentGrade, currentQuarter, w);
    if ((cell.strength ?? 2) < 2) m = Math.min(m, w.sameGradeAdjacentQuarter);
    if (m > w.other) m = w.other + (m - w.other) * (cell.norm ?? 1);
    if (m > best) best = m;
  }
  return Math.max(best, w.other);
}

// ---------------------------------------------------------------- recency factor

/**
 * Within the current quarter, favour review (weeks already covered) over preview. Needs a
 * per-competency week, which the tags do not carry yet — returns 1 until they do.
 */
export function recencyMultiplier(competencyWeek?: number, currentWeekInQuarter?: number): number {
  if (competencyWeek === undefined || currentWeekInQuarter === undefined) return 1;
  return competencyWeek <= currentWeekInQuarter ? 1.5 : 1;
}

// ---------------------------------------------------------------- seen factor

/** A row of card_seen / competency_seen (rag/pipeline/seen-store.sql). Never key on card.topic — it is a per-card slug. */
export interface SeenRecord {
  times: number;
  lastSeen: number; // epoch ms
}

export const SEEN_DECAY = {
  card: 0.5,
  competency: 0.8,
  /** Multiplicative recovery per 7 days since last_seen, capped at 1. */
  recoveryPerWeek: 1.5,
} as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function seenMultiplier(
  rec: SeenRecord | null | undefined,
  now: number,
  decay: number,
  recoveryPerWeek: number = SEEN_DECAY.recoveryPerWeek,
): number {
  if (!rec || !(rec.times > 0)) return 1;
  const base = Math.pow(decay, rec.times);
  const weeks = Math.max(0, now - rec.lastSeen) / WEEK_MS;
  return Math.min(1, base * Math.pow(recoveryPerWeek, weeks));
}

export const seenCardMultiplier = (rec: SeenRecord | null | undefined, now: number): number =>
  seenMultiplier(rec, now, SEEN_DECAY.card);

export const seenCompetencyMultiplier = (rec: SeenRecord | null | undefined, now: number): number =>
  seenMultiplier(rec, now, SEEN_DECAY.competency);

// ---------------------------------------------------------------- combined

export interface WeightContext {
  studentGrade: GradeLevel;
  currentQuarter: Quarter | null;
  now: number; // epoch ms
  weights?: CurriculumWeights;
}

export interface WeightInputs {
  tag?: CurriculumTag | null;
  cardSeen?: SeenRecord | null;
  competencySeen?: SeenRecord | null;
  competencyWeek?: number;
  currentWeekInQuarter?: number;
}

/** The full weight of one card for one draw. Always > 0. */
export function cardWeight(inp: WeightInputs, ctx: WeightContext): number {
  return (
    curriculumMultiplier(inp.tag, ctx.studentGrade, ctx.currentQuarter, ctx.weights) *
    recencyMultiplier(inp.competencyWeek, inp.currentWeekInQuarter) *
    seenCardMultiplier(inp.cardSeen, ctx.now) *
    seenCompetencyMultiplier(inp.competencySeen, ctx.now)
  );
}

/** Sample one item proportionally to weightOf(item). Non-positive weights are treated as 0. */
export function weightedPick<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  rand: () => number = Math.random,
): T | undefined {
  if (items.length === 0) return undefined;
  const ws = new Float64Array(items.length);
  let total = 0;
  items.forEach((item, i) => {
    const w = weightOf(item);
    ws[i] = w > 0 ? w : 0;
    total += ws[i] ?? 0;
  });
  if (total <= 0) return items[Math.floor(rand() * items.length)];
  let r = rand() * total;
  for (let i = 0; i < items.length; i += 1) {
    r -= ws[i] ?? 0;
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}
