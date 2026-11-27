import { z } from 'zod';
import {
  BUILTIN_TEMPLATES,
  SectionContent as SectionContentSchema,
  type SectionContent,
  type Template,
  type GenerationInput,
} from '@hiraia/tala-core';
import {
  validateGeneratedSections,
  resolvedObjectiveText,
  type DraftInput,
} from '@hiraia/tala-core/generation';
import type { LlmRequest } from '../../kernel/types';

export const DEFAULT_LESSON_PROMPT_VERSION = 4;

const text = z.string().max(3000);
const targetFields = {
  text: text.default(''),
  targets: z.array(z.string()).default([]),
  items: z.array(text).default([]),
};
const group = z.object({ grade: z.string(), ...targetFields });
export const compactSchema = z.object({
  title: z.string().max(200),
  sections: z
    .array(
      z.object({
        key: z.string(),
        note: z.string().max(600).optional(),
        ...targetFields,
        groups: z.array(group).default([]),
        steps: z
          .array(
            z.object({
              slot: z.number().int().optional(),
              title: z.string().max(200),
              minutes: z.number().int().min(0).max(480).default(0),
              text,
            })
          )
          .default([]),
        blocks: z
          .array(
            z.object({
              slot: z.number().int().optional(),
              label: z.string().max(120),
              minutes: z.number().int().min(1).max(240).default(1),
              transitionMinutes: z.number().int().min(0).max(30).default(0),
              teacherWith: z.string().default('none'),
              pairedGrades: z.array(z.string()).default([]),
              activities: z.array(
                z.object({
                  grade: z.string(),
                  mode: z.enum(['direct', 'independent', 'peer', 'shared']).default('independent'),
                  text,
                })
              ),
            })
          )
          .max(24)
          .default([]),
        days: z
          .array(
            z.object({
              weekday: z.number().int().min(1).max(7),
              minutes: z.number().int().min(0).max(480).default(0),
              text,
            })
          )
          .max(7)
          .default([]),
      })
    )
    .max(20),
});
export type CompactLesson = z.infer<typeof compactSchema>;
export interface LessonOutput {
  title: string;
  warnings?: string[];
  sections: { key: string; content: SectionContent }[];
}
const rich = (value: string) =>
  value
    .split('\n')
    .filter((s) => s.trim())
    .map((line) => ({ t: 'p' as const, spans: [{ text: line }] }));
