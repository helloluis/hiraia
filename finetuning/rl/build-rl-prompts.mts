// Build the GRPO RL prompt set from the fact bank.
//
// Like finetuning/datasets/grounded/build-grounded.mts, every row is assembled with
// the SAME functions the app uses at runtime (generateSystemPrompt + formatGroundingBlock
// + composeGroundedUserTurn) and filled from the SAME bank (SCIENCE_FACTS) — train/serve
// lockstep. Unlike the SFT set there are NO gold answers: each row carries `meta` with
// machine-checkable expectations (required/forbidden terms, abstention, image tag) that
// finetuning/rl/reward.py scores GRPO rollouts against.
//
// Buckets (per language):
//   grounded   50%  1 gold fact in the block; answer must use it
//   distractor 15%  gold + 1–2 same-domain distractors; must use gold, not distractors
//   knowledge  10%  MISMATCHED grounding + basic answerable question → answer from
//                   knowledge, do NOT parrot the irrelevant block (Track-A / F4 direction:
//                   rebalance.tagalog.json "Bucket-3 answer-from-knowledge")
//   abstain    10%  genuinely unanswerable ask (specific unknowables) → admit uncertainty,
//                   never invent a name/number
//   chitchat   10%  greeting/ack → warm + brief, no lecture
//   trap        5%  answerable gold fact, messy/colloquial phrasing → must still answer
//                   (over-abstention counter)
//
//   run: node_modules/.bin/tsx finetuning/rl/build-rl-prompts.mts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadFactBank } from '../../packages/shared/src/rag/bankFile.ts';
import {
  generateSystemPrompt,
  formatGroundingBlock,
  composeGroundedUserTurn,
} from '../../packages/shared/src/prompts/system.ts';
import type { RagResult } from '../../packages/shared/src/types/index.ts';

// The curated bank, read from its source of truth (rag/bank/science-facts.jsonl).
// It used to arrive as a generated 43.5 MB TypeScript array; the array is gone, the
// file it was transcribed from is not.
const SCIENCE_FACTS = loadFactBank();

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'prompts');
const SEED = 42;

type Lang = 'tagalog' | 'cebuano' | 'english';
const LANG_KEY: Record<Lang, 'tl' | 'bis' | 'en'> = { tagalog: 'tl', cebuano: 'bis', english: 'en' };
type Kind = 'grounded' | 'distractor' | 'knowledge' | 'abstain' | 'chitchat' | 'trap';

const COUNTS: Record<Lang, Record<Kind, number>> = {
  tagalog: { grounded: 1400, distractor: 420, knowledge: 280, abstain: 280, chitchat: 280, trap: 140 },
  cebuano: { grounded: 850, distractor: 255, knowledge: 170, abstain: 170, chitchat: 170, trap: 85 },
  // english rows ride INSIDE the tagalog prompt file (device routes English → tagalog
  // adapter, no separate English LoRA). 700 = 20% of that file — enough signal to stop
  // Tagalog-drift on English questions (capability A/B 2026-06-11) without diluting TL.
  english: { grounded: 350, distractor: 105, knowledge: 70, abstain: 70, chitchat: 70, trap: 35 },
};
const LIVING_THINGS_CAP = 0.45; // bank is 60% LIVING_THINGS; don't let RL be biology-dominated
const IMAGE_REQUEST_SHARE = 0.1; // grounded rows that explicitly ask for a picture (expect_image=true)

// ---------------------------------------------------------------- deterministic PRNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- text utils
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const containsTerm = (text: string, term: string) => norm(text).includes(norm(term));

// generic words that make weak required/forbidden terms
const GENERIC = new Set([
  'anumang', 'unsang', 'halos', 'bisan', 'butang', 'bagay', 'lahat', 'tanan',
  'science', 'siyensya', 'mahalaga', 'importante', 'example', 'halimbawa', 'pananglitan',
]);

