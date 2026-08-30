// Build the Track-A SFT-rebalance SPEC (not the gold answers — those are generated
// by a subscription workflow). Targets the capability-baseline failure diagnosis (FINDINGS F4):
//   - Bucket 3 (the MISSING signal): thin/irrelevant/WRONG grounding → still answer canonical
//     grade-school science from knowledge. The prior accuracy component only did Bucket 1.
//   - Myth-debunk at VOLUME (safety-myth was the worst tier, 2.31; prior set had ~1 row).
//   - A modest abstain counterweight so helpfulness rises without breaking honesty.
//
// METHODOLOGY GUARD: every question here is DISJOINT from finetuning/eval/capability/probes.json
// (different topics/phrasings). We train the BEHAVIOR; the held-out benchmark tests whether it
// generalized. Training on the probes themselves would fake the re-benchmark gain.
//
// Emits /tmp/rebalance-spec.json: rows of {mode, grade, lang, user, factIds, groundingTexts, kind}.
// The workflow writes the gold `assistant`; assemble.mts then folds them into rebalance.<lang>.json.
//
//   run: node_modules/.bin/tsx finetuning/datasets/grounded/build-rebalance-spec.mts
import { writeFileSync } from 'node:fs';
import { loadFactBank } from '../../../packages/shared/src/rag/bankFile.ts';
import { RagStore } from '../../../packages/shared/src/rag/RagStore.ts';

// The curated bank, read from its source of truth (rag/bank/science-facts.jsonl).
// It used to arrive as a generated 43.5 MB TypeScript array; the array is gone, the
// file it was transcribed from is not.
const SCIENCE_FACTS = loadFactBank();

type Lang = 'tagalog' | 'cebuano';
const LK: Record<Lang, 'tl' | 'bis'> = { tagalog: 'tl', cebuano: 'bis' };
const store = new RagStore(SCIENCE_FACTS);
const byId = new Map(SCIENCE_FACTS.map((f) => [f.id, f]));
const ALL_IDS = SCIENCE_FACTS.map((f) => f.id);

// Deterministic pseudo-random (no Math.random — keep the spec reproducible across builds).
let _s = 1337;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T,>(arr: T[], n: number) => {
  const out: T[] = [], used = new Set<number>();
  while (out.length < n && used.size < arr.length) { const i = Math.floor(rnd() * arr.length); if (!used.has(i)) { used.add(i); out.push(arr[i]); } }
  return out;
};

function realGrounding(q: string, lang: Lang, k = 3): string[] {
  const hits = store.retrieveForGrounding(q as any, lang as any, k);
  return hits.map((h: any) => h.fact.id);
}
function mismatchGrounding(): string[] { return pick(ALL_IDS, 3); } // deliberately-irrelevant facts
function textsFor(ids: string[], lang: Lang): string[] {
  return ids.map((id) => { const f = byId.get(id); return f ? f.fact[LK[lang]] : ''; }).filter(Boolean);
}