/** Resolve model target references against authoritative objectives; never invent missing references. */
export function objectiveTargets(input: DraftInput) {
  const objectives = resolvedObjectiveText(input);
  let ordinal = 0;
  return input.gradeGroups.map((g) => ({
    grade: g.grade,
    id: g.id,
    ...(g.learnerCount != null ? { learnerCount: g.learnerCount } : {}),
    objectives: (objectives[g.id] ?? [])
      .map((value) => ({ ref: `objective-${++ordinal}`, text: value }))
      .concat(input.customObjectives.map((value, i) => ({ ref: `custom-${i + 1}`, text: value }))),
  }));
}
/** Counts are the only learner information projected into a lesson request. */
function classSize(input: DraftInput) {
  const complete = input.gradeGroups.every((group) => group.learnerCount != null);
  return {
    groups: objectiveTargets(input),
    ...(complete
      ? {
          totalLearnerCount: input.gradeGroups.reduce(
            (total, group) => total + group.learnerCount!,
            0
          ),
        }
      : {}),
  };
}
// Compare only presentation text; authoritative curriculum wording remains unchanged.
function withAuthoritativeText(authoritative: string[], additions: string[]): string[] {
  const stored = [...new Set(authoritative)];
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\p{P}\p{S}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const canonical = stored.map(normalize);
  return [
    ...stored,
    ...additions
      .flatMap((value) => value.split('\n'))
      .filter((line) => {
        const normalized = normalize(line);
        return normalized && !canonical.some((text) => ` ${text} `.includes(` ${normalized} `));
      }),
  ];
}
export function convertCompact(
  input: DraftInput,
  raw: CompactLesson,
  newId: () => string
): LessonOutput {
  const template = input.template ?? BUILTIN_TEMPLATES.find((t) => t.id === input.templateId);
  if (!template) throw Error('template');
  const groups = objectiveTargets(input);
  const groupId = (grade: string) => {
    const g = groups.find((g) => g.grade === grade);
    if (!g) throw Error('group_reference');
    return g.id;
  };
  const bound = (part: { text: string; targets: string[] }, grade?: string) => {
    const candidates = groups
      .filter((g) => !grade || g.grade === grade)
      .flatMap((g) => g.objectives);
    if (part.targets.some((ref) => !candidates.some((t) => t.ref === ref)))
      throw Error('objective_reference');
    return withAuthoritativeText(
      part.targets.map((ref) => candidates.find((t) => t.ref === ref)!.text),
      [part.text]
    ).join('\n');
  };
  const warnings: string[] = [];
  const sections = raw.sections.map((s, index) => {
    const spec = template.sections.find((t) => t.key === s.key);
    if (!spec) throw Error('section_key');
    if (spec.outsideLock) throw Error('post_class_section');
    let content: SectionContent;
    const isTarget = s.key === 'objectives' || s.key === 'assessment';
    switch (spec.contentType) {
      case 'text':
        content = { type: 'text', blocks: rich(isTarget ? bound(s) : s.text) };
        break;
      case 'list':
        content = {
          type: 'list',
          items: isTarget
            ? withAuthoritativeText(
                s.targets.map((ref) => {
                  const obj = groups.flatMap((g) => g.objectives).find((o) => o.ref === ref);
                  if (!obj) throw Error('objective_reference');
                  return obj.text;
                }),
                s.items
              )
            : s.items,
        };
        break;
      case 'pergroup':
        if (new Set(s.groups.map((g) => g.grade)).size !== s.groups.length)
          throw Error('duplicate_group');
        content = {
          type: 'pergroup',
          groups: Object.fromEntries(
            s.groups.map((g) => [
              groupId(g.grade),
              rich(
                isTarget ? bound(g, g.grade) : s.key === 'materials' ? g.items.join('\n') : g.text
              ),
            ])
          ),
        };
        break;
      case 'procedure': {
        const schedule = procedureSchedule(input);
        if (
          s.steps.length !== schedule.length ||
          new Set(s.steps.map((step) => step.slot)).size !== schedule.length
        )
          throw Error('schedule_slots');
        content = {
          type: 'procedure',
          steps: schedule.map((slot) => {
            const step = s.steps.find((s) => s.slot === slot.slot);
            if (!step) throw Error('schedule_slots');
            return { id: newId(), title: step.title, minutes: slot.minutes, body: rich(step.text) };
          }),
        };
        break;
      }
      case 'multigrade': {
        const schedule = multigradeSchedule(input);
        if (
          s.blocks.length !== schedule.length ||
          new Set(s.blocks.map((b) => b.slot)).size !== schedule.length
        )
          throw Error('schedule_slots');
        content = {
          type: 'multigrade',
          ...(s.note ? { note: s.note } : {}),
          blocks: schedule.map((slot) => {
            const b = s.blocks.find((b) => b.slot === slot.slot);
            if (!b) throw Error('schedule_slots');
            if (new Set(b.activities.map((a) => a.grade)).size !== b.activities.length)
              throw Error('duplicate_group');
            return {
              id: newId(),
              label: b.label,
              minutes: slot.minutes,
              transitionMinutes: slot.transitionMinutes,
              teacherWith: slot.teacherWith === 'all' ? 'all' : groupId(slot.teacherWith),
              pairedGroupIds: [],
              groups: Object.fromEntries(
                b.activities.map((a) => [
                  groupId(a.grade),
                  {
                    mode:
                      slot.teacherWith === 'all'
                        ? 'shared'
                        : a.grade === slot.teacherWith
                          ? 'direct'
                          : 'independent',
                    activity: rich(a.text),
                  },
                ])
              ),
            };
          }),
        };
        break;
      }
      case 'weekgrid':
        content = {
          type: 'weekgrid',
          days: s.days.map((d) => ({
            date: null,
            weekday: d.weekday,
            minutes: input.timeBudgetMinutes,
            body: rich(d.text),
          })),
        };
        break;
    }
    return { key: s.key, content: SectionContentSchema.parse(content) };
  });
  return { title: raw.title, sections, warnings };
}
export function procedureSchedule(input: DraftInput) {
  const weights = [0.1, 0.1, 0.3, 0.4, 0.1],
    labels = ['Opening', 'Recall', 'Model and explain', 'Practice', 'Closing and check'];
  const minutes = weights.map((w) => Math.floor(input.timeBudgetMinutes * w));
  minutes[3]! += input.timeBudgetMinutes - minutes.reduce((n, m) => n + m, 0);
  return minutes.map((m, i) => ({ slot: i + 1, minutes: m, purpose: labels[i] }));
}
/** Fixed timing/focus is a server constraint; models only fill activities for these slots. */
export function multigradeSchedule(input: DraftInput) {
  const edge = Math.max(1, Math.min(5, Math.floor(input.timeBudgetMinutes * 0.1)));
  const remaining = input.timeBudgetMinutes - edge * 2,
    n = input.gradeGroups.length;
  return [
    { slot: 1, minutes: edge, transitionMinutes: 0, teacherWith: 'all' },
    ...input.gradeGroups.map((g, i) => ({
      slot: i + 2,
      minutes: Math.floor(remaining / n) + (i < remaining % n ? 1 : 0),
      transitionMinutes: 1,
      teacherWith: g.grade,
    })),
    { slot: n + 2, minutes: edge, transitionMinutes: 0, teacherWith: 'all' },
  ];
}
/**
 * The weekdays of a week plan's sessions. A plan laid out on the days its class meets (a Saturday or Sunday class:
 * Monday, Wednesday and Saturday) names them in its own week grid; those are used when the grid has one day per
 * session. Otherwise Monday onwards, as before.
 */
