/**
 * v7 trainset = v6 trainset (contracted prompt) + the new v7 safety/myth-debunk rows. Simple concat.
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v7-trainset.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';

const V6 = 'finetuning/distill/train-distill-v6.jsonl';
const V7NEW = 'finetuning/distill/v7-new.jsonl';
const OUT = 'finetuning/distill/train-distill-v7.jsonl';

const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
const v6 = lines(V6);
const v7 = lines(V7NEW);
writeFileSync(OUT, [...v6, ...v7].join('\n') + '\n');
console.log(`v7 trainset -> ${OUT}`);
console.log(`  v6 base: ${v6.length}`);
console.log(`  v7 new:  ${v7.length}`);
console.log(`  total:   ${v6.length + v7.length}`);
