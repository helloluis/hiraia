/**
 * Lesson-plan content model (PRD §6.1, PLAN-2, §9.3).
 * "Simple formatted text": paragraphs, bold, italic, lists. No free tables, no inline images.
 * Template tables (DLL week grid, multi-grade time blocks) are structured fields laid out by the app.
 * OWNER: orchestrator.
 */
import { z } from 'zod';
import { Id, IsoDate, Localized } from './common';

export const Span = z.object({
  text: z.string().max(4000),
  b: z.boolean().optional(),
  i: z.boolean().optional(),
});
export type Span = z.infer<typeof Span>;

export const Block = z.discriminatedUnion('t', [
  z.object({ t: z.literal('p'), spans: z.array(Span) }),
  z.object({ t: z.literal('ul'), items: z.array(z.array(Span)) }),
  z.object({ t: z.literal('ol'), items: z.array(z.array(Span)) }),
]);
export type Block = z.infer<typeof Block>;

export const RichText = z.array(Block).max(400);
export type RichText = z.infer<typeof RichText>;

/** Who the teacher is with during a multi-grade time block. */
export const TeacherFocus = z.union([Id, z.literal('all'), z.literal('none')]);

export const MultigradeGroupActivity = z.object({
  /** direct = teacher-led; independent = no teacher needed; peer = cross-age help; shared = whole room together. */
  mode: z.enum(['direct', 'independent', 'peer', 'shared']),
  activity: RichText,
});

export const MultigradeBlock = z.object({
  id: Id,
  label: z.string().max(120),
  minutes: z.number().int().min(1).max(240),
  /** Minutes of this block spent moving between activities (included in `minutes`). */
  transitionMinutes: z.number().int().min(0).max(30).default(0),
  /** gradeGroupId the teacher is teaching directly, 'all' for a shared block, 'none' for supervised independent work. */
  teacherWith: TeacherFocus,
  /** Grade groups explicitly taught together in this block (PRD §9.3 pairing of adjacent groups). */
  pairedGroupIds: z.array(Id).max(4).default([]),
  /** Keyed by gradeGroupId. Every grade group of the class must be present. */
  groups: z.record(Id, MultigradeGroupActivity),
});
export type MultigradeBlock = z.infer<typeof MultigradeBlock>;

export const SectionContent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), blocks: RichText }),
  z.object({ type: z.literal('list'), items: z.array(z.string().max(1000)).max(100) }),
  z.object({
    type: z.literal('procedure'),
    steps: z
      .array(
        z.object({
          id: Id,
          title: z.string().max(200),
          minutes: z.number().int().min(0).max(480),
          body: RichText,
        })
      )
      .max(40),
  }),
  z.object({
    type: z.literal('multigrade'),
    blocks: z.array(MultigradeBlock).max(24),
    /**
     * A short pre-class note to the teacher about the session as a whole (e.g. that with three or four groups
     * each gets a short turn with her, or which group gets its turn next session). Shown above the time blocks.
     */
    note: z.string().max(600).optional(),
  }),
  z.object({
    type: z.literal('weekgrid'),
    days: z
      .array(
        z.object({
          date: IsoDate.nullable(),
          weekday: z.number().int().min(1).max(7),
          /** Minutes planned for that day's session, when known; lets a week plan be checked against the time budget. */
          minutes: z.number().int().min(0).max(600).nullable().optional(),
          body: RichText,
        })
      )
      .max(7),
  }),
  /** Per-grade-group content, e.g. assessment or materials for each group in a multi-grade plan. */
  z.object({ type: z.literal('pergroup'), groups: z.record(Id, RichText) }),
]);
export type SectionContent = z.infer<typeof SectionContent>;
export type SectionContentType = SectionContent['type'];

/** Stable section keys. Templates choose a subset and label them. Custom templates may add `custom.*` keys. */
export const SECTION_KEYS = [
  'objectives',
  'content',
  'materials',
  'procedure',
  'multigrade',
  'weekgrid',
  'assessment',
  'differentiation',
  'assignment',
  'results',
  'reflection',
] as const;
export const SectionKey = z.string().regex(/^([a-z]+|custom\.[a-z0-9_-]{1,32})$/);
export type SectionKey = z.infer<typeof SectionKey>;

export const TemplateSection = z.object({
  key: SectionKey,
  label: Localized,
  contentType: z.enum(['text', 'list', 'procedure', 'multigrade', 'weekgrid', 'pergroup']),
  required: z.boolean(),
  /**
   * POST-CLASS section: written after the lesson has been taught (assessment results, reflection). It is
   * outside the lock (DOC-2) — it stays editable on a locked plan, is never required for locking, is not part
   * of the lock's revision code, and is never drafted by a model. Everything else is pre-class content and
   * freezes when the plan is locked.
   */
  outsideLock: z.boolean().default(false),
});
export type TemplateSection = z.infer<typeof TemplateSection>;

export const TemplateKind = z.enum(['dll', 'dlp', 'multigrade', 'custom']);
export type TemplateKind = z.infer<typeof TemplateKind>;

