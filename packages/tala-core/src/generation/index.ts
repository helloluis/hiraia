import {
  BUILTIN_TEMPLATES,
  type GenerationInput,
  type SectionContent,
  type Template,
  type Competency,
} from '../contracts';
export interface DraftSection {
  key: string;
  content: SectionContent;
}
export interface DraftInput extends GenerationInput {
  template?: Template;
  resolvedObjectives?: Record<string, string[]>;
  resolvedCompetencies?: Record<string, Pick<Competency, 'code' | 'text'>[]>;
}
/** Teacher-facing curriculum label: internal IDs are deliberately not accepted. */
export function formatCompetencyObjective(competency: Pick<Competency, 'code' | 'text'>): string {
  const code = competency.code?.trim();
  return code ? `${code}: ${competency.text}` : competency.text;
}
export function resolvedObjectiveText(input: DraftInput): Record<string, string[]> {
  return Object.fromEntries(
    input.gradeGroups.map((group) => {
      const records = input.resolvedCompetencies?.[group.id];
      const values = records
        ? records.map(formatCompetencyObjective)
        : (input.resolvedObjectives?.[group.id] ?? [])
            .filter((text) => !(input.competencies[group.id] ?? []).includes(text))
            .map((text) => {
              // Compatibility for saved client drafts assembled by the earlier ID-prefixed helper.
              const id = (input.competencies[group.id] ?? []).find((id) =>
                text.startsWith(`${id}:`)
              );
              return id ? text.slice(id.length + 1).trimStart() : text;
            });
      return [group.id, values];
    })
  );
}
export function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).join('\n');
  if (value && typeof value === 'object')
    return Object.entries(value)
      .filter(([key]) => !['type', 't', 'id', 'mode'].includes(key))
      .map(([, v]) => contentText(v))
      .join('\n');
  return '';
}
const rich = (text: string) => [{ t: 'p' as const, spans: [{ text }] }];
export function buildPrefilledDraft(input: DraftInput): {
  title: string;
  sections: DraftSection[];
  notice: string;
  classDetails: {
    gradeGroups: GenerationInput['gradeGroups'];
    classProfile: GenerationInput['classProfile'];
    timeBudgetMinutes: number;
  };
} {
  const template = input.template ?? BUILTIN_TEMPLATES.find((t) => t.id === input.templateId);
  if (!template) throw new Error('Choose a supported template.');
  const objectives = resolvedObjectiveText(input);
  const groups = Object.fromEntries(
    input.gradeGroups.map((g) => [
      g.id,
      rich((objectives[g.id] ?? []).concat(input.customObjectives).join('\n')),
    ])
  );
  const sections = template.sections.map((s) => {
    let content: SectionContent;
    switch (s.contentType) {
      case 'list':
        content = {
          type: 'list',
          items:
            s.key === 'objectives'
              ? Object.values(objectives).flat().concat(input.customObjectives)
              : s.key === 'materials'
                ? input.classProfile.materials
                : [],
        };
        break;
      case 'pergroup':
        content = {
          type: 'pergroup',
          groups:
            s.key === 'objectives'
              ? groups
              : Object.fromEntries(input.gradeGroups.map((g) => [g.id, []])),
        };
        break;
      case 'multigrade':
        content = {
          type: 'multigrade',
          blocks: [
            {
              id: 'draft-block',
              label: '',
              minutes: input.timeBudgetMinutes,
              transitionMinutes: 0,
              teacherWith: 'none',
              pairedGroupIds: [],
              groups: Object.fromEntries(
                input.gradeGroups.map((g) => [g.id, { mode: 'independent' as const, activity: [] }])
              ),
            },
          ],
        };
        break;
      case 'procedure':
        content = {
          type: 'procedure',
          steps: [{ id: 'draft-step', title: '', minutes: input.timeBudgetMinutes, body: [] }],
        };
        break;
      case 'weekgrid':
        content = {
          type: 'weekgrid',
          days: Array.from({ length: input.sessions }, (_, i) => ({
            date: null,
            weekday: i + 1,
            minutes: input.timeBudgetMinutes,
            body: [],
          })),
        };
        break;
      default:
        content = { type: 'text', blocks: [] };
    }
    return { key: s.key, content };
  });
  return {
    title: input.subjectName,
    sections,
    classDetails: {
      gradeGroups: input.gradeGroups.map((g) => ({ ...g })),
      classProfile: {
        ...input.classProfile,
        materials: [...input.classProfile.materials],
        textbooks: [...input.classProfile.textbooks],
      },
      timeBudgetMinutes: input.timeBudgetMinutes,
    },
    notice: 'Check facts, examples, answers and fit to the competency before use.',
  };
}
export function validateGeneratedSections(input: DraftInput, sections: DraftSection[]): string[] {
  const errors: string[] = [];
  const template = input.template ?? BUILTIN_TEMPLATES.find((t) => t.id === input.templateId);
  const keys = sections.map((s) => s.key);
  if (new Set(keys).size !== keys.length) errors.push('Duplicate sections.');
  for (const spec of template?.sections ?? []) {
    const section = sections.find((s) => s.key === spec.key);
    if (spec.required && !section) errors.push(`Missing ${spec.key}.`);
    if (section && section.content.type !== spec.contentType)
      errors.push(`Wrong content type for ${spec.key}.`);
  }
  for (const section of sections) {
    if (!template?.sections.some((s) => s.key === section.key))
      errors.push(`Unknown section ${section.key}.`);
    if (
      section.content.type === 'procedure' &&
      section.content.steps.reduce((n, b) => n + b.minutes, 0) !== input.timeBudgetMinutes
    )
      errors.push('Procedure minutes must equal time budget.');
    if (section.content.type === 'weekgrid') {
      if (section.content.days.length !== input.sessions)
        errors.push('Weekly session count must match.');
      if (new Set(section.content.days.map((d) => d.weekday)).size !== section.content.days.length)
        errors.push('Duplicate weekday.');
      for (const day of section.content.days)
        if (day.minutes !== input.timeBudgetMinutes)
          errors.push('Weekly minutes must equal time budget.');
    }
    if (section.content.type !== 'multigrade') continue;
    if (section.content.blocks.reduce((n, b) => n + b.minutes, 0) !== input.timeBudgetMinutes)
      errors.push('Block minutes must equal time budget.');
    for (const b of section.content.blocks) {
      if (b.transitionMinutes > b.minutes) errors.push('Transition exceeds block.');
      const ids = input.gradeGroups.map((g) => g.id);
      if (b.teacherWith !== 'all' && b.teacherWith !== 'none' && !ids.includes(b.teacherWith))
        errors.push('Unknown teacher focus.');
      if (b.pairedGroupIds.some((id) => !ids.includes(id))) errors.push('Unknown paired group.');
      const direct = Object.entries(b.groups)
        .filter(([, a]) => a.mode === 'direct')
        .map(([id]) => id);
      if (direct.length > 1 && !direct.every((id) => b.pairedGroupIds.includes(id)))
        errors.push('Teacher cannot teach unpaired groups together.');
      for (const id of ids) {
        const a = b.groups[id];
        if (!a || !contentText(a.activity).trim()) errors.push(`Missing activity for ${id}.`);
        if (
          a?.mode === 'direct' &&
          b.teacherWith !== id &&
          !(b.pairedGroupIds.includes(id) && b.pairedGroupIds.includes(b.teacherWith))
        )
          errors.push(`Direct instruction without teacher for ${id}.`);
        if (a?.mode === 'shared' && b.teacherWith !== 'all')
          errors.push('Shared activity needs whole-room focus.');
      }
    }
  }
  const resolved = resolvedObjectiveText(input);
  for (const group of input.gradeGroups)
    if ((input.competencies[group.id]?.length ?? 0) !== (resolved[group.id]?.length ?? 0))
      errors.push('Stored competency text must be resolved before validation.');
  for (const [group, objectives] of Object.entries(resolved))
    for (const objective of objectives)
      for (const key of ['objectives', 'assessment']) {
        const content = sections.find((s) => s.key === key)?.content;
        const text = contentText(content?.type === 'pergroup' ? content.groups[group] : content);
        if (!text?.includes(objective))
          errors.push(`${key} must include ${objective} for ${group}.`);
      }
  for (const objective of input.customObjectives)
    for (const key of ['objectives', 'assessment'])
      if (!contentText(sections.find((s) => s.key === key)?.content).includes(objective))
        errors.push(`${key} must include custom objective.`);
  const material = sections.find((s) => s.key === 'materials')?.content;
  const available = [...input.classProfile.materials, ...input.classProfile.textbooks].map((m) =>
    m.trim().toLowerCase()
  );
  const namedMaterials =
    material?.type === 'list'
      ? material.items
      : material?.type === 'pergroup'
        ? Object.values(material.groups).flatMap((blocks) =>
            blocks.flatMap((b) =>
              b.t === 'p'
                ? [b.spans.map((s) => s.text).join('')]
                : b.items.map((item) => item.map((s) => s.text).join(''))
            )
          )
        : [];
  for (const item of namedMaterials)
    if (item.trim() && !available.includes(item.trim().toLowerCase()))
      errors.push('Materials must exactly name available class resources.');
  if (material?.type === 'pergroup')
    for (const g of input.gradeGroups)
      if (!material.groups[g.id]) errors.push(`Missing materials group ${g.id}.`);
  return errors;
}
