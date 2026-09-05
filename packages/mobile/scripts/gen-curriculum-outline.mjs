#!/usr/bin/env node
// Generates: src/generated/curriculumOutline.generated.json
//   { [grade]: [[code, quarter, text], ...] }  — every MATATAG competency of that grade, in
//   DepEd's OWN order (quarter by quarter, competency by competency, exactly as the CG lists
//   them). This is the calendar mode's spine: the outline sheet prints it top to bottom and
//   the curriculum cursor walks it forward when a topic's cards run out.
//
//   Source: rag/sources/curriculum-guides/matatag-{elementary,jhs}-competencies.json (the
//   same files gen-curriculum-tags.mjs reads its code→cell map from), so a code here is by
//   construction a code the tags can carry. Text is the CG's English wording verbatim (the
//   CG is authored in English; localized glosses are a separate translation job).
//   NOT filtered by card presence: which rows actually hold cards is a property of the pool
//   and is decided at runtime (data/cards.ts curriculumOutline), so a pool rebuild never
//   needs this file regenerated. The quarter's domain is not stored either — it is
//   GRADE_DOMAIN_MAP (packages/shared/src/curriculum) at runtime, one source of truth.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MOBILE = new URL('..', import.meta.url).pathname;
const CG = join(MOBILE, '../../rag/sources/curriculum-guides');
const OUT = join(MOBILE, 'src/generated/curriculumOutline.generated.json');

const byGrade = new Map(); // grade -> [[code, quarter, text]]
for (const f of readdirSync(CG).filter((n) => /^matatag-.*-competencies\.json$/.test(n)).sort()) {
  const { quarters } = JSON.parse(readFileSync(join(CG, f), 'utf8'));
  // The file lists quarters in curriculum order already; sort defensively on (grade, quarter)
  // so a hand edit that reorders the array cannot reorder the outline.
  for (const q of [...quarters].sort((a, b) => a.grade - b.grade || a.quarter - b.quarter)) {
    const rows = byGrade.get(q.grade) ?? [];
    for (const c of q.competencies) rows.push([c.code, q.quarter, c.text.trim()]);
    byGrade.set(q.grade, rows);
  }
}

const grades = [...byGrade.keys()].sort((a, b) => a - b);
const seen = new Set();
for (const g of grades) for (const [code] of byGrade.get(g)) {
  if (seen.has(code)) throw new Error(`gen-curriculum-outline: duplicate competency code ${code}`);
  seen.add(code);
}
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `{\n${grades.map((g) => `${JSON.stringify(String(g))}:[\n${byGrade.get(g).map((r) => JSON.stringify(r)).join(',\n')}\n]`).join(',\n')}\n}\n`
);
console.log(
  `curriculumOutline: ${seen.size} competencies across grades ${grades.join(', ')} ` +
    `(${grades.map((g) => `G${g}=${byGrade.get(g).length}`).join(' ')}) → ${OUT}`
);
