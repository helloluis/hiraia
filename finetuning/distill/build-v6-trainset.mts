/**
 * v6 trainset = the v5 trainset (already on the CONTRACTED prompt) + the new v6 targeted-patch rows.
 * No system swap needed — train-distill-v5.jsonl is already contracted. Simple concat.
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v6-trainset.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';

const V5 = 'finetuning/distill/train-distill-v5.jsonl';
const V6NEW = 'finetuning/distill/v6-new.jsonl';
const OUT = 'finetuning/distill/train-distill-v6.jsonl';

const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
const v5 = lines(V5);
const v6 = lines(V6NEW);
writeFileSync(OUT, [...v5, ...v6].join('\n') + '\n');
console.log(`v6 trainset -> ${OUT}`);
console.log(`  v5 base: ${v5.length}`);
console.log(`  v6 new:  ${v6.length}`);
console.log(`  total:   ${v5.length + v6.length}`);
