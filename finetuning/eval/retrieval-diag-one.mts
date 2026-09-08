/**
 * retrieval-diag-one.mts — dissect ONE query: lexical top-10, semantic top-10 (cosine), hybrid
 * top-5 (RRF score, ratio to the top), and what retrieveForGroundingHybrid would inject. Written
 * 2026-09-08 for the gate's tier2-affirm-flat-earth case (the one-moon fact rides along as a
 * distractor at ~0.5 of the top fused score). Boot the embedder on :8090 first.
 *
 *   EMBED_ENDPOINT=http://localhost:8090 node_modules/.bin/tsx finetuning/eval/retrieval-diag-one.mts "totoo po bang patag ang mundo?" tagalog
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RagStore, SemanticIndex, normalizeQuery, MemoryFactSource } from '../../packages/shared/src/rag/index.ts';
import { loadFactBank, bankFileHash } from '../../packages/shared/src/rag/bankFile.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const EMBED = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
const query = process.argv[2] ?? 'totoo po bang patag ang mundo?';
const lang = (process.argv[3] ?? 'tagalog') as 'tagalog' | 'cebuano' | 'english';

const bank = loadFactBank();
const store = new RagStore(new MemoryFactSource(bank, bankFileHash()));
const META = JSON.parse(readFileSync(join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json'), 'utf8'));
const bytes = readFileSync(join(ROOT, 'packages/mobile/assets/rag/vectors-labse.i8.bin'));
const sem = new SemanticIndex({ dims: META.dims, scale: META.scale, count: META.count, langs: META.langs, data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
store.attachSemantic(sem, META.bankHash);

async function embed(text: string): Promise<Float32Array> {
  const res = await fetch(`${EMBED}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: normalizeQuery(text) }) });
  const v: number[] = (await res.json()).data[0].embedding;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

const short = (id: string) => { const f = bank.find((x) => x.id === id); return f ? f.fact[lang === 'cebuano' ? 'bis' : lang === 'english' ? 'en' : 'tl'].slice(0, 70) : ''; };

console.log(`query: ${JSON.stringify(query)} → normalized ${JSON.stringify(normalizeQuery(query))}\n`);
const lex = store.search(query, 10, lang);
console.log('LEXICAL top-10:');
lex.forEach((h, i) => console.log(`  ${String(i + 1).padStart(2)} ${h.score.toFixed(3)}  ${h.fact.id}  | ${short(h.fact.id)}`));
const qv = await embed(query);
const semHits = sem.search(qv, lang, 10);
console.log('\nSEMANTIC top-10 (cosine):');
semHits.forEach((h, i) => { const f = bank[h.index]; console.log(`  ${String(i + 1).padStart(2)} ${h.cosine.toFixed(3)}  ${f?.id}  | ${f ? short(f.id) : ''}`); });
const hyb = store.searchHybrid(query, qv, 5, lang);
console.log('\nHYBRID top-5 (RRF score, ratio to top):');
const top = hyb[0]?.score ?? 1;
hyb.forEach((h, i) => console.log(`  ${i + 1} ${h.score.toFixed(4)}  ×${(h.score / top).toFixed(2)}  ${h.fact.id}`));
const ground = store.retrieveForGroundingHybrid(query, qv, lang, 3, 0.5);
console.log(`\nGROUNDING SET (max 3, floorRatio 0.5): ${ground.map((h) => h.fact.id).join(', ') || 'ABSTAIN'}`);
