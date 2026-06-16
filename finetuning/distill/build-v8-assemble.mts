/**
 * Assemble v8 pedagogy/ELI5 turns → ChatML (CONTRACTED prompt; grounding in the user turn).
 *   pedagogy_eli5 — [sys, grounded(fact)(question), ELI5-engaging answer]
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v8-assemble.mts <rows.json> <out.jsonl>
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../packages/shared/src/prompts/system.ts';

const ROWS = process.argv[2] ?? 'finetuning/distill/v8-rows-final.json';
const OUT = process.argv[3] ?? 'finetuning/distill/v8-new.jsonl';
const WORK = 'finetuning/distill/work-v8';
const LANG = 'tagalog' as const;

const itemById = new Map<string, any>();
for (const f of readdirSync(join(WORK, 'pedagogy_eli5'))) {
  if (!f.endsWith('.json')) continue;
  for (const it of JSON.parse(readFileSync(join(WORK, 'pedagogy_eli5', f), 'utf8'))) itemById.set(it.id, it);
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
let skipped = 0;
for (const r of rows) {
  if (!r.user || !r.assistant) { skipped++; continue; }
  out.push({ messages: [msg('system', SYSTEM), msg('user', composeGroundedUserTurn(grounding(r.fact_id), r.user)), msg('assistant', r.assistant)] });
}
writeFileSync(OUT, out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`assembled ${out.length} v8 rows -> ${OUT} (${skipped} skipped)`);
