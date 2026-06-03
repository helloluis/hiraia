/**
 * Generate the Tier-1 "building block" primitives (inventory category 1) into
 * assets/general/. Authored as clean, label-free geometry per STYLE-SPEC.md —
 * the hand-drawn wobble is applied at render time, not baked here.
 *
 * Skipped: arrow-single / arrow-double — already first-class DSL elements.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'general');
mkdirSync(OUT, { recursive: true });

const INK = '#1f2937';
// stroke arrowhead barbs: tip at (x,y), pointing in direction `ang`
const head = (x, y, ang, len = 10, spread = 0.5) => {
  const a1 = ang + Math.PI - spread, a2 = ang + Math.PI + spread;
  const p = (a) => `${(x + len * Math.cos(a)).toFixed(1)},${(y + len * Math.sin(a)).toFixed(1)}`;
  return `M${p(a1)} L${x},${y} L${p(a2)}`;
};
const stroke = (extra = '') =>
  `fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${extra ? ' ' + extra : ''}`;

const A = []; // {id, vb:[w,h], name, description, tags, inner}

A.push({ id: 'arrow-cycle', vb: [100, 100], name: 'Cycle arrows', description: 'Two curved arrows forming a loop, for cycles and repeating processes', tags: ['arrow', 'cycle', 'process', 'loop', 'diagram'],
  inner: `<g ${stroke()}>
    <path d="M52,14 A36,36 0 0 1 52,86"/><path d="${head(52, 86, Math.PI)}"/>
    <path d="M48,86 A36,36 0 0 1 48,14"/><path d="${head(48, 14, 0)}"/>
  </g>` });

A.push({ id: 'arrow-curved', vb: [100, 70], name: 'Curved arrow', description: 'Curved arrow for showing flow or change of direction', tags: ['arrow', 'curved', 'flow', 'direction'],
  inner: `<g ${stroke()}>
    <path d="M12,52 Q50,4 86,40"/><path d="${head(86, 40, Math.atan2(40 - 4, 86 - 50))}"/>
  </g>` });

A.push({ id: 'sign-plus', vb: [60, 60], name: 'Plus sign', description: 'Plus sign for combining items, e.g. A + B', tags: ['plus', 'add', 'symbol', 'math'],
  inner: `<g stroke="${INK}" stroke-width="8" stroke-linecap="round"><line x1="30" y1="14" x2="30" y2="46"/><line x1="14" y1="30" x2="46" y2="30"/></g>` });

A.push({ id: 'sign-equals', vb: [60, 46], name: 'Equals sign', description: 'Equals sign for results, e.g. A + B = C', tags: ['equals', 'result', 'symbol', 'math'],
  inner: `<g stroke="${INK}" stroke-width="8" stroke-linecap="round"><line x1="12" y1="17" x2="48" y2="17"/><line x1="12" y1="31" x2="48" y2="31"/></g>` });

A.push({ id: 'label-callout', vb: [130, 74], name: 'Label callout', description: 'Empty callout box with leader line; scene supplies the label text', tags: ['label', 'callout', 'annotation', 'frame'],
  inner: `<rect x="6" y="8" width="86" height="36" rx="8" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>
  <path d="M86,40 L114,64" ${stroke()}/><circle cx="116" cy="66" r="4" fill="${INK}"/>` });

A.push({ id: 'zoom-callout', vb: [116, 84], name: 'Zoom callout', description: 'Magnified-detail callout: a small marked area expanded into a larger view', tags: ['zoom', 'magnify', 'detail', 'callout'],
  inner: `<g ${stroke()}>
    <circle cx="24" cy="46" r="15" stroke-dasharray="4,3"/>
    <circle cx="80" cy="42" r="30" fill="#ffffff"/>
    <path d="M37,35 L53,17"/><path d="M37,57 L55,66"/>
  </g>` });

A.push({ id: 'chart-data-table', vb: [120, 100], name: 'Data table', description: 'Blank observation/data table grid with header row', tags: ['table', 'data', 'chart', 'observation', 'grid'],
  inner: `<rect x="8" y="10" width="104" height="80" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>
  <rect x="8" y="10" width="104" height="22" fill="#e8eef3"/>
  <g fill="none" stroke="${INK}" stroke-width="1.6">
    <line x1="8" y1="32" x2="112" y2="32"/><line x1="8" y1="51" x2="112" y2="51"/><line x1="8" y1="70" x2="112" y2="70"/>
    <line x1="44" y1="10" x2="44" y2="90"/><line x1="78" y1="10" x2="78" y2="90"/>
  </g>
  <rect x="8" y="10" width="104" height="80" fill="none" stroke="${INK}" stroke-width="2.5"/>` });

A.push({ id: 'tally-marks', vb: [110, 60], name: 'Tally marks', description: 'Tally marks grouped in fives for counting', tags: ['tally', 'count', 'data', 'math'],
  inner: `<g stroke="${INK}" stroke-width="3" stroke-linecap="round">
    <line x1="14" y1="14" x2="14" y2="46"/><line x1="22" y1="14" x2="22" y2="46"/><line x1="30" y1="14" x2="30" y2="46"/><line x1="38" y1="14" x2="38" y2="46"/><line x1="10" y1="46" x2="42" y2="14"/>
    <line x1="64" y1="14" x2="64" y2="46"/><line x1="72" y1="14" x2="72" y2="46"/><line x1="80" y1="14" x2="80" y2="46"/><line x1="88" y1="14" x2="88" y2="46"/><line x1="60" y1="46" x2="92" y2="14"/>
  </g>` });

A.push({ id: 'graph-bar', vb: [115, 105], name: 'Bar graph', description: 'Simple bar graph with axes and bars of different heights', tags: ['graph', 'bar', 'chart', 'data'],
  inner: `<rect x="30" y="54" width="15" height="32" fill="#7cb342" stroke="${INK}" stroke-width="2"/>
  <rect x="52" y="28" width="15" height="58" fill="#4fc3f7" stroke="${INK}" stroke-width="2"/>
  <rect x="74" y="42" width="15" height="44" fill="#fbbf24" stroke="${INK}" stroke-width="2"/>
  <path d="M20,12 L20,86 L100,86" ${stroke()}/>` });

A.push({ id: 'graph-pictograph', vb: [120, 92], name: 'Pictograph', description: 'Pictograph with rows of icons representing counts', tags: ['graph', 'pictograph', 'chart', 'data'],
  inner: `<g fill="#4fc3f7" stroke="${INK}" stroke-width="2">
    ${[18, 36, 54, 72].map((x) => `<circle cx="${x}" cy="20" r="6"/>`).join('')}
    ${[18, 36, 54].map((x) => `<circle cx="${x}" cy="46" r="6"/>`).join('')}
    ${[18, 36, 54, 72, 90].map((x) => `<circle cx="${x}" cy="72" r="6"/>`).join('')}
  </g>` });

A.push({ id: 'graph-line-distance-time', vb: [115, 105], name: 'Line graph', description: 'Line graph with axes; for distance-time and speed', tags: ['graph', 'line', 'distance', 'time', 'speed', 'motion'],
  inner: `<path d="M20,12 L20,86 L100,86" ${stroke()}/>
  <polyline points="26,74 44,54 64,60 86,30" fill="none" stroke="#e53935" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  <g fill="#e53935">${[[26, 74], [44, 54], [64, 60], [86, 30]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join('')}</g>` });

A.push({ id: 'diagram-venn', vb: [135, 95], name: 'Venn diagram', description: 'Two overlapping circles for comparing and contrasting', tags: ['venn', 'compare', 'diagram', 'sets'],
  inner: `<circle cx="54" cy="47" r="36" fill="#7cb342" fill-opacity="0.35" stroke="#2e7d32" stroke-width="2.5"/>
  <circle cx="86" cy="47" r="36" fill="#4fc3f7" fill-opacity="0.35" stroke="#37536b" stroke-width="2.5"/>` });

A.push({ id: 'diagram-tchart', vb: [110, 100], name: 'T-chart', description: 'Two-column T-chart frame for comparing two things', tags: ['t-chart', 'compare', 'diagram', 'frame'],
  inner: `<rect x="12" y="12" width="86" height="80" rx="4" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>
  <path d="M12,34 H98 M55,12 V92" fill="none" stroke="${INK}" stroke-width="2.5"/>` });

A.push({ id: 'diagram-flowchart', vb: [160, 64], name: 'Flowchart', description: 'Three connected boxes for a process flow', tags: ['flowchart', 'process', 'diagram', 'steps'],
  inner: `<g fill="#ffffff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round">
    <rect x="8" y="14" width="36" height="30" rx="6"/><rect x="62" y="14" width="36" height="30" rx="6"/><rect x="116" y="14" width="36" height="30" rx="6"/>
  </g>
  <g ${stroke()}><path d="M46,29 H60"/><path d="${head(60, 29, 0)}"/><path d="M100,29 H114"/><path d="${head(114, 29, 0)}"/></g>` });

A.push({ id: 'icon-method-question', vb: [80, 80], name: 'Question (magnifier)', description: 'Magnifying glass icon for the question / inquiry step', tags: ['question', 'inquiry', 'scientific-method', 'magnifier', 'icon'],
  inner: `<g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"><circle cx="34" cy="34" r="20"/><line x1="49" y1="49" x2="66" y2="66"/></g>` });

A.push({ id: 'icon-method-hypothesis', vb: [80, 80], name: 'Hypothesis (lightbulb)', description: 'Lightbulb icon for the hypothesis / idea step', tags: ['hypothesis', 'idea', 'scientific-method', 'lightbulb', 'icon'],
  inner: `<path d="M40,10 a22,22 0 0 1 13,39 q-2,3 -2,7 h-22 q0,-4 -2,-7 a22,22 0 0 1 13,-39 Z" fill="#fbbf24" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
  <g fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"><path d="M31,63 h18 M34,70 h12"/></g>` });

A.push({ id: 'icon-method-experiment', vb: [80, 80], name: 'Experiment (flask)', description: 'Erlenmeyer flask icon for the experiment / test step', tags: ['experiment', 'test', 'scientific-method', 'flask', 'lab', 'icon'],
  inner: `<path d="M34,14 V32 L18,62 Q15,70 24,70 H56 Q65,70 62,62 L46,32 V14" fill="#ffffff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
  <path d="M25,52 H55 L60,62 Q62,69 55,69 H25 Q18,69 20,62 Z" fill="#7cb342" stroke="none"/>
  <path d="M30,14 H50" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>` });

A.push({ id: 'icon-method-observe', vb: [80, 64], name: 'Observe (eye)', description: 'Eye icon for the observe / collect-data step', tags: ['observe', 'data', 'scientific-method', 'eye', 'icon'],
  inner: `<path d="M8,32 Q40,6 72,32 Q40,58 8,32 Z" fill="#ffffff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="40" cy="32" r="11" fill="#4fc3f7" stroke="${INK}" stroke-width="2"/><circle cx="40" cy="32" r="4.5" fill="${INK}"/>` });

A.push({ id: 'icon-method-conclude', vb: [80, 80], name: 'Conclude (check)', description: 'Checkmark icon for the conclusion step', tags: ['conclude', 'conclusion', 'scientific-method', 'check', 'icon'],
  inner: `<circle cx="40" cy="40" r="28" fill="#7cb342" fill-opacity="0.25" stroke="#2e7d32" stroke-width="2.5"/>
  <path d="M27,41 L36,51 L55,29" fill="none" stroke="#2e7d32" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` });

A.push({ id: 'icon-observe-eye', vb: [80, 64], name: 'Eye', description: 'Eye icon for observation and the sense of sight', tags: ['eye', 'observe', 'sight', 'sense', 'icon'],
  inner: `<path d="M8,32 Q40,6 72,32 Q40,58 8,32 Z" fill="#ffffff" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
  <circle cx="40" cy="32" r="11" fill="#4fc3f7" stroke="${INK}" stroke-width="2"/><circle cx="40" cy="32" r="4.5" fill="${INK}"/>` });

A.push({ id: 'icon-clipboard', vb: [70, 92], name: 'Clipboard', description: 'Clipboard with lines, for notes, checklists and recording', tags: ['clipboard', 'notes', 'checklist', 'record', 'icon'],
  inner: `<rect x="10" y="14" width="50" height="70" rx="6" fill="#ffffff" stroke="${INK}" stroke-width="2.5"/>
  <rect x="24" y="8" width="22" height="13" rx="3" fill="#cfd6dc" stroke="${INK}" stroke-width="2.5"/>
  <g fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"><line x1="20" y1="36" x2="50" y2="36"/><line x1="20" y1="48" x2="50" y2="48"/><line x1="20" y1="60" x2="42" y2="60"/></g>` });

let n = 0;
for (const a of A) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.vb[0]} ${a.vb[1]}" width="${a.vb[0]}" height="${a.vb[1]}">\n  ${a.inner.trim()}\n</svg>\n`;
  const json = {
    id: a.id, name: a.name, description: a.description, subject: 'general',
    grades: ['K-3', '4-6', '7-9', '10-12'], tags: a.tags, curriculum: [],
    source: 'hiraia', license: 'CC-BY-4.0', viewBox: a.vb,
  };
  writeFileSync(join(OUT, `${a.id}.svg`), svg);
  writeFileSync(join(OUT, `${a.id}.json`), JSON.stringify(json, null, 2) + '\n');
  n++;
}
console.log(`Wrote ${n} primitives to assets/general/`);
