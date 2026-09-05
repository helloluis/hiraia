#!/usr/bin/env node
// Generates: src/generated/curriculumOutline.generated.json  (outline v2 — TOPICS)
//   { [grade]: [ { quarter, contentIndex, title: {en, tl, bis}, codes: [code, ...] }, ... ] }
//   — every Content-column TOPIC of that grade's MATATAG CG, in DepEd's OWN order (quarter by
//   quarter, then the quarter's Content list top to bottom), each carrying the competency codes
//   the reviewed mapping files under it (in CG order). This is the calendar mode's spine: the
//   outline sheet prints one row per topic and the curriculum cursor walks topics forward when
//   a topic's cards run out.
//
//   Sources (all under rag/sources/curriculum-guides/):
//     matatag-{elementary,jhs}-competencies.json — the verbatim CG extraction (quarters, their
//       `content` list, their competencies). Same files gen-curriculum-tags.mjs reads, so a code
//       here is by construction a code the tags can carry.
//     competency-content-map.json — code → {grade, quarter, contentIndex, title}: which Content
//       title each competency belongs to (the CG does not say; this is the reviewed mapping).
//     content-titles.i18n.json — en title → {tl, bis}: the row copy in the tutor language.
//   A topic with NO code (the CG lists a title no competency fits — G7 Q3 "Identifying and
//   controlling variables") is still emitted with codes: [] so the outline mirrors the CG; the
//   runtime drops rows without cards anyway (data/cards.ts curriculumOutline).
//   NOT filtered by card presence: which rows actually hold cards is a property of the pool and
//   is decided at runtime, so a pool rebuild never needs this file regenerated. The quarter's
//   domain is not stored either — it is GRADE_DOMAIN_MAP (packages/shared/src/curriculum).
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const MOBILE = new URL('..', import.meta.url).pathname;
const CG = join(MOBILE, '../../rag/sources/curriculum-guides');
const OUT = join(MOBILE, 'src/generated/curriculumOutline.generated.json');

const { map: CODE_MAP } = JSON.parse(readFileSync(join(CG, 'competency-content-map.json'), 'utf8'));
const { titles: I18N } = JSON.parse(readFileSync(join(CG, 'content-titles.i18n.json'), 'utf8'));

// The elementary file lists `content` as an array; the JHS file joins it with ' | '.
const contentOf = (q) =>
  (Array.isArray(q.content) ? q.content : String(q.content).split(' | ')).map((s) => s.trim());

const byGrade = new Map(); // grade -> [topic]
const seen = new Set();
let codes = 0;
for (const f of readdirSync(CG).filter((n) => /^matatag-.*-competencies\.json$/.test(n)).sort()) {
  const { quarters } = JSON.parse(readFileSync(join(CG, f), 'utf8'));
  // The file lists quarters in curriculum order already; sort defensively on (grade, quarter)
  // so a hand edit that reorders the array cannot reorder the outline.
  for (const q of [...quarters].sort((a, b) => a.grade - b.grade || a.quarter - b.quarter)) {
    const content = contentOf(q);
    const topics = content.map((en, contentIndex) => {
      const t = I18N[en];
      if (!t) throw new Error(`gen-curriculum-outline: no translation for content title ${JSON.stringify(en)} (G${q.grade} Q${q.quarter})`);
      return { quarter: q.quarter, contentIndex, title: { en, tl: t.tl, bis: t.bis }, codes: [] };
    });
    for (const c of q.competencies) {
      if (seen.has(c.code)) throw new Error(`gen-curriculum-outline: duplicate competency code ${c.code}`);
      seen.add(c.code);
      const m = CODE_MAP[c.code];
      if (!m) throw new Error(`gen-curriculum-outline: ${c.code} missing from competency-content-map.json`);
      if (m.grade !== q.grade || m.quarter !== q.quarter || m.contentIndex < 0 || m.contentIndex >= content.length || content[m.contentIndex] !== m.title) {
        throw new Error(`gen-curriculum-outline: ${c.code} maps to G${m.grade} Q${m.quarter} [${m.contentIndex}] "${m.title}" but the CG has G${q.grade} Q${q.quarter} ${JSON.stringify(content)}`);
      }
      topics[m.contentIndex].codes.push(c.code);
      codes += 1;
    }
    byGrade.set(q.grade, [...(byGrade.get(q.grade) ?? []), ...topics]);
  }
}
for (const code of Object.keys(CODE_MAP)) {
  if (!seen.has(code)) throw new Error(`gen-curriculum-outline: competency-content-map.json names ${code}, which no CG file lists`);
}

const grades = [...byGrade.keys()].sort((a, b) => a - b);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  `{\n${grades.map((g) => `${JSON.stringify(String(g))}:[\n${byGrade.get(g).map((t) => JSON.stringify(t)).join(',\n')}\n]`).join(',\n')}\n}\n`
);
const empty = grades.flatMap((g) => byGrade.get(g).filter((t) => !t.codes.length).map((t) => `G${g} Q${t.quarter} "${t.title.en}"`));
console.log(
  `curriculumOutline v2: ${grades.reduce((n, g) => n + byGrade.get(g).length, 0)} topics / ${codes} competencies across grades ${grades.join(', ')} ` +
    `(${grades.map((g) => `G${g}=${byGrade.get(g).length}`).join(' ')})` +
    (empty.length ? ` | topics with no competency: ${empty.join('; ')}` : '') +
    ` → ${OUT}`
);
