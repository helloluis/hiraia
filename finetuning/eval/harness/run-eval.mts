// Behavioral gate: runs each case in cases.json against a LOCAL llama-server
// (base GGUF + adapter GGUF — the device-equivalent engine), using the EXACT
// runtime prompt the app builds (RagStore retrieval + generateSystemPrompt +
// formatGroundingBlock, imageTags=true). Asserts on retrieval + output and exits
// non-zero if anything fails. This is the formal gate BEFORE on-device / human tests.
//
//   run via run-harness.sh (which starts/stops the server). Standalone:
//   ENDPOINT=http://localhost:8088 node_modules/.bin/tsx run-eval.mts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RagStore, SemanticIndex, normalizeQuery } from '../../../packages/shared/src/rag/index.ts';
import {
  generateSystemPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from '../../../packages/shared/src/prompts/system.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8088';
const LANG_OK = { tagalog: 'tl', cebuano: 'bis', english: 'en' } as const;

interface Turn { role: 'user' | 'assistant'; content: string }
interface Case {
  id: string; lang: keyof typeof LANG_OK; grade: number; mode: string; question?: string;
  history?: Turn[]; // multi-turn: full conversation; grounding uses the LAST user turn
  expectRetrieves?: string; mustContain?: string[]; mustNotContain?: string[]; maxChars?: number;
  pending?: boolean; // codified behavior not yet trained into the adapter — reported, non-blocking
  mustEmitImage?: boolean; // answer must contain an [image: …] tag. Since the tag→bundled-image
  // resolution shipped on mobile (#51: display strips the tag and shows the matched asset), the tag
  // IS the display mechanism; v4 Family-A trains image REQUESTS to answer-and-tag, never abstain.
  mustNotEmitImage?: boolean; // answer must NOT carry a tag (pop-culture/vague requests redirect/clarify instead)
  mustRetrieveIdIncludes?: string[]; // a retrieved fact id must contain one of these (the image-bearing concept)
  mustContainEmoji?: boolean; // the answer should carry at least one emoji (engagement nudge)
  mustGround?: boolean; // COVERED-topic probe: the answer must NOT deflect/over-abstain (no REFUSAL_MARKERS).
  // Use ONLY when the bank demonstrably has facts on the topic (pair with expectRetrieves/mustRetrieveIdIncludes).
  // This is the opposite of mode:abstain — it catches the model punting ("tanungin ang guro") on things it CAN answer.
  adapter?: 'tagalog' | 'bisaya'; // which LoRA this case must run under (default tagalog); harness boots both
}

// Deflection / over-abstention markers — phrases that PUNT to a teacher/book or
// disclaim knowledge instead of using the grounded facts. For a topic we KNOW is
// covered (mustGround cases) any of these is a FAILURE. NOTE: this is deliberately
// NARROW (anchored deflection phrasings, not a bare "hindi") so it does NOT fire on
// legitimate science prose like "hindi ito bituin kundi planeta". The genuine
// abstain cases (mode:abstain, e.g. biggest-star) do NOT set mustGround, so the
// required "hindi ako sigurado" there is unaffected.
const REFUSAL_MARKERS: RegExp[] = [
  /hindi\s+(?:po\s+)?ako(?:\s+po)?\s+(?:gaano\s+)?(?:sigurado|tiyak|kumpiyansa)/i,
  /hindi\s+ko\s+(?:po\s+)?(?:alam|matiyak|masabi|maipaliwanag|sigurado|lubos na alam)/i,
  /hindi\s+(?:po\s+)?(?:sigurado|tiyak)\s+(?:ang|ako)/i,
  /wala\s+(?:po\s+)?ako(?:ng)?\s+(?:sapat\s+na\s+)?(?:impormasyon|alam|kaalaman|datos)/i,
  /(?:tanungin|magtanong|itanong|kausapin|konsultahin).{0,24}\b(?:guro|titser|teacher|magulang)\b/i,
  /(?:tingnan|basahin|hanapin|alamin|maghanap).{0,22}\b(?:libro|aklat|teksbuk|textbook|internet|reference)\b/i,
  /ayaw\s+ko(?:ng)?\s+(?:po\s+)?(?:magbigay|magsabi|manghula|mag-?imbento).{0,18}mali/i,
  /baka\s+(?:po\s+)?(?:ako\s+)?(?:magkamali|mali\s+ang|maling)/i,
  // Bisaya
  /wala\s+ko(?:y)?\s+(?:kasiguro|kasiguruhan|kahibalo|igong\s+impormasyon)/i,
  /pangutan-?a.{0,22}\b(?:magtutudlo|titser|maestra|maestro|ginikanan)\b/i,
  // English (base-model path)
  /\bI(?:'m| am)\s+not\s+(?:sure|certain)\b/i,
  /\bask\s+your\s+(?:teacher|parent)\b/i,
  /\bI\s+(?:don'?t|do not)\s+(?:know|have enough)\b/i,
];

const cfg = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as { cases: Case[] };
// The harness boots one server per adapter (tagalog, then bisaya). Each pass runs
// only the cases tagged for its adapter (default tagalog), so Cebuano answers are
// tested against the Bisaya LoRA — the real device path, not the Tagalog one.
const ADAPTER_TAG = process.env.ADAPTER_TAG ?? 'tagalog';
// Sampling temperature. Default 0 = deterministic gate (one greedy sample per case).
// The DEVICE runs at the model's default temp (~0.8, LocalEngine.chat sets none), where
// the model can STOCHASTICALLY wander into a deflection ("tanungin ang guro") on a
// vaguely-phrased but covered query. Set TEMP=0.8 SAMPLES=5 to reproduce that — a
// mustGround case then fails if ANY sample deflects (the on-device experience).
const TEMP = Number(process.env.TEMP ?? '0');
const SAMPLES = Math.max(1, Number(process.env.SAMPLES ?? '1'));
// Optional focused run: CASES="venus,photosynth" runs only cases whose id contains
// one of the comma-separated substrings (handy for probing a single failure mode).
const CASE_FILTER = (process.env.CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const cases = cfg.cases
  .filter((c) => (c.adapter ?? 'tagalog') === ADAPTER_TAG)
  .filter((c) => !CASE_FILTER.length || CASE_FILTER.some((s) => c.id.includes(s)));
const store = new RagStore();
const stripTags = (s: string) => s.replace(/\s*\[image:[^\]]*\]/gi, '').trim();

// DEVICE-FAITHFUL retrieval: the phone uses retrieveForGroundingHybrid (lexical + LaBSE
// semantic), so the gate must too (FINDINGS F7) — lexical-only gave false Cebuano fails
// (correct answers failing retrieval-id assertions on garbage lexical grounding). Embed each
// query via the LaBSE service + attach the bundled blob. Falls back to lexical (loud warn) if
// the embedder/blob is unavailable.
const ROOT = join(HERE, '../../..');
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
function attachSemantic(): boolean {
  const META = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json');
  const BIN = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.i8.bin');
  if (!existsSync(META) || !existsSync(BIN)) return false;
  try {
    const meta = JSON.parse(readFileSync(META, 'utf8'));
    const bytes = readFileSync(BIN);
    store.attachSemantic(new SemanticIndex({ dims: meta.dims, scale: meta.scale, count: meta.count, langs: meta.langs, data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }));
    return true;
  } catch (e) { console.warn(`>> ⚠️ semantic blob unusable (${(e as Error).message}) — lexical fallback`); return false; }
}
async function embedQuery(text: string): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(`${EMBED_ENDPOINT}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: normalizeQuery(text) }) });
    if (!res.ok) return undefined;
    const v: number[] = (await res.json()).data[0].embedding;
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (x) => x / n);
  } catch { return undefined; }
}
const HAS_SEMANTIC = attachSemantic();
const HYBRID = HAS_SEMANTIC && !!(await embedQuery('test'));
console.log(HYBRID ? '>> retrieval: HYBRID (device-faithful)' : '>> ⚠️ retrieval: LEXICAL-ONLY (not device-faithful — boot the embedder)');

async function ask(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: TEMP, max_tokens: 320, stream: false,
      ...(TEMP > 0 ? { seed: -1 } : {}), // vary samples when probing at device temp
      // adapter loaded at server start (--lora); activate at scale 1.0 per request too.
      lora: [{ id: 0, scale: 1.0 }],
    }),
  });
  // surface context-overflow etc. as a thrown error so the case FAILS (not silently)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`server error: ${JSON.stringify(data.error).slice(0, 200)}`);
  return data.choices?.[0]?.message?.content ?? ''; // RAW (keeps [image:] for mustEmitImage)
}

let pass = 0;
const failures: string[] = [];
const pending: string[] = [];

for (const c of cases) {
  // retrieval grounds on the latest user message (matches chatStore)
  const query = c.history ? [...c.history].reverse().find((t) => t.role === 'user')!.content : c.question!;
  const qvec = HYBRID ? await embedQuery(query) : undefined;
  const hits = store.retrieveForGroundingHybrid(query as any, qvec, c.lang as any, 3, 0.5);
  const retrievedIds = hits.map((h: any) => h.fact.id);
  // STATIC system (no grounding) — grounding rides the current user turn, matching
  // chatStore + training, so this gate validates the cache-friendly serving path.
  const system = generateSystemPrompt(c.lang as any, c.grade as any, true);
  const block = formatGroundingBlock(
    hits.map((h: any) => ({ content: h.text, source: h.fact.source, score: h.score, metadata: { topic: h.fact.topic } }))
  );

  const fails: string[] = [];

  // 1) retrieval assertion (cheap, model-independent)
  if (c.expectRetrieves === 'none') {
    if (hits.length) fails.push(`retrieval: expected NONE, got [${retrievedIds.join(',')}]`);
  } else if (c.expectRetrieves && c.expectRetrieves !== 'any') {
    if (!retrievedIds.includes(c.expectRetrieves)) fails.push(`retrieval: expected '${c.expectRetrieves}', got [${retrievedIds.join(',') || 'none'}]`);
  }

  // 2) generation + output assertions. Grounding goes into the CURRENT (last) user
  // turn via composeGroundedUserTurn — same as chatStore, so the system stays static.
  const baseTurns = c.history
    ? c.history.map((t: { role: string; content: string }) => ({ ...t }))
    : [{ role: 'user', content: c.question! }];
  if (block) {
    for (let i = baseTurns.length - 1; i >= 0; i--) {
      if (baseTurns[i].role === 'user') {
        baseTurns[i].content = composeGroundedUserTurn(block, baseTurns[i].content);
        break;
      }
    }
  }
  const messages = [{ role: 'system', content: system }, ...baseTurns];
  let raw = '';
  try {
    raw = await ask(messages);
  } catch (e: any) {
    fails.push(`request error: ${e.message}`);
  }
  const answer = stripTags(raw); // text assertions run on the displayed (tag-stripped) text
  for (const rx of c.mustContain ?? []) if (!new RegExp(rx, 'i').test(answer)) fails.push(`mustContain /${rx}/ missing`);
  for (const rx of c.mustNotContain ?? []) if (new RegExp(rx, 'i').test(answer)) fails.push(`mustNotContain /${rx}/ present`);
  if (c.maxChars && answer.length > c.maxChars) fails.push(`too long (${answer.length} > ${c.maxChars} chars)`);
  if (c.mustEmitImage && !/\[image:/i.test(raw)) fails.push('mustEmitImage: no [image: …] tag emitted');
  if (c.mustNotEmitImage && /\[image:/i.test(raw)) fails.push('mustNotEmitImage: unexpected [image: …] tag emitted');
  // display-aligned image check: the retrieval-driven picture shows the right concept
  if (c.mustRetrieveIdIncludes && !c.mustRetrieveIdIncludes.some((s) => retrievedIds.some((id) => id.toLowerCase().includes(s.toLowerCase()))))
    fails.push(`mustRetrieveIdIncludes: none of [${c.mustRetrieveIdIncludes.join(',')}] in retrieved [${retrievedIds.join(',') || 'none'}]`);
  // emoji engagement nudge (Extended_Pictographic covers the emoji blocks)
  if (c.mustContainEmoji && !/\p{Extended_Pictographic}/u.test(raw)) fails.push('mustContainEmoji: no emoji in answer');
  // COVERED-topic probe: the model must USE the grounding, not punt to a teacher/book.
  // At SAMPLES>1 (device-temp repro), draw extra samples and fail if ANY deflects —
  // the kid only has to hit the bad branch once to be told "ask your teacher".
  if (c.mustGround) {
    const drawn = [answer];
    if (SAMPLES > 1) {
      for (let s = 1; s < SAMPLES; s++) {
        try { drawn.push(stripTags(await ask(messages))); } catch { /* counted as a non-deflection draw */ }
      }
    }
    const deflected = drawn.filter((a) => REFUSAL_MARKERS.some((rx) => rx.test(a)));
    if (deflected.length) {
      const m = REFUSAL_MARKERS.find((rx) => rx.test(deflected[0]));
      const rate = SAMPLES > 1 ? ` (${deflected.length}/${SAMPLES} samples @ temp ${TEMP})` : '';
      fails.push(`mustGround: deflected/over-abstained on a COVERED topic${rate} (matched ${m}); retrieved [${retrievedIds.join(',') || 'none'}]`);
    }
  }

  const ok = fails.length === 0;
  const tag = ok ? '✅ PASS' : c.pending ? '⏳ PEND' : '❌ FAIL';
  if (ok) pass++;
  else if (c.pending) pending.push(c.id);
  else failures.push(c.id);
  console.log(`${tag}  ${c.id}  [${c.mode}]  retrieved: ${retrievedIds.slice(0, 3).join(', ') || 'none'}`);
  console.log(`   A: ${answer.replace(/\n+/g, ' ').slice(0, 180)}`);
  if (!ok) fails.forEach((f) => console.log(`   ↳ ${f}`));
}

const gated = cases.filter((c) => !c.pending).length;
console.log(`\n===== [${ADAPTER_TAG}] ${pass}/${gated} gated passed${pending.length ? ` (+${pending.length} pending)` : ''} =====`);
if (pending.length) console.log(`PENDING (codified, awaits next adapter): ${pending.join(', ')}`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('ALL PASS — safe to proceed to on-device / human testing.');
