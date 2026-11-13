import type { DraftInput } from '@hiraia/tala-core/generation';
import { BUILTIN_TEMPLATES } from '@hiraia/tala-core';
import {
  compactSchema,
  objectiveTargets,
  multigradeSchedule,
  procedureSchedule,
  type CompactLesson,
} from '../src/modules/generation/compact';
export function fakeCompact(input: DraftInput): CompactLesson {
  const template = input.template ?? BUILTIN_TEMPLATES.find((t) => t.id === input.templateId)!;
  const refs = (id: string) =>
    objectiveTargets(input)
      .find((g) => g.id === id)!
      .objectives.map((o) => o.ref);
  return compactSchema.parse({
    title: 'Plants',
    sections: template.sections.map((s) => ({
      key: s.key,
      text: 'Describe plants and check understanding.',
      targets: ['objectives', 'assessment'].includes(s.key)
        ? input.gradeGroups.flatMap((g) => refs(g.id))
        : [],
      items: s.key === 'materials' ? input.classProfile.materials : [],
      groups:
        s.contentType === 'pergroup'
          ? input.gradeGroups.map((g) => ({
              grade: g.grade,
              text: 'Describe plants and check understanding.',
              targets: refs(g.id),
              items: s.key === 'materials' ? input.classProfile.materials : [],
            }))
          : [],
      steps:
        s.contentType === 'procedure'
          ? procedureSchedule(input).map((slot) => ({
              slot: slot.slot,
              title: slot.purpose!,
              text: 'Observe and describe a familiar plant.',
            }))
          : [],
      blocks:
        s.contentType === 'multigrade'
          ? multigradeSchedule(input).map((slot) => ({
              slot: slot.slot,
              label: 'Observe',
              activities: input.gradeGroups.map((g) => ({
                grade: g.grade,
                text: 'Observe a plant.',
              })),
            }))
          : [],
      days:
        s.contentType === 'weekgrid'
          ? Array.from({ length: input.sessions }, (_, i) => ({
              weekday: i + 1,
              minutes: input.timeBudgetMinutes,
              text: 'Observe a plant and check understanding.',
            }))
          : [],
    })),
  });
}
/** Sparse provider wire representation: omit fields that belong to other section formats. */
export function fakeCompactRaw(input: DraftInput) {
  const full = fakeCompact(input),
    template = input.template ?? BUILTIN_TEMPLATES.find((t) => t.id === input.templateId)!;
  return {
    title: full.title,
    sections: full.sections.map((s) => {
      const type = template.sections.find((t) => t.key === s.key)!.contentType;
      switch (type) {
        case 'text':
          return {
            key: s.key,
            text: s.text,
            ...(s.key === 'assessment' ? { targets: s.targets } : {}),
          };
        case 'list':
          return {
            key: s.key,
            items: s.items,
            ...(s.key === 'objectives' ? { targets: s.targets } : {}),
          };
        case 'pergroup':
          return {
            key: s.key,
            groups: s.groups.map((g) => ({
              grade: g.grade,
              ...(s.key === 'materials'
                ? { items: g.items }
                : { text: g.text, targets: g.targets }),
            })),
          };
        case 'procedure':
          return {
            key: s.key,
            steps: s.steps.map((step) => ({ slot: step.slot, title: step.title, text: step.text })),
          };
        case 'weekgrid':
          return {
            key: s.key,
            days: s.days.map((day) => ({ weekday: day.weekday, text: day.text })),
          };
        case 'multigrade':
          return {
            key: s.key,
            blocks: s.blocks.map((b) => ({
              slot: b.slot,
              label: b.label,
              activities: b.activities.map((a) => ({ grade: a.grade, text: a.text })),
            })),
          };
      }
    }),
  };
}
