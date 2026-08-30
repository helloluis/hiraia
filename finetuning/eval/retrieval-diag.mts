/**
 * retrieval-diag.mts — dissect WHY the wrong facts win for the P2/P3 collision queries.
 * For each query: show normalizeQuery output, top-5 LEXICAL, top-5 SEMANTIC (cosine),
 * top-5 HYBRID (RRF), and where the IDEAL facts rank in each list. Boot the embedder on :8090.
 *   EMBED_ENDPOINT=http://localhost:8090 node_modules/.bin/tsx finetuning/eval/retrieval-diag.mts
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RagStore, SemanticIndex, normalizeQuery, MemoryFactSource } from '../../packages/shared/src/rag/index.ts';
import { loadFactBank, bankFileHash } from '../../packages/shared/src/rag/bankFile.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const EMBED = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
const bank = loadFactBank();
// The bank is needed as an ARRAY here (the ordinal map below), so it is wrapped rather than
// re-read via loadFactSource — same stamp, one parse. The hash is what lets attachSemantic
// reject a blob built for a different bank of the same size.
const store = new RagStore(new MemoryFactSource(bank, bankFileHash()));
const META = JSON.parse(readFileSync(join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json'), 'utf8'));
const bytes = readFileSync(join(ROOT, 'packages/mobile/assets/rag/vectors-labse.i8.bin'));
const sem = new SemanticIndex({ dims: META.dims, scale: META.scale, count: META.count, langs: META.langs, data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
store.attachSemantic(sem, META.bankHash);
// id -> ORDINAL. This used to reach into RagStore's private `docs` array; the store no longer
// keeps one (the bank lives in an inverted index it reads through), and it never needed to be
// the source anyway — the ordinal IS the bank file's line number, which is also what the
// vectors blob is indexed by.
const idIndex = new Map<string, number>(bank.map((f, i) => [f.id, i]));

async function embed(text: string): Promise<Float32Array> {
  const res = await fetch(`${EMBED}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: normalizeQuery(text) }) });
  const v: number[] = (await res.json()).data[0].embedding;
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

const CASES = [
  { q: "ma'am may project po ako bukas tungkol sa solar system, di ko po alam paano gagawin", ideal: ['earth-solar-system-g4', 'val-planets-order', 'why-planets-orbit-sun-g5'] },
  { q: 'yung mga planeta po na umiikot sa araw', ideal: ['why-planets-orbit-sun-g5', 'val-planets-order', 'earth-solar-system-g4'] },
  { q: 'ilan ba ang planeta tapos ano ang pinakamalaki', ideal: ['val-planets-order', 'val-largest-smallest-planet', 'planet-size-comparison-g6', 'jupiter-planet-g5'] },
  { q: 'bakit laging may bagyo dito sa Pilipinas', ideal: ['why-ph-many-typhoons-g6', 'typhoon-what-g5', 'earth-typhoon-g5'] },
];

function rankOf(id: string, list: { id: string }[]): string {
  const r = list.findIndex((x) => x.id === id);
  return r < 0 ? '>50' : String(r + 1);
}

for (const c of CASES) {
  const qvec = await embed(c.q);
  // lexical (RagStore.search, tl)
  const lex = store.search(c.q, 50, 'tagalog').map((h: any) => ({ id: h.fact.id, score: +h.score.toFixed(2) }));
  // semantic (direct)
  const semHits = sem.search(qvec, 'tagalog', 50).map((h: any) => ({ id: bank[h.index]!.id, cos: +h.cosine.toFixed(3) }));
  // hybrid (RRF) via searchHybrid
  const hyb = store.searchHybrid(c.q, qvec, 50, 'tagalog').map((h: any) => ({ id: h.fact.id }));
  console.log(`\n===== "${c.q}"`);
  console.log(`  normalizeQuery → "${normalizeQuery(c.q)}"`);
  console.log(`  LEXICAL top5:  ${lex.slice(0, 5).map((x) => `${x.id}(${x.score})`).join('  ')}`);
  console.log(`  SEMANTIC top5: ${semHits.slice(0, 5).map((x) => `${x.id}(${x.cos})`).join('  ')}`);
  console.log(`  HYBRID top5:   ${hyb.slice(0, 5).map((x) => x.id).join('  ')}`);
  console.log(`  → IDEAL fact ranks (lex / sem / hybrid):`);
  for (const id of c.ideal) {
    const inBank = idIndex.has(id) ? '' : '  ⚠️NOT IN BANK';
    console.log(`      ${id}:  lex ${rankOf(id, lex)} · sem ${rankOf(id, semHits)} · hyb ${rankOf(id, hyb)}${inBank}`);
  }
}