// ---- POOLS (all DISJOINT from probes.json) ----
// Canonical grade-school science the tutor must ALWAYS answer. {q, grade}.
const CANON_TL: [string, number][] = [
  ['Bakit umiiyak tayo kapag may pumasok na alikabok sa mata?', 4],
  ['Paano gumagaling ang sugat natin?', 5],
  ['Bakit nangangati ang kagat ng lamok?', 5],
  ['Bakit may kulog pagkatapos ng kidlat?', 6],
  ['Paano humihinga ang isda sa ilalim ng tubig?', 5],
  ['Bakit kumikislap ang mga bituin sa langit?', 5],
  ['Ano ang sanhi ng lindol?', 6],
  ['Paano gumagawa ng pulot-pukyutan ang mga bubuyog?', 5],
  ['Bakit may iba’t ibang lasa ang nararamdaman ng dila natin?', 5],
  ['Bakit kailangan natin ng Vitamin C?', 5],
  ['Ano ang ozone layer at bakit ito mahalaga?', 7],
  ['Bakit lumalaki ang tinapay kapag niluluto?', 6],
  ['Bakit kumukulo ang tubig kapag iniinit?', 5],
  ['Bakit nagiging yelo ang tubig sa freezer?', 4],
  ['Bakit nauuhaw tayo kapag kumain ng maalat?', 5],
  ['Bakit may amoy ang mga bulaklak?', 4],
  ['Paano nakakakita ang paniki sa dilim?', 6],
  ['Bakit kayang dumikit ng butiki sa dingding?', 6],
  ['Bakit pumuputi ang buhok kapag tumatanda ang tao?', 6],
  ['Ano ang ginagawa ng mga bato (kidney) sa katawan natin?', 7],
  ['Bakit pawis tayo nang pawis kapag mainit?', 4],
  ['Paano lumilipad ang mga ibon?', 5],
  ['Bakit hindi nahuhulog ang tubig sa baso kahit baligtad sandali kapag iniikot nang mabilis?', 7],
  ['Bakit lumalamig ang sabaw kapag hinihipan natin?', 5],
  ['Ano ang nangyayari sa pagkain natin para maging enerhiya?', 7],
  ['Bakit nagkakaroon ng tag-araw at tag-ulan na ihip ng hangin (monsoon) sa atin?', 7],
  ['Bakit naglalaho ang asukal kapag inihalo sa tubig?', 5],
  ['Bakit gumagalaw ang mga karayom ng kompas patungong hilaga?', 7],
  ['Ano ang sanhi ng pagtaas ng tubig-dagat (high tide)?', 7],
  ['Bakit nagkukulay-kahel o pula ang langit kapag paglubog ng araw?', 6],
  ['Paano nakakahawa ang trangkaso sa ibang tao?', 6],
  ['Bakit nagkakaroon ng bula ang softdrinks?', 5],
  ['Ano ang nagpapakislap sa alitaptap (firefly)?', 5],
  ['Bakit nakakalangoy ang ilang hayop pero ang iba hindi?', 5],
  ['Bakit nagdidilim ang langit kapag malakas ang ulan?', 5],
  ['Paano umiinom ng tubig ang mga halaman mula sa ugat?', 5],
  ['Bakit kumakalat ang amoy sa buong silid?', 6],
  ['Ano ang sanhi ng ulan ng yelo o granizo?', 7],
  ['Bakit kailangan ng halaman ang araw para mabuhay?', 4],
  ['Bakit may iba’t ibang kulay ang mga mata ng tao?', 6],
  ['Bakit lumulutang ang langis sa ibabaw ng sabaw?', 6],
  ['Ano ang ginagawa ng utak natin?', 5],
  ['Bakit tumitigas ang putik kapag natuyo sa araw?', 5],
  ['Bakit dumadausdos tayo sa basang sahig?', 5],
  ['Paano nabubuo ang hamog sa umaga?', 6],
];
const CANON_BIS: [string, number][] = [
  ['Nganong mohilak man ta kung naay abog nga mosulod sa mata?', 4],
  ['Unsaon pag-ayo sa atong samad?', 5],
  ['Nganong adunay dahunog human sa kilat?', 6],
  ['Unsaon paghinga sa isda ilalom sa tubig?', 5],
  ['Nganong mokidlap man ang mga bituon?', 5],
  ['Unsa ang hinungdan sa linog?', 6],
  ['Nganong nagsingot man ta kung init?', 4],
  ['Nganong nagbukal man ang tubig kung initon?', 5],
];
// Myths to DEBUNK — different myths from the benchmark's (tests generalization of the behavior).
const MYTH_TL: [string, number][] = [
  ['Totoo bang kung lulunukin mo ang buto ng bayabas ay tutubo ito sa tiyan mo?', 5],
  ['Totoo bang nagkakasakit ang bata kapag naliligo agad pagkatapos kumain?', 6],
  ['Totoo bang nakakabulag ang pagbasa sa madilim?', 6],
  ['Totoo bang tatlong segundo lang ang memorya ng goldfish?', 6],
  ['Totoo bang pumapandak ang tao kapag umiinom ng kape?', 7],
  ['Totoo bang ligtas nang kainin ang pagkaing nahulog kung kukunin sa loob ng 5 segundo?', 6],
  ['Totoo bang nababaliw ang mga tao kapag full moon?', 7],
  ['Totoo bang mas matalino ang mga taong gumagamit ng kanang kamay kaysa kaliwa?', 7],
  ['Totoo bang nakakalason ang kamatis dahil kapamilya ito ng makamandag na halaman?', 7],
  ['Totoo bang lumalaki ang mata mo nang permanente kapag naduduwal?', 6],
  ['Totoo bang hihina ang mata mo kapag masyadong malapit kang manood ng TV nang permanente?', 6],
  ['Totoo bang lahat ng gagamba ay nakakamatay ang kagat?', 6],
  ['Totoo bang umiinit ang dugo natin kapag galit tayo?', 6],
  ['Totoo bang nakukuryente ka kapag humawak ka ng switch na basa ang kamay?', 6],
  ['Totoo bang mas mabigat ang tao sa timbangan kapag full moon dahil sa gravity ng buwan?', 7],
  ['Totoo bang nagiging kabute ang utak kapag kulang sa tulog?', 6],
  ['Totoo bang nakakahawa ang sipon kapag nilalanghap mo ang hangin ng may sakit?', 6],
  ['Totoo bang lahat ng bakterya ay masama para sa katawan?', 7],
  ['Totoo bang nakakain ang lahat ng kabute sa gubat?', 6],
  ['Totoo bang permanenteng nawawala ang ngipin kapag nilunok mo ito?', 5],
  ['Totoo bang tumitigil ang paglaki ng tao pagkatapos uminom ng softdrinks?', 6],
  ['Totoo bang dumadami ang sungay-sungay sa kuko dahil sa kakulangan sa gatas?', 6],
];
const MYTH_BIS: [string, number][] = [
  ['Tinuod ba nga motubo sa tiyan ang liso sa bayabas kung tunlon nimo?', 5],
  ['Tinuod ba nga mabuta ka kung magbasa sa ngitngit?', 6],
  ['Tinuod ba nga mabuang ang tawo kung full moon?', 7],
  ['Tinuod ba nga tanang bakterya daotan sa lawas?', 7],
  ['Tinuod ba nga tulo ka segundo ra ang memorya sa goldfish?', 6],
];
// Genuinely unanswerable / out-of-scope → abstain (counterweight). Different from benchmark's.
const ABSTAIN_TL: [string, number][] = [
  ['Ilang araw na natitira bago matapos ang summer break ko?', 5],
  ['Anong oras na ngayon sa lugar namin?', 4],
  ['Magkano ang bigas sa palengke namin ngayon?', 6],
  ['Nanalo ba ang paborito kong team kahapon?', 6],
  ['Ano ang grado ko sa Science quiz kanina?', 6],
  ['Anong pangalan ng magiging anak ko balang araw?', 6],
  ['Ilang taon na ang lola ko ngayon?', 5],
  ['Saan nagtatrabaho ang tatay ng katabi kong si Ana?', 6],
  ['Mananalo ba ako sa raffle sa school fair bukas?', 6],
  ['Anong kulay ng damit na susuotin ng titser ko bukas?', 5],
  ['Ilan ang estudyante sa buong paaralan namin ngayong taon?', 6],
  ['Kailan eksaktong uulan dito sa amin sa susunod na linggo?', 6],
  ['Gaano karaming langgam ang nasa bakuran namin ngayon?', 5],
  ['Anong numero ang lalabas sa dice kapag inihagis ko mamaya?', 5],
  ['May bisita ba kaming darating mamayang gabi?', 5],
];
const ABSTAIN_BIS: [string, number][] = [
  ['Unsa man ang grado nako sa Science quiz ganina?', 6],
  ['Modaog ba ang paborito nakong team ugma?', 6],
  ['Pila ka tawo ang naa sa among eskwelahan karon?', 6],
  ['Unsang orasa na karon diri sa among lugar?', 4],
];

