/**
 * A lesson plan as an editable Word document (.docx): real paragraphs, real lists and real tables, so a teacher can
 * revise it in Word, WPS or Google Docs before printing. Built from the same parts as the print page (../print), in
 * the same order, with the same labels; a multi-grade plan is set as the same table (one row per time block, one
 * column per grade group, and who the teacher is with).
 *
 * Pure and dependency-free: no clock, no I/O, the same plan always gives the same bytes. Runs in the browser (the
 * file is made on the teacher's device, also offline), on the phone and in Node.
 *
 * What it deliberately does not carry: the Hiraia mark as a picture and the big "DRAFT" watermark. A draft says
 * DRAFT in words at the top instead, which the teacher can delete when the plan is final.
 */
import type { MultigradeBlock, RichText, SectionContent, Span } from '../contracts/content';
import { richTextPlainText } from '../plan/text';
import {
  PRINT_LABELS,
  TABLE_WORDS,
  competencyReferences,
  flowColumnWidths,
  printFooter,
  printGroups,
  printHeaderFields,
  printOrderedSections,
  printOrientation,
  printPageSize,
  teacherFocus,
  teacherIsHere,
  type RenderPlanOptions,
} from '../print';
import { utf8, zipStore } from './zip';

export { zipStore, crc32 } from './zip';

export const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Page margins in twentieths of a point: the print page's 14 mm top, 12 mm sides, 18 mm bottom. */
const MARGIN = { top: 794, side: 680, bottom: 1020 };
const BULLETS = 1;

/* ---------------- text ---------------- */

/** Characters XML 1.0 cannot hold are dropped (a pasted control character must not make the file unreadable). */
const clean = (s: string): string => s.replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '');
const esc = (s: string): string => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface RunStyle {
  b?: boolean;
  i?: boolean;
  caps?: boolean;
  color?: string;
  /** Half-points. */
  size?: number;
}

