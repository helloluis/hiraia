import { Plan, PlanSection } from '../contracts/records';
import type { GradeGroup, ClassRecord, SectionGenMeta } from '../contracts/records';
import type { SectionContent, Template } from '../contracts/content';
import type { ArtifactVersion } from '../contracts/features';
import { sectionPlainText } from './text';
export { sectionPlainText, richTextPlainText } from './text';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function blankContent(type: SectionContent['type'], groupIds: string[] = []): SectionContent {
  switch (type) {
    case 'text': return { type, blocks: [] };
    case 'list': return { type, items: [] };
    case 'procedure': return { type, steps: [] };
    case 'multigrade': return { type, blocks: [] };
    case 'weekgrid': return { type, days: [1, 2, 3, 4, 5].map(weekday => ({ weekday, date: null, body: [] })) };
    case 'pergroup': return { type, groups: Object.fromEntries(groupIds.map(id => [id, []])) };
  }
}
export function blankSections(template: Template, planId: string, gradeGroups: ReadonlyArray<Pick<GradeGroup, 'id'>>, newId: () => string): PlanSection[] {
  return template.sections.map(s => PlanSection.parse({ id: newId(), planId, key: s.key, content: blankContent(s.contentType, gradeGroups.map(g => g.id)) }));
}
/** Labels, dates and time allocations alone do not make a required section complete. */
export function hasSectionContent(c: SectionContent, groupIds: string[] = []): boolean {
  const has = (s: string) => s.trim().length > 0;
  switch (c.type) {
    case 'text': return c.blocks.some(b => b.t === 'p' ? b.spans.some(s => has(s.text)) : b.items.some(i => i.some(s => has(s.text))));
    case 'list': return c.items.some(has);
    case 'procedure': return c.steps.some(s => hasSectionContent({ type: 'text', blocks: s.body }));
    case 'weekgrid': return c.days.some(d => hasSectionContent({ type: 'text', blocks: d.body }));
    case 'pergroup': return (groupIds.length ? groupIds : Object.keys(c.groups)).length > 0 && (groupIds.length ? groupIds : Object.keys(c.groups)).every(id => hasSectionContent({ type: 'text', blocks: c.groups[id] ?? [] }));
    case 'multigrade': return c.blocks.length > 0 && c.blocks.every(b => {
      const ids = groupIds.length ? groupIds : Object.keys(b.groups);
      return ids.length > 0 && ids.every(id => hasSectionContent({ type: 'text', blocks: b.groups[id]?.activity ?? [] }));
    });
  }
}
export interface LockValidation { ok: boolean; errors: Array<{ code: 'required_section' | 'competency_required' | 'template_mismatch' | 'already_locked'; sectionKey?: string; message: string }> }
export function validatePlanForLock(plan: Plan, sections: PlanSection[], template: Template, classRecord?: Pick<ClassRecord, 'curriculum'>): LockValidation {
  const errors: LockValidation['errors'] = [];
  if (plan.state !== 'draft') errors.push({ code: 'already_locked', message: 'Open a draft before locking this lesson.' });
  if (plan.templateId !== template.id) errors.push({ code: 'template_mismatch', message: 'Choose the lesson’s template.' });
  for (const spec of template.sections.filter(s => s.required)) {
    const section = sections.find(s => s.planId === plan.id && s.key === spec.key);
    if (!section || section.content.type !== spec.contentType || !hasSectionContent(section.content, plan.gradeGroupIds)) errors.push({ code: 'required_section', sectionKey: spec.key, message: `Complete ${spec.label.en}.` });
  }
  if (classRecord?.curriculum === 'deped' && !Object.values(plan.competencies).some(ids => ids.length)) errors.push({ code: 'competency_required', message: 'Add at least one curriculum competency.' });
  return { ok: errors.length === 0, errors };
}
/** Stable short fingerprint of a supplied revision snapshot, not a security or identity token. */
export function revisionCode(value: unknown): string {
  const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
  let hash = 2166136261;
  for (const char of canonical(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(36).toUpperCase().padStart(7, '0');
}
export type PublishSnapshot = Pick<ArtifactVersion, 'templateId' | 'gradeGroups' | 'competencies' | 'customObjectives' | 'sections'> & { schoolName?: string };
/** Allow-list only. Arbitrary personal information typed into lesson prose still needs pre-post review. */
export function stripForPublish(plan: Plan, sections: PlanSection[], options: { template?: Template; schoolName?: string; includeSchoolName?: boolean } = {}): PublishSnapshot {
  const ids = plan.gradeGroupIds.length ? plan.gradeGroupIds : Object.keys(plan.competencies);
  const groups = ids.map((id, index) => ({ source: id, id: `public.g${index + 1}`, grade: plan.grades[index] ?? plan.grades[0]! }));
  const remap = (id: string): string => groups.find(g => g.source === id)?.id ?? 'public.unknown';
  const outside = new Set(['reflection', ...(options.template?.sections.filter(s => s.outsideLock).map(s => s.key) ?? [])]);
  const clean = (c: SectionContent): SectionContent => {
    switch (c.type) {
      case 'weekgrid': return { ...c, days: c.days.map(d => ({ ...d, date: null })) };
      case 'pergroup': return { ...c, groups: Object.fromEntries(groups.filter(g => c.groups[g.source]).map(g => [g.id, c.groups[g.source]!])) };
      case 'multigrade': return { ...c, blocks: c.blocks.map((b, i) => ({ ...b, id: `public.block${i + 1}`, teacherWith: b.teacherWith === 'all' || b.teacherWith === 'none' ? b.teacherWith : remap(b.teacherWith), pairedGroupIds: b.pairedGroupIds.map(remap), groups: Object.fromEntries(groups.filter(g => b.groups[g.source]).map(g => [g.id, b.groups[g.source]!])) })) };
      case 'procedure': return { ...c, steps: c.steps.map((s, i) => ({ ...s, id: `public.step${i + 1}` })) };
      default: return c;
    }
  };
  return clone({ templateId: plan.templateId, gradeGroups: groups.map(({ id, grade }) => ({ id, grade })), competencies: Object.fromEntries(groups.map(g => [g.id, plan.competencies[g.source] ?? []])), customObjectives: plan.customObjectives,
    sections: sections.filter(s => s.planId === plan.id && !outside.has(s.key)).map(s => ({ key: s.key, content: clean(s.content) })),
    ...(options.includeSchoolName && options.schoolName ? { schoolName: options.schoolName } : {}),
  });
}
/** Conservative, deterministic lexical evidence; call with the recorded AI revision, never a user checkbox. */
export function substantiallyRewritten(originalAi: SectionContent[], current: SectionContent[], threshold = 0.5): boolean {
  if (threshold <= 0 || threshold > 1) throw new Error('Rewrite threshold must be between zero and one.');
  const words = (sections: SectionContent[]) => sections.flatMap(s => sectionPlainText(s).toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) ?? []);
  const before = words(originalAi), after = words(current);
  if (!before.length || after.length < before.length / 2) return false;
  const counts = new Map<string, number>(); for (const word of before) counts.set(word, (counts.get(word) ?? 0) + 1);
  let novel = 0;
  for (const word of after) { const n = counts.get(word) ?? 0; if (n) counts.set(word, n - 1); else novel++; }
  return novel / Math.max(before.length, after.length) >= threshold;
}
export interface SectionRevision { sectionId: string; previous: PlanSection; replacement: PlanSection }
/** Caller atomically persists returned plan, sections AND revisions before acknowledging generation. */
export function applyGeneratedSections(input: { plan: Plan; sections: PlanSection[]; generated: Array<{ key: string; content: SectionContent }>; gen: SectionGenMeta; newId: () => string; confirmedSectionIds?: string[] }): { plan: Plan; sections: PlanSection[]; revisions: SectionRevision[] } {
  if (input.plan.state !== 'draft') throw new Error('Unlock the lesson before generating sections.');
  const sections = clone(input.sections), revisions: SectionRevision[] = [];
  const keys = new Set<string>();
  for (const generated of input.generated) {
    if (keys.has(generated.key)) throw new Error('A generated section appears twice.'); keys.add(generated.key);
    const i = sections.findIndex(s => s.planId === input.plan.id && s.key === generated.key), previous = sections[i];
    if (previous && (previous.editedByTeacher || (previous.origin === 'manual' && hasSectionContent(previous.content))) && !input.confirmedSectionIds?.includes(previous.id)) throw new Error(`Confirm replacing section ${previous.key} first.`);
    const next = PlanSection.parse({ id: previous?.id ?? input.newId(), planId: input.plan.id, key: generated.key, content: generated.content, origin: 'ai', editedByTeacher: false, gen: input.gen });
    if (previous) { revisions.push({ sectionId: previous.id, previous: clone(previous), replacement: clone(next) }); sections[i] = next; } else sections.push(next);
  }
  return { plan: Plan.parse({ ...input.plan, aiDraft: true, aiAssisted: true }), sections, revisions };
}
export function restoreSectionRevision(revision: SectionRevision): PlanSection { return clone(revision.previous); }
