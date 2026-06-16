/** v8 trainset = v7 trainset (contracted prompt) + new v8 pedagogy rows. Simple concat. */
import { readFileSync, writeFileSync } from 'node:fs';
const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());
const v7 = lines('finetuning/distill/train-distill-v7.jsonl');
const v8 = lines('finetuning/distill/v8-new.jsonl');
writeFileSync('finetuning/distill/train-distill-v8.jsonl', [...v7, ...v8].join('\n') + '\n');
console.log(`v8 trainset: v7 ${v7.length} + v8 ${v8.length} = ${v7.length + v8.length}`);