function run(text: string, s: RunStyle = {}): string {
  if (!text) return '';
  const props = `${s.b ? '<w:b/>' : ''}${s.i ? '<w:i/>' : ''}${s.caps ? '<w:caps/>' : ''}${s.color ? `<w:color w:val="${s.color}"/>` : ''}${s.size ? `<w:sz w:val="${s.size}"/><w:szCs w:val="${s.size}"/>` : ''}`;
  // A line break inside a paragraph is a real break; a tab stays a tab.
  const body = clean(text)
    .split('\n')
    .map((line) =>
      line
        .split('\t')
        .map((piece) => (piece ? `<w:t xml:space="preserve">${esc(piece)}</w:t>` : ''))
        .join('<w:tab/>')
    )
    .join('<w:br/>');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${body}</w:r>`;
}

const spans = (items: Span[], base: RunStyle = {}): string => items.map((s) => run(s.text, { ...base, b: base.b || s.b, i: base.i || s.i })).join('');

interface ParaStyle {
  style?: 'Title' | 'Heading1' | 'Heading2';
  num?: number;
  keepNext?: boolean;
  /** A box around the paragraph (the AI-draft notice). */
  boxed?: boolean;
  /** A rule under the paragraph (a line to write on). */
  ruled?: boolean;
  before?: number;
  after?: number;
  align?: 'center' | 'right';
}

function para(runs: string, s: ParaStyle = {}): string {
  const side = (name: string) => `<w:${name} w:val="single" w:sz="6" w:space="4" w:color="000000"/>`;
  const props =
    (s.style ? `<w:pStyle w:val="${s.style}"/>` : '') +
    (s.keepNext ? '<w:keepNext/>' : '') +
    (s.num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${s.num}"/></w:numPr>` : '') +
    (s.boxed ? `<w:pBdr>${side('top')}${side('left')}${side('bottom')}${side('right')}</w:pBdr>` : s.ruled ? `<w:pBdr>${side('bottom')}</w:pBdr>` : '') +
    (s.before !== undefined || s.after !== undefined ? `<w:spacing${s.before !== undefined ? ` w:before="${s.before}"` : ''}${s.after !== undefined ? ` w:after="${s.after}"` : ''}/>` : '') +
    (s.align ? `<w:jc w:val="${s.align}"/>` : '');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`;
}

/* ---------------- tables ---------------- */

interface Cell {
  paras: string[];
  shade?: boolean;
  /** A heavier left edge: the teacher is with this group here. */
  heavyLeft?: boolean;
  /** Only a line above (signature lines). */
  topOnly?: boolean;
}
interface Row {
  cells: Cell[];
  /** Repeats at the top of every page the table runs onto. */
  header?: boolean;
  /** Keep the row on one page. */
  together?: boolean;
}

function table(widths: number[], rows: Row[], frame: 'grid' | 'none' = 'grid'): string {
  const edge = (name: string, on: boolean) => `<w:${name} w:val="${on ? 'single' : 'nil'}"${on ? ' w:sz="4" w:space="0" w:color="000000"' : ''}/>`;
  const on = frame === 'grid';
  const borders = `<w:tblBorders>${edge('top', on)}${edge('left', on)}${edge('bottom', on)}${edge('right', on)}${edge('insideH', on)}${edge('insideV', on)}</w:tblBorders>`;
  const margin = (name: string, w: number) => `<w:${name} w:w="${w}" w:type="dxa"/>`;
  const head = `<w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar>${margin('top', 60)}${margin('left', 100)}${margin('bottom', 60)}${margin('right', 100)}</w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const body = rows
    .map((row) => {
      const props = `${row.together ? '<w:cantSplit/>' : ''}${row.header ? '<w:tblHeader/>' : ''}`;
      const cells = row.cells
        .map((cell, i) => {
          const edges = cell.heavyLeft
            ? '<w:tcBorders><w:left w:val="single" w:sz="18" w:space="0" w:color="000000"/></w:tcBorders>'
            : cell.topOnly
              ? '<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tcBorders>'
              : '';
          const shade = cell.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '';
          // A cell must end with a paragraph, even an empty one.
          return `<w:tc><w:tcPr><w:tcW w:w="${widths[i] ?? widths[widths.length - 1]}" w:type="dxa"/>${edges}${shade}</w:tcPr>${cell.paras.length ? cell.paras.join('') : para('')}</w:tc>`;
        })
        .join('');
      return `<w:tr>${props ? `<w:trPr>${props}</w:trPr>` : ''}${cells}</w:tr>`;
    })
    .join('');
  return `<w:tbl>${head}${grid}${body}</w:tbl>`;
}

/** Column widths in twentieths of a point that add up to the text width exactly. */
function columns(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0) || 1;
  const widths = shares.map((s) => Math.floor((total * s) / sum));
  widths[widths.length - 1]! += total - widths.reduce((a, b) => a + b, 0);
  return widths;
}

/* ---------------- the document ---------------- */

interface Built {
  body: string;
  orderedLists: number;
}

