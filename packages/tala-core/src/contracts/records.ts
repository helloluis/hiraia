/**
 * Synced records: everything a teacher owns that must work offline (PRD §10.4).
 *
 * Storage model (same on server and on every client): one row per record,
 *   { entity, id, ownerId, rev, updatedAt, deletedAt, data }
 * where `data` validates against the schema registered for `entity` in RECORD_SCHEMAS.
 * A plan's sections are separate records so two devices editing different sections never conflict (§10.5).
 *
 * OWNER: orchestrator.
 */
import { z } from 'zod';
import { GradeLevel, Id, IsoDate, IsoDateTime, Lang, LIMITS, Weekday } from './common';
import { SectionContent, SectionKey, Template } from './content';

/* ---------- school year & calendar (PRD §7.2) ---------- */

export const Term = z.object({
  id: Id,
  /** 1-based position in the year. The number of terms is data, never assumed to be four. */
  index: z.number().int().min(1).max(12),
  name: z.string().max(60),
  startDate: IsoDate,
  endDate: IsoDate,
});
export type Term = z.infer<typeof Term>;

export const SchoolYear = z.object({
  id: Id,
  label: z.string().max(40), // "2026-2027"
  schoolName: z.string().max(200).default(''),
  startDate: IsoDate,
  endDate: IsoDate,
  terms: z.array(Term).min(1).max(12),
  /** Teaching weekdays, normally Mon–Fri. */
  teachingWeekdays: z.array(Weekday).min(1).max(7).default([1, 2, 3, 4, 5]),
  presetId: z.string().nullable().default(null),
  presetVersion: z.string().nullable().default(null),
  provisional: z.boolean().default(false),
});
export type SchoolYear = z.infer<typeof SchoolYear>;

export const CalendarDayKind = z.enum([
  'national_holiday',
  'deped_event',
  'exam',
  'local_holiday',
  'school_event',
  'suspension',
  'makeup', // an added teaching day (SCH-7)
  'shortened', // teaching day with reduced minutes (SCH-5)
]);
export type CalendarDayKind = z.infer<typeof CalendarDayKind>;

export const CalendarDay = z.object({
  id: Id,
  schoolYearId: Id,
  date: IsoDate,
  kind: CalendarDayKind,
  label: z.string().max(200).default(''),
  /** null = applies to all of the teacher's classes in this school year. */
  classId: Id.nullable().default(null),
  /** For `shortened`: minutes available per session that day. */
  minutesOverride: z.number().int().min(0).max(600).nullable().default(null),
  source: z.enum(['preset', 'teacher']).default('teacher'),
  /**
   * For `makeup`: which weekday's timetable the make-up day follows (a Saturday class that "follows Monday").
   * null = use the date's own weekday (only slots that already fall on it).
   */
  followsWeekday: Weekday.nullable().default(null),
  /** For `makeup` / `shortened`: limit to these teaching assignments. null = every assignment of the class(es). */
  assignmentIds: z.array(Id).max(40).nullable().default(null),
});
export type CalendarDay = z.infer<typeof CalendarDay>;

/** Kinds that remove a date from teaching. `makeup` adds one; `shortened` keeps it with fewer minutes. */
export const NON_TEACHING_KINDS: readonly CalendarDayKind[] = [
  'national_holiday',
  'deped_event',
  'exam',
  'local_holiday',
  'school_event',
  'suspension',
];

/* ---------- classes (PRD §8) ---------- */

export const GradeGroup = z.object({
  id: Id,
  grade: GradeLevel,
  learnerCount: z.number().int().min(0).max(200).nullable().default(null),
});
export type GradeGroup = z.infer<typeof GradeGroup>;

export const ClassProfile = z.object({
  materials: z.array(z.string().max(120)).max(60).default([]),
  textbooks: z.array(z.string().max(200)).max(30).default([]),
  electricity: z.boolean().nullable().default(null),
  projector: z.boolean().nullable().default(null),
  printing: z.boolean().nullable().default(null),
  outdoorSpace: z.boolean().nullable().default(null),
  notes: z.string().max(2000).default(''),
});
export type ClassProfile = z.infer<typeof ClassProfile>;

