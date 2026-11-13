import { SectionContent } from '../contracts/content';
import { sectionPlainText } from '../plan/text';
/** Keep both in reading order. Structured content stays structured where possible. */
export function appendContent(first: SectionContent, second: SectionContent): SectionContent {
  let value: SectionContent;
  if (first.type === 'text' && second.type === 'text')
    value = { type: 'text', blocks: [...first.blocks, ...second.blocks] };
  else if (first.type === 'list' && second.type === 'list')
    value = { type: 'list', items: [...first.items, ...second.items] };
  else if (first.type === 'procedure' && second.type === 'procedure')
    value = {
      type: 'procedure',
      steps: [
        ...first.steps,
        ...second.steps.map((s, i) => ({ ...s, id: `both.${i}.${s.id}`.slice(0, 64) })),
      ],
    };
  else if (first.type === 'multigrade' && second.type === 'multigrade')
    value = {
      type: 'multigrade',
      blocks: [
        ...first.blocks,
        ...second.blocks.map((s, i) => ({ ...s, id: `both.${i}.${s.id}`.slice(0, 64) })),
      ],
    };
  else if (first.type === 'pergroup' && second.type === 'pergroup')
    value = {
      type: 'pergroup',
      groups: Object.fromEntries(
        [...new Set([...Object.keys(first.groups), ...Object.keys(second.groups)])].map((k) => [
          k,
          [...(first.groups[k] ?? []), ...(second.groups[k] ?? [])],
        ])
      ),
    };
  else if (first.type === 'weekgrid' && second.type === 'weekgrid') {
    const days = first.days.map((d) => ({ ...d, body: [...d.body] }));
    for (const d of second.days) {
      const match = days.find((x) => x.weekday === d.weekday && x.date === d.date);
      if (match) match.body.push(...d.body);
      else days.push(d);
    }
    value = { type: 'weekgrid', days };
  } else
    value = {
      type: 'text',
      blocks: [first, second].flatMap((c) =>
        sectionPlainText(c)
          .split('\n')
          .map((text) => ({ t: 'p' as const, spans: [{ text }] }))
      ),
    };
  // Overflow fails before saving; the original conflict and both versions remain durable.
  return SectionContent.parse(value);
}
