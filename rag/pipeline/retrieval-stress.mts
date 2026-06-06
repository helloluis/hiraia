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
}
const { cases } = JSON.parse(readFileSync(new URL('./retrieval-stress.cases.json', import.meta.url), 'utf8')) as { cases: Case[] };
const store = new RagStore();
console.log(`bank: ${store.size} facts | ${cases.length} cases\n`);

const matches = (id: string, subs: string[]) => subs.some((s) => id.toLowerCase().includes(s.toLowerCase()));

let pass = 0;
const byCat: Record<string, [number, number]> = {};
const byLang: Record<string, [number, number]> = {};
const fails: string[] = [];

for (const c of cases) {
  const hits = store.search(c.q, 5, c.lang); // top-5, inspect ranks
  const topIds = hits.map((h: any) => h.fact.id);
  // first rank (1-based) where an expected fact appears, within maxRank
  let hitRank = 0;
  for (let i = 0; i < Math.min(c.maxRank, topIds.length); i++) {
    if (matches(topIds[i], c.expectIdIncludes)) { hitRank = i + 1; break; }
  }
  // a mustNot fact winning at rank 1 (ahead of the expected) is a fail signal
  const badAtTop = c.mustNotIdIncludes && topIds[0] && matches(topIds[0], c.mustNotIdIncludes);
  const ok = hitRank > 0 && !badAtTop;

  byCat[c.cat] = byCat[c.cat] || [0, 0]; byCat[c.cat][1]++;
  byLang[c.lang] = byLang[c.lang] || [0, 0]; byLang[c.lang][1]++;
  if (ok) { pass++; byCat[c.cat][0]++; byLang[c.lang][0]++; }
  else fails.push(`[${c.cat}/${c.lang}] "${c.q}"\n      got: ${topIds.slice(0, 3).join(', ') || 'NONE'}${badAtTop ? '  (mustNot won @1)' : ''}`);
}

console.log(`===== ${pass}/${cases.length} passed (${Math.round((100 * pass) / cases.length)}%) =====\n`);
console.log('by category:');
for (const [k, [p, n]] of Object.entries(byCat).sort()) console.log(`  ${k.padEnd(14)} ${p}/${n}`);
console.log('\nby language:');
for (const [k, [p, n]] of Object.entries(byLang)) console.log(`  ${k.padEnd(10)} ${p}/${n}`);
if (fails.length) {
  console.log(`\nFAILURES (${fails.length}):`);
  for (const f of fails) console.log('  ✗ ' + f);
}
