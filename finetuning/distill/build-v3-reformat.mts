/**
 * Reformat v1 intent examples (correct-fact) into the EXACT production grounded-turn
 * format, using the real shared prompt builders so train==serve. Output: messages rows
 * [system (static persona+grade5+imagetags), user (VERIFIED FACTS block + framed Q),
 * assistant (<think> + grounded answer)].
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  generateSystemPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from '../../packages/shared/src/prompts/system.ts';

type V1 = { fact_id: string; lang: 'tl' | 'en'; framing: string; question: string; think: string; answer: string };
type Fact = { id: string; topic: string; fact: { tl: string; en: string; bis: string } };

const bank = new Map<string, Fact>();
for (const line of readFileSync('rag/bank/science-facts.jsonl', 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const f = JSON.parse(line) as Fact;
  bank.set(f.id, f);
}

const langName = { tl: 'tagalog', en: 'english' } as const;
const out: string[] = [];
let missing = 0;
for (const line of readFileSync('finetuning/distill/dataset-v3-correct.jsonl', 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as V1;
  const f = bank.get(r.fact_id);
  if (!f) { missing++; continue; }
  const factText = r.lang === 'tl' ? f.fact.tl : f.fact.en;
  const system = generateSystemPrompt(langName[r.lang], 5, true); // imageTags=true, matches shipped
  const grounding = formatGroundingBlock([{ content: factText, metadata: { topic: f.topic } } as any]);
  const user = composeGroundedUserTurn(grounding, r.question);
  const assistant = `<think>\n${r.think.trim()}\n</think>\n\n${r.answer.trim()}`;
  out.push(JSON.stringify({ messages: [
    { role: 'system', content: system },
    { role: 'user', content: user },
    { role: 'assistant', content: assistant },
  ] }));
}
writeFileSync('finetuning/distill/v3-correct.jsonl', out.join('\n') + '\n');
console.log(`reformatted v3 ${out.length} correct-fact rows (missing facts: ${missing}) -> v3-correct.jsonl`);
