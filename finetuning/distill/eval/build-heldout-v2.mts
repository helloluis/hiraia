/**
 * Build the v2 held-out eval set in PRODUCTION format. For each held-out fact (not in
 * v2 training) we build two prompts that differ only in the grounding block:
 *  - user_correct:    VERIFIED FACTS = the right fact   → expect grounded answer
 *  - user_distractor: VERIFIED FACTS = a WRONG off-topic fact → expect: ignore it, answer real topic
 * Also a no-fact variant (empty grounding). System prompt is the real static one.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { generateSystemPrompt, formatGroundingBlock, composeGroundedUserTurn } from '../../../packages/shared/src/prompts/system.ts';

type Fact = { id: string; domain: string; topic: string; fact: { tl: string; en: string; bis: string } };
const bank: Fact[] = [];
for (const l of readFileSync('rag/bank/science-facts.jsonl', 'utf8').split('\n')) { if (l.trim()) bank.push(JSON.parse(l)); }
const byId = new Map(bank.map((f) => [f.id, f]));

// exclude every fact that v2 trained on
const excl = new Set<string>();
for (const l of readFileSync('finetuning/distill/dataset-v1.jsonl', 'utf8').split('\n')) { if (l.trim()) excl.add(JSON.parse(l).fact_id); }
for (const sf of readdirSync('finetuning/distill/work-v2/safe').filter((f) => f.endsWith('.json'))) {
  for (const it of JSON.parse(readFileSync(`finetuning/distill/work-v2/safe/${sf}`, 'utf8'))) { excl.add(it.right.id); if (it.wrong) excl.add(it.wrong.id); }
}
for (const l of readFileSync('finetuning/distill/work-v2/sensitive.json', 'utf8') ? [readFileSync('finetuning/distill/work-v2/sensitive.json','utf8')] : []) {
  for (const it of JSON.parse(l)) { excl.add(it.right.id); if (it.wrong) excl.add(it.wrong.id); }
}

const SENS = /\b(dugo|tiyan|buto|puso|baga|lason|sakit|blood|heart|lungs|brain|utak|liver|disease|fever)\b/i;
// deterministic shuffle (seeded LCG) so no Math.random
let seed = 4242; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const safe = bank.filter((f) => !excl.has(f.id) && !SENS.test((f.fact.en + f.fact.tl + f.topic).toLowerCase()));
for (let i = safe.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [safe[i], safe[j]] = [safe[j], safe[i]]; }
const held = safe.slice(0, 30);

const FR = ['may homework po ako tungkol sa {t}, pakitulungan naman', 'pa-essay naman about {t} for my project bukas',
  'teacher may report po kami tungkol sa {t}', 'assignment ko po e tung_kol sa {t}, ano ba ito'];
const sys = generateSystemPrompt('tagalog', 5, true);
const rows = held.map((f, i) => {
  const q = FR[i % FR.length].replace('{t}', f.topic);
  // wrong fact: random off-domain
  const pool = bank.filter((g) => g.domain !== f.domain);
  const wrong = pool[Math.floor(rnd() * pool.length)];
  const gCorrect = formatGroundingBlock([{ content: f.fact.tl, metadata: { topic: f.topic } } as any]);
  const gWrong = formatGroundingBlock([{ content: wrong.fact.tl, metadata: { topic: wrong.topic } } as any]);
  return {
    id: f.id, topic: f.topic, en: f.fact.en, tl: f.fact.tl, framed_q: q,
    wrong_topic: wrong.topic, system: sys,
    user_correct: composeGroundedUserTurn(gCorrect, q),
    user_distractor: composeGroundedUserTurn(gWrong, q),
    user_nofact: composeGroundedUserTurn('', q),
  };
});
writeFileSync('finetuning/distill/eval/heldout-v2.json', JSON.stringify(rows));
console.log(`held-out v2 eval: ${rows.length} facts (excluded ${excl.size} trained); 3 conditions each (correct/distractor/nofact)`);
console.log('sample framed_q:', rows[0].framed_q, '| wrong fact topic:', rows[0].wrong_topic);
