// Compaction probe — part of the formal behavioral gate.
//
// The mobile auto-compacter calls LocalEngine.summarize() with the GROUNDED
// adapter. That adapter was fine-tuned to DEFER/ABSTAIN on science prompts that
// lack a grounding block — so there's a real risk it abstains on a summarization
// instruction (an unseen task type) instead of actually summarizing, which would
// silently poison the compacted memory fed back into context.
//
// This probe replicates summarize() EXACTLY: a single user-role instruction with
// NO system prompt (matching LocalEngine.summarize), against representative tutor
// answers, and asserts the model returns a real, shorter, non-abstaining summary
// that retains a key term. Keep INSTRUCTION in sync with LocalEngine.summarize().
//
//   ENDPOINT=http://localhost:8088 node_modules/.bin/tsx probe-compaction.mts

const ENDPOINT = process.env.ENDPOINT ?? 'http://localhost:8088';

// MUST match LocalEngine.summarize()'s instruction prefix verbatim.
const INSTRUCTION =
  'Ibuod ang sumusunod na sagot ng science tutor sa ISA o DALAWANG napakaikling pangungusap, ' +
  'para magamit bilang maikling alaala (memory) sa susunod na usapan. Panatilihin LANG ang ' +
  'mahalagang science fact at termino. Alisin ang pagbati, mga halimbawa, at ang tanong sa dulo. ' +
  'Sumagot ng buod lamang, walang ibang sasabihin.\n\nSAGOT:\n';

// Representative long tutor answers: greeting + fact + example + image tag + trailing
// question — i.e. the exact shape the compacter is asked to shrink on-device.
const SAMPLES = [
  {
    id: 'photosynthesis',
    keyTerm: /photosynthesis|liwanag|enerhiya|halaman/i,
    answer:
      'Kumusta! Magandang tanong iyan. Ang photosynthesis ay ang proseso kung saan ginagamit ng ' +
      'mga halaman ang liwanag ng araw, tubig, at carbon dioxide para gumawa ng pagkain (glucose) ' +
      'at oxygen. Halimbawa, tulad ng pagluluto sa kusina, ang dahon ang "kusina" ng halaman na ' +
      'gumagamit ng sikat ng araw. [image: dahon na may sikat ng araw] Naiintindihan mo ba kung ' +
      'bakit mahalaga ang araw sa mga halaman?',
  },
  {
    id: 'water-cycle',
    keyTerm: /tubig|ulan|singaw|evaporation|water cycle|ikot/i,
    answer:
      'Magandang tanong! Ang water cycle o ikot ng tubig ay ang paulit-ulit na paggalaw ng tubig. ' +
      'Una, ang init ng araw ay nagpapasingaw sa tubig sa dagat (evaporation). Pagkatapos, ang ' +
      'singaw ay tumataas at nagiging ulap (condensation). Sa huli, bumabagsak ito bilang ulan ' +
      '(precipitation). Halimbawa, ang ulan na nakikita mo ay galing sa tubig-dagat na sumingaw. ' +
      '[image: ikot ng tubig] May tanong ka pa ba tungkol dito?',
  },
  {
    id: 'gravity',
    keyTerm: /gravity|grabidad|hila|bigat|nahuhulog|lupa/i,
    answer:
      'Kumusta! Ang gravity o grabidad ay ang puwersa na humihila sa lahat ng bagay papunta sa ' +
      'lupa. Ito ang dahilan kung bakit nahuhulog ang isang mansanas mula sa puno pababa, hindi ' +
      'pataas. Lahat ng bagay na may bigat ay hinihila ng grabidad ng Earth. Halimbawa, kapag ' +
      'tumalon ka, bumabalik ka sa lupa dahil sa grabidad. Gusto mo bang malaman kung bakit ' +
      'lumulutang ang mga astronaut?',
  },
];

const ABSTAIN = /(wala\s+akong|hindi\s+ko\s+(alam|mat'?yak|tiyak|masagot)|paumanhin|wala\s+sa\s+aking|hindi\s+ko\s+po|walang\s+sapat)/i;

async function ask(content: string): Promise<string> {
  // EXACTLY mirrors LocalEngine.summarize(): single user turn, no system prompt.
  const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      temperature: 0, max_tokens: 160, stream: false,
      lora: [{ id: 0, scale: 1.0 }],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`server error: ${JSON.stringify(data.error).slice(0, 200)}`);
  return (data.choices?.[0]?.message?.content ?? '').trim();
}

let pass = 0;
const failures: string[] = [];

for (const s of SAMPLES) {
  const fails: string[] = [];
  let summary = '';
  try {
    summary = await ask(INSTRUCTION + s.answer);
  } catch (e: any) {
    fails.push(`request error: ${e.message}`);
  }

  if (!summary) fails.push('empty summary');
  if (ABSTAIN.test(summary)) fails.push(`abstained instead of summarizing: "${summary.slice(0, 80)}"`);
  // Must actually compress (the app only stores it if < 0.9x; assert real shrink).
  if (summary && summary.length >= s.answer.length * 0.9)
    fails.push(`not compressed (${summary.length} vs ${s.answer.length} chars)`);
  // Must retain the science substance, not generic filler.
  if (summary && !s.keyTerm.test(summary)) fails.push(`lost key term (${s.keyTerm})`);
  // Compaction should drop the trailing question and greetings.
  if (/kumusta|magandang tanong/i.test(summary)) fails.push('kept greeting');

  const ok = fails.length === 0;
  if (ok) pass++; else failures.push(s.id);
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  compaction:${s.id}`);
  console.log(`   summary (${summary.length}c): ${summary.replace(/\n+/g, ' ').slice(0, 160)}`);
  if (!ok) fails.forEach((f) => console.log(`   ↳ ${f}`));
}

console.log(`\n===== compaction probe: ${pass}/${SAMPLES.length} passed =====`);
if (failures.length) {
  console.log(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('COMPACTION OK — summarize() produces usable memory, no abstention.');
