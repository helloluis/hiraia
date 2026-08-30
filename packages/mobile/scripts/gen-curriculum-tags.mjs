#!/usr/bin/env node
// Generates: src/generated/curriculumTags.generated.json
//   { [ffctId]: [competency, grade, quarter, confidence, cells, codes] }
//   competency = primary MATATAG code; codes = every code the card serves (best first);
//   cells = [grade, quarter, strength, norm] per distinct grade-quarter cell the codes imply:
//     strength 2 = agreed by two labelers (cells_strong) or the primary cell of a confident label; 1 = weak
//     norm = sqrt(median_n / n_code) of the code producing the cell (max if several), clamped [0.1, 1] (dampen only),
//            where n_code counts every pool card carrying that code — applied by feedWeighting.ts only to
//            the lift above the x1 baseline, so a fat competency cannot swamp its cell.
//   Source: rag/bank/curriculum-tags.json v2 (rag/pipeline/assemble-competency-labels.py); a v1
//   single-label row becomes one strong un-normalised cell. Pool cards only; untagged cards are absent.
//   SECOND SOURCE — DepEd provenance: a dcard-* card carries the grade (and usually the quarter) of
//   the learning module it was written from. That IS a curriculum position, so a card the labeler
//   missed is tagged from it rather than left off-curriculum. Without this, 54% of the DepEd half of
//   the deck fell into the offCurriculum x0.4 band and the module-derived cards — the ones actually
//   tied to what a class is being taught — became the LEAST likely to be shown (21.3% of the pool,
//   13.1% of draws). Ruleset: rag/pipeline/FEED-WEIGHTING.md.
// Ruleset: rag/pipeline/FEED-WEIGHTING.md. Never key on card.topic — the competency code is the topic axis.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MOBILE = new URL('..', import.meta.url).pathname;
const TAGS = process.env.TAGS ?? join(MOBILE, '../../rag/bank/curriculum-tags.json');
const POOL = join(MOBILE, '../../rag/pipeline/cardsPool.app.json');
const CG = join(MOBILE, '../../rag/sources/curriculum-guides');
const OUT = join(MOBILE, 'src/generated/curriculumTags.generated.json');

const { factoids, scheme = '' } = JSON.parse(readFileSync(TAGS, 'utf8'));
const { cards } = JSON.parse(readFileSync(POOL, 'utf8'));
const cellOfCode = new Map(); // code -> [grade, quarter]
for (const f of readdirSync(CG).filter((n) => /^matatag-.*-competencies\.json$/.test(n))) {
  for (const q of JSON.parse(readFileSync(join(CG, f), 'utf8')).quarters) {
    for (const c of q.competencies) cellOfCode.set(c.code, [q.grade, q.quarter]);
  }
}
const v2 = scheme.startsWith('v2');
const tagged = cards.map((c) => [c.id, factoids[c.id]]).filter(([, t]) => t);
const nCode = new Map();
for (const [, t] of tagged) for (const code of t.codes ?? [t.competency]) nCode.set(code, (nCode.get(code) ?? 0) + 1);
const counts = [...nCode.values()].sort((a, b) => a - b);
const median = counts.length ? counts[Math.floor(counts.length / 2)] : 1;
const normOf = (code) => Math.min(1, Math.max(0.1, Math.sqrt(median / (nCode.get(code) ?? median)))); // only ever dampens: a rare code never exceeds its band

