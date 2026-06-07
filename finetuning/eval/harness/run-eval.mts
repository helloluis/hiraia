// Behavioral gate: runs each case in cases.json against a LOCAL llama-server
// (base GGUF + adapter GGUF — the device-equivalent engine), using the EXACT
// runtime prompt the app builds (RagStore retrieval + generateSystemPrompt +
// formatGroundingBlock, imageTags=true). Asserts on retrieval + output and exits
// non-zero if anything fails. This is the formal gate BEFORE on-device / human tests.
//
//   run via run-harness.sh (which starts/stops the server). Standalone:
//   ENDPOINT=http://localhost:8088 node_modules/.bin/tsx run-eval.mts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RagStore } from '../../../packages/shared/src/rag/RagStore.ts';
import { generateSystemPrompt, formatGroundingBlock } from '../../../packages/shared/src/prompts/system.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8088';
const LANG_OK = { tagalog: 'tl', cebuano: 'bis', english: 'en' } as const;

interface Turn { role: 'user' | 'assistant'; content: string }
interface Case {
  id: string; lang: keyof typeof LANG_OK; grade: number; mode: string; question?: string;
  history?: Turn[]; // multi-turn: full conversation; grounding uses the LAST user turn
  expectRetrieves?: string; mustContain?: string[]; mustNotContain?: string[]; maxChars?: number;
  pending?: boolean; // codified behavior not yet trained into the adapter — reported, non-blocking
  mustEmitImage?: boolean; // legacy: answer must contain an [image: …] tag. Vestigial now — on-device
  // display is RETRIEVAL-driven (FACT_IMAGE[retrieved fact]), not tag-driven; prefer mustRetrieveIdIncludes.
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
  const hits = store.retrieveForGrounding(query as any, c.lang as any, 3);
  const retrievedIds = hits.map((h: any) => h.fact.id);
  let system = generateSystemPrompt(c.lang as any, c.grade as any, true);
  const block = formatGroundingBlock(
    hits.map((h: any) => ({ content: h.text, source: h.fact.source, score: h.score, metadata: { topic: h.fact.topic } }))
  );
  if (block) system += `\n\n${block}`;

  const fails: string[] = [];

  // 1) retrieval assertion (cheap, model-independent)
  if (c.expectRetrieves === 'none') {
    if (hits.length) fails.push(`retrieval: expected NONE, got [${retrievedIds.join(',')}]`);
  } else if (c.expectRetrieves && c.expectRetrieves !== 'any') {
    if (!retrievedIds.includes(c.expectRetrieves)) fails.push(`retrieval: expected '${c.expectRetrieves}', got [${retrievedIds.join(',') || 'none'}]`);
  }

  // 2) generation + output assertions
  const messages = c.history
    ? [{ role: 'system', content: system }, ...c.history]
    : [{ role: 'system', content: system }, { role: 'user', content: c.question! }];
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
