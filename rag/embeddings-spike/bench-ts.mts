// Validate the TS hybrid (RagStore.searchHybrid + SemanticIndex) reproduces the
// Python benchmark (hyb-labse-cls R@3 .607) on the actual shipped code path,
// using the built int8 blob + precomputed query vectors.
//   node_modules/.bin/tsx rag/embeddings-spike/bench-ts.mts
import { readFileSync } from 'node:fs';
import { RagStore } from '../../packages/shared/src/rag/RagStore.ts';
import { loadFactSource } from '../../packages/shared/src/rag/bankFile.ts';
import { SemanticIndex, type SemanticBlob } from '../../packages/shared/src/rag/SemanticIndex.ts';
import type { Language } from '../../packages/shared/src/types/index.ts';

const HERE = new URL('.', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('../bank/vectors-labse.meta.json', HERE), 'utf8'));
const binBuf = readFileSync(new URL('../bank/vectors-labse.i8.bin', HERE));
const blob: SemanticBlob = {
  dims: meta.dims, scale: meta.scale, count: meta.count, langs: meta.langs,
  data: new Int8Array(binBuf.buffer, binBuf.byteOffset, binBuf.byteLength),
};
// loadFactSource stamps the store with md5(science-facts.jsonl)[:12] so attachSemantic can
// reject a blob built for a different bank of the SAME size (facts edited in place).
const store = new RagStore(loadFactSource());
store.attachSemantic(new SemanticIndex(blob), meta.bankHash);
console.log(`blob: ${meta.count} facts x ${meta.dims}d x ${meta.langs.length} langs (scale ${meta.scale.toFixed(5)})`);

const bench = readFileSync(new URL('benchmark.jsonl', HERE), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const qbuf = readFileSync(new URL('bench-cache/q_labsecls.f32.bin', HERE));
const qvecs = new Float32Array(qbuf.buffer, qbuf.byteOffset, qbuf.byteLength / 4);
const D = meta.dims;
const scope = (l: string): Language => (l === 'cebuano' ? 'cebuano' : l === 'english' ? 'english' : 'tagalog');

let lexHit = 0, hybHit = 0, n = 0;
for (let i = 0; i < bench.length; i++) {
  const b = bench[i];
  if (b.fact_id === 'NONE') continue;
  n++;
  const lang = scope(b.lang);
  const qv = qvecs.subarray(i * D, i * D + D);
  const lex = store.searchHybrid(b.query, undefined, 3, lang).map((h: any) => h.fact.id); // lexical-only
  const hyb = store.searchHybrid(b.query, qv, 3, lang).map((h: any) => h.fact.id);
  if (lex.includes(b.fact_id)) lexHit++;
  if (hyb.includes(b.fact_id)) hybHit++;
}
console.log(`\n${n} labeled queries`);
console.log(`  lexical-only  R@3 = ${(lexHit / n).toFixed(3)}`);
console.log(`  hybrid-LaBSE  R@3 = ${(hybHit / n).toFixed(3)}  (python bench: 0.607)`);
console.log(Math.abs(hybHit / n - 0.607) < 0.01 ? '✅ TS reproduces the benchmark' : '⚠️ TS differs from benchmark — investigate');