// document frequency of every term across the bank → prefer rare (distinctive) terms
const DF = new Map<string, number>();
for (const f of SCIENCE_FACTS)
  for (const t of f.terms) DF.set(t, (DF.get(t) ?? 0) + 1);

/** distinctive terms of `fact` that actually appear in its own text for `lang` */
function factTerms(fact: (typeof SCIENCE_FACTS)[number], lang: Lang): string[] {
  const text = fact.fact[LANG_KEY[lang]];
  return fact.terms
    .filter((t) => t.length >= 4 && !GENERIC.has(t) && containsTerm(text, t))
    .sort((a, b) => (DF.get(a) ?? 0) - (DF.get(b) ?? 0)); // rarest first
}

/** the thing the kid asks about: topic minus question scaffolding, else rarest term */
function subjectOf(fact: (typeof SCIENCE_FACTS)[number], lang: Lang): string {
  const stripped = fact.topic
    .replace(/^(what (is|are) |what happens (when|during) |how (do|does) |why (do|does|is|are) |parts of |types of |kinds of )/i, '')
    .trim();
  if (stripped && stripped.split(/\s+/).length <= 4 && stripped.length <= 40) return stripped;
  const ts = factTerms(fact, lang);
  return ts[0] ?? stripped ?? fact.topic;
}

// ---------------------------------------------------------------- question templates
const Q: Record<Lang, ((s: string) => string)[]> = {
  tagalog: [
    (s) => `Ano po ang ${s}?`,
    (s) => `Ano ang ${s}?`,
    (s) => `Pwede po bang ipaliwanag kung ano ang ${s}?`,
    (s) => `Ano po ba ang ${s}? Hindi ko po maintindihan sa klase.`,
    (s) => `Ituro mo naman sa akin ang tungkol sa ${s} 🙏`,
  ],
  cebuano: [
    (s) => `Unsa man ang ${s}?`,
    (s) => `Unsa diay ang ${s}?`,
    (s) => `Pwede ba nimo ipasabot kung unsa ang ${s}?`,
    (s) => `Unsa po ang ${s}? Wala ko kasabot sa klase.`,
    (s) => `Tudloi ko bahin sa ${s} palihug 🙏`,
  ],
  english: [
    (s) => `What is ${s}?`,
    (s) => `What's ${s}?`,
    (s) => `Can you explain what ${s} is?`,
    (s) => `What is ${s}? I didn't understand it in class.`,
    (s) => `Teach me about ${s} please 🙏`,
  ],
};
const Q_TRAP: Record<Lang, ((s: string) => string)[]> = {
  tagalog: [
    (s) => `ano nga ulit yung ${s}?? nakalimutan ko na e`,
    (s) => `miss di ko gets yung ${s} 😅 ano ba yun`,
    (s) => `yung ${s} daw, ano yun? sabi ng teacher namin`,
    (s) => `${s}???`,
  ],
  cebuano: [
    (s) => `unsa na gani to ang ${s}?? nakalimot nako`,
    (s) => `maam wa jud ko kasabot sa ${s} 😅 unsa man na`,
    (s) => `${s}???`,
  ],
  english: [
    (s) => `what was ${s} again?? i forgot`,
    (s) => `teacher i dont get ${s} 😅 what is that`,
    (s) => `${s}??? our teacher was talking about it`,
    (s) => `${s}???`,
  ],
};
const IMG_SUFFIX: Record<Lang, string> = {
  tagalog: ' Pakipakita rin po ng larawan 🙏',
  cebuano: ' Pakita pud og hulagway palihug 🙏',
  english: ' Can you also show me a picture? 🙏',
};