interface SpecRow { mode: 'grounded' | 'abstain'; grade: number; lang: Lang; user: string; factIds: string[]; groundingTexts: string[]; kind: string }
const rows: SpecRow[] = [];

// Canonical: ~70% real grounding (use-it), ~30% mismatch grounding (ignore-it, answer anyway → Bucket 3).
const addCanon = (pool: [string, number][], lang: Lang) => pool.forEach(([q, grade], i) => {
  const mismatch = i % 10 < 3; // ~30%
  const factIds = mismatch ? mismatchGrounding() : realGrounding(q, lang);
  rows.push({ mode: 'grounded', grade, lang, user: q, factIds, groundingTexts: textsFor(factIds, lang), kind: mismatch ? 'answer-knowledge-mismatch' : 'answer-knowledge-real' });
});
const addMyth = (pool: [string, number][], lang: Lang) => pool.forEach(([q, grade]) => {
  const factIds = realGrounding(q, lang);
  rows.push({ mode: 'grounded', grade, lang, user: q, factIds, groundingTexts: textsFor(factIds, lang), kind: 'debunk-myth' });
});
const addAbstain = (pool: [string, number][], lang: Lang) => pool.forEach(([q, grade]) => {
  const factIds = realGrounding(q, lang); // usually weak/irrelevant — correct for these
  rows.push({ mode: 'abstain', grade, lang, user: q, factIds, groundingTexts: textsFor(factIds, lang), kind: 'abstain-counterweight' });
});

addCanon(CANON_TL, 'tagalog'); addCanon(CANON_BIS, 'cebuano');
addMyth(MYTH_TL, 'tagalog'); addMyth(MYTH_BIS, 'cebuano');
addAbstain(ABSTAIN_TL, 'tagalog'); addAbstain(ABSTAIN_BIS, 'cebuano');

writeFileSync('/tmp/rebalance-spec.json', JSON.stringify(rows, null, 2));
const by = (k: string) => rows.filter((r) => r.kind === k).length;
console.log(`wrote ${rows.length} spec rows -> /tmp/rebalance-spec.json`);
console.log(`  answer-knowledge-real:     ${by('answer-knowledge-real')}`);
console.log(`  answer-knowledge-mismatch: ${by('answer-knowledge-mismatch')}  (Bucket-3 signal)`);
console.log(`  debunk-myth:               ${by('debunk-myth')}`);
console.log(`  abstain-counterweight:     ${by('abstain-counterweight')}`);
console.log(`  by lang: tagalog=${rows.filter((r) => r.lang === 'tagalog').length} cebuano=${rows.filter((r) => r.lang === 'cebuano').length}`);