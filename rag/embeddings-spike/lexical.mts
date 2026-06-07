// Lexical top-k from the production RagStore for the hard-case queries, so the
// spike can compare lexical-only vs semantic vs hybrid on identical inputs.
//   node_modules/.bin/tsx rag/embeddings-spike/lexical.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { RagStore } from '../../packages/shared/src/rag/RagStore.ts';

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8')) as {
  q: string; lang: 'tagalog' | 'cebuano' | 'english';
}[];
const store = new RagStore();
const out: Record<string, { id: string; score: number }[]> = {};
for (const c of cases) {
  const hits = store.search(c.q, 8, c.lang);
  out[c.q] = hits.map((h: any) => ({ id: h.fact.id, score: h.score }));
}
writeFileSync(new URL('./lexical_results.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('wrote lexical_results.json');