// genuinely unanswerable asks (specific unknowables) → gold behavior: admit uncertainty,
// never invent a name/number. Kept small + hand-written; cycled with paraphrase templates.
const ABSTAIN_Q: Record<Lang, string[]> = {
  tagalog: [
    'Ano po ang pangalan ng kauna-unahang dinosaur sa buong mundo?',
    'Ilan po ang eksaktong bilang ng mga isda sa buong dagat?',
    'Ilang butil ng buhangin ang nasa Boracay?',
    'Ano ang pangalan ng pinakamatandang bituin sa buong langit?',
    'Ilan po lahat ang langgam sa buong mundo ngayon?',
    'Anong petsa po tumubo ang kauna-unahang puno sa Pilipinas?',
    'Sino po ang kauna-unahang taong nakakita ng ulap?',
    'Ilan po ang eksaktong bilang ng mga dahon sa isang malaking puno sa school namin?',
    'Ano po ang pangalan ng pinakaunang isda na nabuhay sa mundo?',
    'Ilang patak po ng ulan ang bumagsak kahapon sa buong Pilipinas?',
  ],
  cebuano: [
    'Unsa ang ngalan sa pinakaunang dinosaur sa tibuok kalibutan?',
    'Pila ka buok tanan ang isda sa tibuok dagat?',
    'Pila ka lugas sa balas ang naa sa baybayon sa Boracay?',
    'Unsa ang ngalan sa pinakatigulang nga bituon sa tibuok langit?',
    'Pila tanan ka hulmigas sa tibuok kalibutan karon?',
    'Kinsa ang pinakaunang tawo nga nakakita og panganod?',
    'Pila ka dahon ang naa sa usa ka dako nga kahoy sa among eskwelahan?',
    'Unsa ang ngalan sa pinakaunang isda nga nabuhi sa kalibutan?',
    'Pila ka tulo sa ulan ang nahulog gahapon sa tibuok Pilipinas?',
  ],
  english: [
    'What is the name of the very first dinosaur in the whole world?',
    'What is the exact number of fish in the entire ocean?',
    'How many grains of sand are on the beach in Boracay?',
    'What is the name of the oldest star in the whole sky?',
    'How many ants are there in the whole world right now?',
    'On what date did the very first tree in the Philippines grow?',
    'Who was the first person ever to see a cloud?',
    'What is the exact number of leaves on the big tree at our school?',
    'What is the name of the very first fish that ever lived?',
    'How many raindrops fell yesterday over the whole Philippines?',
  ],
};

const CHITCHAT_Q: Record<Lang, string[]> = {
  tagalog: [
    'Hi po!', 'Hello!', 'Magandang umaga po!', 'Magandang hapon po!', 'Salamat po!',
    'ok po', 'ge po salamat', 'handa na po ako!', 'uy kamusta?', 'ang galing mo magturo!',
    'sige po, bye na po!', 'good night po', 'thank you po ulit!', 'kamusta po kayo?',
    'yehey natapos ko na yung homework ko!', 'hehe', 'musta na po', 'antok na po ako',
    'tara po, game na ako!', 'wow ang cool!',
  ],
  cebuano: [
    'Hi po!', 'Hello!', 'Maayong buntag!', 'Maayong hapon!', 'Salamat kaayo!',
    'ok ra po', 'sige salamat', 'andam na ko!', 'uy kumusta ka?', 'nindot kaayo ka motudlo!',
    'sige, bye na!', 'maayong gabii', 'salamat pud ulit!', 'kumusta naman ka?',
    'yehey human na nako akong homework!', 'hehe', 'katulgon na ko', 'wow nindot kaayo!',
  ],
  english: [
    'Hi!', 'Hello!', 'Good morning!', 'Good afternoon!', 'Thank you!',
    'ok thanks', 'got it, thanks!', "i'm ready!", 'hey how are you?', "you're so good at teaching!",
    'ok bye!', 'good night', 'thank you again!', 'how are you today?',
    'yay i finished my homework!', 'hehe', "i'm sleepy now", 'wow so cool!',
  ],
};

