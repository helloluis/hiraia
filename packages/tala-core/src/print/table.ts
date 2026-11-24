/**
 * Table layout for a multi-grade plan on paper: one row per time block, one column per grade group, and a column
 * that says who the teacher is with (PRD §9.3). Per-grade sections (objectives, materials, assessment) are set
 * side by side the same way, so a teacher reads across the room, not down three separate lessons.
 *
 * Used when a print is asked for with `layout: 'table'`; the stacked layout stays the default (and the phone's).
 * The Word export (../docx) writes the same rows and columns from the same content.
 *
 * FILIPINO in TABLE_WORDS: first drafts, not yet reviewed by a fluent Filipino-speaking teacher (PRD §14.3).
 */
import type { Lang } from '../contracts/common';
import type { MultigradeBlock, RichText } from '../contracts/content';

export const TABLE_WORDS: Record<Lang, { time: string; teacherWith: string; references: string; page: string; aiDraft: string; draft: string }> = {
  en: {
    time: 'Time',
    teacherWith: 'Teacher is with',
    references: 'Curriculum references',
    page: 'p.',
    aiDraft: 'Drafted with AI and not yet checked by the teacher. Check facts, examples and answers before use.',
    draft: 'DRAFT',
  },
  fil: {
    time: 'Oras',
    teacherWith: 'Kasama ng guro',
    references: 'Mga sanggunian sa kurikulum',
    page: 'p.',
    aiDraft: 'Ginawa ang draft na ito gamit ang AI. Wala pang gurong nagsuri nito. Tingnan kung tama ang impormasyon, mga halimbawa at sagot bago gamitin.',
    draft: 'DRAFT',
  },
};

export interface TableDeps {
  lang: Lang;
  escape: (s: string | number) => string;
  rich: (blocks: RichText) => string;
  /** Grade groups in column order. */
  groups: Array<{ id: string; label: string }>;
  /** Words shared with the stacked layout (print/index.ts `labels`). */
  words: { minutes: string; all: string; none: string; direct: string; independent: string; peer: string; shared: string };
}

/** Who the teacher is with in a block, in words. */
export function teacherFocus(block: Pick<MultigradeBlock, 'teacherWith' | 'pairedGroupIds'>, d: Pick<TableDeps, 'groups' | 'words'>): string {
  const name = (id: string) => d.groups.find((g) => g.id === id)?.label ?? '';
  if (block.teacherWith === 'all') return d.words.all;
  if (block.teacherWith === 'none') return d.words.none;
  const paired = block.pairedGroupIds.includes(block.teacherWith) ? block.pairedGroupIds.map(name).filter(Boolean) : [];
  return paired.length > 1 ? paired.join(' + ') : name(block.teacherWith);
}

/** Does the teacher teach this group in this block (directly, or with the whole room)? */
export const teacherIsHere = (block: Pick<MultigradeBlock, 'teacherWith' | 'pairedGroupIds'>, groupId: string, mode: string): boolean =>
  mode === 'direct' || mode === 'shared' || block.teacherWith === 'all' || block.teacherWith === groupId;

/** Column widths in percent: time, teacher, then the groups sharing what is left. */
export function flowColumnWidths(groupCount: number): { time: number; teacher: number; group: number } {
  const time = groupCount >= 4 ? 11 : groupCount === 3 ? 12 : 14;
  const teacher = groupCount >= 4 ? 9 : groupCount === 3 ? 10 : 12;
  return { time, teacher, group: +((100 - time - teacher) / Math.max(1, groupCount)).toFixed(2) };
}

export function flowTableHtml(blocks: MultigradeBlock[], d: TableDeps): string {
  const w = TABLE_WORDS[d.lang];
  const widths = flowColumnWidths(d.groups.length);
  const cols = `<colgroup><col style="width:${widths.time}%"><col style="width:${widths.teacher}%">${d.groups.map(() => `<col style="width:${widths.group}%">`).join('')}</colgroup>`;
  const head = `<thead><tr><th scope="col">${d.escape(w.time)}</th><th scope="col">${d.escape(w.teacherWith)}</th>${d.groups.map((g) => `<th scope="col">${d.escape(g.label)}</th>`).join('')}</tr></thead>`;
  const rows = blocks
    .map((b) => {
      const cells = d.groups
        .map((g) => {
          const a = b.groups[g.id];
          if (!a) return '<td></td>';
          const here = teacherIsHere(b, g.id, a.mode);
          return `<td class="${here ? 'with-teacher' : 'on-own'}"><p class="mode">${d.escape(d.words[a.mode])}</p>${d.rich(a.activity)}</td>`;
        })
        .join('');
      return `<tr><th scope="row" class="flow-time"><span class="flow-label">${d.escape(b.label)}</span><span class="flow-min">${b.minutes} ${d.escape(d.words.minutes)}</span></th><td class="flow-teacher">${d.escape(teacherFocus(b, d))}</td>${cells}</tr>`;
    })
    .join('');
  return `<table class="flow">${cols}${head}<tbody>${rows}</tbody></table>`;
}

/** Per-grade text side by side. `ruled` gives a group writing lines instead of an empty cell (after-class sections). */
export function groupsTableHtml(byGroup: Record<string, RichText>, d: TableDeps, ruled?: (groupId: string) => boolean): string {
  const lines = '<div class="writing-space"><div></div><div></div><div></div></div>';
  return `<table class="groups"><thead><tr>${d.groups.map((g) => `<th scope="col">${d.escape(g.label)}</th>`).join('')}</tr></thead><tbody><tr>${d.groups
    .map((g) => `<td>${ruled?.(g.id) ? lines : d.rich(byGroup[g.id] ?? [])}</td>`)
    .join('')}</tr></tbody></table>`;
}

/** Added to the print stylesheet. Black on white, no fills that a school's monochrome printer would muddy. */
export const TABLE_CSS =
  'table.flow,table.groups{margin:4pt 0 8pt}table.flow th,table.groups th{background:#f2f2f2;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
  'table.flow tr,table.groups tr{break-inside:avoid;page-break-inside:avoid}' +
  'table.flow td p,table.groups td p{margin:0 0 3pt}table.flow td ul,table.flow td ol,table.groups td ul,table.groups td ol{margin:2pt 0;padding-left:14pt}' +
  '.flow-time{font-weight:600}.flow-label{display:block}.flow-min{display:block;font-weight:400;margin-top:2pt}.flow-teacher{font-weight:600}' +
  'td.with-teacher{border-left-width:2.4pt}td .mode{font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:.3pt;margin-bottom:3pt}' +
  '.ai-draft{border:1pt solid currentColor;padding:4pt 6pt;margin:0 0 8pt;font-size:9pt}.references{font-size:9pt}.references li{margin-bottom:2pt}';