const entries = [];
let multi = 0, weak = 0, unknown = 0;
for (const [id, t] of tagged) {
  const confidence = Math.round(t.confidence * 100) / 100;
  const codes = (t.codes ?? [t.competency]).filter((c) => cellOfCode.has(c));
  if (!codes.length) { unknown++; continue; }
  const hasAgreement = Array.isArray(t.cells_strong);
  const strongSet = new Set(hasAgreement ? t.cells_strong : []);
  const primaryCell = `G${t.grade}-Q${t.quarter}`;
  const cells = new Map(); // "g-q" -> [g, q, strength, norm]
  for (const code of codes) {
    const [g, q] = cellOfCode.get(code);
    const key = `G${g}-Q${q}`;
    const strength = !v2 ? 2 : hasAgreement ? (strongSet.has(key) || (key === primaryCell && confidence >= 0.67) ? 2 : 1) : confidence >= 0.67 ? 2 : 1;
    const norm = v2 ? Math.round(normOf(code) * 100) / 100 : 1;
    const prev = cells.get(key);
    cells.set(key, prev ? [g, q, Math.max(prev[2], strength), Math.max(prev[3], norm)] : [g, q, strength, norm]);
  }
  const cellRows = [...cells.values()];
  if (cellRows.length > 1) multi++;
  if (cellRows.every((c) => c[2] < 2)) weak++;
  entries.push([id, [t.competency, t.grade, t.quarter, confidence, cellRows, codes]]);
}
// ---- DepEd provenance fallback -------------------------------------------------------------
// A card the labeler missed but whose SOURCE MODULE names a grade (and usually a quarter) is
// tagged from that. Deliberate choices:
//   * the seen-group (`codes`) is the module, not the cell. Module groups are small (median 4
//     cards, max 25), which is the scale competency_seen decay is meant for; a whole grade-quarter
//     as one group would make hundreds of unrelated cards decay together, the exact thing the
//     'off' bucket is excluded from CODE_LIST to avoid.
//   * the `norm` denominator is the CELL, not the module. norm exists so one fat competency cannot
//     swamp its cell, and the fat thing here is the provenance route: every module-derived card
//     claiming G5-Q2 competes for the same band. Normalising by module size instead would hand
//     each tiny module an undampened x6 and simply invert the bias.
//   * grade known, quarter unknown -> all four quarters of that grade, WEAK, so each is capped at
//     the adjacent-quarter level. "Somewhere in Grade 5" is worth saying; it is not worth saying
//     loudly.
const MODULE_CONFIDENCE = 0.5; // provenance, not a label: above minConfidence, below a confident tag
const synth = cards.filter((c) => !factoids[c.id] && Number.isFinite(c.grade) && c.source_module);
const cellsOf = (c) =>
  Number.isFinite(c.quarter) ? [[c.grade, c.quarter, 2]] : [1, 2, 3, 4].map((q) => [c.grade, q, 1]);
const nCell = new Map();
for (const c of synth) for (const [g, q] of cellsOf(c)) nCell.set(`G${g}-Q${q}`, (nCell.get(`G${g}-Q${q}`) ?? 0) + 1);
const normOfCell = (g, q) => Math.min(1, Math.max(0.1, Math.sqrt(median / (nCell.get(`G${g}-Q${q}`) ?? median))));
let synthWeak = 0;
for (const c of synth) {
  const code = `deped:${c.source_module}`;
  const cellRows = cellsOf(c).map(([g, q, st]) => [g, q, st, Math.round(normOfCell(g, q) * 100) / 100]);
  if (cellRows.every((x) => x[2] < 2)) synthWeak += 1;
  entries.push([c.id, [code, c.grade, cellRows[0][1], MODULE_CONFIDENCE, cellRows, [code]]]);
}

entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `{\n${entries.map(([id, tag]) => `${JSON.stringify(id)}:${JSON.stringify(tag)}`).join(',\n')}\n}\n`);
console.log(
  `curriculumTags: ${entries.length}/${cards.length} pool cards tagged (${Math.round((100 * entries.length) / cards.length)}%; ` +
    `${multi} multi-cell, ${weak} weak-only, ${unknown} unknown-code; median cards per code ${median}; ${v2 ? 'v2' : 'v1'} source) from ${TAGS}\n` +
    `  + ${synth.length} from DepEd module provenance (${synthWeak} grade-only/weak, ${nCell.size} cells touched)`
);
