import type { Plan, PlanSection, ClassRecord, SchoolYear } from '../contracts/records';
import type { Template, RichText, SectionContent, Span } from '../contracts/content';
import type { Competency } from '../contracts/curriculum';
import type { Lang } from '../contracts/common';
import { colors, fonts } from '../tokens';
import { sectionPlainText, richTextPlainText } from '../plan/text';
import { blankContent } from '../plan';
import { frauncesBase64 } from './font';
import { hiraiaGlyphSvg } from './glyph';
export { frauncesBase64 } from './font';
export { hiraiaGlyphSvg } from './glyph';

export interface RenderPlanOptions {
  plan: Plan;
  sections: PlanSection[];
  template: Template;
  class?: ClassRecord;
  schoolYear?: SchoolYear;
  teacherName: string;
  paper: 'a4' | 'long';
  lang: Lang;
  competencyLookup?: (id: string) => Pick<Competency, 'code' | 'text'> | string | null | undefined;
  /** V1 content contains no image fields. Kept for the common fallback call shape. */
  includeImages?: boolean;
}
const printInk = colors.printInk;
const escape = (s: string | number) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
const labels = {
  en: {
    teacher: 'Teacher',
    school: 'School',
    class: 'Class',
    grade: 'Grade',
    subject: 'Learning area',
    dates: 'Dates',
    term: 'Term',
    competencies: 'Competencies',
    minutes: 'min',
    prepared: 'Prepared by',
    checked: 'Checked by',
    time: 'Time block',
    afterClass: 'After class',
    locked: 'Locked',
    revision: 'Revision',
    adapted: 'Adapted from',
    by: 'by',
    all: 'All groups',
    none: 'Supervision',
    direct: 'Teacher-led',
    independent: 'Independent',
    peer: 'Peer learning',
    shared: 'Together',
    notice: 'Tala lesson plan · Hiraia',
    days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  },
  fil: {
    teacher: 'Guro',
    school: 'Paaralan',
    class: 'Klase',
    grade: 'Baitang',
    subject: 'Asignatura',
    dates: 'Mga Petsa',
    term: 'Markahan',
    competencies: 'Mga competency',
    minutes: 'min',
    prepared: 'Inihanda ni',
    checked: 'Sinuri ni',
    time: 'Time block',
    afterClass: 'Pagkatapos ng klase',
    locked: 'Naka-lock',
    revision: 'Bersyon',
    adapted: 'Hinango sa',
    by: 'ni',
    all: 'Lahat ng pangkat',
    none: 'Pagbabantay sa sariling gawain',
    direct: 'Kasama ang guro',
    independent: 'Sariling gawain',
    peer: 'Tulungan sa grupo',
    shared: 'Sama-sama',
    notice: 'Banghay-aralin sa Tala · Hiraia',
    days: ['Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado', 'Linggo'],
  },
} as const;
export function printOrientation(options: RenderPlanOptions): 'portrait' | 'landscape' {
  return options.template.kind === 'multigrade' &&
    Math.max(options.plan.gradeGroupIds.length, options.plan.grades.length) >= 3
    ? 'landscape'
    : options.template.orientation;
}
export function printPageSize(options: RenderPlanOptions): [number, number] {
  const size: [number, number] = options.paper === 'a4' ? [595.276, 841.89] : [612, 936];
  return printOrientation(options) === 'landscape' ? [size[1], size[0]] : size;
}
function groups(options: RenderPlanOptions): Array<{ id: string; label: string }> {
  const contentIds = options.sections
    .filter((s) => s.planId === options.plan.id)
    .flatMap((s) =>
      s.content.type === 'pergroup'
        ? Object.keys(s.content.groups)
        : s.content.type === 'multigrade'
          ? s.content.blocks.flatMap((b) => Object.keys(b.groups))
          : []
    );
  const ids = [
    ...new Set([
      ...options.plan.gradeGroupIds,
      ...(options.class?.gradeGroups.map((g) => g.id) ?? []),
      ...contentIds,
    ]),
  ];
  return ids.map((id, i) => {
    const grade =
      options.class?.gradeGroups.find((g) => g.id === id)?.grade ?? options.plan.grades[i];
    return {
      id,
      label: grade
        ? `${labels[options.lang].grade} ${grade}`
        : options.lang === 'fil'
          ? 'Pangkat'
          : 'Group',
    };
  });
}
function groupName(o: RenderPlanOptions, id: string): string {
  return groups(o).find((g) => g.id === id)?.label ?? (o.lang === 'fil' ? 'Pangkat' : 'Group');
}
function contentText(c: SectionContent, o: RenderPlanOptions): string {
  const l = labels[o.lang];
  if (c.type === 'pergroup')
    return Object.entries(c.groups)
      .map(([id, body]) => `${groupName(o, id)}\n${richTextPlainText(body)}`)
      .join('\n\n');
  if (c.type === 'multigrade')
    return [
      c.note?.trim(),
      c.blocks
        .map((b) => {
          const teacher =
            b.teacherWith === 'all'
              ? l.all
              : b.teacherWith === 'none'
                ? l.none
                : groupName(o, b.teacherWith);
          return `${b.label} (${b.minutes} ${l.minutes})\n${l.teacher}: ${teacher}${b.pairedGroupIds.length ? `\n${b.pairedGroupIds.map((id) => groupName(o, id)).join(' + ')}` : ''}\n${Object.entries(
            b.groups
          )
            .map(
              ([id, g]) => `${groupName(o, id)} (${l[g.mode]}): ${richTextPlainText(g.activity)}`
            )
            .join('\n')}`;
        })
        .join('\n\n'),
    ]
      .filter(Boolean)
      .join('\n\n');
  if (c.type === 'weekgrid')
    return c.days
      .map((d) => `${d.date ?? l.days[d.weekday - 1]}\n${richTextPlainText(d.body)}`)
      .join('\n\n');
  return sectionPlainText(c);
}
function headerFields(o: RenderPlanOptions): Array<[string, string]> {
  const l = labels[o.lang];
  const dates = [
    ...new Set(
      o.plan.placements.filter((p) => !o.class || p.classId === o.class.id).flatMap((p) => p.dates)
    ),
  ].sort();
  const terms =
    o.schoolYear?.terms
      .filter((t) => dates.some((d) => d >= t.startDate && d <= t.endDate))
      .map((t) => t.name) ?? [];
  return [
    [l.school, o.schoolYear?.schoolName ?? ''],
    [l.teacher, o.teacherName],
    [l.class, o.class?.name ?? ''],
    [l.grade, o.plan.grades.join(', ')],
    [l.subject, o.plan.subjectName],
    [l.dates, dates.join(', ')],
    [l.term, terms.join(', ')],
  ];
}
function competencyLines(o: RenderPlanOptions): string[] {
  return Object.entries(o.plan.competencies).flatMap(([id, ids]) =>
    ids.map((competencyId) => {
      const c = o.competencyLookup?.(competencyId);
      const text =
        typeof c === 'string' ? c : c ? `${c.code ? `${c.code} — ` : ''}${c.text}` : competencyId;
      const group = groups(o).find((g) => g.id === id);
      return `${group ? `${group.label}: ` : ''}${text}`;
    })
  );
}
function footer(o: RenderPlanOptions): string[] {
  const l = labels[o.lang],
    result: string[] = [];
  if (o.plan.lock)
    result.push(
      `${l.locked}: ${o.plan.lock.lockedAt}${o.plan.lock.lockedBy ? ` · ${o.plan.lock.lockedBy}` : ''} · ${l.revision}: ${o.plan.lock.revisionCode}`
    );
  if (o.plan.lineage)
    result.push(
      `${l.adapted} “${o.plan.lineage.title}” ${l.by} ${o.plan.lineage.authorDisplayName} · ${o.plan.lineage.artifactId}/${o.plan.lineage.versionId}`
    );
  result.push(l.notice);
  return result;
}
function spans(items: Span[]): string {
  return items
    .map((s) => {
      let text = escape(s.text).replace(/\n/g, '<br>');
      if (s.b) text = `<strong>${text}</strong>`;
      if (s.i) text = `<em>${text}</em>`;
      return text;
    })
    .join('');
}
function rich(blocks: RichText): string {
  return blocks
    .map((b) =>
      b.t === 'p'
        ? `<p>${spans(b.spans)}</p>`
        : `<${b.t}>${b.items.map((i) => `<li>${spans(i)}</li>`).join('')}</${b.t}>`
    )
    .join('');
}
function contentHtml(c: SectionContent, o: RenderPlanOptions): string {
  const l = labels[o.lang];
  const groupLabel = (id: string) => groupName(o, id);
  switch (c.type) {
    case 'text':
      return rich(c.blocks);
    case 'list':
      return `<ul>${c.items.map((i) => `<li>${escape(i)}</li>`).join('')}</ul>`;
    case 'procedure':
      return c.steps
        .map(
          (s) =>
            `<div class="step"><h3>${escape(s.title)} <small>(${s.minutes} ${l.minutes})</small></h3>${rich(s.body)}</div>`
        )
        .join('');
    case 'pergroup':
      return Object.entries(c.groups)
        .map(
          ([id, body]) => `<div class="group"><h3>${escape(groupLabel(id))}</h3>${rich(body)}</div>`
        )
        .join('');
    case 'weekgrid':
      return `<table class="weekgrid"><thead><tr>${c.days.map((d) => `<th>${escape(l.days[d.weekday - 1] ?? '')}${d.date ? `<br>${escape(d.date)}` : ''}</th>`).join('')}</tr></thead><tbody><tr>${c.days.map((d) => `<td>${rich(d.body)}</td>`).join('')}</tr></tbody></table>`;
    case 'multigrade': {
      return `${c.note?.trim() ? `<p class="session-note">${escape(c.note)}</p>` : ''}${c.blocks
        .map((b) => {
          const teacher =
            b.teacherWith === 'all'
              ? l.all
              : b.teacherWith === 'none'
                ? l.none
                : groupLabel(b.teacherWith);
          return `<div class="time-block"><h3>${escape(b.label)} (${b.minutes} ${l.minutes}) · ${l.teacher}: ${escape(teacher)}</h3>${b.pairedGroupIds.length ? `<p>${escape(b.pairedGroupIds.map(groupLabel).join(' + '))}</p>` : ''}${Object.entries(
            b.groups
          )
            .map(
              ([id, g]) =>
                `<div class="group"><h4>${escape(groupLabel(id))} · ${l[g.mode]}</h4>${rich(g.activity)}</div>`
            )
            .join('')}</div>`;
        })
        .join('')}`;
    }
  }
}
function orderedSections(
  o: RenderPlanOptions
): Array<{ label: string; section: PlanSection; postClass: boolean }> {
  const own = o.sections.filter((s) => s.planId === o.plan.id);
  const ordered = o.template.sections.flatMap((t) => {
    const matches = own.filter((s) => s.key === t.key);
    // Older plans may not have the new post-class records yet. Always offer writing space.
    if (!matches.length && t.outsideLock)
      matches.push({
        id: '',
        planId: o.plan.id,
        key: t.key,
        content: blankContent(
          t.contentType,
          groups(o).map((g) => g.id)
        ),
        origin: 'manual',
        editedByTeacher: false,
        gen: null,
      });
    return matches.map((section) => ({
      label: t.label[o.lang],
      section,
      postClass: t.outsideLock,
    }));
  });
  const all = [
    ...ordered,
    ...own
      .filter((s) => !o.template.sections.some((t) => t.key === s.key))
      .map((section) => ({
        label: section.key,
        section,
        postClass: ['results', 'reflection'].includes(section.key),
      })),
  ];
  return [...all.filter((s) => !s.postClass), ...all.filter((s) => s.postClass)];
}
const writingLines =
  '______________________________\n______________________________\n______________________________';
