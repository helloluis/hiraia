/**
 * bust-cache.mts — invalidate gen-cache entries the CURRENT build rules forbid.
 *
 * The stage caches (out/cache/<bucket>.gen.jsonl) are append-only and keyed by row id, so a
 * lint rule added AFTER an entry was cached never re-runs its writer: collection would only
 * drop the row, shrinking the bucket. This utility removes exactly the entries a NEW rule
 * rejects — the next reshape/generate run then REGENERATES them, and the writer's retry loop
 * gets the violation as feedback (the difference between losing 82 rows and fixing them).
 *
 * Rules applied (the deltas that motivated it):
 *   - META_FACT_RES     cards that talk about the FACT block ("Walang impormasyon sa mga FACTS")
 *   - PERSONA_CARD_RES  persona / invitation / hedge-teaching cards ("Ako si Hiraia…")
 *   - abstainDenyRes    abstain-kind cards naming a gate mustNotContain entity (Sirius)
 *
 * Safe to re-run (idempotent); prints ids and counts only, never card content (AUP).
 *
 *   node_modules/.bin/tsx finetuning/sft-v2/bust-cache.mts
 */
import { readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { CACHE, META_FACT_RES, PERSONA_CARD_RES, abstainDenyRes } from './lib.mts';

const FILES = ['core', 'thin', 'abstain', 'ceb', 'compress', 'en', 'safety'];

let totalBusted = 0;
for (const name of FILES) {
  const path = join(CACHE, `${name}.gen.jsonl`);
  if (!existsSync(path)) continue;
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const keep: string[] = [];
  const busted: string[] = [];
  for (const line of lines) {
    let row: any;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const card = String(row.card ?? '');
    let bad = '';
    if (card) {
      if (META_FACT_RES.some((re) => re.test(card))) bad = 'meta-facts';
      else if (PERSONA_CARD_RES.some((re) => re.test(card))) bad = 'persona-card';
      else if (name === 'abstain' && row.kind === 'abstain' && abstainDenyRes().some((re) => re.test(card)))
        bad = 'deny-entity';
    }
    if (bad) busted.push(`${row.id} (${bad})`);
    if (bad) totalBusted++;
    else keep.push(line);
  }
  if (busted.length) {
    renameSync(path, `${path}.pre-bust`);
    writeFileSync(path, keep.join('\n') + (keep.length ? '\n' : ''));
    console.log(`>> ${name}: busted ${busted.length}/${lines.length} entries`);
    for (const b of busted) console.log(`   - ${b}`);
  } else {
    console.log(`>> ${name}: clean (${lines.length} entries)`);
  }
}
console.log(`>> total busted: ${totalBusted}`);