// ---------------------------------------------------------------- fact sampling
/** shuffled fact pool with LIVING_THINGS capped; ABOUT_HIRAIA excluded (10 meta-facts) */
function factPool(need: number): (typeof SCIENCE_FACTS)[number][] {
  const lt = shuffle(SCIENCE_FACTS.filter((f) => f.domain === 'LIVING_THINGS'));
  const rest = shuffle(SCIENCE_FACTS.filter((f) => f.domain !== 'LIVING_THINGS' && f.domain !== 'ABOUT_HIRAIA'));
  const maxLt = Math.floor(need * LIVING_THINGS_CAP);
  return shuffle([...lt.slice(0, maxLt), ...rest.slice(0, need - Math.min(maxLt, lt.length))]);
}

function ragResult(f: (typeof SCIENCE_FACTS)[number], lang: Lang): RagResult {
  return { content: f.fact[LANG_KEY[lang]], source: f.source, score: 1, metadata: { topic: f.topic } };
}

/** same-domain, different-topic distractors whose distinctive terms don't appear in gold's text */
function distractorsFor(gold: (typeof SCIENCE_FACTS)[number], lang: Lang, n: number) {
  const goldText = gold.fact[LANG_KEY[lang]];
  const cands = SCIENCE_FACTS.filter(
    (f) =>
      f.domain === gold.domain && f.topic !== gold.topic && f.id !== gold.id &&
      factTerms(f, lang).some((t) => !containsTerm(goldText, t))
  );
  return shuffle(cands).slice(0, n);
}

// ---------------------------------------------------------------- row builder
interface Row {
  id: string;
  lang: 'tl' | 'bis' | 'en';
  kind: Kind;
  grade: number;
  messages: { role: string; content: string }[];
  meta: {
    gold_fact_id: string | null;
    required_terms: string[];
    forbidden_terms: string[];
    expect_abstain: boolean;
    expect_image: boolean | null;
    grounding_text: string;
  };
}

let seq = 0;
function buildRow(
  lang: Lang, kind: Kind, question: string, grade: number,
  blockFacts: (typeof SCIENCE_FACTS)[number][],
  gold: (typeof SCIENCE_FACTS)[number] | null,
  required: string[], forbidden: string[],
  expectAbstain: boolean, expectImage: boolean | null
): Row {
  const system = generateSystemPrompt(lang as any, grade as any, true); // tag-aware, like SFT + runtime
  const block = formatGroundingBlock(blockFacts.map((f) => ragResult(f, lang)));
  return {
    id: `rl-${LANG_KEY[lang]}-${kind}-${String(seq++).padStart(5, '0')}`,
    lang: LANG_KEY[lang],
    kind,
    grade,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: composeGroundedUserTurn(block, question) },
    ],
    meta: {
      gold_fact_id: gold?.id ?? null,
      required_terms: required,
      forbidden_terms: forbidden,
      expect_abstain: expectAbstain,
      expect_image: expectImage,
      grounding_text: block,
    },
  };
}