export const ClassRecord = z.object({
  id: Id,
  schoolYearId: Id,
  name: z.string().min(1).max(120),
  /** 'deped' = preloaded curriculum; 'none' = teacher types own objectives (CUR-10). */
  curriculum: z.enum(['deped', 'none']).default('deped'),
  /** One group = ordinary class. Two to four = multi-grade (decision 13). */
  gradeGroups: z.array(GradeGroup).min(1).max(LIMITS.maxGradeGroupsPerClass),
  languages: z.array(Lang).min(1).default(['fil']),
  profile: ClassProfile.default({}),
  /** Sample class with fictional data (PACE-11). Never postable to the community. */
  isSample: z.boolean().default(false),
  archived: z.boolean().default(false),
});
export type ClassRecord = z.infer<typeof ClassRecord>;

export const TimetableSlot = z.object({
  id: Id,
  weekday: Weekday,
  /** 'HH:MM' 24h, optional: many teachers only know "Science is MWF, 50 minutes". */
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().default(null),
  minutes: z.number().int().min(5).max(480),
  /** Rotating schedules (SCH-3): slot is active only in week `week` of an `everyWeeks` cycle. null = every week. */
  rotation: z.object({ everyWeeks: z.number().int().min(2).max(8), week: z.number().int().min(1).max(8) }).nullable().default(null),
});
export type TimetableSlot = z.infer<typeof TimetableSlot>;

/** A subject taught to a class (or to some of its grade groups) in given timetable slots (PRD §7.4). */
export const TeachingAssignment = z.object({
  id: Id,
  classId: Id,
  /** Curriculum learning-area id, or null for a class without preloaded curriculum. */
  learningAreaId: z.string().max(64).nullable(),
  subjectName: z.string().min(1).max(120),
  /** Grade groups that take this subject in these slots. Shared slots across groups make a multi-grade session. */
  gradeGroupIds: z.array(Id).min(1).max(LIMITS.maxGradeGroupsPerClass),
  language: Lang.default('fil'),
  slots: z.array(TimetableSlot).max(21),
});
export type TeachingAssignment = z.infer<typeof TeachingAssignment>;

/* ---------- pacing (PRD §7) ---------- */

export const PacingParams = z.object({
  /** Buffer sessions as a share of teaching sessions (default one per ten). */
  bufferRatio: z.number().min(0).max(0.5).default(0.1),
  assessmentSessionsPerTerm: z.number().int().min(0).max(20).default(2),
  minSessionsPerCompetency: z.number().int().min(1).max(10).default(1),
  /** Unmarked past sessions count as taught (§7.5). */
  assumeTaught: z.boolean().default(true),
  pairingRule: z.enum(['theme_then_sequence', 'sequence']).default('theme_then_sequence'),
});
export type PacingParams = z.infer<typeof PacingParams>;

