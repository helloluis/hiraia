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
}

const cfg = JSON.parse(readFileSync(join(HERE, 'cases.json'), 'utf8')) as { cases: Case[] };
const store = new RagStore();
const stripTags = (s: string) => s.replace(/\s*\[image:[^\]]*\]/gi, '').trim();

async function ask(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      temperature: 0, max_tokens: 320, stream: false,
      // adapter loaded at server start (--lora); activate at scale 1.0 per request too.
      lora: [{ id: 0, scale: 1.0 }],
    }),
  });
  // surface context-overflow etc. as a thrown error so the case FAILS (not silently)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`server error: ${JSON.stringify(data.error).slice(0, 200)}`);
  return stripTags(data.choices?.[0]?.message?.content ?? '');
}

let pass = 0;
const failures: string[] = [];
const pending: string[] = [];

for (const c of cfg.cases) {
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
  let answer = '';
  try {
    answer = await ask(messages);
  } catch (e: any) {
    fails.push(`request error: ${e.message}`);
  }
  for (const rx of c.mustContain ?? []) if (!new RegExp(rx, 'i').test(answer)) fails.push(`mustContain /${rx}/ missing`);
  for (const rx of c.mustNotContain ?? []) if (new RegExp(rx, 'i').test(answer)) fails.push(`mustNotContain /${rx}/ present`);
  if (c.maxChars && answer.length > c.maxChars) fails.push(`too long (${answer.length} > ${c.maxChars} chars)`);

  const ok = fails.length === 0;
  const tag = ok ? '✅ PASS' : c.pending ? '⏳ PEND' : '❌ FAIL';
  if (ok) pass++;
  else if (c.pending) pending.push(c.id);
  else failures.push(c.id);
  console.log(`${tag}  ${c.id}  [${c.mode}]  retrieved: ${retrievedIds.slice(0, 3).join(', ') || 'none'}`);
  console.log(`   A: ${answer.replace(/\n+/g, ' ').slice(0, 180)}`);
  if (!ok) fails.forEach((f) => console.log(`   ↳ ${f}`));
}

const gated = cfg.cases.filter((c) => !c.pending).length;
console.log(`\n===== ${pass}/${gated} gated passed${pending.length ? ` (+${pending.length} pending)` : ''} =====`);
if (pending.length) console.log(`PENDING (codified, awaits next adapter): ${pending.join(', ')}`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('ALL PASS — safe to proceed to on-device / human testing.');
