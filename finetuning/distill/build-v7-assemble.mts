/**
 * Assemble v7 safety/myth-debunk turns → ChatML (CONTRACTED prompt; grounding in user turn).
 *   confident_safety / myth_debunk — [sys, grounded(on-topic fact)(yes/no-Q), correct-polarity answer]
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v7-assemble.mts <rows.json> <out.jsonl>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../packages/shared/src/prompts/system.ts';

const ROWS = process.argv[2] ?? 'finetuning/distill/v7-rows-final.json';
const OUT = process.argv[3] ?? 'finetuning/distill/v7-new.jsonl';
const WORK = 'finetuning/distill/work-v7';
const LANG = 'tagalog' as const;

const itemById = new Map<string, any>();
for (const sub of ['confident_safety', 'myth_debunk']) {
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
for (const r of rows) {
  if (!r.seed || !r.assistant) { skipped[r.type] = (skipped[r.type] || 0) + 1; continue; }
  out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn(grounding(r.fact_id), r.seed)), msg('assistant', r.assistant)] });
}
writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
const byType: Record<string, number> = {};
for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
console.log(`assembled ${out.length} v7 rows -> ${OUT}`);
console.log('input rows by type:', byType, '| skipped:', skipped);
