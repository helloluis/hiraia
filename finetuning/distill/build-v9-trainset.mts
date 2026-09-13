/** v9 trainset = v7 trainset (contracted prompt) + new v9 pedagogy+ballast rows. Simple concat. */
import { readFileSync, writeFileSync } from 'node:fs';
const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
const v7 = lines('finetuning/distill/train-distill-v7.jsonl');
const v9 = lines('finetuning/distill/v9-new.jsonl');
writeFileSync('finetuning/distill/train-distill-v9.jsonl', [...v7, ...v9].join('\n') + '\n');
console.log(`v9 trainset: v7 ${v7.length} + v9 ${v9.length} = ${v7.length + v9.length}`);
