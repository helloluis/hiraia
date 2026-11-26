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
  stage: z.enum(['kinder', 'elementary', 'jhs', 'shs_core', 'shs_tvl']),
  /** All stages this learning area spans. One entry per learning area id — do not duplicate the area per stage. */
  stages: z
    .array(z.enum(['kinder', 'elementary', 'jhs', 'shs_core', 'shs_tvl']))
    .min(1)
    .optional(),
});
export type LearningArea = z.infer<typeof LearningArea>;

export const Competency = z.object({
  /** Stable Tala id, never reused: '<curriculum>.<area>.g<grade>.t<term>.<seq>'. */
  id: z.string().max(200),
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
  domain: z.string().max(400).nullable(),
  /**
   * Short display title for pickers and timelines: one to four words ("Exploring Motion", "Friction and Heat").
   * A label, not curriculum text — the competency `text` above stays the only authoritative wording.
   * 'official' = taken from a heading in the source document; 'derived' = shortened from the domain/competency
   * by Hiraia tooling and open to teacher correction.
   */
  shortTitle: z.string().max(60).optional(),
  shortTitleSource: z.enum(['official', 'derived']).optional(),
  /** Week(s) of the term the source document allots to this competency (1-based), when it says. */
  weekFrom: z.number().int().min(1).max(20).optional(),
  weekTo: z.number().int().min(1).max(20).optional(),
  /**
   * Component of a combined learning area, exactly as printed ("Music and Arts", "Physical Education and Health",
   * an EPP/TLE component). Distinct from `domain` (strand / theme used for cross-grade pairing).
   */
  component: z.string().max(200).nullable().optional(),
  /**
   * The official heading printed above this competency in the source (theme / topic / lesson title), verbatim and
   * untruncated. Kept alongside `shortTitle` so a derived label can always be re-derived or replaced (ADR-0001).
   */
  officialHeading: z.string().max(400).nullable().optional(),
  /** How `shortTitle` was produced. Absent when there is no short title. */
  shortTitleDerivation: z
    .object({
      /**
       * official_heading = the printed heading used whole; heading_shortened = printed heading shortened by a rule;
       * competency_keyphrase = noun phrase taken from the competency text by a rule; domain_fallback = strand or
       * component name used because nothing narrower exists; manual = a reviewed, hand-entered label.
       */
      method: z.enum([
        'official_heading',
        'heading_shortened',
        'competency_keyphrase',
        'domain_fallback',
        'manual',
      ]),
      /** Id and version of the rule table that produced it, e.g. 'titles.mathematics@1'. */
      rule: z.string().max(80),
      /** The source wording the title was derived from (heading or phrase of the competency). */
      basis: z.string().max(400).nullable(),
    })
    .optional(),
  /**
   * Lettered / bulleted sub-items of a parent competency, in source order. `text` above always stays the complete
   * wording (parent + sub-items); `parts` only makes the structure addressable (selector, generator, retrieval).
   */
  parts: z
    .array(z.object({ label: z.string().max(12), text: z.string().min(1).max(2000) }))
    .max(60)
    .optional(),
  /** Teaching days the source allots, when it prints them ("2 to 3 (7 days)"). */
  allottedDays: z.number().int().min(1).max(120).optional(),
  /** Source-printed classification marks, e.g. Filipino macro-skill columns ['PK', 'PS']. Codes as printed. */
  tags: z.array(z.string().max(40)).max(20).optional(),
  /**
   * Stable id of the source row this entry came from, shared by every entry made from the same printed row
   * (a grid row that applies to several terms yields one entry per term with the same sourceRowId).
   */
  sourceRowId: z.string().max(96).optional(),
  /** Relative share of teaching time; null = equal weight. */
  weight: z.number().positive().nullable(),
  weightSource: z.enum(['official', 'estimated']),
  source: z.object({
    document: z.string().max(300),
    edition: z.string().max(120).nullable(),
    page: z.number().int().nullable(),
    /** Last page when the entry continues across a page break. */
    pageTo: z.number().int().nullable().optional(),
    url: z.string().url().nullable(),
    /** SHA-256 of the exact source file the text was read from. */
    sha256: z.string().length(64).optional(),
  }),
});
export type Competency = z.infer<typeof Competency>;

