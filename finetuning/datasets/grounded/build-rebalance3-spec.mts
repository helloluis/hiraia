// Track-A v3 SFT-rebalance spec — recover the v2 wobble without losing the safety/myth gains.
// v2 (safety/myth-heavy) nudged synthesis (rust/greenhouse) and codeswitch (electricity/blackhole)
// down. v3 adds reinforcement for exactly those, plus more myth-debunk volume (incl. body/grooming
// myths so the stubborn shave-thicker pattern generalizes). DISJOINT from the benchmark probes.
//   run: node_modules/.bin/tsx finetuning/datasets/grounded/build-rebalance3-spec.mts
import { writeFileSync } from 'node:fs';
import { loadFactBank } from '../../../packages/shared/src/rag/bankFile.ts';
import { RagStore } from '../../../packages/shared/src/rag/RagStore.ts';

// The curated bank, read from its source of truth (rag/bank/science-facts.jsonl).
// It used to arrive as a generated 43.5 MB TypeScript array; the array is gone, the
// file it was transcribed from is not.
const SCIENCE_FACTS = loadFactBank();
const store = new RagStore(SCIENCE_FACTS);
const byId = new Map(SCIENCE_FACTS.map((f) => [f.id, f]));
const ALL = SCIENCE_FACTS.map((f) => f.id);
let _s = 4242; const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (n: number) => { const o: string[] = [], u = new Set<number>(); while (o.length < n && u.size < ALL.length) { const i = Math.floor(rnd() * ALL.length); if (!u.has(i)) { u.add(i); o.push(ALL[i]); } } return o; };
const real = (q: string) => store.retrieveForGrounding(q as any, 'tagalog' as any, 3).map((h: any) => h.fact.id);
const texts = (ids: string[]) => ids.map((id) => byId.get(id)?.fact.tl).filter(Boolean) as string[];

// SYNTHESIS-reinforce — combine 2-3 facts. [q, grade]
const SYNTH: [string, number][] = [
  ['Bakit namamatay ang mga isda kapag sobrang dami ng lumalagong algae sa lawa?', 7],
  ['Ano ang mangyayari sa mga halaman kung mawala ang lahat ng bubuyog at paru-paro?', 6],
  ['Bakit mas mainit sa siyudad kaysa sa probinsya kahit magkalapit lang sila?', 7],
  ['Bakit mas masagana ang ani kapag maraming bulate sa lupa?', 6],
  ['Ano ang mangyayari sa klima kung putulin ang lahat ng puno sa kagubatan?', 7],
  ['Paano nagiging kuryente ang tubig sa isang hydroelectric dam?', 7],
  ['Bakit nagkakasakit ang mga tao kapag marumi ang tubig na kanilang iniinom?', 6],
  ['Ano ang koneksyon ng init ng araw sa pag-ihip ng hangin?', 7],
  ['Bakit mahalaga ang mga mangrove sa mga isda at sa baybayin?', 6],
  ['Bakit mas mabilis mainitan ang buhangin kaysa sa tubig-dagat kapag tanghali?', 7],
];
// CODESWITCH-reinforce — natural Taglish. [q, grade]
const CS: [string, number][] = [
  ['Sir bakit po nagkakaroon ng high tide at low tide? Like anong nagca-cause non?', 7],
  ['Teacher totoo po ba na may sariling gravity ang buwan? Paano po nakakaapekto sa atin?', 7],
  ['Po bakit po ba umiinit yung cellphone ko kapag matagal kong ginagamit?', 6],
  ['Sir paano po nagiging electricity yung lakas ng tubig sa hydroelectric dam?', 7],
  ['Teacher bakit po nagkakaroon ng goosebumps tayo kapag nilalamig o natatakot?', 6],
  ['Po anong nagpapaganda po ng kulay ng sunset? Like bakit kahel po siya?', 6],
  ['Sir totoo po ba na may bacteria kahit saan kahit malinis? Like sa phone ko po?', 7],
  ['Teacher bakit po nahihilo ako pag nasa sasakyang mabilis o paliko-liko?', 6],
  ['Po bakit po lumalaki yung mga bula sa softdrinks kapag binuksan?', 5],
  ['Sir bakit po ba pakiramdam ko mas magaan ako kapag nasa tubig na malalim?', 6],
];
// MYTH-debunk — more volume incl. body/grooming (different from the benchmark myths). [q, grade]
const MYTH: [string, number][] = [
  ['Totoo bang mas mabilis at mas makapal tumubo ang kuko kapag madalas putulin?', 6],
  ['Totoo bang biglang pumuputi ang buhok kapag sobrang natakot o nabigla ang tao?', 6],
  ['Totoo bang lumalaki ang utak ng tao sa laki kapag mas marami siyang natutunan?', 7],
  ['Totoo bang mas matalino ang mga batang isinilang nang maaga sa umaga?', 6],
  ['Totoo bang nakakasama sa mata ang pagbabasa habang nakahiga?', 5],
  ['Totoo bang namamana ng anak ang peklat o sugat ng kanyang magulang?', 7],
  ['Totoo bang ligtas pa ring kainin ang patatas kahit luntian o nagbabago na ang kulay?', 6],
  ['Totoo bang gumagaling ang ubo kapag uminom ng mainit na softdrink?', 5],
  ['Totoo bang nakakapagpalakas ng buto ang pag-inom ng softdrink dahil may bula?', 6],
  ['Totoo bang nababawasan ang timbang mo kapag umihi o pumawis ka nang marami?', 6],
];

interface Row { mode: 'grounded'; grade: number; user: string; factIds: string[]; groundingTexts: string[]; kind: string }
const rows: Row[] = [];
const add = (pool: [string, number][], kind: string, mmRate: number) => pool.forEach(([q, grade], i) => {
  const mm = (i % 10) < mmRate * 10; const factIds = mm ? pick(3) : real(q);
  rows.push({ mode: 'grounded', grade, user: q, factIds, groundingTexts: texts(factIds), kind: mm ? `${kind}-mismatch` : kind });
});
add(SYNTH, 'answer-knowledge', 0.3);   // synthesis = answer-from-knowledge combining facts
add(CS, 'answer-knowledge', 0.3);
add(MYTH, 'debunk-myth', 0.6);

writeFileSync('/tmp/rebalance3-spec.json', JSON.stringify(rows, null, 2));
console.log(`wrote ${rows.length} v3 spec rows -> /tmp/rebalance3-spec.json`);
console.log(`  synth+cs (answer-knowledge): ${rows.filter((r) => r.kind.startsWith('answer-knowledge')).length} | debunk-myth: ${rows.filter((r) => r.kind.startsWith('debunk-myth')).length}`);
