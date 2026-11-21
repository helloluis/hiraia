/**
 * Prebuilt weekly teaching packs (Luis, 19 Nov 2026: prepared, reviewed weekly packs first; optional AI adaptation
 * second). A pack is Hiraia-authored reference content for one DepEd week: five day-by-day lesson plans, a
 * classroom slide deck with per-slide speaker notes, and a teacher guide written for non-specialist teachers.
 *
 * Review is recorded in stages that are never merged: deterministic checks, a second model's critique (NOT human
 * review), named human teacher/expert review, and publication. Only `approved` packs are public.
 * OWNER: teaching-packs rework (docs/tala/teaching-packs/STATUS.md).
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
/**
 * Teacher-facing prose (plans, notes, guide, answer key): the English design length × 1.4, because the Filipino
 * edition of the same content runs 20–40% longer (the G4 T1 W8 Filipino guide overflowed a 500-character field).
 * Learner-facing slide text keeps its TV limits in both languages.
 */
const prose = (max: number) => text(Math.ceil(max * 1.4));

export const PACK_SCHEMA_VERSION = 1;

/**
 * Learning areas that have prebuilt packs. Science is the library. Mathematics is a six-week pilot (21 Nov 2026):
 * a separate, much smaller library with its own index, kept apart so a Science refresh can never remove it.
 */
export const PACK_SUBJECTS = ['science', 'mathematics'] as const;
export const PackSubject = z.enum(PACK_SUBJECTS);
export type PackSubject = z.infer<typeof PackSubject>;

/** `sci26-g4-t2-w10`, `math26-g4-t3-w01`: the prefix names the learning area. */
export const PACK_ID_PATTERN = /^(sci26|math26)-g(3|4|5|6|7|8|9|10)-t[1-3]-w\d{2}$/;
export const packSubjectOf = (packId: string): PackSubject =>
  packId.startsWith('math26-') ? 'mathematics' : 'science';

/** Every pack is produced in English and in Filipino, with the same structure, competencies, timing and drawings. */
export const PACK_LANGS = ['en', 'fil'] as const;
export const PackLang = z.enum(PACK_LANGS);
export type PackLang = z.infer<typeof PackLang>;

/** MATATAG lesson procedure (DepEd MATATAG training, 2024), in order. */
export const LESSON_PHASES = [
  'activating_prior_knowledge',
  'lesson_purpose',
  'developing_understanding',
  'generalization',
  'evaluating_learning',
] as const;
export const LessonPhase = z.enum(LESSON_PHASES);
export type LessonPhase = z.infer<typeof LessonPhase>;

export const PackCompetency = z.object({
  /** Curriculum record id (tala-server/data/packs); `text` is the stored record, never model wording. */
  id: z.string().max(200),
  text: z.string().max(4000),
  shortTitle: z.string().max(120).nullable(),
  weekFrom: z.number().int().min(1).max(20),
  weekTo: z.number().int().min(1).max(20),
  /** This week's position inside the printed range (1-based). */
  position: z.number().int().min(1).max(20),
  sourcePage: z.number().int().min(1),
});
export type PackCompetency = z.infer<typeof PackCompetency>;

export const SlideKind = z.enum([
  'cover',
  'day',
  'question',
  'concept',
  'vocabulary',
  'activity',
  'check',
  'reveal',
  'summary',
  'credits',
]);
export type SlideKind = z.infer<typeof SlideKind>;

export const SlideImage = z.object({
  /** Illustration slug from the Hiraia catalog (packages/tala-packs/data/art). */
  slug: z.string().max(120),
  /** Short description for screen readers and for teachers with images switched off. */
  alt: text(200),
});