function postClassText(c: SectionContent, o: RenderPlanOptions): string {
  if (c.type === 'pergroup')
    return groups(o)
      .map((g) => `${g.label}\n${richTextPlainText(c.groups[g.id] ?? []).trim() || writingLines}`)
      .join('\n\n');
  return contentText(c, o).trim() || writingLines;
}
function postClassHtml(c: SectionContent, o: RenderPlanOptions): string {
  const ruled = '<div class="writing-space"><div></div><div></div><div></div></div>';
  if (c.type === 'pergroup')
    return groups(o)
      .map(
        (g) =>
          `<div class="group"><h3>${escape(g.label)}</h3>${richTextPlainText(c.groups[g.id] ?? []).trim() ? rich(c.groups[g.id] ?? []) : ruled}</div>`
      )
      .join('');
  return contentText(c, o).trim() ? contentHtml(c, o) : ruled;
}
/** Pure HTML: no clock, scripts, external fonts, network URLs or platform APIs. */
export function renderPlanHtml(o: RenderPlanOptions): string {
  const [width, height] = printPageSize(o),
    l = labels[o.lang];
  const css = `@font-face{font-family:${fonts.display};src:url(data:font/ttf;base64,${frauncesBase64}) format('truetype');font-weight:600;font-style:normal}@page{size:${width}pt ${height}pt;margin:14mm 12mm 18mm}*{box-sizing:border-box}html{color:${printInk};background:${colors.white};font-family:${fonts.bodyWebStack};font-size:10pt;line-height:1.4}body{margin:0}h1{font-family:${fonts.display},${fonts.displayWebStack};font-size:19pt;margin:0 0 8pt}h2{font-size:12pt;border-bottom:1pt solid currentColor;margin:14pt 0 6pt;break-after:avoid}h3{font-size:10pt;margin:8pt 0 3pt;break-after:avoid}p{margin:3pt 0;white-space:pre-wrap;overflow-wrap:anywhere}ul,ol{padding-left:18pt}li,td,th{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.6pt solid currentColor;padding:5pt;vertical-align:top;text-align:left}thead{display:table-header-group}tr{break-inside:auto}th{font-weight:600}.metadata{display:flex;flex-wrap:wrap;gap:3pt 16pt;margin-bottom:10pt}.metadata div{min-width:40%}.signatures{display:flex;justify-content:space-between;gap:24pt;margin-top:30pt;break-inside:avoid}.signatures div{width:45%;padding-top:8pt;border-top:.6pt solid currentColor}footer{margin-top:18pt;border-top:.6pt solid currentColor;padding-top:6pt;font-size:8pt;break-inside:avoid}footer svg{width:16pt;height:16pt;vertical-align:middle;margin-right:5pt}.draft{position:fixed;inset:40% 0 auto;text-align:center;font-size:72pt;font-weight:bold;opacity:.1;transform:rotate(-30deg);pointer-events:none;z-index:0}header,main,footer{position:relative;z-index:1}.notice{font-size:8pt;margin:0 0 6pt}.step{break-inside:auto}.group{border-left:1pt solid currentColor;padding-left:8pt;margin:8pt 0}.group h4{margin:4pt 0}.writing-space{break-inside:avoid}.writing-space div{height:20pt;border-bottom:.5pt solid currentColor}.session-note{margin-bottom:10pt}@media print{html,body{background:${colors.white};color:${printInk}}}`;
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(o.plan.title)}</title><style>${css}</style></head><body>${o.plan.state === 'draft' ? '<div class="draft" aria-hidden="true">DRAFT</div>' : ''}<header><p class="notice">${l.notice}</p><h1>${escape(o.plan.title || o.template.name[o.lang])}</h1><div class="metadata">${headerFields(
    o
  )
    .map(([label, value]) => `<div><strong>${escape(label)}:</strong> ${escape(value)}</div>`)
    .join('')}</div></header><main>${
    competencyLines(o).length
      ? `<section><h2>${l.competencies}</h2><ul>${competencyLines(o)
          .map((c) => `<li>${escape(c)}</li>`)
          .join('')}</ul></section>`
      : ''
  }${orderedSections(o)
    .map(
      ({ label, section, postClass }, i, all) =>
        `${postClass && !all[i - 1]?.postClass ? `<h2>${l.afterClass}</h2>` : ''}<section><h${postClass ? 3 : 2}>${escape(label)}</h${postClass ? 3 : 2}>${postClass ? postClassHtml(section.content, o) : contentHtml(section.content, o)}</section>`
    )
    .join(
      ''
    )}<div class="signatures"><div>${l.prepared}</div><div>${l.checked}</div></div></main><footer>${hiraiaGlyphSvg}${footer(o).map(escape).join('<br>')}</footer></body></html>`;
}
export function renderPlanText(o: RenderPlanOptions): string {
  const l = labels[o.lang];
  return [
    o.plan.state === 'draft' ? 'DRAFT' : '',
    o.plan.title || o.template.name[o.lang],
    ...headerFields(o).map(([label, value]) => `${label}: ${value}`),
    '',
    ...competencyLines(o),
    '',
    ...orderedSections(o).flatMap(({ label, section, postClass }, i, all) => [
      ...(postClass && !all[i - 1]?.postClass ? [l.afterClass, ''] : []),
      label,
      postClass ? postClassText(section.content, o) : contentText(section.content, o),
      '',
    ]),
    `${l.prepared}: ____________________`,
    `${l.checked}: ____________________`,
    '',
    ...footer(o),
  ]
    .filter((x, i, all) => x || all[i - 1])
    .join('\n');
}
