/**
 * Enrich DPO pairs with AUTHENTIC on-policy rejected: sample the actual kitten-v7
 * (Sailor2-1B + v7) on each prompt at device temp 0.5, and where it FAILS (wrong
 * polarity for the bucket), swap that real failure in as `rejected`. Where the
 * kitten already answers correctly, keep the synthesized wrong-polarity rejected
 * (still a valid contrast that keeps the model correct).
 *
 * Body/health TL answers stay in FILES (never printed) — only summary stats + the
 * failure RATE are surfaced (AUP-safe; the wrong-polarity check is pure regex).
 *
 *   ENDPOINT=http://localhost:8089 node_modules/.bin/tsx enrich-dpo-onpolicy.mts \
 *     finetuning/distill/dpo-pairs.json finetuning/distill/dpo-pairs-enriched.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSystemPrompt } from '../../packages/shared/src/prompts/system.ts';

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8089';
const IN = process.argv[2] ?? 'finetuning/distill/dpo-pairs.json';
const OUT = process.argv[3] ?? 'finetuning/distill/dpo-pairs-enriched.json';
const TEMP = Number(process.env.TEMP ?? '0.5');

const sys: Record<string, string> = {
  tagalog: generateSystemPrompt('tagalog', 5), english: generateSystemPrompt('english', 5), cebuano: generateSystemPrompt('cebuano', 5),
};

// Wrong-polarity detectors per bucket (does the kitten's answer FAIL?). Deliberately
// anchored to the OPENER region to avoid firing on later nuance.
function isWrong(bucket: string, a: string): boolean {
  const head = a.slice(0, 160).toLowerCase();
  const denyDanger = /(hindi|hindî|dili)\b[^.]{0,18}(masama|delikado|mapanganib|nakaka)|ligtas\s+naman|okay\s+lang|wala\s*(man)?\s*(problema|delikado)|dili\s+man\s+delikado|not\s+(bad|dangerous|harmful)|it'?s\s+safe|no,?\s+it'?s/i;
  const affirmDanger = /\b(oo|opo|delikado|masama|mapanganib|huwag|dangerous|not\s+safe|unsafe|bad\s+for)\b/i;
  const affirmYes = /^\s*(oo\b|opo\b|oo po|tama|totoo|yes\b)/i;
  const denyTrue = /^\s*(hindi|hindî|dili|no\b)|hindi\s+(po\s+)?(totoo|sigurado)|not\s+(true|sure)|that'?s\s+not\s+true/i;
  switch (bucket) {
    case 'safety_hazardous': case 'safety_health': return denyDanger.test(head); // should affirm danger → wrong if it denies
    case 'safety_safe':      return affirmDanger.test(head);                       // harmless → wrong if it warns
    case 'myth_false':       return affirmYes.test(head);                          // false myth → wrong if it affirms
    case 'myth_true':        return denyTrue.test(head);                           // true fact → wrong if it denies
    default: return false;
  }
}

async function ask(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: TEMP, max_tokens: 200, stream: false, seed: -1, lora: [{ id: 0, scale: 1.0 }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d: any = await res.json();
  return (d.choices?.[0]?.message?.content ?? '').replace(/<\/?(?:think|reasoning)\b[^>]*>[\s\S]*?<\/(?:think|reasoning)>/gi, '').trim();
}

type Pair = { bucket: string; lang: string; polarity: string; prompt: string; chosen: string; rejected: string; _onpolicy?: boolean };
const pairs: Pair[] = JSON.parse(readFileSync(IN, 'utf8'));
const stats: Record<string, { n: number; failed: number }> = {};
let swapped = 0;

for (let i = 0; i < pairs.length; i++) {
  const p = pairs[i];
  const s = sys[p.lang] ?? sys.tagalog;
  let ans = '';
  try { ans = await ask([{ role: 'system', content: s }, { role: 'user', content: p.prompt }]); } catch { /* keep synthesized */ }
  stats[p.bucket] ??= { n: 0, failed: 0 }; stats[p.bucket].n++;
  if (ans && ans.length > 8 && isWrong(p.bucket, ans)) {
    p.rejected = ans;            // authentic on-policy failure
    p._onpolicy = true;
    stats[p.bucket].failed++; swapped++;
  }
  if (i % 25 === 0) process.stdout.write(`${i}/${pairs.length} `);
}

writeFileSync(OUT, JSON.stringify(pairs, null, 0));
console.log(`\n\n=== on-policy enrichment: ${swapped}/${pairs.length} rejected swapped to authentic kitten failures ===`);
for (const b of Object.keys(stats).sort()) {
  const st = stats[b];
  console.log(`  ${b.padEnd(20)} kitten failure rate: ${st.failed}/${st.n} (${(100 * st.failed / st.n).toFixed(0)}%)`);
}
