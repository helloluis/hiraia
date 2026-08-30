// Device-faithful ROLE-PLAY runner (temp 0.5 by default — the device-realistic
// temperature where safety/myth/abstention edge bugs surface; the green gate at
// temp 0 is blind to them). Unlike run-eval.mts (fixed assertions, pre-written
// assistant turns), this threads the model's REAL responses back across 3-4
// turns, so turn N reacts to what the model actually said in turn N-1 — the true
// multi-turn experience (repetition, state-drift, contradiction).
//
// Replicates the EXACT device path (LocalEngine.ragSearch + chatStore.send):
//   - static grade-5 system prompt (no grounding — KV-cache-friendly)
//   - R1/R2 context-gated hybrid retrieval (bare query first; fold the prior
//     turns in only when the bare query is weak)
//   - seenIds (shownFactIds) accumulate across turns → SEEN_PENALTY demotes
//     already-shown facts (the "same Mars fact again" repetition guard)
//   - grounding injected into the CURRENT user turn only; history stays raw
//
//   ENDPOINT=http://localhost:8088 EMBED_ENDPOINT=http://localhost:8090 \
//   SCRIPTS=roleplay-scripts.json OUT=roleplay-transcripts.cat.json TEMP=0.5 \
//   node_modules/.bin/tsx roleplay-run.mts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RagStore, SemanticIndex, normalizeQuery, buildContextualQuery, CONTEXT_FALLBACK_FLOOR,
} from '../../../packages/shared/src/rag/index.ts';
import { loadFactSource } from '../../../packages/shared/src/rag/bankFile.ts';
import {
  generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn,
} from '../../../packages/shared/src/prompts/system.ts';
import { presentationViolations } from '../presentation.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8088';
const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
const TEMP = Number(process.env.TEMP ?? '0.5');
const GRADE = Number(process.env.GRADE ?? '5');
const SCRIPTS = process.env.SCRIPTS ?? join(HERE, 'roleplay-scripts.json');
const OUT = process.env.OUT ?? join(HERE, 'roleplay-transcripts.json');
const LANG_OK = { tagalog: 'tl', cebuano: 'bis', english: 'en' } as const;

interface Script { id: string; category: string; lang: keyof typeof LANG_OK; persona?: string; turns: string[] }

const scripts: Script[] = (JSON.parse(readFileSync(SCRIPTS, 'utf8')).scripts ?? []) as Script[];
// loadFactSource stamps the store with md5(science-facts.jsonl)[:12] so attachSemantic can
// reject a blob built for a different bank of the SAME size (facts edited in place).
const store = new RagStore(loadFactSource());

