/**
 * Online features: lesson generation (PRD §9), roster import (§12), community (§11), config (Appendix B).
 * OWNER: orchestrator.
 */
import { z } from 'zod';
import { GradeLevel, Id, IsoDateTime, Lang, LIMITS, QueryBool } from './common';
import { SectionContent, SectionKey, Template, TemplateKind } from './content';
import { ClassProfile, GradeGroup, Plan, PlanSection, SectionGenMeta } from './records';

/* ============================ LLM routing ============================ */

export const LlmFeature = z.enum([
  'lesson.generate',
  'lesson.regenerate',
  'lesson.adapt',
  'lesson.translate',
  'plan.import',
  'timetable.extract',
  'tags.rerank',
  'roster.columns',
  'roster.names',
  'community.moderate',
  'search.query',
]);
export type LlmFeature = z.infer<typeof LlmFeature>;

/** cloud = DeepSeek then Qwen; local = Hiraia-hosted model; rules = deterministic only; off = feature disabled. */
export const LlmRoute = z.enum(['cloud', 'local', 'rules', 'off']);
export type LlmRoute = z.infer<typeof LlmRoute>;

/* ============================ generation ============================ */

export const GenerationKind = z.enum(['full', 'section', 'adapt', 'translate']);

export const GenerationInput = z.object({
  kind: GenerationKind,
  /**
   * Client-generated. Re-sending the same key (lost reply, app restart) returns the SAME job instead of
   * creating — and paying for — another one (RES-5). Scoped to the account.
   */
  idempotencyKey: Id.optional(),
  /** Existing plan to fill, regenerate a section of, adapt or translate. Omit to create a new plan. */
  planId: Id.optional(),
  templateId: Id,
  language: Lang,
  subjectName: z.string().max(120),
  learningAreaId: z.string().max(64).nullable(),
  /** Minutes for the session; for a week plan, minutes per session. */
  timeBudgetMinutes: z.number().int().min(10).max(480),
  sessions: z.number().int().min(1).max(7).default(1),
  /** One to four grade groups. Counts only — never names (PRD §9.2). */
  gradeGroups: z.array(GradeGroup).min(1).max(LIMITS.maxGradeGroupsPerClass),
  /** gradeGroupId → competency ids. The server resolves ids to stored records; text is never taken from the client. */
  competencies: z.record(Id, z.array(z.string()).max(12)),
  curriculumVersion: z.string().nullable(),
  /** For classes with no preloaded curriculum (CUR-10). */
  customObjectives: z.array(z.string().max(500)).max(30).default([]),
  classProfile: ClassProfile,
  guidance: z.string().max(1000).default(''),
  priorPlanId: Id.optional(),
  sourceArtifactVersionId: Id.optional(),
  /** kind = 'section' */
  sectionKey: SectionKey.optional(),
  instruction: z.string().max(500).optional(),
  /** kind = 'translate' / 'adapt' */
  targetLanguage: Lang.optional(),
});
export type GenerationInput = z.infer<typeof GenerationInput>;

export const GeneratedSection = z.object({
  key: SectionKey,
  content: SectionContent,
  gen: SectionGenMeta,
});
export type GeneratedSection = z.infer<typeof GeneratedSection>;

export const GenerationJob = z.object({
  id: Id,
  status: z.enum(['queued', 'running', 'done', 'failed', 'cancelled']),
  kind: GenerationKind,
  planId: Id.nullable(),
  createdAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  /**
   * On `done`: the sections to write. The CLIENT writes them into plan_section records through the sync
   * engine (keeping the previous text as a revision, LLM-4); the server does not touch synced records here.
   */
  result: z
    .object({
      title: z.string().max(200),
      sections: z.array(GeneratedSection),
      provider: z.string(),
      model: z.string(),
      /** Multi-grade structural checks that failed and were repaired, for transparency. */
      warnings: z.array(z.string()).default([]),
    })
    .nullable(),
  failure: z
    .object({
      reason: z.enum([
        'providers_unavailable',
        'invalid_output',
        'quota_exceeded',
        'budget_exceeded',
        'disabled',
        'invalid_input',
      ]),
      message: z.string(),
    })
    .nullable(),
});
export type GenerationJob = z.infer<typeof GenerationJob>;