export const Template = z.object({
  id: Id,
  kind: TemplateKind,
  name: Localized,
  builtIn: z.boolean(),
  /** session = one lesson; week = DLL-style week of sessions for one subject. */
  span: z.enum(['session', 'week']),
  orientation: z.enum(['portrait', 'landscape']),
  sections: z.array(TemplateSection).min(1).max(20),
});
export type Template = z.infer<typeof Template>;

const L = (fil: string, en: string) => ({ fil, en });

/** Built-in templates. [verify] section names against current DepEd DLL/DLP formats (PRD PLAN-3). */
export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'tpl.dlp.v1',
    kind: 'dlp',
    name: L('Detalyadong Banghay-Aralin (DLP)', 'Detailed Lesson Plan (DLP)'),
    builtIn: true,
    span: 'session',
    orientation: 'portrait',
    sections: [
      {
        key: 'objectives',
        label: L('Mga Layunin', 'Objectives'),
        contentType: 'list',
        required: true,
        outsideLock: false,
      },
      {
        key: 'content',
        label: L('Nilalaman', 'Content'),
        contentType: 'text',
        required: false,
        outsideLock: false,
      },
      {
        key: 'materials',
        label: L('Mga Kagamitan', 'Learning Resources'),
        contentType: 'list',
        required: true,
        outsideLock: false,
      },
      {
        key: 'procedure',
        label: L('Pamamaraan', 'Procedure'),
        contentType: 'procedure',
        required: true,
        outsideLock: false,
      },
      {
        key: 'assessment',
        label: L('Pagtataya', 'Assessment'),
        contentType: 'text',
        required: true,
        outsideLock: false,
      },
      {
        key: 'differentiation',
        label: L('Remediation at Pagpapayaman', 'Remediation and Enrichment'),
        contentType: 'text',
        required: false,
        outsideLock: false,
      },
      {
        key: 'assignment',
        label: L('Takdang-Aralin', 'Assignment'),
        contentType: 'text',
        required: false,
        outsideLock: false,
      },
      {
        key: 'results',
        label: L('Resulta ng Pagtataya (pagkatapos ng klase)', 'Assessment results (after class)'),
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
      {
        key: 'reflection',
        label: L('Pagninilay', 'Reflection'),
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
    ],
  },
  {
    id: 'tpl.dll.v1',
    kind: 'dll',
    name: L('Daily Lesson Log (DLL)', 'Daily Lesson Log (DLL)'),
    builtIn: true,
    span: 'week',
    orientation: 'landscape',
    sections: [
      {
        key: 'objectives',
        label: L('Mga Layunin', 'Objectives'),
        contentType: 'list',
        required: true,
        outsideLock: false,
      },
      {
        key: 'content',
        label: L('Nilalaman', 'Content'),
        contentType: 'text',
        required: false,
        outsideLock: false,
      },
      {
        key: 'materials',
        label: L('Mga Kagamitan', 'Learning Resources'),
        contentType: 'list',
        required: true,
        outsideLock: false,
      },
      {
        key: 'weekgrid',
        label: L('Pamamaraan sa Bawat Araw', 'Daily Procedures'),
        contentType: 'weekgrid',
        required: true,
        outsideLock: false,
      },
      {
        key: 'assessment',
        label: L('Pagtataya', 'Assessment'),
        contentType: 'text',
        required: true,
        outsideLock: false,
      },
      {
        key: 'results',
        label: L('Resulta ng Pagtataya (pagkatapos ng klase)', 'Assessment results (after class)'),
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
      {
        key: 'reflection',
        label: L('Pagninilay', 'Reflection'),
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
    ],
  },
  {
    id: 'tpl.multigrade.v1',
    kind: 'multigrade',
    name: L('Banghay-Aralin para sa Multigrade', 'Multi-grade Session Plan'),
    builtIn: true,
    span: 'session',
    orientation: 'portrait',
    sections: [
      {
        key: 'objectives',
        label: L('Mga Layunin ng Bawat Baitang', 'Objectives per Grade'),
        contentType: 'pergroup',
        required: true,
        outsideLock: false,
      },
      {
        key: 'materials',
        label: L('Mga Kagamitan ng Bawat Baitang', 'Materials per Grade'),
        contentType: 'pergroup',
        required: true,
        outsideLock: false,
      },
      {
        key: 'multigrade',
        label: L('Daloy ng Klase', 'Session Flow'),
        contentType: 'multigrade',
        required: true,
        outsideLock: false,
      },
      {
        key: 'assessment',
        label: L('Pagtataya ng Bawat Baitang', 'Assessment per Grade'),
        contentType: 'pergroup',
        required: true,
        outsideLock: false,
      },
      {
        key: 'results',
        label: L('Resulta ng Pagtataya (pagkatapos ng klase)', 'Assessment results (after class)'),
        contentType: 'pergroup',
        required: false,
        outsideLock: true,
      },
      {
        key: 'reflection',
        label: L('Pagninilay', 'Reflection'),
        contentType: 'text',
        required: false,
        outsideLock: true,
      },
    ],
  },
];