export const Slide = z.object({
  /** `d<day>s<n>`; cover/credits use `d0s<n>`. */
  id: z.string().regex(/^d[0-5]s\d{1,2}$/),
  day: z.number().int().min(0).max(5),
  kind: SlideKind,
  /** Learner-facing heading. Short: read from the back of a classroom on a TV. */
  title: text(70),
  /** Learner-facing lines (no answers before a reveal slide). */
  /** 110 characters in English; Filipino runs longer, so the contract allows 130 and the checker applies the language's limit. */
  lines: z.array(text(130)).max(5).default([]),
  /** Multiple-choice options for `check` slides (learner-facing, no marker on the correct one). */
  choices: z.array(text(120)).max(4).default([]),
  /** For `reveal`: the `check` slide it answers, and the index of the correct choice when there are choices. */
  revealOf: z.string().nullable().default(null),
  correctChoice: z.number().int().min(0).max(3).nullable().default(null),
  image: SlideImage.nullable().default(null),
  /** Teacher-only speaker notes: what to say and ask, expected answers, timing, cautions. Never on the slide. */
  notes: prose(2400),
});
export type Slide = z.infer<typeof Slide>;

export const FlowStep = z.object({
  phase: LessonPhase,
  minutes: z.number().int().min(1).max(45),
  /** What the teacher does and says. */
  teacher: prose(2400),
  /** What learners do. */
  learners: prose(1000),
  slideIds: z.array(z.string()).max(12),
});
export type FlowStep = z.infer<typeof FlowStep>;

export const DayPlan = z.object({
  day: z.number().int().min(1).max(5),
  title: text(80),
  /** Curriculum ids this lesson works on; each must be one of the pack's competencies. */
  competencyIds: z.array(z.string()).min(1).max(6),
  /** "Learners will be able to …" — observable, one sentence. */
  objective: prose(300),
  minutes: z.number().int().min(30).max(60),
  materials: z.array(prose(300)).max(12),
  flow: z.array(FlowStep).min(5).max(8),
  /** What learners should see or find in today's activity, so the teacher knows what "worked" looks like. */
  expectedObservations: z.array(prose(300)).max(6).default([]),
  /** Formative check (exit ticket); the answer is teacher-only. */
  check: z.object({ question: prose(400), answer: prose(600), why: prose(800) }),
  support: prose(900),
  extension: prose(900),
  longerPeriod: prose(800),
});
export type DayPlan = z.infer<typeof DayPlan>;

export const AssessmentItem = z.object({
  id: z.string().regex(/^q\d{1,2}$/),
  kind: z.enum(['multiple_choice', 'short_answer', 'performance']),
  prompt: prose(500),
  choices: z.array(prose(160)).max(4).default([]),
  /** Index into choices for multiple choice. */
  correctChoice: z.number().int().min(0).max(3).nullable().default(null),
  answer: prose(600),
  /** Worked explanation of the answer for the teacher (and why the wrong choices are wrong). */
  explanation: prose(900),
  competencyId: z.string(),
});
export type AssessmentItem = z.infer<typeof AssessmentItem>;

export const PackSourceRef = z.object({
  /** Id from the reference allowlist (packages/tala-packs/data/references.json). */
  refId: z.string().max(60),
  /** Where in that source: chapter, section or DCI code. */
  locator: z.string().max(160),
  usedFor: z.string().max(240),
});

export const TeacherGuide = z.object({
  bigIdea: prose(400),
  whyItMatters: prose(700),
  /** "What is happening and why": the science explained for a teacher who is not a specialist. */
  background: z
    .array(
      z.object({
        heading: prose(90),
        paragraphs: z.array(prose(1400)).min(1).max(4),
        refIds: z.array(z.string()).max(4).default([]),
      })
    )
    .min(2)
    .max(7),
  prerequisites: z
    .array(z.object({ idea: prose(240), quickCheck: prose(300), ifMissing: prose(400) }))
    .min(1)
    .max(5),
  vocabulary: z
    .array(
      z.object({
        term: prose(60),
        filipino: z.string().max(80).nullable(),
        meaning: prose(300),
        example: prose(300),
      })
    )
    .min(3)
    .max(14),
  misconceptions: z
    .array(
      z.object({
        belief: prose(240),
        whyLearnersThinkIt: prose(400),
        correctIdea: prose(500),
        howToAddress: prose(500),
      })
    )
    .min(2)
    .max(6),
  studentQuestions: z
    .array(z.object({ question: prose(240), answer: prose(800) }))
    .min(3)
    .max(8),
  localExamples: z
    .array(z.object({ example: prose(200), connection: prose(500) }))
    .min(2)
    .max(6),
  materials: z
    .array(
      z.object({
        item: prose(120),
        amount: prose(120),
        notes: z.string().max(420).default(''),
        substitute: z.string().max(280).nullable().default(null),
      })
    )
    .max(20),
  preparation: z.array(prose(400)).max(8),
  safety: z.array(prose(400)).max(8),
  sources: z.array(PackSourceRef).min(1).max(10),
});
export type TeacherGuide = z.infer<typeof TeacherGuide>;