export function weekSchedule(input: DraftInput, source?: unknown) {
  const grid = Array.isArray(source)
    ? (source as Array<{ content?: SectionContent }>).find((s) => s?.content?.type === 'weekgrid')
        ?.content
    : undefined;
  const planned =
    grid?.type === 'weekgrid'
      ? [...new Set(grid.days.map((d) => d.weekday))]
          .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
          .sort((a, b) => a - b)
      : [];
  const weekdays =
    planned.length === input.sessions
      ? planned
      : Array.from({ length: input.sessions }, (_, i) => i + 1);
  return weekdays.map((weekday) => ({ weekday, minutes: input.timeBudgetMinutes }));
}
export function compactTemplateSchema(template: Template, input?: DraftInput) {
  const refs = input
    ? objectiveTargets(input).flatMap((g) => g.objectives.map((o) => o.ref))
    : ['example'];
  const targetRefs = z.array(z.enum((refs.length ? refs : ['__none__']) as [string, ...string[]]));
  const preClass = template.sections.filter((s) => !s.outsideLock);
  const shapes = preClass.map((s) => {
    const key = { key: z.literal(s.key) };
    switch (s.contentType) {
      case 'text':
        return z
          .object({ ...key, text, ...(s.key === 'assessment' ? { targets: targetRefs } : {}) })
          .strict();
      case 'list':
        return z
          .object({
            ...key,
            items: z.array(text),
            ...(s.key === 'objectives' ? { targets: targetRefs } : {}),
          })
          .strict();
      case 'pergroup':
        return z
          .object({
            ...key,
            groups: z.array(
              z
                .object({
                  grade: z.string(),
                  ...(s.key === 'materials'
                    ? { items: z.array(text) }
                    : { text, targets: targetRefs }),
                })
                .strict()
            ),
          })
          .strict();
      case 'procedure':
        return z
          .object({
            ...key,
            steps: z
              .array(
                z
                  .object({
                    slot: z.number().int().min(1).max(5),
                    title: z.string().max(200),
                    text,
                  })
                  .strict()
              )
              .length(5),
          })
          .strict();
      case 'multigrade':
        return z
          .object({
            ...key,
            note: z.string().max(600).optional(),
            blocks: z
              .array(
                z
                  .object({
                    slot: z
                      .number()
                      .int()
                      .min(1)
                      .max(input ? input.gradeGroups.length + 2 : 6),
                    label: z.string().max(120),
                    activities: z.array(z.object({ grade: z.string(), text }).strict()),
                  })
                  .strict()
              )
              .length(input ? input.gradeGroups.length + 2 : 4),
          })
          .strict();
      case 'weekgrid':
        return z
          .object({
            ...key,
            days: z
              .array(z.object({ weekday: z.number().int().min(1).max(7), text }).strict())
              .length(input?.sessions ?? 5),
          })
          .strict();
    }
  });
  // Section keys discriminate between small, mandatory per-format fields; no silent defaulting of missing content.
  return z
    .object({
      title: z.string().max(200),
      sections: z
        .array(
          z.discriminatedUnion(
            'key',
            shapes as unknown as [
              z.ZodDiscriminatedUnionOption<'key'>,
              ...z.ZodDiscriminatedUnionOption<'key'>[],
            ]
          )
        )
        .min(preClass.filter((s) => s.required).length)
        .max(preClass.length),
    })
    .strict();
}
function translationRequest(
  input: DraftInput,
  source: LessonOutput['sections'],
  opts: { userId: string; signal?: AbortSignal; version?: number }
): LlmRequest<LessonOutput> {
  const leaves: { path: string; text: string }[] = [];
  const trusted = Object.values(input.resolvedObjectives ?? {})
    .flat()
    .concat(input.customObjectives, input.classProfile.materials, input.classProfile.textbooks);
  const walk = (value: unknown, path: string[], parentKey = '') => {
    if (
      typeof value === 'string' &&
      ['text', 'title', 'label', 'items', 'note'].includes(parentKey) &&
      value.trim() &&
      !trusted.includes(value)
    )
      leaves.push({ path: path.join('/'), text: value });
    else if (Array.isArray(value))
      value.forEach((v, i) => walk(v, [...path, String(i)], parentKey));
    else if (value && typeof value === 'object')
      for (const [key, v] of Object.entries(value)) walk(v, [...path, key], key);
  };
  const template = input.template ?? BUILTIN_TEMPLATES.find((t) => t.id === input.templateId)!;
  source = source.filter((s) => !template.sections.find((spec) => spec.key === s.key)?.outsideLock);
  walk(source, []);
  const rawSchema = z
    .object({
      translations: z
        .array(z.object({ path: z.string(), text: z.string().max(3000) }).strict())
        .length(leaves.length),
    })
    .strict();
  const schema = rawSchema.transform((raw, ctx) => {
    const paths = raw.translations.map((t) => t.path);
    if (
      new Set(paths).size !== leaves.length ||
      paths.some((p) => !leaves.some((l) => l.path === p))
    ) {
      ctx.addIssue({ code: 'custom', message: 'translation_paths' });
      return z.NEVER;
    }
    if (
      raw.translations.some(
        (replacement) => replacement.path.endsWith('/note') && replacement.text.length > 600
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'note_length' });
      return z.NEVER;
    }
    const sections = structuredClone(source);
    for (const replacement of raw.translations) {
      const parts = replacement.path.split('/');
      let node: unknown = sections;
      for (const part of parts.slice(0, -1)) node = (node as Record<string, unknown>)[part];
      (node as Record<string, unknown>)[parts.at(-1)!] = replacement.text;
    }
    return { title: input.subjectName, sections, warnings: [] };
  });
  return {
    feature: 'lesson.translate',
    promptId: 'lesson/translate',
    version: opts.version ?? DEFAULT_LESSON_PROMPT_VERSION,
    userId: opts.userId,
    signal: opts.signal,
    maxOutputTokens: 12288,
    vars: {
      input: JSON.stringify({ language: input.targetLanguage, ...classSize(input), leaves }),
    },
    schema,
    check: (value) => validateGeneratedSections(input, value.sections),
  };
}
export function lessonRequest(
  input: DraftInput,
  opts: {
    userId: string;
    newId: () => string;
    source?: unknown;
    prior?: unknown;
    signal?: AbortSignal;
    version?: number;
  }
): LlmRequest<LessonOutput> {
  const template = input.template ?? BUILTIN_TEMPLATES.find((t) => t.id === input.templateId)!;
  const requestedTemplate =
    input.kind === 'section'
      ? { ...template, sections: template.sections.filter((s) => s.key === input.sectionKey) }
      : { ...template, sections: template.sections.filter((s) => !s.outsideLock) };
  if (!requestedTemplate.sections.length || requestedTemplate.sections.some((s) => s.outsideLock))
    throw Error('post_class_section');
  const preClassOnly = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((s) => !template.sections.find((spec) => spec.key === s.key)?.outsideLock)
      : value;
  const promptId = `lesson/${input.kind === 'full' ? (input.gradeGroups.length > 1 ? 'multigrade' : template.span === 'week' ? 'week' : 'single') : input.kind}`;
  // The storage representation is generated locally, including all IDs and trusted objective text.
  if (opts.version === 1) {
    const storageSchema = z.object({
      title: z.string().max(200),
      sections: z
        .array(z.object({ key: z.string(), content: SectionContentSchema }))
        .refine(
          (sections) =>
            sections.every((s) => requestedTemplate.sections.some((spec) => spec.key === s.key)),
          'post_class_or_unknown_section'
        ),
    });
    return {
      feature:
        input.kind === 'section'
          ? 'lesson.regenerate'
          : input.kind === 'adapt'
            ? 'lesson.adapt'
            : input.kind === 'translate'
              ? 'lesson.translate'
              : 'lesson.generate',
      promptId,
      version: 1,
      userId: opts.userId,
      signal: opts.signal,
      maxOutputTokens: 12288,
      vars: {
        input: JSON.stringify({
          ...input,
          gradeGroups: input.gradeGroups.map((g) => ({
            id: g.id,
            grade: g.grade,
            ...(g.learnerCount != null ? { learnerCount: g.learnerCount } : {}),
          })),
          ...classSize(input),
          template: requestedTemplate,
          source: preClassOnly(opts.source),
          prior: preClassOnly(opts.prior),
        }),
        schema: JSON.stringify(requestedTemplate.sections),
      },
      schema: storageSchema,
      check: (value) => {
        const errors = validateGeneratedSections(
          { ...input, template: requestedTemplate },
          value.sections
        );
        if (input.kind === 'translate') {
          const shape = (v: unknown, key = ''): unknown =>
            Array.isArray(v)
              ? v.map((item) => shape(item, key))
              : v && typeof v === 'object'
                ? Object.fromEntries(Object.entries(v).map(([k, item]) => [k, shape(item, k)]))
                : typeof v === 'string' && ['text', 'title', 'label', 'items'].includes(key)
                  ? ''
                  : v;
          if (JSON.stringify(shape(value.sections)) !== JSON.stringify(shape(opts.source)))
            errors.push('Translation must preserve source structure.');
        }
        return errors.filter(
          (e) =>
            input.kind !== 'section' ||
            (!e.startsWith('objectives must') && !e.startsWith('assessment must'))
        );
      },
    };
  }
  if (input.kind === 'translate')
    return translationRequest(input, (opts.source ?? []) as LessonOutput['sections'], opts);
  const schema = compactTemplateSchema(requestedTemplate, input).transform((raw, ctx) => {
    try {
      const value = compactSchema.parse(raw);
      return convertCompact({ ...input, template: requestedTemplate }, value, opts.newId);
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'conversion',
      });
      return z.NEVER;
    }
  });
  return {
    feature:
      input.kind === 'section'
        ? 'lesson.regenerate'
        : input.kind === 'adapt'
          ? 'lesson.adapt'
          : 'lesson.generate',
    promptId,
    version: opts.version ?? DEFAULT_LESSON_PROMPT_VERSION,
    userId: opts.userId,
    signal: opts.signal,
    maxOutputTokens:
      input.kind === 'section'
        ? 4096
        : template.span === 'week' || input.gradeGroups.length >= 3
          ? 12288
          : 8192,
    vars: {
      input: JSON.stringify({
        language: input.targetLanguage ?? input.language,
        subject: input.subjectName,
        ...classSize(input),
        timeBudgetMinutes: input.timeBudgetMinutes,
        sessions: input.sessions,
        profile: input.classProfile,
        schedule:
          template.span === 'week'
            ? weekSchedule(input, opts.source)
            : input.gradeGroups.length > 1
              ? multigradeSchedule(input)
              : procedureSchedule(input),
        guidance: input.guidance,
        instruction: input.instruction,
        sections: requestedTemplate.sections.map((s) => ({ key: s.key, format: s.contentType })),
        source: preClassOnly(opts.source),
        prior: preClassOnly(opts.prior),
      }),
    },
    schema,
    check: (value) =>
      validateGeneratedSections({ ...input, template: requestedTemplate }, value.sections).filter(
        (e) =>
          input.kind !== 'section' ||
          (!e.startsWith('objectives must') && !e.startsWith('assessment must'))
      ),
  };
}