function generate(lang: Lang): Row[] {
  const c = COUNTS[lang];
  const rows: Row[] = [];
  const needFacts = c.grounded + c.distractor + c.knowledge + c.trap + c.knowledge; // knowledge uses 2 (question fact + block fact)
  const pool = factPool(needFacts * 2); // headroom for skips
  let pi = 0;
  const nextFact = () => pool[pi++ % pool.length];
  const gradeOf = (f: (typeof SCIENCE_FACTS)[number]) => pick(f.grades.filter((g) => g >= 3 && g <= 7));

  // grounded + trap (same recipe, different phrasing + image-request slice on grounded)
  for (const [kind, n, templates] of [
    ['grounded', c.grounded, Q[lang]],
    ['trap', c.trap, Q_TRAP[lang]],
  ] as const) {
    let made = 0;
    while (made < n) {
      const f = nextFact();
      const req = factTerms(f, lang).slice(0, 4);
      if (req.length < 2) continue; // need at least 2 checkable terms
      // plausible-confab forbidden: distinctive terms of a same-domain sibling
      const sib = distractorsFor(f, lang, 1)[0];
      const forb = sib
        ? factTerms(sib, lang).filter((t) => !containsTerm(f.fact[LANG_KEY[lang]], t)).slice(0, 2)
        : [];
      let question = pick(templates as any[])(subjectOf(f, lang));
      let expectImage: boolean | null = kind === 'grounded' ? null : null;
      if (kind === 'grounded' && rng() < IMAGE_REQUEST_SHARE) {
        question += IMG_SUFFIX[lang];
        expectImage = true;
      }
      rows.push(buildRow(lang, kind, question, gradeOf(f), [f], f, req, forb, false, expectImage));
      made++;
    }
  }

  // distractor: gold + 1–2 same-domain distractors in the block
  let made = 0;
  while (made < c.distractor) {
    const f = nextFact();
    const req = factTerms(f, lang).slice(0, 4);
    if (req.length < 2) continue;
    const ds = distractorsFor(f, lang, 1 + Math.floor(rng() * 2));
    if (!ds.length) continue;
    const forb = ds
      .flatMap((d) => factTerms(d, lang))
      .filter((t) => !containsTerm(f.fact[LANG_KEY[lang]], t) && !req.some((r) => containsTerm(r, t) || containsTerm(t, r)))
      .slice(0, 3);
    if (!forb.length) continue;
    const blockFacts = shuffle([f, ...ds]);
    rows.push(buildRow(lang, 'distractor', pick(Q[lang])(subjectOf(f, lang)), gradeOf(f), blockFacts, f, req, forb, false, null));
    made++;
  }

  // knowledge: answerable basic question + MISMATCHED (different-domain) grounding.
  // Right behavior (Track-A): ignore the block, answer from knowledge; required terms come
  // from the question fact's text, forbidden from the irrelevant block (anti-parroting).
  made = 0;
  while (made < c.knowledge) {
    const f = nextFact();
    const req = factTerms(f, lang).slice(0, 3);
    if (req.length < 2) continue;
    const other = SCIENCE_FACTS.filter((x) => x.domain !== f.domain && x.domain !== 'ABOUT_HIRAIA');
    const mism = pick(other);
    const forb = factTerms(mism, lang).filter((t) => !containsTerm(f.fact[LANG_KEY[lang]], t)).slice(0, 3);
    if (!forb.length) continue;
    rows.push(buildRow(lang, 'knowledge', pick(Q[lang])(subjectOf(f, lang)), gradeOf(f), [mism], f, req, forb, false, null));
    made++;
  }

  // abstain: hand-written unanswerables; half with empty grounding, half with an
  // irrelevant fact in the block (must STILL not invent specifics from it)
  for (let i = 0; i < c.abstain; i++) {
    const q = ABSTAIN_Q[lang][i % ABSTAIN_Q[lang].length];
    const withBlock = rng() < 0.5;
    const mism = withBlock ? [nextFact()] : [];
    const forb = withBlock ? factTerms(mism[0], lang).slice(0, 2) : [];
    rows.push(buildRow(lang, 'abstain', q, 3 + Math.floor(rng() * 3), mism, null, [], forb, true, false));
  }

  // chitchat: empty grounding; warm + brief, no lecture, no image
  for (let i = 0; i < c.chitchat; i++) {
    const q = CHITCHAT_Q[lang][i % CHITCHAT_Q[lang].length];
    rows.push(buildRow(lang, 'chitchat', q, 3 + Math.floor(rng() * 3), [], null, [], [], false, false));
  }

  return shuffle(rows);
}

// ---------------------------------------------------------------- generate + verify
mkdirSync(OUT_DIR, { recursive: true });
const stats: string[] = ['# RL prompt set — stats', '', `seed=${SEED}`, ''];
const generated = new Map<Lang, Row[]>();

