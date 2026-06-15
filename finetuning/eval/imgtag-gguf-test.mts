/**
 * imgtag-gguf-test.mts — measure [image:] emission of a GGUF adapter on the SAME held-out
 * prompts where v3 HF emitted 90% (out_correct condition), to isolate the GGUF-evaporation cause.
 * Boot llama-server with the adapter under test first, then point ENDPOINT here.
 */
import { readFileSync } from 'node:fs';
const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8092';
const HELD = JSON.parse(readFileSync('finetuning/distill/eval/heldout-v2.json', 'utf8')) as any[];
const HAS = /\[image:[^\]]*\]/i;
async function ask(system: string, user: string): Promise<string> {
  const r = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.5, max_tokens: 400, stream: false }),
  });
  const j: any = await r.json();
  return j.choices?.[0]?.message?.content ?? '';
}
(async () => {
  let hit = 0;
  for (const row of HELD) {
    const out = await ask(row.system, row.user_correct);
    if (HAS.test(out)) hit++;
  }
  console.log(`[${process.env.TESTTAG ?? 'gguf'}] out_correct emission: ${hit}/${HELD.length} (${Math.round((100 * hit) / HELD.length)}%)   (v3 HF reference: 90%)`);
})();