function build(o: RenderPlanOptions): Built {
  const l = PRINT_LABELS[o.lang];
  const tw = TABLE_WORDS[o.lang];
  const groups = printGroups(o);
  const [pageWidth] = printPageSize(o);
  const textWidth = Math.round(pageWidth * 20) - 2 * MARGIN.side;
  let orderedLists = 0;

  const rich = (blocks: RichText, base: RunStyle = {}): string[] =>
    blocks.flatMap((b) => {
      if (b.t === 'p') return [para(spans(b.spans, base))];
      // Every numbered list starts again at 1: it gets a numbering instance of its own.
      const num = b.t === 'ul' ? BULLETS : BULLETS + ++orderedLists;
      return b.items.map((item) => para(spans(item, base), { num }));
    });
  const writingLines = (): string[] => [0, 1, 2].map(() => para('', { ruled: true, before: 200, after: 0 }));
  const empty = (blocks: RichText | undefined): boolean => !richTextPlainText(blocks ?? []).trim();
  const headerRow = (labels: string[]): Row => ({ header: true, together: true, cells: labels.map((text) => ({ shade: true, paras: [para(run(text, { b: true }))] })) });

  const groupsTable = (byGroup: Record<string, RichText>, ruled: boolean): string =>
    table(
      columns(textWidth, groups.map(() => 1)),
      // Kept on one page when it fits, so a grade's objectives or materials are not left one line behind.
      [headerRow(groups.map((g) => g.label)), { together: true, cells: groups.map((g) => ({ paras: ruled && empty(byGroup[g.id]) ? writingLines() : rich(byGroup[g.id] ?? []) })) }]
    );

  const flowTable = (blocks: MultigradeBlock[]): string => {
    const share = flowColumnWidths(groups.length);
    const deps = { groups, words: l };
    return table(columns(textWidth, [share.time, share.teacher, ...groups.map(() => share.group)]), [
      headerRow([tw.time, tw.teacherWith, ...groups.map((g) => g.label)]),
      ...blocks.map(
        (b): Row => ({
          together: true,
          cells: [
            { paras: [para(run(b.label, { b: true })), para(run(`${b.minutes} ${l.minutes}`))] },
            { paras: [para(run(teacherFocus(b, deps), { b: true }))] },
            ...groups.map((g): Cell => {
              const a = b.groups[g.id];
              if (!a) return { paras: [] };
              return { heavyLeft: teacherIsHere(b, g.id, a.mode), paras: [para(run(l[a.mode], { b: true, caps: true, size: 17 })), ...rich(a.activity)] };
            }),
          ],
        })
      ),
    ]);
  };

  const content = (c: SectionContent, postClass: boolean): string[] => {
    switch (c.type) {
      case 'text':
        return postClass && empty(c.blocks) ? writingLines() : rich(c.blocks);
      case 'list': {
        const items = c.items.filter((i) => i.trim());
        return postClass && !items.length ? writingLines() : items.map((i) => para(run(i), { num: BULLETS }));
      }
      case 'procedure':
        return c.steps.flatMap((s) => [para(run(`${s.title} (${s.minutes} ${l.minutes})`), { style: 'Heading2' }), ...rich(s.body)]);
      case 'pergroup':
        return [groupsTable(c.groups, postClass)];
      case 'weekgrid':
        return [
          table(
            columns(textWidth, c.days.map(() => 1)),
            [headerRow(c.days.map((d) => `${l.days[d.weekday - 1] ?? ''}${d.date ? `\n${d.date}` : ''}`)), { cells: c.days.map((d) => ({ paras: rich(d.body) })) }]
          ),
        ];
      case 'multigrade':
        return [...(c.note?.trim() ? [para(run(c.note.trim(), { i: true }), { after: 120 })] : []), flowTable(c.blocks)];
    }
  };

  const parts: string[] = [];
  parts.push(para(run(l.notice, { size: 16, color: '555555' }), { after: 40 }));
  if (o.plan.state === 'draft') parts.push(para(run(tw.draft, { b: true, color: '777777', size: 28 }), { after: 40 }));
  parts.push(para(run(o.plan.title || o.template.name[o.lang]), { style: 'Title' }));

  const fields = printHeaderFields(o);
  const fieldCell = (f: [string, string] | undefined): Cell => ({ paras: f ? [para(`${run(`${f[0]}: `, { b: true })}${run(f[1])}`, { after: 20 })] : [] });
  const fieldRows: Row[] = [];
  for (let i = 0; i < fields.length; i += 2) fieldRows.push({ cells: [fieldCell(fields[i]), fieldCell(fields[i + 1])] });
  parts.push(table(columns(textWidth, [1, 1]), fieldRows, 'none'));

  if (o.plan.aiDraft) parts.push(para(run(tw.aiDraft, { size: 18 }), { boxed: true, before: 160, after: 120 }));

  const references = competencyReferences(o);
  if (references.length) {
    parts.push(para(run(l.competencies), { style: 'Heading1' }));
    for (const c of references)
      parts.push(para(`${c.group ? run(`${c.group}: `, { b: true }) : ''}${run(c.text)}${c.reference ? run(` [${c.reference}]`, { i: true }) : ''}`, { num: BULLETS }));
  }

  const sections = printOrderedSections(o);
  sections.forEach(({ label, section, postClass }, i) => {
    if (postClass && !sections[i - 1]?.postClass) parts.push(para(run(l.afterClass), { style: 'Heading1' }));
    parts.push(para(run(label), { style: postClass ? 'Heading2' : 'Heading1' }));
    parts.push(...content(section.content, postClass));
  });

  parts.push(para('', { before: 480, after: 0 }));
  parts.push(
    table(columns(textWidth, [9, 2, 9]), [{ together: true, cells: [{ topOnly: true, paras: [para(run(l.prepared))] }, { paras: [] }, { topOnly: true, paras: [para(run(l.checked))] }] }], 'none')
  );
  // A table may not be the last thing in the body.
  parts.push(para('', { after: 0 }));
  return { body: parts.join(''), orderedLists };
}

