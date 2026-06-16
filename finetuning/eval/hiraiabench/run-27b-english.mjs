#!/usr/bin/env node
/**
 * (b) Re-run ONLY the English (en-tier, AUP-safe) probes for Qwen3.5-27B with an EXPLICIT
 * "reply in English" instruction — the 27B otherwise defaults to Tagalog under the shared
 * Filipino-tutor prompt, which unfairly tanks its English score (language-match miss, not an
 * English deficit). Writes the new English answers; the rest of the 27B row is unchanged.
 *
 * Local llama.cpp 27B Q4 (enable_thinking=false). Usage: ENDPOINT=http://localhost:8077 node run-27b-english.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8077';
const SYS_EN =
  'You are a kind, knowledgeable science tutor for Filipino grade-5 students. The student is asking in ENGLISH, so reply in clear, simple English (not Tagalog). Be accurate and age-appropriate; gently correct misconceptions; if a question is genuinely unknowable, say so honestly and do not make it up.';

const { probes } = JSON.parse(readFileSync(join(HERE, 'bench-set.json'), 'utf8'));
const en = probes.filter((p) => p.lang === 'en' && !p.aup);

async function ask(prompt) {
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: SYS_EN }, { role: 'user', content: prompt }],
      temperature: 0.5, max_tokens: 800, stream: false,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  let s = j.choices?.[0]?.message?.content ?? '';
  if (s.includes('</think>')) s = s.slice(s.lastIndexOf('</think>') + 8);
  return s.trim();
}

const out = [];
for (const p of en) {
  const t0 = Date.now();
  const answer = await ask(p.prompt);
  out.push({ id: p.id, prompt: p.prompt, answer });
  console.log(`${p.id} (${Date.now() - t0}ms): ${answer.slice(0, 70).replace(/\n/g, ' ')}`);
}
writeFileSync(join(HERE, 'answers.qwen3.5-27b.english.json'), JSON.stringify(out, null, 1));
console.log(`\nwrote ${out.length} English answers -> answers.qwen3.5-27b.english.json`);
