/**
 * Assemble the v9+ AUGMENTATION (today's on-device fixes) → ChatML, matching v9 exactly.
 *   teach  (/tmp/teach-all.jsonl, {id,user,assistant})  — grounded: look the fact up in the
 *          bank by id, prepend the VERIFIED FACTS block to the user turn. Fixes over-abstention
 *          on open "Paturo po tungkol sa X" requests.
 *   safety (safety-rows-v4.json, {seed,assistant})         — ungrounded yes/no: settled safety.
 *          Fixes the smoking/health negation (mixed polarity so it evaluates, not reflex-negates).
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v9plus-assemble.mts <out.jsonl>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../packages/shared/src/prompts/system.ts';

const OUT = process.argv[2] ?? 'finetuning/distill/v9plus-new.jsonl';
const SYSTEM = generateSystemPrompt('tagalog', 5);
const msg = (role: string, content: string) => ({ role, content });

// Bank index: id -> {tl, topic} (for grounding the teach rows).
const byId = new Map<string, { tl: string; topic: string }>();
for (const l of readFileSync('rag/bank/science-facts.jsonl', 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const f = JSON.parse(l);
  byId.set(f.id, { tl: f.fact?.tl ?? f.fact?.en ?? '', topic: f.topic ?? '' });
}

const out: any[] = [];
let missing = 0;

// teach (grounded)
for (const l of readFileSync('/tmp/teach-all.jsonl', 'utf8').split('\n')) {
  if (!l.trim()) continue;
  const r = JSON.parse(l);
  const f = byId.get(r.id);
  if (!f || !f.tl) { missing++; continue; }
  const block = formatGroundingBlock([{ content: f.tl, source: r.id, score: 1, metadata: { topic: f.topic } }]);
  out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn(block, r.user)), msg('assistant', r.assistant)] });
}

// safety (ungrounded)
for (const r of JSON.parse(readFileSync('finetuning/distill/safety-rows-v4.json', 'utf8'))) {
  out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn('', r.seed)), msg('assistant', r.assistant)] });
}

writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`wrote ${OUT}: ${out.length} rows (teach grounded + safety ungrounded); ${missing} teach rows skipped (fact id not in bank)`);