function sectionProperties(o: RenderPlanOptions): string {
  const [w, h] = printPageSize(o).map((pt) => Math.round(pt * 20)) as [number, number];
  const landscape = printOrientation(o) === 'landscape';
  return `<w:sectPr><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="${w}" w:h="${h}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${MARGIN.top}" w:right="${MARGIN.side}" w:bottom="${MARGIN.bottom}" w:left="${MARGIN.side}" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>`;
}

const STYLES = `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="38"/><w:szCs w:val="38"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`;

function numbering(orderedLists: number): string {
  const level = (format: string, text: string) =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="240"/></w:pPr></w:lvl>`;
  const ordered = Array.from(
    { length: orderedLists },
    (_x, i) => `<w:num w:numId="${BULLETS + 1 + i}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`
  ).join('');
  return `${XML}<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${level('bullet', '•')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${level('decimal', '%1.')}</w:abstractNum><w:num w:numId="${BULLETS}"><w:abstractNumId w:val="0"/></w:num>${ordered}</w:numbering>`;
}

function footerPart(o: RenderPlanOptions): string {
  const lines = printFooter(o);
  const page = '<w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>';
  return `${XML}<w:ftr xmlns:w="${W}" xmlns:r="${R}">${lines.map((line) => para(run(line, { size: 16 }), { after: 0 })).join('')}${para(page, { after: 0, align: 'right' })}</w:ftr>`;
}

/** The parts of the document by name, as text. `renderPlanDocx` packs exactly these. */
export function renderPlanDocxParts(o: RenderPlanOptions): Record<string, string> {
  const built = build(o);
  const type = (part: string, kind: string) => `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`;
  const rel = (id: string, kind: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/>`;
  return {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${type('/word/document.xml', 'document.main')}${type('/word/styles.xml', 'styles')}${type('/word/numbering.xml', 'numbering')}${type('/word/footer1.xml', 'footer')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'officeDocument', 'word/document.xml')}<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    'word/document.xml': `${XML}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${built.body}${sectionProperties(o)}</w:body></w:document>`,
    'word/_rels/document.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId1', 'styles', 'styles.xml')}${rel('rId2', 'numbering', 'numbering.xml')}${rel('rId3', 'footer', 'footer1.xml')}</Relationships>`,
    'word/styles.xml': STYLES,
    'word/numbering.xml': numbering(built.orderedLists),
    'word/footer1.xml': footerPart(o),
    'docProps/core.xml': `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(o.plan.title || o.template.name[o.lang])}</dc:title><dc:creator>${esc(o.teacherName)}</dc:creator></cp:coreProperties>`,
  };
}

/** The plan as a .docx file. */
export function renderPlanDocx(o: RenderPlanOptions): Uint8Array {
  return zipStore(Object.entries(renderPlanDocxParts(o)).map(([name, text]) => ({ name, data: utf8(text) })));
}

/** A file name a phone, a school computer and a messaging app will all keep: plain letters, digits and dashes. */
export function planDocxFileName(o: Pick<RenderPlanOptions, 'plan'>): string {
  const stem = o.plan.title
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${stem || 'lesson-plan'}.docx`;
}