/** One pacing track per (teaching assignment × grade group × term). */
export const PacingTrack = z.object({
  id: Id,
  classId: Id,
  assignmentId: Id,
  gradeGroupId: Id,
  termId: Id,
  curriculumVersion: z.string().nullable().default(null),
  /** Any-day onboarding (§7.5): competencies before this one are "covered before Tala". */
  startPosition: z
    .object({ competencyId: z.string(), date: IsoDate, estimated: z.boolean() })
    .nullable()
    .default(null),
  /**
   * The allocation the teacher last accepted (after setup or a confirmed realignment): exact session dates and
   * slots per item. When present the engine keeps these placements for past and pinned items instead of
   * re-deriving them, so a recomputation never silently moves what the teacher already saw. null = derive.
   */
  allocation: z
    .array(
      z.object({
        competencyIds: z.array(z.string()).min(1),
        sessions: z.array(z.object({ date: IsoDate, slotId: Id })),
      }),
    )
    .nullable()
    .default(null),
  /** Teacher overrides of Hiraia defaults; absent keys fall back to defaults. */
  params: PacingParams.partial().default({}),
  overrides: z
    .object({
      /** Full competency order for the term, when the teacher reordered. */
      order: z.array(z.string()).optional(),
      /** competencyId → number of sessions. */
      sessions: z.record(z.string(), z.number().int().min(1).max(40)).optional(),
      /** competencyId → weight (relative share of time). */
      weights: z.record(z.string(), z.number().positive()).optional(),
      /** competencyId → pinned first date. */
      pins: z.record(z.string(), IsoDate).optional(),
      /** Groups of competencies taught in one session. */
      merges: z.array(z.array(z.string()).min(2)).optional(),
      /** Competencies carried into the next term. */
      deferred: z.array(z.string()).optional(),
      /** Competencies moved into this term from another. */
      movedIn: z.array(z.string()).optional(),
    })
    .default({}),
});
export type PacingTrack = z.infer<typeof PacingTrack>;

/** Editable multi-grade pairing for one shared slot occurrence (§7.4). Absent = engine proposal stands. */
export const PairingOverride = z.object({
  id: Id,
  classId: Id,
  assignmentId: Id,
  date: IsoDate,
  /** Timetable slot the override applies to. null = every session of this assignment on that date. */
  slotId: Id.nullable().default(null),
  /** gradeGroupId → competencyIds for that date. */
  byGroup: z.record(Id, z.array(z.string())),
});
export type PairingOverride = z.infer<typeof PairingOverride>;

/* ---------- plans (PRD §6.1, §10) ---------- */

export const PlanState = z.enum(['draft', 'locked', 'archived']);
export type PlanState = z.infer<typeof PlanState>;

export const PlanLineage = z.object({
  artifactId: Id,
  versionId: Id,
  title: z.string(),
  authorDisplayName: z.string(),
});
export type PlanLineage = z.infer<typeof PlanLineage>;

/** One scheduled occurrence of a plan for one class (PLAN-7: a plan can be applied to several sections). */
export const PlanPlacement = z.object({
  classId: Id,
  assignmentId: Id.nullable(),
  /** Session dates this plan covers for that class. One for a session plan, up to a week for a DLL. */
  dates: z.array(IsoDate).max(7),
});
export type PlanPlacement = z.infer<typeof PlanPlacement>;

export const Plan = z.object({
  id: Id,
  title: z.string().max(200).default(''),
  templateId: Id,
  language: Lang,
  subjectName: z.string().max(120).default(''),
  learningAreaId: z.string().max(64).nullable().default(null),
  grades: z.array(GradeLevel).min(1).max(LIMITS.maxGradeGroupsPerClass),
  /** gradeGroupIds of the primary class, in display order; keys of multigrade/pergroup section content. */
  gradeGroupIds: z.array(Id).max(LIMITS.maxGradeGroupsPerClass).default([]),
  /** gradeGroupId → competency ids (stored curriculum records). Single-grade plans have one key. */
  competencies: z.record(Id, z.array(z.string())).default({}),
  curriculumVersion: z.string().nullable().default(null),
  /** For classes with no preloaded curriculum (CUR-10). */
  customObjectives: z.array(z.string().max(500)).max(30).default([]),
  durationMinutes: z.number().int().min(5).max(600),
  placements: z.array(PlanPlacement).max(20).default([]),
  state: PlanState.default('draft'),
  lock: z
    .object({
      lockedAt: IsoDateTime,
      /** Teacher's display name at the moment of locking (DOC-1 "who"); printed with the lock date. */
      lockedBy: z.string().max(120).default(''),
      /** Short human-readable code printed in the PDF footer (PDF-3). */
      revisionCode: z.string().max(16),
      /** Server plan revision number the lock applies to; null while the lock is still only on the device. */
      revision: z.number().int().nullable(),
    })
    .nullable()
    .default(null),
  submitted: z.object({ date: IsoDate, note: z.string().max(300) }).nullable().default(null),
  /** True until the teacher edits or locks a generated draft (§9.4). */
  aiDraft: z.boolean().default(false),
  /** True if any section ever originated from generation; feeds community provenance (§11.3). */
  aiAssisted: z.boolean().default(false),
  lineage: PlanLineage.nullable().default(null),
  unitId: Id.nullable().default(null),
  /** When this plan is the draft copy kept after a lock-vs-edit conflict (DOC-4). */
  conflictCopyOf: Id.nullable().default(null),
});
export type Plan = z.infer<typeof Plan>;

