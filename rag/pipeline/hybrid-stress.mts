// R1 regression gate for the HYBRID retriever (LaBSE + abstain floor) — the device
// path the lexical retrieval-stress can't see. Runs OFFLINE against precomputed
// faithful query vectors (hybrid-stress.qvecs.json). Asserts:
//   • mustGround cases → retrieveForGroundingHybrid returns ≥1 hit, one whose id
//     matches expectIdIncludes (and none matching mustNotIdIncludes at top).
//   • mustAbstain cases → returns [] (genuinely out-of-bank stays abstained).
// 'known: true' cases are reported but DON'T fail the gate (documented-hard).
//   node_modules/.bin/tsx rag/pipeline/hybrid-stress.mts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { RagStore, SemanticIndex, normalizeQuery, expandColloquial } from '../../packages/shared/src/rag/index.ts';
import { loadFactSource } from '../../packages/shared/src/rag/bankFile.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

// normalizeQuery contract (R1): strip padding from LONG queries, but NEVER damage a
// terse reply (no padding to remove) and never collapse to a scrap. Guards the
// MIN_NORMALIZE_LEN behavior so a future regex tweak can't silently eat short replies.
const NORM_CHECKS: [string, string][] = [
  ['oo', 'oo'], // short reply — untouched
  ['ulan ba?', 'ulan ba?'], // would-be stripped to "ulan" if the guard were off
  ['kaya?', 'kaya?'], // a lone particle stays (don't empty it)
  ['may homework po ako about sa puso', 'puso'], // padded → single CONTENT word (ideal)
  ['may project po ako about sa mga planeta', 'mga planeta'],
];
const normFails = NORM_CHECKS.filter(([q, exp]) => normalizeQuery(q) !== exp)
  .map(([q, exp]) => `normalizeQuery(${JSON.stringify(q)}) = ${JSON.stringify(normalizeQuery(q))}, expected ${JSON.stringify(exp)}`);
// expandColloquial (R3): "pinas"→"pilipinas", but NEVER touch real science terms (pH!).
const COLLOQ_CHECKS: [string, boolean][] = [
  ['saan sa pinas may lindol', true], // slang expands
  ['ano ang ph ng tubig at suka', false], // pH stays — must NOT become "pilipinas"
  ['pineapple is sweet', false], // substring "pinas"-ish but whole-word guard holds
];
for (const [q, shouldExpand] of COLLOQ_CHECKS) {
  const expanded = /\bpilipinas\b/i.test(expandColloquial(q));
  if (expanded !== shouldExpand) normFails.push(`expandColloquial(${JSON.stringify(q)}) ${expanded ? 'expanded' : 'did not expand'} (expected ${shouldExpand ? 'expand' : 'no change'})`);
}
if (normFails.length) { console.log('❌ query-normalization contract:'); normFails.forEach((f) => console.log('   ' + f)); process.exit(1); }
console.log(`✓ query-normalization contract (${NORM_CHECKS.length + COLLOQ_CHECKS.length} checks)\n`);
const cases = JSON.parse(readFileSync(join(HERE, 'hybrid-stress.cases.json'), 'utf8')).cases as any[];
let qvecs: Record<string, number[]>;
try {
  qvecs = JSON.parse(readFileSync(join(HERE, 'hybrid-stress.qvecs.json'), 'utf8'));
} catch {
  console.error('ERR: hybrid-stress.qvecs.json missing — run gen-hybrid-fixtures.mts (embedder up).');
  process.exit(2);
}

const META = join(HERE, '../../packages/mobile/assets/rag/vectors-labse.meta.json');
const BIN = join(HERE, '../../packages/mobile/assets/rag/vectors-labse.i8.bin');
const meta = JSON.parse(readFileSync(META, 'utf8'));
const bytes = readFileSync(BIN);
// loadFactSource, not loadFactBank: it stamps the store with md5(science-facts.jsonl)[:12],
// which is the only thing that lets attachSemantic reject a blob built for a DIFFERENT bank
// of the same size. Editing facts in place — the routine correction workflow — leaves the row
// count at 50,279 while every vector goes wrong, so the count check alone sees nothing. This
// is the gate that stands between a stale blob and an APK build: on the phone attachSemantic
// does throw, but LocalEngine.initSemantic downgrades that to a warning and ships lexical-only
// retrieval (Recall@3 .607 -> .509, no SEMANTIC_FLOOR abstain). Hashing the bank costs ~60 ms.
const store = new RagStore(loadFactSource());
store.attachSemantic(new SemanticIndex({ dims: meta.dims, scale: meta.scale, count: meta.count, langs: meta.langs, data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }), meta.bankHash);

const matches = (id: string, subs: string[] = []) => subs.some((s) => id.toLowerCase().includes(s.toLowerCase()));
let pass = 0, gated = 0;
const fails: string[] = [], known: string[] = [];

for (const c of cases) {
  const qv = qvecs[c.id];
  if (!qv) { fails.push(`${c.id}: no fixture vector (regenerate)`); continue; }
  const vec = Float32Array.from(qv);
  const topCos = store.hasSemantic ? (store as any).semantic.search(vec, c.lang, 1)[0]?.cosine ?? 0 : 0;
  let hits = store.retrieveForGroundingHybrid(c.q, vec, c.lang, 3, 0.5, c.context ?? '');
  // R2 fallback: a context case whose BARE query abstained re-tries with the folded
  // vector (mirrors LocalEngine.ragSearch / chat-tutor). The bare abstain IS the R2
  // problem; the folded retrieval is the fix being gated.
  let foldedNote = '';
  if (hits.length === 0 && c.context && qvecs[`${c.id}__ctx`]) {
    hits = store.retrieveForGroundingHybrid(c.q, Float32Array.from(qvecs[`${c.id}__ctx`]), c.lang, 3, 0.5, c.context);
    foldedNote = ' (via ctx-fold)';
  }
  const ids = hits.map((h: any) => h.fact.id);

  let ok: boolean, why = '';
  if (c.mustAbstain) {
    ok = hits.length === 0;
    if (!ok) why = `expected ABSTAIN, got [${ids.join(', ')}]`;
  } else {
    const hit = ids.some((id: string) => matches(id, c.expectIdIncludes));
    const badTop = c.mustNotIdIncludes && ids[0] && matches(ids[0], c.mustNotIdIncludes);
    ok = hits.length > 0 && hit && !badTop;
    if (!hits.length) why = `expected GROUND, got NONE (topCos ${topCos.toFixed(3)})`;
    else if (!hit) why = `none of [${(c.expectIdIncludes || []).join(',')}] in [${ids.join(', ')}]`;
    else if (badTop) why = `polluted top: ${ids[0]}`;
  }

  const tag = c.mustAbstain ? 'abstain' : 'ground ';
  const mark = ok ? '✅' : c.known ? '🔶' : '❌';
  console.log(`${mark} [${tag}] ${c.id.padEnd(22)} cos=${topCos.toFixed(3)}  ${ok ? (ids.slice(0, 3).join(', ') || '(abstained)') + foldedNote : why}`);
  if (c.known) { if (!ok) known.push(c.id); continue; }
  gated++;
  if (ok) pass++; else fails.push(c.id);
}

console.log(`\n===== hybrid R1 gate: ${pass}/${gated} passed${known.length ? `  (+${known.length} known-hard)` : ''} =====`);
if (known.length) console.log(`known-hard (non-blocking): ${known.join(', ')}`);
if (fails.length) { console.log(`FAILED: ${fails.join(', ')}`); process.exit(1); }
console.log('HYBRID R1 OK.');
