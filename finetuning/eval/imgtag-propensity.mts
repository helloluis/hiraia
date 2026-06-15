/**
 * imgtag-propensity.mts — measure how often the SHIPPED adapter emits an [image:] tag on
 * image-OPPORTUNITY prompts vs RESTRAINT prompts, under the CURRENT vs a STRONGER
 * IMAGE_TAG_INSTRUCTION wording. Tests whether the cheap serve-time lever (prompt wording)
 * can lift the ~2% emission the capability run measured, WITHOUT a retrain.
 *
 * Boot the adapter first (separate terminal), then run this against it:
 *   /opt/homebrew/bin/llama-server -m deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf \
 *     --lora packages/mobile/assets/models/adapter-tagalog.gguf -ngl 99 --port 8091 -c 2048
 *   ENDPOINT=http://localhost:8091 node_modules/.bin/tsx finetuning/eval/imgtag-propensity.mts
 *
 * No grounding here on purpose — this isolates the INSTRUCTION's effect on emission propensity
 * (grounding is orthogonal to the image decision). Samples N per prompt at the device temp.
 */
import { generateSystemPrompt } from '../../packages/shared/src/prompts/system.ts';

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8091';
const TEMP = Number(process.env.TEMP ?? '0.5');
const SAMPLES = Number(process.env.SAMPLES ?? '3');
const HAS_TAG = /\[image:[^\]]*\]/i;

// Current production wording (matches IMAGE_TAG_INSTRUCTION.tagalog in prompts/system.ts).
const CURRENT = `
MGA LARAWAN: Kapag makakatulong ang isang simpleng larawan sa pagpapaliwanag, magdagdag ng huling linyang: [image: maikli at tiyak na paglalarawan sa Ingles ng larawan]. Kung walang angkop na larawan, huwag maglagay ng ganitong linya. At kung naipakita mo na ang isang larawan kani-kanina lang sa usapang ito, huwag mo na itong ulitin — magpakita lamang ng bago at angkop na larawan.`;

// Stronger draft: shift from "when it would help" to "for concrete science topics a picture
// usually helps → prefer to include one", keeping the SAME restraint (no greetings/thanks/abstract,
// no repeats) so we can check restraint didn't break.
const STRONG = `
MGA LARAWAN: Para sa mga konkretong paksa sa agham — gaya ng hayop, halaman, planeta, bahagi ng katawan, eksperimento, hugis, o bagay na nakikita — kadalasang nakakatulong ang isang larawan. Kaya kapag konkreto at puwedeng ilarawan ang paksa, magdagdag ng huling linyang: [image: maikli at tiyak na paglalarawan sa Ingles ng larawan]. Mas mabuting magbigay ng isang angkop na larawan kaysa wala. Ngunit HUWAG maglagay ng larawan para sa pagbati, pasasalamat, o puro abstraktong/matematikong tanong, at huwag ulitin ang larawang naipakita mo na sa usapang ito.`;

const OPPORTUNITY = [
  'Ano po ang mga bahagi ng isang bulaklak?',
  'Paano po umiikot ang mga planeta sa paligid ng Araw?',
  'Paano po gumagana ang isang bulkan?',
  'Ano po ang mga bahagi ng katawan ng isda?',
  'Paano po dumadaloy ang dugo sa ating katawan?',
  'Ano po ang water cycle o siklo ng tubig?',
  'Paano po nabubuo ang bahaghari?',
  'Ano po ang hitsura ng isang DNA?',
  'Ano po ang mga yugto ng buwan?',
  'Paano po gumagawa ng pagkain ang mga halaman?',
  'Paano po dumadaloy ang kuryente sa isang simpleng circuit?',
  'Ano po ang mga bahagi ng isang halaman?',
];
const RESTRAINT = [
  'Salamat po sa tulong, ang galing niyo magturo!',
  'Hello po, kumusta?',
  "Ano po ang ibig sabihin ng salitang 'enerhiya'?",
  'Magkano po ang 5 plus 3?',
];

async function ask(system: string, user: string): Promise<string> {
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: TEMP, max_tokens: 256, stream: false,
    }),
  });
  const j: any = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

async function emissionRate(instruction: string, prompts: string[]): Promise<{ hit: number; n: number; perPrompt: number[] }> {
  const base = generateSystemPrompt('tagalog', 5, false); // base+grade+lang, NO image instr
  const system = base + '\n' + instruction;
  let hit = 0, n = 0;
  const perPrompt: number[] = [];
  for (const p of prompts) {
    let ph = 0;
    for (let s = 0; s < SAMPLES; s++) {
      const out = await ask(system, p);
      if (HAS_TAG.test(out)) { ph++; hit++; }
      n++;
    }
    perPrompt.push(ph);
  }
  return { hit, n, perPrompt };
}

(async () => {
  for (const [name, instr] of [['CURRENT', CURRENT], ['STRONG', STRONG]] as const) {
    const opp = await emissionRate(instr, OPPORTUNITY);
    const res = await emissionRate(instr, RESTRAINT);
    console.log(`\n===== ${name} instruction (temp ${TEMP}, ${SAMPLES} samples/prompt) =====`);
    console.log(`  OPPORTUNITY emission: ${opp.hit}/${opp.n} (${((100 * opp.hit) / opp.n).toFixed(0)}%)  — higher is the goal`);
    console.log(`    per-prompt hits (/${SAMPLES}): [${opp.perPrompt.join(', ')}]`);
    console.log(`  RESTRAINT emission:   ${res.hit}/${res.n} (${((100 * res.hit) / res.n).toFixed(0)}%)  — should stay ~0 (no over-tagging)`);
    console.log(`    per-prompt hits (/${SAMPLES}): [${res.perPrompt.join(', ')}]`);
  }
})();
