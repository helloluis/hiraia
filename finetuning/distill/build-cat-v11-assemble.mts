/**
 * Assemble the cat-v11 English bucket → ChatML rows, then CONCAT onto the v9plus
 * cat trainset to form train-distill-cat-v11.jsonl (the v11 train input).
 *
 * Each bucket row is a conversational (no-grounding) turn: ENGLISH-mode system
 * prompt + raw user turn (Taglish or English) + English assistant reply — matching
 * how v9plus stores its chitchat/identity rows (e.g. "nawala po ako sa gitna" → raw).
 *
 * Hygiene: <think> scrub, length bounds, and an ENGLISH-ONLY gate on the reply
 * (drop any row whose assistant leaked Tagalog/Bisaya — the whole point is English).
 *
 * Usage: tsx build-cat-v11-assemble.mts <bucket-rows.json> <v9plus.jsonl> <out.jsonl>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSystemPrompt } from '../../packages/shared/src/prompts/system.ts';

const ROWS_IN = process.argv[2] ?? 'finetuning/distill/cat-v11-english-rows.json';
const V9PLUS  = process.argv[3] ?? 'finetuning/distill/train-distill-v9plus.jsonl';
const OUT     = process.argv[4] ?? 'finetuning/distill/train-distill-cat-v11.jsonl';

const SYSTEM_EN = generateSystemPrompt('english', 5);
const msg = (role: string, content: string) => ({ role, content });

const THINK = /<\/?(?:think|reasoning|scratchpad|cot)\b[^>]*>[\s\S]*?<\/(?:think|reasoning|scratchpad|cot)>/gi;
const STRAY = /<\/?(?:think|reasoning|scratchpad|cot)\b[^>]*>/gi;
const scrub = (t?: string) => (t ?? '').replace(THINK, '').replace(STRAY, '').replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
// Tagalog/Bisaya leak markers — if the ASSISTANT reply carries >=2, drop (it leaked).
const TL_LEAK = /\b(ang|ng|mga|po|opo|ay|dahil|kaya|naman|hindi|kasi|yung|ito|natin|nila|niya|tayo|mo ba|ako|ka ba|salamat|kumusta|sige|maganda|tanong|hayop)\b/gi;

type Row = { type: string; user?: string; assistant?: string };
const rows: Row[] = JSON.parse(readFileSync(ROWS_IN, 'utf8'));
const out: any[] = [];
const stats: Record<string, { added: number; dropped: number; reasons: Record<string, number> }> = {};
const tally = (t: string, k: 'added' | 'dropped', r?: string) => {
  stats[t] ??= { added: 0, dropped: 0, reasons: {} };
  stats[t][k]++; if (r) stats[t].reasons[r] = (stats[t].reasons[r] ?? 0) + 1;
};
const seen = new Set<string>();

for (const r of rows) {
  const type = r.type ?? 'unknown';
  const u = scrub(r.user), a = scrub(r.assistant);
  if (!u || !a) { tally(type, 'dropped', 'incomplete'); continue; }
  if (wc(a) < 2 || wc(a) > 90) { tally(type, 'dropped', 'length'); continue; }
  const leaks = (a.match(TL_LEAK) || []).length;
  if (leaks >= 2) { tally(type, 'dropped', `tl_leak(${leaks})`); continue; }
  const key = u.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  if (seen.has(key)) { tally(type, 'dropped', 'dup'); continue; }
  seen.add(key);
  // conversational turn: raw user (no grounding block), English system + reply
  out.push({ messages: [msg('system', SYSTEM_EN), msg('user', u), msg('assistant', a)] });
  tally(type, 'added');
}

// concat onto v9plus
const base = readFileSync(V9PLUS, 'utf8').split('\n').filter((l) => l.trim());
const all = [...base, ...out.map((o) => JSON.stringify(o))];
writeFileSync(OUT, all.join('\n') + '\n');

console.log(`\n=== cat-v11 assembly ===`);
for (const t of Object.keys(stats).sort()) {
  const s = stats[t];
  const reasons = Object.entries(s.reasons).map(([k, v]) => `${k}=${v}`).join(', ') || '—';
  console.log(`  ${t.padEnd(24)} added=${s.added}  dropped=${s.dropped} (${reasons})`);
}
console.log(`\n  v9plus base: ${base.length}  + english bucket: ${out.length}  = ${all.length} rows → ${OUT}`);
