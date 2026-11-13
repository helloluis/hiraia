/**
 * Curriculum data model (PRD §6.3) and the pacing engine's public surface (PRD §7).
 * Curriculum data is read-only reference data delivered as versioned packs, not synced records.
 * OWNER: orchestrator. Implementation of the engine: workstream B, in src/pacing and src/curriculum.
 */
import { z } from 'zod';
import { GradeLevel, Id, IsoDate, Localized } from './common';
import type {
  CalendarDay,
  CompetencyCheck,
  PacingParams,
  PacingTrack,
  PairingOverride,
  Plan,
  SchoolYear,
  SessionMark,
  TeachingAssignment,
  Term,
  ClassRecord,
} from './records';

export const LearningArea = z.object({
  /** Stable id, e.g. 'science', 'mathematics', 'filipino', 'ap', 'gmrc', 'shs.general-mathematics'. */
  id: z.string().max(64),
  name: Localized,
  grades: z.array(GradeLevel),
  /** Primary stage. Prefer `stages` (a learning area such as Science spans elementary and JHS). */
  stage: z.enum(['kinder', 'elementary', 'jhs', 'shs_core']),
  /** All stages this learning area spans. One entry per learning area id — do not duplicate the area per stage. */
  stages: z
    .array(z.enum(['kinder', 'elementary', 'jhs', 'shs_core']))
    .min(1)
    .optional(),
});
export type LearningArea = z.infer<typeof LearningArea>;

export const Competency = z.object({
  /** Stable Tala id, never reused: '<curriculum>.<area>.g<grade>.t<term>.<seq>'. */
  id: z.string().max(96),
  /** Official DepEd code where one exists. */
  code: z.string().max(60).nullable(),
  learningAreaId: z.string().max(64),
  grade: GradeLevel,
  /** 1-based term (quarter) the guide places it in. */
  termIndex: z.number().int().min(1).max(12),
  sequence: z.number().int().min(0),
  /** Competency text exactly as in the official guide, in the guide's language. Never model-written. */
  text: z.string().min(1).max(2000),
  textLang: z.enum(['fil', 'en']),
  contentStandard: z.string().max(2000).nullable(),
  performanceStandard: z.string().max(2000).nullable(),
  /** Strand / domain / theme, used to pair competencies across grades in multi-grade classes. */
  domain: z.string().max(200).nullable(),
  /** Relative share of teaching time; null = equal weight. */
  weight: z.number().positive().nullable(),
  weightSource: z.enum(['official', 'estimated']),
  source: z.object({
    document: z.string().max(300),
    edition: z.string().max(120).nullable(),
    page: z.number().int().nullable(),
    url: z.string().url().nullable(),
  }),
});
export type Competency = z.infer<typeof Competency>;

export const CurriculumPackMeta = z.object({
  /** '<curriculumVersion>:<grade>:<learningAreaId>' */
  packId: z.string().max(160),
  curriculumVersion: z.string().max(64),
  grade: GradeLevel,
  learningAreaId: z.string().max(64),
  /** School years this pack is in force for, e.g. ['2026-2027', '2027-2028']. */
  schoolYears: z.array(z.string()),
  competencyCount: z.number().int(),
  /** Monotonic data revision; bumps when corrections are published (CUR-8). */
  dataRevision: z.number().int(),
  bytes: z.number().int(),
});
export type CurriculumPackMeta = z.infer<typeof CurriculumPackMeta>;

export const CurriculumPack = CurriculumPackMeta.extend({ competencies: z.array(Competency) });
export type CurriculumPack = z.infer<typeof CurriculumPack>;

export const CurriculumIndex = z.object({
  learningAreas: z.array(LearningArea),
  packs: z.array(CurriculumPackMeta),
});
export type CurriculumIndex = z.infer<typeof CurriculumIndex>;