export const GenerationAllowance = z.object({
  fullRemainingToday: z.number().int(),
  sectionRemainingToday: z.number().int(),
  degraded: z.boolean(),
});

/* ============================ roster import ============================ */

export const RosterField = z.enum([
  'fullName',
  'familyName',
  'givenName',
  'middleName',
  'suffix',
  'sex',
  'grade',
  'localId',
  'ignore',
  /** Recognised sensitive column that Tala never stores (LRN, birthdate, address, guardian, contact …). */
  'drop',
]);
export type RosterField = z.infer<typeof RosterField>;

export const RosterRowFlag = z.enum([
  'uncertain_split',
  'maybe_not_person',
  'maybe_two_people',
  'possible_duplicate',
  'corrupted_characters',
  'model_rules_disagree',
  'untraceable_output', // model output not traceable to the source row; proposal discarded (§12.4)
  'unknown_grade',
]);

export const RosterProposed = z.object({
  displayName: z.string().max(200),
  familyName: z.string().max(120),
  givenName: z.string().max(120),
  middleName: z.string().max(120),
  suffix: z.string().max(20),
  sex: z.enum(['M', 'F']).nullable(),
  grade: GradeLevel.nullable(),
  localId: z.string().max(40).nullable(),
});
export type RosterProposed = z.infer<typeof RosterProposed>;

export const RosterRow = z.object({
  rowIndex: z.number().int(),
  /** Original name text exactly as read. */
  original: z.string().max(500),
  proposed: RosterProposed,
  status: z.enum(['clean', 'changed', 'needs_review', 'not_student']),
  flags: z.array(RosterRowFlag),
  /** Honorifics / annotations removed from the name, reported to the teacher. */
  removed: z.array(z.string()).default([]),
  duplicateGroup: z.number().int().nullable(),
});
export type RosterRow = z.infer<typeof RosterRow>;

export const RosterImportDraft = z.object({
  importId: Id,
  classId: Id,
  filename: z.string().max(260),
  columns: z.array(
    z.object({ index: z.number().int(), header: z.string().max(200), field: RosterField })
  ),
  /** Human-readable names of sensitive columns that were discarded before storage (PRIV-2). */
  droppedColumns: z.array(z.string()),
  /** Up to maxRosterRows STUDENT rows plus the non-student lines found around them (headers, totals, notes). */
  rows: z.array(RosterRow).max(LIMITS.maxRosterRows + 100),
  counts: z.object({
    linesRead: z.number().int(),
    students: z.number().int(),
    needsReview: z.number().int(),
    notStudents: z.number().int(),
  }),
  /** Route actually used. */
  route: LlmRoute,
  aiUsed: z.boolean(),
  sheets: z.array(z.string()).default([]),
  expiresAt: IsoDateTime,
});
export type RosterImportDraft = z.infer<typeof RosterImportDraft>;

export const RosterImportRequest = z.object({
  classId: Id,
  filename: z.string().max(260),
  /** Exactly one of text / contentBase64. */
  text: z.string().max(LIMITS.maxRosterFileBytes).optional(),
  contentBase64: z
    .string()
    .max(Math.ceil((LIMITS.maxRosterFileBytes * 4) / 3) + 8)
    .optional(),
  sheet: z.string().optional(),
  /** Teacher's choice on the flagged screen: Clean with AI vs Clean without AI (§12.4.1). */
  useAi: z.boolean(),
  /** Must be true when useAi is true and the active route is 'cloud': the teacher saw the flag. */
  cloudFlagAcknowledged: z.boolean().default(false),
  /** "Import exactly as written": one student per non-empty line, no splitting. */
  exactlyAsWritten: z.boolean().default(false),
});

export const RosterResolution = z.object({
  rowIndex: z.number().int(),
  action: z.enum(['accept', 'edit', 'split', 'not_student', 'keep_original']),
  /** For 'edit': the corrected fields. For 'split': two or more students. */
  students: z.array(RosterProposed).max(4).optional(),
});