export const PackIllustration = z.object({
  slug: z.string(),
  /** Path inside the Hiraia reference checkout and the SHA-256 of the exact bytes embedded. */
  file: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  px: z.tuple([z.number().int(), z.number().int()]),
  /** Card art: `clean` or `approved_regen`. Mathematics diagrams are drawn by code from the problem's own numbers. */
  v05Status: z.enum(['clean', 'approved_regen', 'pilot_code_generated']),
  generator: z.string(),
  slides: z.array(z.string()).min(1),
  /** Independent image check for each slide claim it supports. */
  check: z.object({
    method: z.enum(['vision_model', 'none', 'code_and_visual']),
    model: z.string().nullable(),
    verdict: z.enum(['pass', 'fail', 'not_checked']),
    note: z.string().max(600),
  }),
});
export type PackIllustration = z.infer<typeof PackIllustration>;

export const WeeklyPackContent = z.object({
  schemaVersion: z.literal(PACK_SCHEMA_VERSION),
  packId: z.string().regex(PACK_ID_PATTERN),
  curriculumVersion: z.string(),
  curriculumDataRevision: z.number().int(),
  /** Must agree with the pack id's prefix (the library refuses a pack where they differ). */
  learningAreaId: PackSubject,
  grade: z.string(),
  term: z.number().int().min(1).max(3),
  week: z.number().int().min(1).max(14),
  language: PackLang,
  title: text(80),
  summary: prose(600),
  competencies: z.array(PackCompetency).min(1).max(20),
  timing: z.object({
    sessions: z.literal(5),
    minutesPerSession: z.literal(45),
    basis: z.string().max(400),
  }),
  guide: TeacherGuide,
  days: z.array(DayPlan).length(5),
  assessment: z.array(AssessmentItem).min(4).max(12),
  slides: z.array(Slide).min(12).max(70),
  illustrations: z.array(PackIllustration).max(40),
  /** Topics that need a human reviewer's eye before publication whatever the checks say. */
  sensitivity: z.array(z.enum(['human_reproduction', 'health', 'disaster', 'safety_critical'])).default([]),
  provenance: z.object({
    pipelineVersion: z.string(),
    promptIds: z.array(z.string()),
    models: z.array(z.object({ role: z.string(), provider: z.string(), model: z.string() })),
    generatedAt: z.string(),
    groundingFactIds: z.array(z.string()).max(200),
    targetInputHash: z.string(),
    artCatalogCommit: z.string(),
  }),
});
export type WeeklyPackContent = z.infer<typeof WeeklyPackContent>;

/* ---------------- Review ledger and library index ---------------- */

export const ReviewStageState = z.enum(['not_started', 'pass', 'fail', 'issues_open']);

export const PackReview = z.object({
  packId: z.string(),
  language: PackLang,
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Deterministic structure, consistency, safety and slide-design checks. */
  autoChecks: z.object({
    state: ReviewStageState,
    checkerVersion: z.string(),
    failures: z.array(z.string()).default([]),
    warnings: z.array(z.string()).default([]),
    at: z.string(),
  }),
  /** A second language model read the pack. This is NOT human review and never approves a pack. */
  modelCritique: z.object({
    state: ReviewStageState,
    model: z.string().nullable(),
    rounds: z.number().int().min(0),
    openIssues: z.array(z.string()).default([]),
    resolvedIssues: z.number().int().min(0),
    at: z.string().nullable(),
  }),
  /** Named people only. A model can never fill these. */
  teacherReview: z
    .object({ reviewer: z.string(), role: z.string(), verdict: z.enum(['approve', 'changes']), notes: z.string(), at: z.string() })
    .nullable(),
  expertReview: z
    .object({ reviewer: z.string(), role: z.string(), verdict: z.enum(['approve', 'changes']), notes: z.string(), at: z.string() })
    .nullable(),
  /** Hiraia's student-text rules measured on the slides (docs/tala/teaching-packs/VERBIAGE-RULES.md). */
  verbiage: z
    .object({
      rulesVersion: z.string(),
      state: z.enum(['pass', 'warn', 'fail']),
      metrics: z.record(z.number().nullable()),
      findings: z.array(z.string()),
    })
    .nullable()
    .default(null),
  /** `approved` only by Luis or a reviewer he names; required for the public library. */
  publication: z.enum(['draft', 'approved', 'withdrawn']),
  publicationBy: z.string().nullable(),
});
export type PackReview = z.infer<typeof PackReview>;

