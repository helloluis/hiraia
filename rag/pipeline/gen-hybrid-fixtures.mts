// Precompute faithful query embeddings for hybrid-stress.cases.json so the gate
// (hybrid-stress.mts) runs OFFLINE — no torch, no embed server. Vectors come from
// the device-equivalent embedder (transformers raw-CLS via labse-embed-service.py,
// the method that built the corpus blob, 0.99999 vs QVAC's GGUF).
//
// Regenerate when the bank, the embedder, or query-normalization changes:
//   1) boot the embedder:  EMBED_BACKEND=transformers finetuning/eval/harness/embed-serve.sh
//      (or: finetuning/.convert-venv/bin/python finetuning/eval/harness/labse-embed-service.py 8090)
//   2) node_modules/.bin/tsx rag/pipeline/gen-hybrid-fixtures.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeQuery, buildContextualQuery } from '../../packages/shared/src/rag/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const EMBED = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
const cases = JSON.parse(readFileSync(join(HERE, 'hybrid-stress.cases.json'), 'utf8')).cases as any[];

async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${EMBED}/v1/embeddings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text }),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status} — is the embedder up on ${EMBED}?`);
  const v: number[] = (await res.json()).data[0].embedding;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; // L2 (device embdNormalize:2)
  return v.map((x) => Math.round((x / n) * 1e6) / 1e6); // round for a compact, git-friendly fixture
}

const out: Record<string, number[]> = {};
for (const c of cases) {
  // The device embeds normalize(query); lexical uses the raw query. Mirror that:
  // store the vector of the NORMALIZED query so the fixture tracks the real pipeline.
  out[c.id] = await embed(normalizeQuery(c.q));
  // R2 cases carry a `context`: also store the topic-FOLDED embed (the fallback the
  // caller fires when the bare query abstains).
  if (c.context) out[`${c.id}__ctx`] = await embed(buildContextualQuery(c.q, c.context));
  process.stdout.write(`  ${c.id}${c.context ? ' (+ctx)' : ''}\n`);
}
writeFileSync(join(HERE, 'hybrid-stress.qvecs.json'), JSON.stringify(out));
console.log(`wrote hybrid-stress.qvecs.json (${cases.length} vectors)`);
