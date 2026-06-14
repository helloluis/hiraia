/**
 * Assemble v2 distractor + no-fact rows into production grounded-turn format.
 * - distractor: grounding block contains the WRONG (mismatched) fact; assistant <think>
 *   notices the mismatch and answers the real topic anyway.
 * - nofact: empty grounding block (just the framed question); assistant answers from
 *   general knowledge with appropriate humility.
 * Safe rows: join shard files (kind/lang/right/wrong) with agent output by index.
 * Sensitive rows: self-contained, rejoin facts via the bank.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../packages/shared/src/prompts/system.ts';

type Fact = { id: string; topic: string; fact: { tl: string; en: string; bis: string } };
const bank = new Map<string, Fact>();
for (const l of readFileSync('rag/bank/science-facts.jsonl', 'utf8').split('\n')) { if (l.trim()) { const f = JSON.parse(l); bank.set(f.id, f); } }
const langName = { tl: 'tagalog', en: 'english' } as const;
const WORK = 'finetuning/distill/work-v2';
const out: string[] = [];
let nDist = 0, nNo = 0;

function emit(kind: string, lang: 'tl' | 'en', rightId: string, wrongId: string | null | undefined, question: string, think: string, answer: string) {
  const system = generateSystemPrompt(langName[lang], 5, true);
  let grounding = '';
  if (kind === 'distractor') {
    const w = bank.get(wrongId!); if (!w) return;
    const wText = lang === 'tl' ? w.fact.tl : w.fact.en;
    grounding = formatGroundingBlock([{ content: wText, metadata: { topic: w.topic } } as any]);
    nDist++;
  } else { nNo++; }
  const user = composeGroundedUserTurn(grounding, question);
  const assistant = `<think>\n${think.trim()}\n</think>\n\n${answer.trim()}`;
  out.push(JSON.stringify({ messages: [
    { role: 'system', content: system }, { role: 'user', content: user }, { role: 'assistant', content: assistant },
  ] }));
}

// SAFE: join shard items with agent output by index
for (const shardFile of readdirSync(`${WORK}/safe`).filter((f) => f.endsWith('.json')).sort()) {
  const n = shardFile.match(/shard-(\d+)\.json/)![1];
  const items = JSON.parse(readFileSync(`${WORK}/safe/${shardFile}`, 'utf8'));
  const outPath = `${WORK}/out/v2-safe-${n}.jsonl`;
  if (!existsSync(outPath)) { console.warn(`missing gen output for shard ${n}`); continue; }
  const gen = new Map<number, any>();
  for (const l of readFileSync(outPath, 'utf8').split('\n')) { if (l.trim()) { const g = JSON.parse(l); gen.set(g.i, g); } }
  items.forEach((it: any, i: number) => {
    const g = gen.get(i); if (!g || !g.question || !g.answer) return;
    emit(it.kind, it.lang, it.right.id, it.wrong?.id, g.question, g.think || '', g.answer);
  });
}

// SENSITIVE: self-contained rows
const sensPath = `${WORK}/out/v2-sensitive.jsonl`;
if (existsSync(sensPath)) {
  for (const l of readFileSync(sensPath, 'utf8').split('\n')) {
    if (!l.trim()) continue; const r = JSON.parse(l);
    emit(r.kind, r.lang, r.right_id, r.wrong_id, r.question, r.think || '', r.answer);
  }
}

writeFileSync('finetuning/distill/v2-distractor-nofact.jsonl', out.join('\n') + '\n');
console.log(`assembled ${out.length} rows: ${nDist} distractor + ${nNo} nofact -> v2-distractor-nofact.jsonl`);