export const CurriculumPackMeta = z.object({
  /** '<curriculumVersion>:<grade>:<learningAreaId>' */
  packId: z.string().max(200),
  curriculumVersion: z.string().max(96),
  grade: GradeLevel,
  learningAreaId: z.string().max(64),
  /** School years this pack is in force for, e.g. ['2026-2027', '2027-2028']. */
  schoolYears: z.array(z.string()),
  competencyCount: z.number().int(),
  /** Monotonic data revision; bumps when corrections are published (CUR-8). */
  dataRevision: z.number().int(),
  bytes: z.number().int(),
  /**
   * Pack format version (ADR-0001). Absent = 1 (the first Science packs). Readers must accept every version they
   * know and ignore unknown optional fields; a breaking change bumps this number instead of migrating old packs.
   */
  formatVersion: z.number().int().min(1).optional(),
  /** Edition of the source document(s), ISO date printed in the document footer, when there is one. */
  edition: z.string().max(40).nullable().optional(),
  /** 'week' = the source places competencies in weeks; 'term' = term-level only (weeks are the teacher's call). */
  placement: z.enum(['week', 'term']).optional(),
  /** Pack this one replaces for the same grade and learning area (an earlier edition), if any. */
  supersedes: z.string().max(160).nullable().optional(),
  /** Display name of the learning area as the source prints it; used when the app has no built-in name. */
  areaName: Localized.optional(),
  /** core = taken by every learner of the grade; elective = a specialisation the school or learner chooses. */
  areaKind: z.enum(['core', 'elective']).optional(),
  /**
   * How the pack sits in the school year (ADR-0001 §11). Absent = `fixed`: `termIndex` is the school term.
   * `teacher_selected` = the source gives a self-contained sequence without saying which school term it runs in
   * (elective sectors "studied for one term" in Grade 9 or 10; Grade 12 electives). Then `termIndex` is the
   * 1-based position inside the unit's own duration, weeks are relative to the unit's start, and the app must
   * ask the teacher which term(s) it runs in. Never read `termIndex` as a school term for such a pack.
   */
  scheduling: z
    .object({
      termAssignment: z.enum(['fixed', 'teacher_selected']),
      /** Length of the unit in terms as the source states it; null when the source is silent or contradictory. */
      durationTerms: z.number().int().min(1).max(6).nullable(),
      /** Every grade the same source document says it may be taught in (the pack's own grade included). */
      eligibleGrades: z.array(GradeLevel).min(1),
      /** The source sentence(s) this is based on, verbatim. */
      sourceNote: z.string().max(800).nullable(),
      /** Other learning areas the source says must be completed first, as printed. */
      prerequisites: z.array(z.string().max(300)).max(10).optional(),
    })
    .optional(),
  /**
   * Problems in the source document itself that a reader should know about (contradictory grade or duration
   * statements, content that appears to belong to another guide). Recorded, never silently repaired.
   */
  sourceIssues: z
    .array(
      z.object({
        code: z.string().max(60),
        note: z.string().max(800),
        page: z.number().int().nullable(),
      })
    )
    .max(20)
    .optional(),
  /** The archived source documents this pack was extracted from. */
  sourceDocuments: z
    .array(
      z.object({
        title: z.string().max(300),
        url: z.string().url().nullable(),
        sha256: z.string().length(64),
        edition: z.string().max(40).nullable(),
        retrieved: z.string().max(40).nullable(),
        pages: z.number().int().nullable(),
      })
    )
    .max(40)
    .optional(),
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