export const PackStatus = z.enum([
  /** Built, checked and approved by a named human: in the public library. */
  'approved',
  /** Built and checked; awaiting human review. Not public. */
  'draft',
  /** Built but a check or the critique left a problem open. Not public. */
  'needs_work',
  /** Generation or rendering failed; the error is recorded. */
  'failed',
  /** Not built yet. */
  'not_built',
]);
export type PackStatus = z.infer<typeof PackStatus>;

/**
 * `exercises` and `solutions` are the Mathematics pilot's learner worksheet and worked answers; `diagrams` and
 * `templates` are materials a week cannot be taught without (the solids week's diagram bank and cut-out nets).
 * All PDF.
 */
export const PackFileKind = z.enum(['slides', 'guide', 'plans', 'exercises', 'solutions', 'diagrams', 'templates']);
export type PackFileKind = z.infer<typeof PackFileKind>;

/** One language version of a week's pack. */
export const PackVariant = z.object({
  language: PackLang,
  status: PackStatus,
  /** Pack title once built (null when the caller may not see it). */
  title: z.string().nullable(),
  /** Whether the caller may open this version (approved, or a reviewer viewing a draft). */
  viewable: z.boolean(),
  files: z
    .array(
      z.object({
        kind: PackFileKind,
        bytes: z.number().int(),
        sha256: z.string(),
        /** The author's instructions for using this file, when it has any (shown beside the download). */
        note: z.string().max(800).optional(),
      })
    )
    .default([]),
  slideCount: z.number().int().nullable(),
  illustratedSlides: z.number().int().nullable(),
  review: z
    .object({
      autoChecks: ReviewStageState,
      modelCritique: ReviewStageState,
      teacherReview: z.boolean(),
      expertReview: z.boolean(),
    })
    .nullable(),
});
export type PackVariant = z.infer<typeof PackVariant>;

export const PackIndexEntry = z.object({
  packId: z.string(),
  grade: z.string(),
  term: z.number().int(),
  week: z.number().int(),
  /** Printed topic titles of the week's competencies. */
  topic: z.string(),
  competencyIds: z.array(z.string()),
  /** Best status across languages (for sorting and the week's badge). */
  status: PackStatus,
  /** True when at least one language version may be opened by the caller. */
  viewable: z.boolean(),
  variants: z.object({ en: PackVariant, fil: PackVariant }),
});
export type PackIndexEntry = z.infer<typeof PackIndexEntry>;

export const PackIndex = z.object({
  /** Which library this is. Index files written before the Mathematics pilot have no field: they are Science. */
  subject: PackSubject.default('science'),
  curriculumVersion: z.string(),
  libraryVersion: z.string(),
  /** The caller sees drafts (reviewer account or a non-production environment). */
  reviewerView: z.boolean(),
  /** Counts are per language version: every week has an English and a Filipino pack. */
  counts: z.object({
    targets: z.number().int(),
    approved: z.number().int(),
    draft: z.number().int(),
    needsWork: z.number().int(),
    failed: z.number().int(),
    notBuilt: z.number().int(),
  }),
  packs: z.array(PackIndexEntry),
});
export type PackIndex = z.infer<typeof PackIndex>;

export const PackDetail = z.object({
  entry: PackIndexEntry,
  language: PackLang,
  content: WeeklyPackContent,
  review: PackReview,
});
export type PackDetail = z.infer<typeof PackDetail>;