export const SectionGenMeta = z.object({
  provider: z.string(),
  model: z.string(),
  promptId: z.string(),
  promptVersion: z.number().int(),
  curriculumVersion: z.string().nullable(),
  at: IsoDateTime,
});
export type SectionGenMeta = z.infer<typeof SectionGenMeta>;

export const PlanSection = z.object({
  id: Id,
  planId: Id,
  key: SectionKey,
  content: SectionContent,
  origin: z.enum(['manual', 'ai', 'copied']).default('manual'),
  editedByTeacher: z.boolean().default(false),
  gen: SectionGenMeta.nullable().default(null),
});
export type PlanSection = z.infer<typeof PlanSection>;

/**
 * A previous version of one section, kept on the device so it can be restored offline in one step
 * (PLAN-10, LLM-4) and so provenance can tell how far an AI draft was rewritten (§11.3).
 * Immutable once written. Clients keep a bounded history per section (newest N) and delete the rest.
 */
export const SectionRevision = z.object({
  id: Id,
  planId: Id,
  sectionId: Id,
  key: SectionKey,
  content: SectionContent,
  origin: z.enum(['manual', 'ai', 'copied']),
  gen: SectionGenMeta.nullable().default(null),
  /** Why the section was about to change when this copy was taken. */
  reason: z.enum(['edit', 'regenerate', 'restore', 'conflict', 'lock', 'unlock']),
  /** Device time, for display only; ordering uses the record's server rev / updatedAt. */
  savedAt: IsoDateTime,
});
export type SectionRevision = z.infer<typeof SectionRevision>;

export const Unit = z.object({
  id: Id,
  classId: Id,
  assignmentId: Id.nullable(),
  name: z.string().min(1).max(160),
  planIds: z.array(Id).max(200).default([]),
});
export type Unit = z.infer<typeof Unit>;

/** What actually happened in a session (PLAN-12). Outside the lock. */
export const SessionMark = z.object({
  id: Id,
  classId: Id,
  assignmentId: Id,
  gradeGroupId: Id,
  date: IsoDate,
  /** Timetable slot, when the assignment meets more than once that day. null = the day's only/first session. */
  slotId: Id.nullable().default(null),
  planId: Id.nullable().default(null),
  competencyIds: z.array(z.string()).default([]),
  status: z.enum(['taught', 'partial', 'not_taught']),
  remark: z.string().max(1000).default(''),
});
export type SessionMark = z.infer<typeof SessionMark>;

export const DayNote = z.object({
  id: Id,
  classId: Id,
  date: IsoDate,
  text: z.string().max(4000),
});
export type DayNote = z.infer<typeof DayNote>;

/* ---------- roster (PRD §12.5 PRIV-1: these fields and no others) ---------- */

export const Student = z.object({
  id: Id,
  classId: Id,
  gradeGroupId: Id.nullable().default(null),
  displayName: z.string().min(1).max(200),
  familyName: z.string().max(120).default(''),
  givenName: z.string().max(120).default(''),
  middleName: z.string().max(120).default(''),
  suffix: z.string().max(20).default(''),
  sex: z.enum(['M', 'F']).nullable().default(null),
  /** Teacher-assigned local id. Never an LRN. */
  localId: z.string().max(40).nullable().default(null),
  order: z.number().int().min(0).default(0),
  importId: Id.nullable().default(null),
});
export type Student = z.infer<typeof Student>;