export const RosterConfirmRequest = z.object({
  /** Client-generated; a retried confirm with the same key returns the same result instead of failing (RES-5). */
  idempotencyKey: Id.optional(),
  resolutions: z.array(RosterResolution),
  /** Bulk-accept all rows with status 'changed' (after the teacher viewed them). */
  acceptAllChanged: z.boolean().default(false),
  /** gradeGroupId assignment for rows whose grade could not be read. */
  defaultGradeGroupId: Id.nullable().default(null),
});

export const RosterConfirmResponse = z.object({
  /**
   * Student records to create. The CLIENT writes them through the sync engine; the server stores nothing
   * from the import beyond the draft, which it deletes on confirm/abandon and within 24 hours (PRIV-2).
   */
  students: z.array(
    RosterProposed.extend({ gradeGroupId: Id.nullable(), rowIndex: z.number().int() })
  ),
  pendingRows: z.array(z.number().int()),
});

/* ============================ community ============================ */

export const LICENSE = 'CC-BY-NC-4.0' as const;

export const ArtifactTags = z.object({
  grades: z.array(GradeLevel).min(1).max(LIMITS.maxGradeGroupsPerClass),
  learningAreaId: z.string().max(64).nullable(),
  subjectName: z.string().max(120),
  termIndex: z.number().int().min(1).max(12).nullable(),
  competencyIds: z.array(z.string()).max(48),
  curriculumVersion: z.string().nullable(),
  language: Lang,
  templateKind: TemplateKind,
  durationMinutes: z.number().int(),
  /** Sorted grade combination when the plan is multi-grade, e.g. ['2','4']. */
  multigrade: z.array(GradeLevel).nullable(),
  region: z.string().max(120).nullable(),
});
export type ArtifactTags = z.infer<typeof ArtifactTags>;

