/**
 * Assemble kitten-DPO pairs → TRL DPOTrainer conversational format:
 *   {"prompt":[{system},{user}], "chosen":[{assistant}], "rejected":[{assistant}]}
 * System = generateSystemPrompt(lang,5) (train/serve parity); user = the raw safety/
 * myth question (no grounding block — these are conversational turns, like chitchat).
 *
 * Validation: drop incomplete, chosen==rejected, out-of-range length, and (light)
 * polarity sanity — chosen and rejected should OPEN with OPPOSITE polarity (that's
 * the whole DPO signal); flag if they don't clearly differ.
 *
 * Usage: tsx build-dpo-assemble.mts <pairs.json> <out.jsonl>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSystemPrompt } from '../../packages/shared/src/prompts/system.ts';

const IN = process.argv[2] ?? 'finetuning/distill/dpo-pairs.json';
const OUT = process.argv[3] ?? 'finetuning/distill/train-dpo-kitten.jsonl';

const sys = { tagalog: generateSystemPrompt('tagalog', 5), english: generateSystemPrompt('english', 5), cebuano: generateSystemPrompt('cebuano', 5) } as Record<string, string>;
const scrub = (t?: string) => (t ?? '').replace(/<\/?(?:think|reasoning)\b[^>]*>[\s\S]*?<\/(?:think|reasoning)>/gi, '').replace(/[ \t]+/g, ' ').trim();
const wc = (t: string) => t.split(/\s+/).filter(Boolean).length;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
const POS = /^\s*(oo\b|opo\b|oo po|tama|totoo|yes\b|delikado|masama|mapanganib)/i; // affirm-ish opener
const NEG = /^\s*(hindi|hindî|no\b|not\b|dili|ligtas|hindi po)/i; // deny-ish opener

type Pair = { bucket: string; lang: string; polarity: string; prompt?: string; chosen?: string; rejected?: string };
const pairs: Pair[] = JSON.parse(readFileSync(IN, 'utf8'));
const out: any[] = [];
const seen = new Set<string>();
const stats: Record<string, { added: number; dropped: number; reasons: Record<string, number> }> = {};
const tally = (k: string, t: 'added' | 'dropped', r?: string) => { stats[k] ??= { added: 0, dropped: 0, reasons: {} }; stats[k][t]++; if (r) stats[k].reasons[r] = (stats[k].reasons[r] ?? 0) + 1; };

for (const p of pairs) {
  const key = `${p.bucket}/${p.lang}`;
  const prompt = scrub(p.prompt), chosen = scrub(p.chosen), rejected = scrub(p.rejected);
  if (!prompt || !chosen || !rejected) { tally(key, 'dropped', 'incomplete'); continue; }
  if (norm(chosen) === norm(rejected)) { tally(key, 'dropped', 'identical'); continue; }
  if (wc(chosen) < 4 || wc(chosen) > 120 || wc(rejected) < 3 || wc(rejected) > 120) { tally(key, 'dropped', 'length'); continue; }
  const dk = norm(prompt) + '|' + norm(chosen);
  if (seen.has(dk)) { tally(key, 'dropped', 'dup'); continue; }
  seen.add(dk);
  // NOTE: no opener-polarity drop — for hazardous "can I / is it ok?" framing the CORRECT
  // answer opens "Hindi po, delikado" (deny the action, affirm danger) and the WRONG one opens
  // "Hindi po, hindi delikado" (deny danger): SAME opener word, opposite meaning. Opener valence
  // is not the discriminator. chosen!=rejected + length is the gate; the generator set polarity by bucket.
  const s = sys[p.lang] ?? sys.tagalog;
  out.push({
    prompt: [{ role: 'system', content: s }, { role: 'user', content: prompt }],
    chosen: [{ role: 'assistant', content: chosen }],
    rejected: [{ role: 'assistant', content: rejected }],
    _meta: { bucket: p.bucket, lang: p.lang, polarity: p.polarity },
  });
  tally(key, 'added');
}

writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`\n=== kitten DPO assembly: ${out.length} pairs → ${OUT} ===`);
for (const k of Object.keys(stats).sort()) {
  const st = stats[k];
  console.log(`  ${k.padEnd(26)} added=${st.added} dropped=${st.dropped} (${Object.entries(st.reasons).map(([a, b]) => `${a}=${b}`).join(', ') || '—'})`);
}
