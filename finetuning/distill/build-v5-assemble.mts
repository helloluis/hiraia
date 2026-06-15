/**
 * Assemble v5 generated turns → ChatML training rows, matching v3/v4 EXACTLY so the adapter sees
 * the same shape at train time as the device serves at inference:
 *   system  = generateSystemPrompt('tagalog', 5)   — the NEW CONTRACTED prompt (train/serve parity!)
 *   user    = composeGroundedUserTurn(grounding, question)   (grounding in the USER turn, KV-cache safe)
 *   assistant = the generated reply
 *
 * v5 bakes the prompt-fragile behaviors into the weights (see hiraia-v5-lora-plan):
 *   chitchat      — [sys, grounded(greeting), reply-that-IGNORES-the-fact]
 *   abstain       — [sys, grounded(unknowable-Q), clean-abstain-no-confabulation]
 *   confident     — [sys, grounded(Q), confident-grounded-answer]   (contrast: don't over-abstain)
 *   refuse        — [sys, grounded(out-of-scope-ask), polite-decline + redirect-to-science]
 *   offscope_help — [sys, NON-science-schoolwork-Q (no grounding), brief-help + science redirect]
 *
 * The chitchat/refuse/abstain user turns carry a DISTRACTOR fact as grounding (as on-device, where
 * retrieval still fires) so the model learns to ignore/decline rather than lecture it. offscope_help
 * has no grounding (non-science → nothing retrieved).
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v5-assemble.mts <rows.json> <out.jsonl>
 *   rows.json = merged v5 rows (chitchat+confident recovered + abstain/refuse/offscope_help regen).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../packages/shared/src/prompts/system.ts';

const ROWS = process.argv[2] ?? 'finetuning/distill/v5-rows-final.json';
const OUT = process.argv[3] ?? 'finetuning/distill/v5-new.jsonl';
const WORK = 'finetuning/distill/work-v5';
const LANG = 'tagalog' as const; // v5 new rows are Tagalog (the adapter slot)

// fact_id -> worklist item (carries the chitchat opener / seed + the distractor fact's en/tl/topic)
const itemById = new Map<string, any>();
for (const sub of ['chitchat', 'abstain', 'confident', 'refuse', 'offscope_help']) {
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
  const a = r.assistant;
  if (!a) { skip(r.type); continue; }

  if (r.type === 'chitchat') {
    // user turn = the kid's greeting (from the shard, keyed by fact_id); grounding = the distractor fact.
    const item = itemById.get(r.fact_id);
    const question = item?.chitchat ?? (typeof r.fact_id === 'string' && /[a-z]/.test(r.fact_id) && r.fact_id.includes(' ') ? r.fact_id : 'Hello po!');
    out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn(grounding(r.fact_id), question)), msg('assistant', a)] });

  } else if (r.type === 'abstain' || r.type === 'refuse') {
    // user turn = the echoed seed; grounding = the distractor fact (present but irrelevant).
    if (!r.seed) { skip(r.type); continue; }
    out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn(grounding(r.fact_id), r.seed)), msg('assistant', a)] });

  } else if (r.type === 'confident') {
    // user turn = the generated question; grounding = the SOURCE fact.
    if (!r.user) { skip(r.type); continue; }
    out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn(grounding(r.fact_id), r.user)), msg('assistant', a)] });

  } else if (r.type === 'offscope_help') {
    // user turn = the echoed non-science seed; NO grounding (nothing retrieved for off-domain schoolwork).
    if (!r.seed) { skip(r.type); continue; }
    out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn('', r.seed)), msg('assistant', a)] });
  }
}

writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const byType: Record<string, number> = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
console.log(`assembled ${out.length} v5 rows -> ${OUT}`);
console.log('input rows by type:', byType);
console.log('skipped (missing fields):', skipped);