/** Community self-check tally for a pack (CUR-7). */
export const CheckSummary = z.object({
  packId: z.string(),
  /** competencyId → number of distinct teachers who confirmed it. */
  confirmedBy: z.record(z.string(), z.number().int()),
  /** competencyId → number of distinct teachers who reported a correction. */
  correctedBy: z.record(z.string(), z.number().int()),
});
export type CheckSummary = z.infer<typeof CheckSummary>;

export const CalendarPreset = z.object({
  id: z.string().max(64), // 'deped-2026-2027'
  version: z.string().max(32),
  label: z.string().max(60),
  provisional: z.boolean(),
  startDate: IsoDate,
  endDate: IsoDate,
  terms: z.array(
    z.object({ index: z.number().int(), name: z.string(), startDate: IsoDate, endDate: IsoDate })
  ),
  days: z.array(
    z.object({
      date: IsoDate,
      kind: z.enum(['national_holiday', 'deped_event', 'exam']),
      label: z.string(),
    })
  ),
  source: z.string().max(300),
});
export type CalendarPreset = z.infer<typeof CalendarPreset>;

/* =====================================================================================
 * Pacing engine — pure, deterministic, no I/O, no Date.now(), no model (PACE-2).
 * Implemented in src/pacing by workstream B and exported from the package root as `pacing`.
 * Web, mobile and server all call the same functions with the same inputs.
 * ===================================================================================== */

export interface TeachingSession {
  date: IsoDate;
  assignmentId: Id;
  slotId: Id;
  minutes: number;
  termId: Id;
}

export type PacedItemState =
  | 'before_tala' // before the track's start position (§7.5)
  | 'taught'
  | 'assumed_taught'
  | 'partial'
  | 'not_taught'
  | 'scheduled'
  | 'deferred'
  | 'unscheduled'; // does not fit in the term

export interface PacedItem {
  /** Usually one competency; several when merged. */
  competencyIds: string[];
  sessions: TeachingSession[];
  state: PacedItemState;
  pinned: boolean;
  weightSource: 'official' | 'estimated' | 'teacher';
}

export interface PacingPlan {
  trackId: Id;
  items: PacedItem[];
  bufferSessions: TeachingSession[];
  assessmentSessions: TeachingSession[];
  /** Competencies that do not fit in the remaining sessions (PACE-8). */
  atRisk: string[];
  /** Positive = behind, negative = ahead, in sessions, as of `today`. */
  sessionsBehind: number;
  effectiveParams: PacingParams;
}

export interface PacingInput {
  track: PacingTrack;
  schoolYear: SchoolYear;
  term: Term;
  assignment: TeachingAssignment;
  /** All calendar days of the school year; the engine filters by class and date. */
  calendarDays: CalendarDay[];
  /** Competencies of this track's grade and learning area for this term, in guide order. */
  competencies: Competency[];
  /** This teacher's own corrections (CUR-8) are applied before pacing. */
  checks: CompetencyCheck[];
  marks: SessionMark[];
  today: IsoDate;
  /** Hiraia-published defaults (configuration); track.params override them. */
  defaults: PacingParams;
}

export interface TimelineEntry {
  date: IsoDate;
  classId: Id;
  assignmentId: Id;
  slotId: Id;
  minutes: number;
  subjectName: string;
  /** gradeGroupId → competencies due in this session. More than one key = multi-grade session. */
  byGroup: Record<Id, string[]>;
  /** 'before_tala' = a session before the track's start position: covered before the teacher started using Tala; needs no plan and never counts as behind. Its `byGroup` competency lists are empty. */
  kind: 'lesson' | 'buffer' | 'assessment' | 'before_tala';
  planId: Id | null;
  planState: 'none' | 'draft' | 'locked';
  /** Summary across groups: the least-complete status of any group in the session. */
  mark: 'taught' | 'assumed_taught' | 'partial' | 'not_taught' | 'before_tala' | null;
  /** Per grade group, for multi-grade sessions where groups differ. Absent = same as `kind` / `mark` for all groups. */
  byGroupKind?: Record<Id, 'lesson' | 'buffer' | 'assessment' | 'other_subject' | 'before_tala'>;
  byGroupMark?: Record<
    Id,
    'taught' | 'assumed_taught' | 'partial' | 'not_taught' | 'before_tala' | null
  >;
  /** Whether the multi-grade pairing shares a theme, and across which groups (§7.4). */
  pairing: { shared: boolean; groupIds: Id[]; overridden: boolean } | null;
}