// english LAST so the tagalog/cebuano rng draws are unchanged vs the pre-english build
for (const lang of ['tagalog', 'cebuano', 'english'] as Lang[]) {
  const rows = generate(lang);
  generated.set(lang, rows);

  // sanity asserts
  for (const r of rows) {
    if (!r.messages[0].content) throw new Error(`${r.id}: empty system`);
    const goldText = r.meta.gold_fact_id
      ? SCIENCE_FACTS.find((f) => f.id === r.meta.gold_fact_id)!.fact[r.lang]
      : '';
    for (const t of r.meta.forbidden_terms)
      if (goldText && containsTerm(goldText, t))
        throw new Error(`${r.id}: forbidden term "${t}" appears in gold fact`);
    if ((r.kind === 'grounded' || r.kind === 'distractor' || r.kind === 'trap'))
      for (const t of r.meta.required_terms)
        if (!containsTerm(r.meta.grounding_text, t))
          throw new Error(`${r.id}: required term "${t}" not in grounding block`);
    if (r.kind === 'knowledge')
      for (const t of r.meta.required_terms)
        if (!containsTerm(goldText, t))
          throw new Error(`${r.id}: required term "${t}" not in question-fact text`);
  }

  const dest = lang === 'cebuano' ? 'rl-prompts.bisaya.jsonl'
    : lang === 'tagalog' ? 'rl-prompts.tagalog.jsonl'
    : 'rl-prompts.tagalog.jsonl (merged)';

  // stats
  const byKind: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const byGrade: Record<string, number> = {};
  let reqSum = 0, forbSum = 0, imgTrue = 0;
  for (const r of rows) {
    byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    byGrade[r.grade] = (byGrade[r.grade] ?? 0) + 1;
    if (r.meta.gold_fact_id) {
      const d = SCIENCE_FACTS.find((f) => f.id === r.meta.gold_fact_id)!.domain;
      byDomain[d] = (byDomain[d] ?? 0) + 1;
    }
    reqSum += r.meta.required_terms.length;
    forbSum += r.meta.forbidden_terms.length;
    if (r.meta.expect_image === true) imgTrue++;
  }
  stats.push(`## ${lang} — ${rows.length} rows → ${dest}`, '');
  stats.push(`- kinds: ${JSON.stringify(byKind)}`);
  stats.push(`- gold-fact domains: ${JSON.stringify(byDomain)}`);
  stats.push(`- grades: ${JSON.stringify(byGrade)}`);
  stats.push(`- mean required=${(reqSum / rows.length).toFixed(2)} forbidden=${(forbSum / rows.length).toFixed(2)} expect_image:true=${imgTrue}`, '');
  for (const k of ['grounded', 'distractor', 'knowledge', 'abstain', 'chitchat', 'trap'] as Kind[]) {
    const ex = rows.find((r) => r.kind === k)!;
    const userTail = ex.messages[1].content.slice(-200).replace(/\n/g, ' ');
    stats.push(`- example ${k}: \`${ex.id}\` user(…tail): "${userTail}" meta: req=${JSON.stringify(ex.meta.required_terms)} forb=${JSON.stringify(ex.meta.forbidden_terms)} abstain=${ex.meta.expect_abstain} img=${ex.meta.expect_image}`);
  }
  stats.push('');
  console.log(`${lang}: generated ${rows.length} rows (→ ${dest})`);
}

// write: tagalog file carries tl + en rows interleaved; bisaya is bis-only
const tlFile = join(OUT_DIR, 'rl-prompts.tagalog.jsonl');
const tlRows = shuffle([...generated.get('tagalog')!, ...generated.get('english')!]);
writeFileSync(tlFile, tlRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`wrote ${tlRows.length} rows (tl+en) -> ${tlFile}`);

const bisFile = join(OUT_DIR, 'rl-prompts.bisaya.jsonl');
const bisRows = generated.get('cebuano')!;
writeFileSync(bisFile, bisRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`wrote ${bisRows.length} rows (bis) -> ${bisFile}`);

writeFileSync(join(OUT_DIR, 'STATS.md'), stats.join('\n') + '\n');
console.log(`stats -> ${join(OUT_DIR, 'STATS.md')}`);
