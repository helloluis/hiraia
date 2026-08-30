// Lexical (production RagStore) top-10 for every benchmark query, language-scoped
// exactly like the app (taglish -> tagalog). Reads benchmark.jsonl, writes
// bench-cache/lexical.json: { "<query>": [factId,...] }.
import { readFileSync, writeFileSync } from 'node:fs';
import { RagStore } from '../../packages/shared/src/rag/RagStore.ts';
import { loadFactBank } from '../../packages/shared/src/rag/bankFile.ts';

const HERE = new URL('.', import.meta.url);
const bench = readFileSync(new URL('benchmark.jsonl', HERE), 'utf8')
  .trim().split('\n').map((l) => JSON.parse(l)) as { query: string; lang: string }[];
const store = new RagStore(loadFactBank());
const scope = (l: string) => (l === 'cebuano' ? 'cebuano' : l === 'english' ? 'english' : 'tagalog');
const out: Record<string, string[]> = {};
for (const b of bench) {
  out[b.query] = store.search(b.query, 10, scope(b.lang) as any).map((h: any) => h.fact.id);
}
writeFileSync(new URL('bench-cache/lexical.json', HERE), JSON.stringify(out));
console.log(`lexical: ${Object.keys(out).length} queries`);