export interface TimelineInput {
  from: IsoDate;
  to: IsoDate;
  today: IsoDate;
  schoolYear: SchoolYear;
  classes: ClassRecord[];
  assignments: TeachingAssignment[];
  tracks: PacingTrack[];
  calendarDays: CalendarDay[];
  /** Competencies for every (grade, learning area) in play, any term. */
  competencies: Competency[];
  checks: CompetencyCheck[];
  marks: SessionMark[];
  plans: Plan[];
  pairingOverrides: PairingOverride[];
  defaults: PacingParams;
}

export type RealignmentOption = 'shift' | 'absorb' | 'compress' | 'merge' | 'add_time' | 'defer';

export interface RealignmentRequest {
  option: RealignmentOption;
  /** For 'merge': pairs of competency ids to combine. For 'defer': competencies to carry over. */
  competencyIds?: string[];
  /** For 'add_time': make-up dates to add. */
  makeupDates?: IsoDate[];
}

export interface RealignmentPreview {
  option: RealignmentOption;
  before: PacingPlan;
  after: PacingPlan;
  /** Track with overrides applied; persisting it (plus `newCalendarDays`) applies the realignment. */
  nextTrack: PacingTrack;
  newCalendarDays: CalendarDay[];
  /** competencyId → { from, to } first-session dates that changed. */
  moved: Record<string, { from: IsoDate | null; to: IsoDate | null }>;
  /** Competencies that fall off the end of the term after this option. */
  dropped: string[];
  /** Plans whose dates change, with their new dates (locked plans keep content, §7.6). */
  planMoves: Array<{ planId: Id; classId: Id; from: IsoDate[]; to: IsoDate[] }>;
}

export interface PacingEngine {
  /** All teaching sessions of an assignment in a term: timetable × calendar − non-teaching days + make-up days. */
  enumerateSessions(
    schoolYear: SchoolYear,
    term: Term,
    assignment: TeachingAssignment,
    calendarDays: CalendarDay[]
  ): TeachingSession[];
  computePacing(input: PacingInput): PacingPlan;
  /** Any-day onboarding (§7.5): the competency default pacing would have reached on `today`. */
  proposeStartPosition(
    input: Omit<PacingInput, 'marks' | 'checks'>
  ): { competencyId: string; date: IsoDate; estimated: true } | null;
  buildTimeline(input: TimelineInput): TimelineEntry[];
  /**
   * `baseline` is the pacing plan as it stood before the disruption (the last plan the teacher saw), so that
   * `before`, `moved` and `planMoves` are measured against what was actually scheduled. Omit it to use
   * computePacing(input) with the disrupting calendar days / marks ignored where derivable.
   */
  previewRealignment(
    input: PacingInput & { plans: Plan[]; baseline?: PacingPlan },
    request: RealignmentRequest
  ): RealignmentPreview;
  /** Which realignment options are applicable right now, with the default first (§7.6). */
  availableRealignments(input: PacingInput): RealignmentOption[];
  /** Term containing `date`, or null between terms. */
  termForDate(schoolYear: SchoolYear, date: IsoDate): Term | null;
}

export const DEFAULT_PACING_PARAMS: PacingParams = {
  bufferRatio: 0.1,
  assessmentSessionsPerTerm: 2,
  minSessionsPerCompetency: 1,
  assumeTaught: true,
  pairingRule: 'theme_then_sequence',
};
