/**
 * Prototype "visual recall" gate (TF-IDF MVP, no model).
 *
 * Reads a tutor response, scores it against index.json, and decides whether to
 * show a diagram + which one. Prints the match, score, gate decision, and the
 * context-injection note that would be appended to the conversation so the
 * main LLM stays aware of what's on screen.
 *
 *   node visual-gate.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { assets } = JSON.parse(readFileSync(join(HERE, 'index.json'), 'utf8'));

const STOP = new Set('the a an of and or to in on is are was were be it its this that for with as at by from into your you we our they them he she his her ang ng sa na mga ay ko mo ito iyon kung may ang sa is ang'.split(/\s+/));
const tok = (s) => (s.toLowerCase().match(/[a-záéíóúñ]+/gi) || []).map((w) => w.replace(/[^a-z]/g, '')).filter((w) => w.length > 2 && !STOP.has(w));

// IDF over the corpus
const df = new Map();
const docs = assets.map((a) => {
  const counts = new Map();
  for (const t of tok(a.searchText)) counts.set(t, (counts.get(t) || 0) + 1);
  for (const t of counts.keys()) df.set(t, (df.get(t) || 0) + 1);
  return counts;
});
const N = assets.length;
const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;
const vec = (counts) => { const v = new Map(); let n = 0; for (const [t, c] of counts) { const w = (1 + Math.log(c)) * idf(t); v.set(t, w); n += w * w; } n = Math.sqrt(n) || 1; for (const [t, w] of v) v.set(t, w / n); return v; };
const docVecs = docs.map(vec);
const cos = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [t, w] of x) s += w * (y.get(t) || 0); return s; };

function rank(text, k = 3) {
  const q = vec((() => { const c = new Map(); for (const t of tok(text)) c.set(t, (c.get(t) || 0) + 1); return c; })());
  return docVecs.map((dv, i) => ({ a: assets[i], score: cos(q, dv) }))
    .sort((p, q2) => q2.score - p.score).slice(0, k);
}

const THRESHOLD = 0.10; // gate: show only if top match clears this

const SAMPLES = [
  ['EN · photosynthesis', 'en', 'Photosynthesis is how plants make their own food. The leaf takes in carbon dioxide from the air and water from the roots, and using sunlight it produces glucose and releases oxygen.'],
  ['TL · water cycle', 'tl', 'Ang tubig sa dagat ay sumisingaw dahil sa init ng araw. Ang singaw ay umaakyat at nagiging ulap. Kapag lumamig, bumabagsak ito bilang ulan, at dumadaloy pabalik sa dagat sa pamamagitan ng ilog.'],
  ['TL · carabao/farm', 'tl', 'Ang kalabaw ay malaking hayop na ginagamit ng mga magsasaka sa pag-aararo ng palayan dito sa Pilipinas.'],
  ['BIS · photosynthesis', 'bis', 'Ang potosintesis mao ang paagi sa paghimo sa tanom og kaugalingong pagkaon. Ang dahon mosuyop og carbon dioxide ug tubig, ug pinaagi sa kahayag sa adlaw maghimo kini og glucose ug mobuga og oxygen.'],
  ['BIS · volcano', 'bis', 'Ang bulkan mobuto kung ang kinit nga magma motungha gikan sa ilawom sa yuta, mogawas ang lava ug aso sa ibabaw sa bukid.'],
  ['EN · off-topic', 'en', 'Good morning! I am doing great, thanks for asking. What would you like to learn about today?'],
];

const pick = (obj, lang) => (obj && (obj[lang] || obj.en)) || (Array.isArray(obj) ? obj : '');

console.log(`Index: ${N} assets · gate threshold = ${THRESHOLD}\n`);
for (const [label, lang, text] of SAMPLES) {
  const top = rank(text, 3);
  const show = top[0].score >= THRESHOLD;
  console.log(`■ ${label}`);
  console.log(`  "${text.slice(0, 90)}${text.length > 90 ? '…' : ''}"`);
  for (const { a, score } of top) console.log(`    ${score.toFixed(3)}  ${a.id}  (${a.subject})`);
  if (show) {
    const a = top[0].a;
    const cap = pick(a.caption, lang);
    const parts = pick(a.parts, lang);
    console.log(`  → SHOW: ${a.id}`);
    console.log(`  → context note (${lang}): "(May larawang ipinapakita: ${cap} — ${(parts || []).join(', ')})"`);
  } else {
    console.log(`  → no diagram (top score ${top[0].score.toFixed(3)} < ${THRESHOLD})`);
  }
  console.log();
}
