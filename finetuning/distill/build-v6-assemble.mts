/**
 * Assemble v6 targeted-patch turns → ChatML, same shape as v5 (CONTRACTED system prompt; grounding
 * in the user turn). v6 row-types:
 *   abstain_adjacent   — [sys, grounded(on-topic fact)(superlative-Q), abstain-no-confab]
 *   refuse_multiturn   — [sys, grounded(Q1), A1, off-domain/insult Q2 (bare), handled-A2]
 *   offscope_help_firm — [sys, arithmetic-Q (no grounding), answer + redirect]
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v6-assemble.mts <rows.json> <out.jsonl>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../packages/shared/src/prompts/system.ts';

const ROWS = process.argv[2] ?? 'finetuning/distill/v6-rows-final.json';
const OUT = process.argv[3] ?? 'finetuning/distill/v6-new.jsonl';
const WORK = 'finetuning/distill/work-v6';
const LANG = 'tagalog' as const;

const itemById = new Map<string, any>();
for (const sub of ['abstain_adjacent', 'refuse_multiturn', 'offscope_help_firm']) {
  for (const f of readdirSync(join(WORK, sub))) {
    if (!f.endsWith('.json')) continue;
    for (const it of JSON.parse(readFileSync(join(WORK, sub, f), 'utf8'))) itemById.set(it.id, it);
  }
}

const SYSTEM = generateSystemPrompt(LANG, 5);
const grounding = (factId: string) => {
  const f = itemById.get(factId);
  if (!f || !(f.tl || f.en)) return '';
  return formatGroundingBlock([{ content: f.tl || f.en, source: f.id, score: 1, metadata: { topic: f.topic } }]);
};
const msg = (role: string, content: string) => ({ role, content });

const rows = JSON.parse(readFileSync(ROWS, 'utf8'));
const out: any[] = [];
const skipped: Record<string, number> = {};
const skip = (t: string) => { skipped[t] = (skipped[t] || 0) + 1; };

for (const r of rows) {
  if (r.type === 'abstain_adjacent') {
    if (!r.seed || !r.assistant) { skip(r.type); continue; }
    out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn(grounding(r.fact_id), r.seed)), msg('assistant', r.assistant)] });

  } else if (r.type === 'refuse_multiturn') {
    if (!r.seed || !r.turn1_user || !r.turn1_assistant || !r.turn2_assistant) { skip(r.type); continue; }
    out.push({ messages: [
      msg('system', SYSTEM),
      msg('user', composeGroundedUserTurn(grounding(r.fact_id), r.turn1_user)), // turn 1: grounded science
      msg('assistant', r.turn1_assistant),
      msg('user', r.seed),                 // turn 2: off-domain/insult, bare (the kid's break)
      msg('assistant', r.turn2_assistant), // handled freshly, no repeat
    ] });

  } else if (r.type === 'offscope_help_firm') {
    if (!r.seed || !r.assistant) { skip(r.type); continue; }
    out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn('', r.seed)), msg('assistant', r.assistant)] });
  }
}

writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const byType: Record<string, number> = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
console.log(`assembled ${out.length} v6 rows -> ${OUT}`);
console.log('input rows by type:', byType);
console.log('skipped (missing fields):', skipped);