// --- device-faithful hybrid retrieval (mirror of LocalEngine.ragSearch) -------
function attachSemantic(): boolean {
  const META = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json');
  const BIN = join(ROOT, 'packages/mobile/assets/rag/vectors-labse.i8.bin');
  if (!existsSync(META) || !existsSync(BIN)) return false;
  try {
    const meta = JSON.parse(readFileSync(META, 'utf8'));
    const bytes = readFileSync(BIN);
    store.attachSemantic(new SemanticIndex({ dims: meta.dims, scale: meta.scale, count: meta.count, langs: meta.langs, data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) }), meta.bankHash);
    return true;
  } catch (e) { console.warn(`>> ⚠️ semantic blob unusable (${(e as Error).message})`); return false; }
}
async function embed(text: string): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(`${EMBED_ENDPOINT}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: text }) });
    if (!res.ok) return undefined;
    const v: number[] = (await res.json()).data[0].embedding;
    let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
    return Float32Array.from(v, (x) => x / n);
  } catch { return undefined; }
}
const HAS_SEMANTIC = attachSemantic();
const HYBRID = HAS_SEMANTIC && !!(await embed('test'));
console.log(HYBRID ? '>> retrieval: HYBRID (device-faithful)' : '>> ⚠️ retrieval: LEXICAL-ONLY (boot the embedder for device-faithful)');

// R1 context-free, R2 fold conversation context when the bare query is weak — exactly LocalEngine.ragSearch.
async function deviceRetrieve(query: string, lang: keyof typeof LANG_OK, context: string, seenIds: Set<string>) {
  const language = lang as any;
  if (HYBRID) {
    const qvec = await embed(normalizeQuery(query));
    const r1 = store.retrieveForGroundingHybridDiag(query, qvec, language, 3, 0.5, '', seenIds);
    let hits = r1.hits;
    if ((hits.length === 0 || r1.topCos < CONTEXT_FALLBACK_FLOOR) && qvec && context.trim()) {
      const folded = await embed(buildContextualQuery(query, context));
      if (folded) {
        const r2 = store.retrieveForGroundingHybridDiag(query, folded, language, 3, 0.5, context, seenIds);
        if (r2.hits.length) hits = r2.hits;
      }
    }
    return { hits, topCos: r1.topCos };
  }
  return { hits: store.retrieveForGrounding(query, language, 3, 0.5, context, seenIds), topCos: 0 };
}

async function ask(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: TEMP, max_tokens: 320, stream: false, seed: -1, lora: [{ id: 0, scale: 1.0 }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`server error: ${JSON.stringify(data.error).slice(0, 200)}`);
  return data.choices?.[0]?.message?.content ?? '';
}

const TAG = process.env.TAG ?? 'cat';
const out: any = { tag: TAG, temp: TEMP, endpoint: ENDPOINT, hybrid: HYBRID, transcripts: [] as any[] };

for (const s of scripts) {
  const system = generateSystemPrompt(s.lang as any, GRADE as any, true);
  const messages: { role: string; content: string }[] = [{ role: 'system', content: system }];
  const rawHistory: { role: string; content: string }[] = []; // raw (ungrounded) turns, for ragContext + the message window
  const seenIds = new Set<string>();
  const turns: any[] = [];
  process.stdout.write(`\n[${s.id}] (${s.category}/${s.lang}) `);
  for (let i = 0; i < s.turns.length; i++) {
    const userMsg = s.turns[i];
    // ragContext = the 2 real turns BEFORE the current user message (chatStore slice(-3,-1))
    const ragContext = rawHistory.slice(-2).map((m) => m.content).join(' ');
    let hits: any[] = [], topCos = 0;
    try { const r = await deviceRetrieve(userMsg, s.lang, ragContext, seenIds); hits = r.hits; topCos = r.topCos; }
    catch (e: any) { /* retrieval failure → ungrounded, like the device's catch */ }
    for (const h of hits) { const id = h.fact?.id; if (id) seenIds.add(id); }
    const block = formatGroundingBlock(hits.map((h: any) => ({ content: h.text, source: h.fact.source, score: h.score, metadata: { topic: h.fact.topic } })));
    const groundedUser = block ? composeGroundedUserTurn(block, userMsg) : userMsg;
    const sendMessages = [{ role: 'system', content: system }, ...rawHistory, { role: 'user', content: groundedUser }];
    let assistant = '';
    try { assistant = await ask(sendMessages); } catch (e: any) { assistant = `‹ERROR: ${e.message}›`; }
    rawHistory.push({ role: 'user', content: userMsg });            // history stays RAW (no grounding block)
    rawHistory.push({ role: 'assistant', content: assistant });
    const pv = presentationViolations(assistant, s.lang as any);
    turns.push({ n: i + 1, user: userMsg, retrievedIds: hits.map((h: any) => h.fact.id), topCos: Number(topCos.toFixed(3)), assistant, presentationViolations: pv });
    process.stdout.write(pv.length ? '⚠' : '·');
  }
  out.transcripts.push({ id: s.id, category: s.category, lang: s.lang, persona: s.persona, turns });
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n\n>> ${out.transcripts.length} transcripts → ${OUT}  (temp ${TEMP}, ${HYBRID ? 'hybrid' : 'lexical'})`);
