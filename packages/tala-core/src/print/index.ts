import type { Plan, PlanSection, ClassRecord, SchoolYear } from '../contracts/records';
import type { Template, RichText, SectionContent, Span } from '../contracts/content';
import type { Competency } from '../contracts/curriculum';
import type { Lang } from '../contracts/common';
import { colors, fonts } from '../tokens';
import { sectionPlainText } from '../plan/text';
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
// Local adapter until the orchestrator adds a monochrome ink token (BRAND-6).
const printInk = '#000000';
const escape = (s: string | number) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const labels = {
  en: { teacher: 'Teacher', school: 'School', class: 'Class', grade: 'Grade', subject: 'Learning area', dates: 'Dates', term: 'Term', competencies: 'Competencies', minutes: 'min', prepared: 'Prepared by', checked: 'Checked by', time: 'Time block', transition: 'Transition', locked: 'Locked', revision: 'Revision', adapted: 'Adapted from', by: 'by', all: 'All groups', none: 'Supervision', direct: 'Teacher-led', independent: 'Independent', peer: 'Peer learning', shared: 'Together', notice: 'Tala lesson plan · Hiraia', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
  fil: { teacher: 'Guro', school: 'Paaralan', class: 'Klase', grade: 'Baitang', subject: 'Asignatura', dates: 'Mga Petsa', term: 'Markahan', competencies: 'Mga Kasanayan', minutes: 'min', prepared: 'Prepared by', checked: 'Checked by', time: 'Bahagi ng oras', transition: 'Paglipat', locked: 'Naka-lock', revision: 'Rebisyon', adapted: 'Hango sa', by: 'ni', all: 'Lahat ng pangkat', none: 'Pagbabantay', direct: 'Kasama ang guro', independent: 'Sariling gawain', peer: 'Tulungan', shared: 'Sama-sama', notice: 'Banghay-aralin sa Tala · Hiraia', days: ['Lunes', 'Martes', 'Miyerkules', 'Huwebes', 'Biyernes', 'Sabado', 'Linggo'] },
} as const;
export function printOrientation(options: RenderPlanOptions): 'portrait' | 'landscape' {
  return options.template.kind === 'multigrade' && options.plan.gradeGroupIds.length >= 3 ? 'landscape' : options.template.orientation;
}
export function printPageSize(options: RenderPlanOptions): [number, number] {
  const size: [number, number] = options.paper === 'a4' ? [595.276, 841.89] : [612, 936];
  return printOrientation(options) === 'landscape' ? [size[1], size[0]] : size;
}
function groups(options: RenderPlanOptions): Array<{ id: string; label: string }> {
  return options.plan.gradeGroupIds.map((id, i) => ({ id, label: `${labels[options.lang].grade} ${options.class?.gradeGroups.find(g => g.id === id)?.grade ?? options.plan.grades[i] ?? id}` }));
}
function headerFields(o: RenderPlanOptions): Array<[string, string]> {
  const l = labels[o.lang];
  const dates = [...new Set(o.plan.placements.filter(p => !o.class || p.classId === o.class.id).flatMap(p => p.dates))].sort();
  const terms = o.schoolYear?.terms.filter(t => dates.some(d => d >= t.startDate && d <= t.endDate)).map(t => t.name) ?? [];
  return [[l.school, o.schoolYear?.schoolName ?? ''], [l.teacher, o.teacherName], [l.class, o.class?.name ?? ''], [l.grade, o.plan.grades.join(', ')], [l.subject, o.plan.subjectName], [l.dates, dates.join(', ')], [l.term, terms.join(', ')]];
}
function competencyLines(o: RenderPlanOptions): string[] {
  return Object.entries(o.plan.competencies).flatMap(([id, ids]) => ids.map(competencyId => {
    const c = o.competencyLookup?.(competencyId);
    const text = typeof c === 'string' ? c : c ? `${c.code ? `${c.code} — ` : ''}${c.text}` : competencyId;
    const group = groups(o).find(g => g.id === id);
    return `${group ? `${group.label}: ` : ''}${text}`;
  }));
}
function footer(o: RenderPlanOptions): string[] {
  const l = labels[o.lang], result: string[] = [];
  if (o.plan.lock) result.push(`${l.locked}: ${o.plan.lock.lockedAt} · ${l.revision}: ${o.plan.lock.revisionCode}`);
  if (o.plan.lineage) result.push(`${l.adapted} “${o.plan.lineage.title}” ${l.by} ${o.plan.lineage.authorDisplayName} · ${o.plan.lineage.artifactId}/${o.plan.lineage.versionId}`);
  result.push(l.notice);
  return result;
}
function spans(items: Span[]): string {
  return items.map(s => { let text = escape(s.text).replace(/\n/g, '<br>'); if (s.b) text = `<strong>${text}</strong>`; if (s.i) text = `<em>${text}</em>`; return text; }).join('');
}
function rich(blocks: RichText): string {
  return blocks.map(b => b.t === 'p' ? `<p>${spans(b.spans)}</p>` : `<${b.t}>${b.items.map(i => `<li>${spans(i)}</li>`).join('')}</${b.t}>`).join('');
}
function contentHtml(c: SectionContent, o: RenderPlanOptions): string {
  const l = labels[o.lang];
  const gradeGroups = groups(o);
  const groupLabel = (id: string) => gradeGroups.find(g => g.id === id)?.label ?? id;
  switch (c.type) {
    case 'text': return rich(c.blocks);
    case 'list': return `<ul>${c.items.map(i => `<li>${escape(i)}</li>`).join('')}</ul>`;
    case 'procedure': return c.steps.map(s => `<div class="step"><h3>${escape(s.title)} <small>(${s.minutes} ${l.minutes})</small></h3>${rich(s.body)}</div>`).join('');
    case 'pergroup': return Object.entries(c.groups).map(([id, body]) => `<div class="group"><h3>${escape(groupLabel(id))}</h3>${rich(body)}</div>`).join('');
    case 'weekgrid': return `<table class="weekgrid"><thead><tr>${c.days.map(d => `<th>${escape(l.days[d.weekday - 1] ?? '')}${d.date ? `<br>${escape(d.date)}` : ''}</th>`).join('')}</tr></thead><tbody><tr>${c.days.map(d => `<td>${rich(d.body)}</td>`).join('')}</tr></tbody></table>`;
    case 'multigrade': {
      const ids = [...new Set([...gradeGroups.map(g => g.id), ...c.blocks.flatMap(b => Object.keys(b.groups))])];
      return `<table class="multigrade"><thead><tr><th>${l.time}</th>${ids.map(id => `<th>${escape(groupLabel(id))}</th>`).join('')}<th>${l.teacher}</th></tr></thead><tbody>${c.blocks.map(b => `<tr><th>${escape(b.label)}<br>${b.minutes} ${l.minutes}${b.transitionMinutes ? `<br>${l.transition}: ${b.transitionMinutes} ${l.minutes}` : ''}</th>${ids.map(id => { const g = b.groups[id]; return `<td>${g ? `<strong>${l[g.mode]}</strong>${rich(g.activity)}` : ''}</td>`; }).join('')}<td>${escape(b.teacherWith === 'all' ? l.all : b.teacherWith === 'none' ? l.none : groupLabel(b.teacherWith))}${b.pairedGroupIds.length ? `<br>${escape(b.pairedGroupIds.map(groupLabel).join(' + '))}` : ''}</td></tr>`).join('')}</tbody></table>`;
    }
  }
}
function orderedSections(o: RenderPlanOptions): Array<{ label: string; section: PlanSection }> {
  const own = o.sections.filter(s => s.planId === o.plan.id);
  const ordered = o.template.sections.flatMap(t => own.filter(s => s.key === t.key).map(section => ({ label: t.label[o.lang], section })));
  return [...ordered, ...own.filter(s => !o.template.sections.some(t => t.key === s.key)).map(section => ({ label: section.key, section }))];
}
/** Pure HTML: no clock, scripts, external fonts, network URLs or platform APIs. */
export function renderPlanHtml(o: RenderPlanOptions): string {
  const [width, height] = printPageSize(o), l = labels[o.lang];
  const css = `@font-face{font-family:${fonts.display};src:url(data:font/ttf;base64,${frauncesBase64}) format('truetype');font-weight:600;font-style:normal}@page{size:${width}pt ${height}pt;margin:14mm 12mm 18mm}*{box-sizing:border-box}html{color:${printInk};background:${colors.white};font-family:${fonts.bodyWebStack};font-size:10pt;line-height:1.4}body{margin:0}h1{font-family:${fonts.display},${fonts.displayWebStack};font-size:19pt;margin:0 0 8pt}h2{font-size:12pt;border-bottom:1pt solid currentColor;margin:14pt 0 6pt;break-after:avoid}h3{font-size:10pt;margin:8pt 0 3pt;break-after:avoid}p{margin:3pt 0;white-space:pre-wrap;overflow-wrap:anywhere}ul,ol{padding-left:18pt}li,td,th{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:.6pt solid currentColor;padding:5pt;vertical-align:top;text-align:left}thead{display:table-header-group}tr{break-inside:auto}th{font-weight:600}.metadata{display:flex;flex-wrap:wrap;gap:3pt 16pt;margin-bottom:10pt}.metadata div{min-width:40%}.signatures{display:flex;justify-content:space-between;gap:24pt;margin-top:30pt;break-inside:avoid}.signatures div{width:45%;padding-top:8pt;border-top:.6pt solid currentColor}footer{margin-top:18pt;border-top:.6pt solid currentColor;padding-top:6pt;font-size:8pt;break-inside:avoid}footer svg{width:16pt;height:16pt;vertical-align:middle;margin-right:5pt}.draft{position:fixed;inset:40% 0 auto;text-align:center;font-size:72pt;font-weight:bold;opacity:.1;transform:rotate(-30deg);pointer-events:none;z-index:0}header,main,footer{position:relative;z-index:1}.notice{font-size:8pt;margin:0 0 6pt}.step{break-inside:auto}@media print{html,body{background:${colors.white};color:${printInk}}}`;
  return `<!doctype html><html lang="${o.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(o.plan.title)}</title><style>${css}</style></head><body>${o.plan.state === 'draft' ? '<div class="draft" aria-hidden="true">DRAFT</div>' : ''}<header><p class="notice">${l.notice}</p><h1>${escape(o.plan.title || o.template.name[o.lang])}</h1><div class="metadata">${headerFields(o).map(([label, value]) => `<div><strong>${escape(label)}:</strong> ${escape(value)}</div>`).join('')}</div></header><main>${competencyLines(o).length ? `<section><h2>${l.competencies}</h2><ul>${competencyLines(o).map(c => `<li>${escape(c)}</li>`).join('')}</ul></section>` : ''}${orderedSections(o).map(({ label, section }) => `<section><h2>${escape(label)}</h2>${contentHtml(section.content, o)}</section>`).join('')}<div class="signatures"><div>${l.prepared}</div><div>${l.checked}</div></div></main><footer>${hiraiaGlyphSvg}${footer(o).map(escape).join('<br>')}</footer></body></html>`;
}
export function renderPlanText(o: RenderPlanOptions): string {
  const l = labels[o.lang];
  return [o.plan.state === 'draft' ? 'DRAFT' : '', o.plan.title || o.template.name[o.lang], ...headerFields(o).map(([label, value]) => `${label}: ${value}`), '', ...competencyLines(o), '', ...orderedSections(o).flatMap(({ label, section }) => [label, sectionPlainText(section.content), '']), `${l.prepared}: ____________________`, `${l.checked}: ____________________`, '', ...footer(o)].filter((x, i, all) => x || all[i - 1]).join('\n');
}
