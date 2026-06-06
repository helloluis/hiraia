// Retrieval stress-test for the ~5k bank. Runs each case through RagStore and
// checks whether a fact whose id matches `expectIdIncludes` appears within
// `maxRank`, and that no `mustNotIdIncludes` fact wins ahead of it. Reports
// hit-rate overall / by category / by language, and lists failures.
//   node_modules/.bin/tsx rag/pipeline/retrieval-stress.mts
import { readFileSync } from 'node:fs';
import { RagStore } from '../../packages/shared/src/rag/RagStore.ts';

interface Case {
  cat: string; q: string; lang: 'tagalog' | 'english' | 'cebuano';
  expectIdIncludes: string[]; mustNotIdIncludes?: string[]; maxRank: number;
  context?: string; // recent-conversation context for follow-up cases
  known?: boolean;  // documented-hard residual: reported but does NOT fail the gate
}
interface Sequence {
  cat: string; lang: 'tagalog' | 'english' | 'cebuano';
  query: string; context?: string; turns: number; minDistinct: number;
}
const raw = JSON.parse(readFileSync(new URL('./retrieval-stress.cases.json', import.meta.url), 'utf8')) as {
  cases: Case[]; sequences?: Sequence[];
};
// drop the {_codified_from}/{_note} marker objects (documentation, not cases)
const cases = raw.cases.filter((c) => c.q && c.cat);
const sequences = raw.sequences ?? [];
const store = new RagStore();
console.log(`bank: ${store.size} facts | ${cases.length} cases + ${sequences.length} sequences\n`);

const matches = (id: string, subs: string[]) => subs.some((s) => id.toLowerCase().includes(s.toLowerCase()));

let pass = 0;
let total = 0;
const byCat: Record<string, [number, number]> = {};
const byLang: Record<string, [number, number]> = {};
const fails: string[] = []; // blocking (regressions)
const knownFails: string[] = []; // documented residuals (non-blocking)

for (const c of cases) {
  total++;
  const hits = store.search(c.q, 5, c.lang, c.context ?? ''); // top-5, inspect ranks
  const topIds = hits.map((h: any) => h.fact.id);
  let hitRank = 0;
  for (let i = 0; i < Math.min(c.maxRank, topIds.length); i++) {
    if (matches(topIds[i], c.expectIdIncludes)) { hitRank = i + 1; break; }
  }
  const badAtTop = c.mustNotIdIncludes && topIds[0] && matches(topIds[0], c.mustNotIdIncludes);
  const ok = hitRank > 0 && !badAtTop;

  byCat[c.cat] = byCat[c.cat] || [0, 0]; byCat[c.cat][1]++;
  byLang[c.lang] = byLang[c.lang] || [0, 0]; byLang[c.lang][1]++;
  if (ok) { pass++; byCat[c.cat][0]++; byLang[c.lang][0]++; }
  else {
    const msg = `[${c.cat}/${c.lang}] "${c.q}"\n      got: ${topIds.slice(0, 3).join(', ') || 'NONE'}${badAtTop ? '  (mustNot won @1)' : ''}`;
    (c.known ? knownFails : fails).push(msg);
  }
}

// Multi-turn novelty: same exploratory question across N turns must surface fresh
// facts (the seen-penalty), measured by distinct fact ids retrieved.
for (const s of sequences) {
  total++;
  const seen = new Set<string>();
  let ctx = s.context ?? '';
  for (let t = 0; t < s.turns; t++) {
    const hits = store.retrieveForGrounding(s.query as any, s.lang as any, 3, 0.5, ctx, seen);
    for (const h of hits as any[]) seen.add(h.fact.id);
    // REALISTIC: next turn's context is the previous answer's text (which quotes the
    // shown facts) — this is what re-surfaced the same fact on-device. The test must
    // mirror it so the novelty guard actually catches the "same fact back-to-back" bug.
    ctx = `${s.query} ${(hits as any[]).map((h) => h.text).join(' ')}`.slice(0, 400);
  }
  const distinct = seen.size;
  const ok = distinct >= s.minDistinct;
  byCat[s.cat] = byCat[s.cat] || [0, 0]; byCat[s.cat][1]++;
  byLang[s.lang] = byLang[s.lang] || [0, 0]; byLang[s.lang][1]++;
  if (ok) { pass++; byCat[s.cat][0]++; byLang[s.lang][0]++; }
  else fails.push(`[${s.cat}/${s.lang}] "${s.query}" over ${s.turns} turns\n      only ${distinct} distinct facts (need ${s.minDistinct}) — repeating`);
}

console.log(`===== ${pass}/${total} passed (${Math.round((100 * pass) / total)}%) =====\n`);
console.log('by category:');
for (const [k, [p, n]] of Object.entries(byCat).sort()) console.log(`  ${k.padEnd(16)} ${p}/${n}`);
console.log('\nby language:');
for (const [k, [p, n]] of Object.entries(byLang)) console.log(`  ${k.padEnd(10)} ${p}/${n}`);
if (knownFails.length) {
  console.log(`\nKNOWN residuals (non-blocking — Phase-2.5 reranker; ${knownFails.length}):`);
  for (const f of knownFails) console.log('  ~ ' + f);
}
if (fails.length) {
  console.log(`\nREGRESSIONS (${fails.length}) — these FAIL the gate:`);
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('\nRETRIEVAL OK — no regressions.');
process.exit(0);
