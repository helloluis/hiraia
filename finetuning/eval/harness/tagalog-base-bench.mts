// Base-model Tagalog benchmark: run a fixed probe set through whatever base model
// is on ENDPOINT (NO adapter) and dump answers. Run once per candidate base
// (Qwen3.5-2B vs the current Sailor2-1B), then judge head-to-head. Decides whether
// a candidate's BASE Tagalog is good enough to be the next kitten base (skip CPT?).
//
//   ENDPOINT=http://localhost:8088 MODEL=qwen35-2b OUT=/tmp/bench-qwen.json \
//   node_modules/.bin/tsx tagalog-base-bench.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../../packages/shared/src/prompts/system.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8088';
const MODEL = process.env.MODEL ?? 'base';
const OUT = process.env.OUT ?? join(HERE, `bench-${MODEL}.json`);
const PROBES = process.env.PROBES ?? join(HERE, 'tagalog-base-probes.json');
const TEMP = Number(process.env.TEMP ?? '0.5');

interface Probe { id: string; category: string; mode: 'bare' | 'tutor' | 'grounded'; lang?: 'tagalog' | 'english'; user: string; fact?: string; factSource?: string }
const probes: Probe[] = JSON.parse(readFileSync(PROBES, 'utf8')).probes;

const NO_THINK = process.env.NO_THINK === '1'; // Qwen3.5 defaults to thinking mode — disable for the kitten (budget CPU) deployment mode
async function ask(messages: { role: string; content: string }[]): Promise<string> {
  const body: any = { messages, temperature: TEMP, max_tokens: 320, stream: false, seed: -1 };
  if (NO_THINK) body.chat_template_kwargs = { enable_thinking: false };
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const d: any = await res.json();
  const m = d.choices?.[0]?.message ?? {};
  return m.content || ''; // answer only (reasoning_content is the thinking block, excluded)
}

const out: any = { model: MODEL, endpoint: ENDPOINT, temp: TEMP, answers: [] };
for (const p of probes) {
  const lang = p.lang ?? 'tagalog';
  let messages: { role: string; content: string }[];
  if (p.mode === 'bare') {
    messages = [{ role: 'user', content: p.user }];
  } else if (p.mode === 'tutor') {
    messages = [{ role: 'system', content: generateSystemPrompt(lang as any, 5 as any, true) }, { role: 'user', content: p.user }];
  } else {
    const block = formatGroundingBlock([{ content: p.fact!, source: p.factSource ?? 'curriculum', score: 1, metadata: { topic: p.id } }]);
    messages = [{ role: 'system', content: generateSystemPrompt(lang as any, 5 as any, true) }, { role: 'user', content: composeGroundedUserTurn(block, p.user) }];
  }
  let answer = '';
  try { answer = await ask(messages); } catch (e: any) { answer = `‹ERROR: ${e.message}›`; }
  out.answers.push({ id: p.id, category: p.category, mode: p.mode, lang, user: p.user, answer });
  process.stdout.write('·');
}
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`\n${out.answers.length} answers → ${OUT} (model=${MODEL}, temp ${TEMP})`);