/* ---------- curriculum self-check (PRD CUR-7, CUR-8) ---------- */

export const CompetencyCheck = z.object({
  id: Id,
  competencyId: z.string(),
  curriculumVersion: z.string(),
  status: z.enum(['confirmed', 'corrected']),
  /** Applies to this teacher's account immediately; reported upstream for review. */
  correction: z
    .object({
      text: z.string().max(2000).optional(),
      code: z.string().max(60).optional(),
      termIndex: z.number().int().min(1).max(12).optional(),
      sequence: z.number().int().min(0).optional(),
    })
    .nullable()
    .default(null),
  note: z.string().max(500).default(''),
});
export type CompetencyCheck = z.infer<typeof CompetencyCheck>;

/* ---------- teacher profile & custom templates ---------- */

export const TeacherProfile = z.object({
  /** Always the literal id 'profile' — one per account. */
  id: z.literal('profile'),
  displayName: z.string().min(1).max(120),
  uiLanguage: Lang.default('fil'),
  schoolName: z.string().max(200).default(''),
  region: z.string().max(120).default(''),
  dataSaver: z.boolean().default(false),
  activeSchoolYearId: Id.nullable().default(null),
  /** Teacher-level pacing defaults (PRD §7.3): Hiraia defaults < these < per-track params. Edited under "Advanced" only. */
  pacingParams: PacingParams.partial().default({}),
});
export type TeacherProfile = z.infer<typeof TeacherProfile>;

export const CustomTemplate = Template.extend({ builtIn: z.literal(false) });
export type CustomTemplate = z.infer<typeof CustomTemplate>;

/* ---------- registry ---------- */

export const RECORD_SCHEMAS = {
  profile: TeacherProfile,
  school_year: SchoolYear,
  calendar_day: CalendarDay,
  class: ClassRecord,
  assignment: TeachingAssignment,
  pacing_track: PacingTrack,
  pairing_override: PairingOverride,
  plan: Plan,
  plan_section: PlanSection,
  section_revision: SectionRevision,
  unit: Unit,
  session_mark: SessionMark,
  day_note: DayNote,
  student: Student,
  competency_check: CompetencyCheck,
  template: CustomTemplate,
} as const;

export type EntityName = keyof typeof RECORD_SCHEMAS;
export const ENTITY_NAMES = Object.keys(RECORD_SCHEMAS) as EntityName[];
export const EntityNameSchema = z.enum(ENTITY_NAMES as [EntityName, ...EntityName[]]);

export type RecordData<E extends EntityName> = z.infer<(typeof RECORD_SCHEMAS)[E]>;

/** Envelope around every synced record, on the wire and in local storage. */
export interface RecordEnvelope<E extends EntityName = EntityName> {
  entity: E;
  id: Id;
  /** Server-assigned version counter. 0 = never synced. */
  rev: number;
  updatedAt: IsoDateTime;
  deletedAt: IsoDateTime | null;
  data: RecordData<E>;
}

export const RecordEnvelopeSchema = z.object({
  entity: EntityNameSchema,
  id: Id,
  rev: z.number().int().min(0),
  updatedAt: IsoDateTime,
  deletedAt: IsoDateTime.nullable(),
  data: z.unknown(),
});

/** Validate `data` for an entity. Throws ZodError on invalid input. Applies schema defaults. */
export function parseRecordData<E extends EntityName>(entity: E, data: unknown): RecordData<E> {
  return RECORD_SCHEMAS[entity].parse(data) as RecordData<E>;
}

/** Entities whose records are never sent anywhere except the owner's own devices (PRIV-3). */
export const PRIVATE_ENTITIES: readonly EntityName[] = ['student'];
