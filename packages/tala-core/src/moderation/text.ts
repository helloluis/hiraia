/**
 * Human-written text of a lesson, as units the detectors can read.
 *
 * Only fields a teacher types are read (span text, list items, step titles, block labels). Internal ids,
 * grade-group keys and numbers the app generates (minutes, weekdays) are never part of the text, so they
 * cannot look like phone numbers or LRNs.
 *
 * A unit is one line. Units from the same container (one rich-text field, one list section, one
 * procedure step, one week day) share a `group`, so a roster pasted one name per line is seen as one list.
 */
import type { RichText, SectionContent } from '../contracts/content';

export interface TextUnit {
  /** Section key, or 'title' / 'summary' for the post's own fields. */
  sectionKey: string;
  text: string;
  /** Units of the same container share a group number. */
  group: number;
}

export interface ModerationTextInput {
  title?: string;
  summary?: string;
  sections: ReadonlyArray<{ key: string; content: SectionContent }>;
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function richTextLines(blocks: RichText): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.t === 'p') out.push(...splitLines(b.spans.map((s) => s.text).join('')));
    else for (const item of b.items) out.push(...splitLines(item.map((s) => s.text).join('')));
  }
  return out;
}

/** Every line of a section's human-written text, grouped by container. */
export function sectionTextGroups(content: SectionContent): string[][] {
  switch (content.type) {
    case 'text':
      return [richTextLines(content.blocks)];
    case 'list':
      return [content.items.flatMap(splitLines)];
    case 'procedure':
      return content.steps.map((s) => [...splitLines(s.title), ...richTextLines(s.body)]);
    case 'weekgrid':
      return content.days.map((d) => richTextLines(d.body));
    case 'pergroup':
      return Object.values(content.groups).map(richTextLines);
    case 'multigrade':
      return content.blocks.flatMap((b) => [splitLines(b.label), ...Object.values(b.groups).map((g) => richTextLines(g.activity))]);
  }
}

export function textUnits(input: ModerationTextInput): TextUnit[] {
  const units: TextUnit[] = [];
  let group = 0;
  const push = (sectionKey: string, lines: string[]) => {
    if (!lines.length) return;
    group++;
    for (const text of lines) units.push({ sectionKey, text, group });
  };
  if (input.title) push('title', splitLines(input.title));
  if (input.summary) push('summary', splitLines(input.summary));
  for (const s of input.sections) for (const lines of sectionTextGroups(s.content)) push(s.key, lines);
  return units;
}

/** Plain text for a model prompt: one `## key` heading per section. Bounded by `maxChars`. */
export function moderationText(input: ModerationTextInput, maxChars = 20_000): { text: string; truncated: boolean } {
  const parts: string[] = [];
  if (input.title) parts.push(`## title\n${input.title}`);
  if (input.summary) parts.push(`## summary\n${input.summary}`);
  for (const s of input.sections) parts.push(`## ${s.key}\n${sectionTextGroups(s.content).map((g) => g.join('\n')).join('\n\n')}`);
  const text = parts.join('\n\n');
  return text.length > maxChars ? { text: text.slice(0, maxChars), truncated: true } : { text, truncated: false };
}

/** Lower-case, accents removed, whitespace collapsed: for matching an excerpt or a name against content. */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
