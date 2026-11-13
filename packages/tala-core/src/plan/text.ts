import type { RichText, SectionContent } from '../contracts/content';
export const richTextPlainText = (blocks: RichText): string =>
  blocks
    .map((b) =>
      b.t === 'p'
        ? b.spans.map((s) => s.text).join('')
        : b.items
            .map(
              (spans, i) =>
                `${b.t === 'ol' ? `${i + 1}.` : '•'} ${spans.map((s) => s.text).join('')}`
            )
            .join('\n')
    )
    .join('\n');
export function sectionPlainText(content: SectionContent): string {
  switch (content.type) {
    case 'text':
      return richTextPlainText(content.blocks);
    case 'list':
      return content.items.join('\n');
    case 'procedure':
      return content.steps
        .map((s) => `${s.title} (${s.minutes} min)\n${richTextPlainText(s.body)}`)
        .join('\n\n');
    case 'weekgrid':
      return content.days
        .map((d) => `${d.date ?? `Day ${d.weekday}`}\n${richTextPlainText(d.body)}`)
        .join('\n\n');
    case 'pergroup':
      return Object.entries(content.groups)
        .map(([id, body]) => `${id}\n${richTextPlainText(body)}`)
        .join('\n\n');
    case 'multigrade':
      return content.blocks
        .map(
          (b) =>
            `${b.label} (${b.minutes} min; transition ${b.transitionMinutes} min)\nTeacher: ${b.teacherWith}\n${Object.entries(
              b.groups
            )
              .map(([id, g]) => `${id} (${g.mode}): ${richTextPlainText(g.activity)}`)
              .join('\n')}`
        )
        .join('\n\n');
  }
}