export const ArtifactSummary = z.object({
  id: Id,
  title: z.string().max(200),
  summary: z.string().max(600),
  authorDisplayName: z.string().max(120),
  authorSchool: z.string().max(200).nullable(),
  tags: ArtifactTags,
  license: z.literal(LICENSE),
  provenance: z.object({ aiDrafted: z.boolean(), adapted: z.boolean() }),
  lineage: z
    .object({
      artifactId: Id,
      versionId: Id,
      title: z.string(),
      authorDisplayName: z.string(),
      available: z.boolean(),
    })
    .nullable(),
  copyCount: z.number().int(),
  currentVersionId: Id,
  versionNumber: z.number().int(),
  status: z.enum(['visible', 'pending_check', 'returned', 'hidden', 'removed']),
  mine: z.boolean(),
  /** Latest moderation outcome. Present only for the author's own artifacts (never shown to others). */
  moderation: z.lazy(() => ModerationDecision).optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ArtifactSummary = z.infer<typeof ArtifactSummary>;

export const ArtifactVersion = z.object({
  id: Id,
  artifactId: Id,
  number: z.number().int(),
  templateId: Id,
  /** gradeGroup placeholders (ids + grades) so multigrade/pergroup content keys resolve after copy. */
  gradeGroups: z.array(z.object({ id: Id, grade: GradeLevel })),
  competencies: z.record(Id, z.array(z.string())),
  customObjectives: z.array(z.string()),
  sections: z.array(z.object({ key: SectionKey, content: SectionContent })),
  /** The template itself when it is a custom one, so a copier can render and save it. Absent for built-in templates. */
  template: Template.optional(),
  createdAt: IsoDateTime,
});
export type ArtifactVersion = z.infer<typeof ArtifactVersion>;

export const ArtifactDetail = ArtifactSummary.extend({ version: ArtifactVersion });
export type ArtifactDetail = z.infer<typeof ArtifactDetail>;

export const ModerationDecision = z.object({
  decision: z.enum(['allow', 'return', 'pending']),
  /** Loose-guideline categories only (§11.6). */
  reasons: z.array(
    z.object({
      category: z.enum(['student_personal_data', 'unsuitable', 'not_a_lesson']),
      /** Finer kind for client wording, e.g. 'phone', 'class_list', 'lrn', 'email', 'address'. */
      kind: z.string().max(40).optional(),
      message: z.string(),
      /** Section key and a short excerpt so the author can fix it. */
      sectionKey: z.string().nullable(),
      excerpt: z.string().max(300).nullable(),
    })
  ),
  guidelineVersion: z.number().int(),
});
export type ModerationDecision = z.infer<typeof ModerationDecision>;

export const PostArtifactRequest = z.object({
  /**
   * The locked plan and its sections as held on the device (the server re-checks state === 'locked'
   * against its own copy and uses its own stored content; these are sent so an offline-queued post is self-contained).
   */
  planId: Id,
  /** Existing artifact to add a version to; omit for a new artifact. */
  artifactId: Id.optional(),
  title: z.string().min(3).max(200),
  summary: z.string().max(600).default(''),
  displayName: z.string().min(1).max(120),
  showSchool: z.boolean().default(false),
  region: z.string().max(120).nullable().default(null),
  termIndex: z.number().int().min(1).max(12).nullable().default(null),
  licenseAccepted: z.literal(true),
  /** "This is my work or properly adapted, and it contains no student personal data." */
  affirmed: z.literal(true),
});

export const ArtifactSearchQuery = z.object({
  q: z.string().max(200).optional(),
  grade: GradeLevel.optional(),
  learningAreaId: z.string().optional(),
  termIndex: z.coerce.number().int().optional(),
  competencyId: z.string().optional(),
  language: Lang.optional(),
  region: z.string().optional(),
  /** Comma-separated sorted grades, e.g. '2,4'. */
  multigrade: z.string().optional(),
  maxMinutes: z.coerce.number().int().optional(),
  mine: QueryBool.optional(),
  cursor: z.string().optional(),
});

export const CopyArtifactResponse = z.object({
  /** New private draft plan + sections with lineage set. The CLIENT stores them through the sync engine. */
  plan: Plan,
  sections: z.array(PlanSection),
});

export const ReportRequest = z.object({
  reason: z.enum([
    'personal_data',
    'unsuitable',
    'copied_without_credit',
    'inaccurate',
    'spam',
    'other',
  ]),
  note: z.string().max(600).default(''),
});

/* ============================ client-facing configuration (Appendix B) ============================ */

export const ClientConfig = z.object({
  environment: z.enum(['local', 'staging', 'production']),
  features: z.object({
    generation: z.boolean(),
    community: z.boolean(),
    rosterAi: z.boolean(),
    googleSignIn: z.boolean(),
    /**
     * False while the server has no way to send mail: clients then hide "verify your email" and say plainly
     * that password reset by email is not available yet. Absent = assume true.
     */
    emailDelivery: z.boolean().optional(),
  }),
  /** Route for roster name cleaning. 'cloud' means the flagged early-access path must be shown (§12.4.1). */
  rosterLlmRoute: LlmRoute,
  limits: z.object({
    rosterRows: z.number().int(),
    rosterFileBytes: z.number().int(),
    attachmentBytes: z.number().int(),
    pageSize: z.number().int(),
  }),
  offline: z.object({ windowWeeksBack: z.number().int(), windowWeeksAhead: z.number().int() }),
  resilience: z.object({
    slowResponseMs: z.number().int(),
    retryMax: z.number().int(),
    retryBaseMs: z.number().int(),
    retryCapMs: z.number().int(),
  }),
  pacingDefaults: z.object({
    bufferRatio: z.number(),
    assessmentSessionsPerTerm: z.number().int(),
    minSessionsPerCompetency: z.number().int(),
    assumeTaught: z.boolean(),
    pairingRule: z.enum(['theme_then_sequence', 'sequence']),
  }),
  moderationGuidelineVersion: z.number().int(),
  minClientVersion: z.string(),
});
export type ClientConfig = z.infer<typeof ClientConfig>;
