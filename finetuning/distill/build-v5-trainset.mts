/**
 * Build the v5 training set: the new v5 rows (already on the CONTRACTED prompt) + the reused v4 base,
 * with every reused row's SYSTEM message rewritten to the contracted prompt so the whole set trains
 * the adapter UNDER the prompt the app now ships (train/serve parity — see hiraia-v5-lora-plan).
 *
 * v4 rows kept their grounding in the USER turn already (build-v4-assemble used composeGroundedUserTurn),
 * so only messages[0] (system) needs swapping. Language is detected from the old system text; grade is
 * pinned to 5 (the project default). Output: train-distill-v5.jsonl  (v4-rewritten, then v5-new).
 *
 * Usage: node_modules/.bin/tsx finetuning/distill/build-v5-trainset.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generateSystemPrompt } from '../../packages/shared/src/prompts/system.ts';
import type { Language } from '../../packages/shared/src/types/index.js';

const V4 = 'finetuning/distill/train-distill-v4.jsonl';
const V5NEW = 'finetuning/distill/v5-new.jsonl';
const OUT = 'finetuning/distill/train-distill-v5.jsonl';

const PROMPTS: Record<Language, string> = {
  tagalog: generateSystemPrompt('tagalog', 5),
  english: generateSystemPrompt('english', 5),
  cebuano: generateSystemPrompt('cebuano', 5),
};
const detectLang = (oldSys: string): Language =>
  /Respond in English/i.test(oldSys) ? 'english'
  : /Cebuano|Bisaya/i.test(oldSys) ? 'cebuano'
  : 'tagalog';

const lines = (p: string) => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim());

let swapped = 0;
const byLang: Record<string, number> = {};
const v4 = lines(V4).map((l) => {
  const row = JSON.parse(l);
  const sys = row.messages?.[0];
  if (sys?.role === 'system') {
    const lang = detectLang(sys.content);
    byLang[lang] = (byLang[lang] || 0) + 1;
    if (sys.content !== PROMPTS[lang]) { sys.content = PROMPTS[lang]; swapped++; }
  }
  return JSON.stringify(row);
});

const v5 = lines(V5NEW); // already contracted (from build-v5-assemble)
writeFileSync(OUT, [...v4, ...v5].join('\n') + '\n');
console.log(`v5 trainset -> ${OUT}`);
console.log(`  v4 reused: ${v4.length} (system swapped to contracted: ${swapped}) lang split:`, byLang);
console.log(`  v5 new:    ${v5.length}`);
console.log(`  total:     ${v4.length + v5.length}`);
