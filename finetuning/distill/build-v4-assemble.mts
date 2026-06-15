/**
 * Assemble v4 generated turns → ChatML training rows, matching the v3 format exactly:
 *   system  = generateSystemPrompt(lang, 5, imageTags=true)   (STATIC; KV-cache friendly)
 *   user    = composeGroundedUserTurn(grounding, question)    (grounding in the USER turn)
 *   assistant = the generated <think>+answer
 *
 * Row-types:
 *   multiturn — [sys, grounded(Q1), A1, Q2(bare), A2]   (turn 1 grounded; follow-up bare)
 *   faithful  — [sys, Q (NO grounding), A]              (settled science answered w/o grounding)
 *   engage    — [sys, grounded(Q), A]                   (A ends with an [image:] tag)
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v4-assemble.mts <rows.json> <out.jsonl>
 *   rows.json = the gen workflow's result.rows array.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../packages/shared/src/prompts/system.ts';

const ROWS = process.argv[2];
const OUT = process.argv[3] ?? 'finetuning/distill/v4-new.jsonl';
const WORK = 'finetuning/distill/work-v4';
const LANG = 'tagalog' as const; // v4 new rows are Tagalog (the adapter slot)

// fact_id -> fact (from the worklist shards)
const factById = new Map<string, any>();
for (const sub of ['multiturn', 'faithful', 'engage']) {
  for (const f of readdirSync(join(WORK, sub))) {
    if (!f.endsWith('.json')) continue;
    for (const it of JSON.parse(readFileSync(join(WORK, sub, f), 'utf8'))) factById.set(it.id, it);
  }
}

const SYSTEM = generateSystemPrompt(LANG, 5, true);
const grounding = (factId: string) => {
  const f = factById.get(factId);
  if (!f) return '';
  return formatGroundingBlock([{ content: f.tl || f.en, source: f.id, score: 1, metadata: { topic: f.topic } }]);
};
const msg = (role: string, content: string) => ({ role, content });

const rows = JSON.parse(readFileSync(ROWS, 'utf8'));
const out: any[] = [];
let skipped = 0;
for (const r of rows) {
  const g = grounding(r.fact_id);
  if (r.type === 'multiturn') {
    if (!r.turn1_user || !r.turn1_assistant || !r.turn2_user || !r.turn2_assistant) { skipped++; continue; }
    out.push({ messages: [
      msg('system', SYSTEM),
      msg('user', composeGroundedUserTurn(g, r.turn1_user)),
      msg('assistant', r.turn1_assistant),
      msg('user', r.turn2_user),              // bare follow-up (no grounding)
      msg('assistant', r.turn2_assistant),
    ] });
  } else if (r.type === 'faithful') {
    if (!r.user || !r.assistant) { skipped++; continue; }
    out.push({ messages: [
      msg('system', SYSTEM),
      msg('user', composeGroundedUserTurn('', r.user)), // NO grounding — settled science from the model
      msg('assistant', r.assistant),
    ] });
  } else if (r.type === 'engage') {
    if (!r.user || !r.assistant) { skipped++; continue; }
    out.push({ messages: [
      msg('system', SYSTEM),
      msg('user', composeGroundedUserTurn(g, r.user)),
      msg('assistant', r.assistant),
    ] });
  }
}
writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`assembled ${out.length} v4 rows (${skipped} skipped for missing fields) -> ${OUT}`);
const byType: Record<string, number> = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
console.log('input rows by type:', byType);
