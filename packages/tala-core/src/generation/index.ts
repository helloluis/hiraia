import { BUILTIN_TEMPLATES, type GenerationInput, type SectionContent, type Template } from '../contracts';
export interface DraftSection { key: string; content: SectionContent }
export interface DraftInput extends GenerationInput { template?: Template; resolvedObjectives?: Record<string, string[]> }
const rich = (text: string) => [{ t: 'p' as const, spans: [{ text }] }];
export function buildPrefilledDraft(input: DraftInput): { title: string; sections: DraftSection[]; notice: string } {
  const template = input.template ?? BUILTIN_TEMPLATES.find(t => t.id === input.templateId);
  if (!template) throw new Error('Choose a supported template.');
  const groups = Object.fromEntries(input.gradeGroups.map(g => [g.id, rich((input.resolvedObjectives?.[g.id] ?? input.competencies[g.id] ?? input.customObjectives).join('\n'))]));
  const sections = template.sections.map(s => {
    let content: SectionContent;
    switch(s.contentType) {
      case 'list': content = { type: 'list', items: s.key === 'objectives' ? Object.values(input.resolvedObjectives ?? input.competencies).flat().concat(input.customObjectives) : s.key === 'materials' ? input.classProfile.materials : [] }; break;
      case 'pergroup': content = { type: 'pergroup', groups: s.key === 'objectives' ? groups : Object.fromEntries(input.gradeGroups.map(g => [g.id, []])) }; break;
      case 'multigrade': content = { type: 'multigrade', blocks: [{ id: 'draft-block', label: '', minutes: input.timeBudgetMinutes, transitionMinutes: 0, teacherWith: 'none', pairedGroupIds: [], groups: Object.fromEntries(input.gradeGroups.map(g => [g.id, { mode: 'independent' as const, activity: [] }])) }] }; break;
      case 'procedure': content = { type: 'procedure', steps: [{ id: 'draft-step', title: '', minutes: input.timeBudgetMinutes, body: [] }] }; break;
      case 'weekgrid': content = { type: 'weekgrid', days: Array.from({length: input.sessions}, (_,i) => ({ date: null, weekday: i+1, body: [] })) }; break;
      default: content = { type: 'text', blocks: [] };
    }
    return { key: s.key, content };
  });
  return { title: input.subjectName, sections, notice: 'Check facts, examples, answers and fit to the competency before use.' };
}
export function validateGeneratedSections(input: DraftInput, sections: DraftSection[]): string[] {
  const errors: string[] = [];
  const template = input.template ?? BUILTIN_TEMPLATES.find(t => t.id === input.templateId);
  const keys = sections.map(s => s.key);
  if (new Set(keys).size !== keys.length) errors.push('Duplicate sections.');
  for (const spec of template?.sections ?? []) {
    const section = sections.find(s => s.key === spec.key);
    if (spec.required && !section) errors.push(`Missing ${spec.key}.`);
    if (section && section.content.type !== spec.contentType) errors.push(`Wrong content type for ${spec.key}.`);
  }
  for (const section of sections) {
    if (!template?.sections.some(s => s.key === section.key)) errors.push(`Unknown section ${section.key}.`);
    if (section.content.type === 'procedure' && section.content.steps.reduce((n,b) => n+b.minutes,0) !== input.timeBudgetMinutes) errors.push('Procedure minutes must equal time budget.');
    if (section.content.type !== 'multigrade') continue;
    if (section.content.blocks.reduce((n,b) => n+b.minutes,0) !== input.timeBudgetMinutes) errors.push('Block minutes must equal time budget.');
    for (const b of section.content.blocks) {
      if (b.transitionMinutes > b.minutes) errors.push('Transition exceeds block.');
      const ids = input.gradeGroups.map(g => g.id);
      if (b.teacherWith !== 'all' && b.teacherWith !== 'none' && !ids.includes(b.teacherWith)) errors.push('Unknown teacher focus.');
      if (b.pairedGroupIds.some(id => !ids.includes(id))) errors.push('Unknown paired group.');
      const direct = Object.entries(b.groups).filter(([,a]) => a.mode === 'direct').map(([id]) => id);
      if (direct.length > 1 && !direct.every(id => b.pairedGroupIds.includes(id))) errors.push('Teacher cannot teach unpaired groups together.');
      for (const id of ids) {
        const a = b.groups[id];
        if (!a || !JSON.stringify(a.activity).match(/"text":"[^"\s]/)) errors.push(`Missing activity for ${id}.`);
        if (a?.mode === 'direct' && b.teacherWith !== id && !(b.pairedGroupIds.includes(id) && b.pairedGroupIds.includes(b.teacherWith))) errors.push(`Direct instruction without teacher for ${id}.`);
        if (a?.mode === 'shared' && b.teacherWith !== 'all') errors.push('Shared activity needs whole-room focus.');
      }
    }
  }
  for (const [group, objectives] of Object.entries(input.resolvedObjectives ?? input.competencies)) for (const objective of objectives) for (const key of ['objectives','assessment']) {
    const content = sections.find(s => s.key === key)?.content;
    const text = JSON.stringify(content?.type === 'pergroup' ? content.groups[group] : content);
    if (!text?.includes(objective)) errors.push(`${key} must include ${objective} for ${group}.`);
  }
  for (const objective of input.customObjectives) for (const key of ['objectives','assessment']) if (!JSON.stringify(sections.find(s => s.key === key)?.content)?.includes(objective)) errors.push(`${key} must include custom objective.`);
  return errors;
}
