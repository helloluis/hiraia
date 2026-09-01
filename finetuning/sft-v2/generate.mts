/**
 * generate.mts — STAGE 2: the six GENERATED buckets, one per gate-failure class.
 *
 *   safety-myth  ~224  2×2 polarity grid (harmful-yes / myth-no / safe-no / true-yes) — the
 *                      anti-collapse mechanism: the correct opener is uncorrelated with the
 *                      question shape (the DPO premise-affirmation lesson). Balanced PER
 *                      (cell, LANGUAGE) — caps tl 28 / ceb 18 / en 10 each cell, with a
 *                      top-up pass for under-served combos (measured skew: ceb 19 affirm vs
 *                      32 deny under global-only balancing). ~40 rows are the settled-science
 *                      sublist: retrieval deliberately mismatches, the card still corrects
 *                      from a SHORT curated list (allowUngrounded).
 *   thin-escape   250  real-retriever mismatches: queries that clear the floor but land
 *                      unrelated facts; the target is the nearest FACT restated whole.
 *   abstain-name  300  200 abstain-shape (never name beyond the facts) + 100 counterweight
 *                      name-when-grounded (the v9 over-abstention lesson).
 *   ceb-quality   300  Cebuano cards seeded from AUTHENTIC Cebuano (bucket-ceb-neutral +
 *                      bisaya/train-v5) — reshape, don't synthesize (the synth-ceb lesson).
 *   compress      220  120 multi-fact compressions that must keep named entities/numbers +
 *                      100 taxonomy contrasts that must survive compression.
 *   en-topup      180  English cue adherence / language purity.
 *
 * AUP: child-body topic SEEDS are authored in English here; the Tagalog/Bisaya queries and
 * cards are written AND judged on Fireworks. Content stays in files; stdout gets ids/stats.
 *
 *   set -a; source /Users/luis/Code/hiraia/.env.local; set +a
 *   BUCKETS=safety,thin node_modules/.bin/tsx finetuning/sft-v2/generate.mts   # or all
 *
 * Resumable per row id via out/cache/<bucket>.gen.jsonl.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  Cache,
  CACHE,
  OUT,
  ROOT,
  type BuiltRow,
  type CardLanguage,
  abstainDenyRes,
  assertEmbedder,
  assertFireworksKey,
  contamination,
  fwGenerate,
  fwUsage,
  FW_CONC,
  isChitchatQuery,
  lintCard,
  parseJson,
  pooled,
  readJsonl,
  route,
  rowId,
  sampleGrade,
  seededRng,
  underCardTextCap,
  wordCount,
} from './lib.mts';

// =======================================================================================
// SEED DATA — topics are English descriptors (AUP: body topics never appear here in TL/BIS).
// =======================================================================================

type Cell = 'harmful-yes' | 'myth-no' | 'safe-no' | 'true-yes';
interface SafetyTopic {
  t: string;
  cell: Cell;
  /** Present = settled-science sublist: correction licensed even when retrieval mismatches. */
  settled?: string;
}

/** The 2×2 grid: (a) harmful thing, expects yes; (b) myth, expects yes; (c) safe thing asked
 *  as if harmful; (d) true science asked as if myth. All four cells ~equal. */
const SAFETY_TOPICS: SafetyTopic[] = [
  // (a) genuinely harmful — the correct card AFFIRMS the harm ("Oo, masama...")
  // Smoking is the flagship gate topic (tier2-safety-smoking) and had only ~3 tl rows, two of
  // them shaky on the ban-vs-sale-ban legal claim — so the smoking cell gets FOUR seed topics.
  { t: 'smoking cigarettes', cell: 'harmful-yes' },
  { t: 'vaping / e-cigarettes for kids', cell: 'harmful-yes' },
  { t: 'breathing secondhand smoke from someone smoking cigarettes nearby', cell: 'harmful-yes' },
  { t: 'trying even one cigarette stick as a kid', cell: 'harmful-yes' },
  { t: 'drinking floodwater', cell: 'harmful-yes' },
  { t: 'staring directly at the sun', cell: 'harmful-yes' },
  { t: 'looking at a solar eclipse with bare eyes', cell: 'harmful-yes' },
  { t: 'touching or playing with mercury from a broken thermometer', cell: 'harmful-yes' },
  { t: 'playing with firecrackers (paputok)', cell: 'harmful-yes' },
  { t: 'swimming outside during a thunderstorm', cell: 'harmful-yes' },
  { t: 'drinking seawater when thirsty', cell: 'harmful-yes' },
  { t: 'breathing smoke from burning plastic and garbage', cell: 'harmful-yes' },
  { t: 'taking medicine that was not prescribed for you', cell: 'harmful-yes' },
  { t: 'sticking things into electrical outlets', cell: 'harmful-yes' },
  { t: 'children drinking alcohol', cell: 'harmful-yes' },
  { t: 'eating raw or undercooked chicken', cell: 'harmful-yes' },
  { t: 'riding a motorcycle without a helmet', cell: 'harmful-yes' },
  // (b) myths — the correct card DENIES ("Hindi totoo...")
  { t: 'the earth being flat', cell: 'myth-no', settled: 'The Earth is round (an oblate sphere) — photos from space and ships disappearing bottom-first over the horizon show this.' },
  { t: 'humans using only 10 percent of their brain', cell: 'myth-no', settled: 'Humans use virtually all of their brain; brain scans show activity throughout the whole brain, even during sleep.' },
  { t: 'lightning never striking the same place twice', cell: 'myth-no', settled: 'Lightning often strikes the same place repeatedly — tall buildings and towers are struck many times a year.' },
  { t: 'swallowed chewing gum staying in the stomach for seven years', cell: 'myth-no' },
  { t: 'cracking knuckles causing arthritis', cell: 'myth-no' },
  { t: 'shaved hair growing back thicker', cell: 'myth-no' },
  { t: 'goldfish having a three-second memory', cell: 'myth-no' },
  { t: 'bats being blind', cell: 'myth-no' },
  { t: 'ostriches burying their heads in sand when scared', cell: 'myth-no' },
  { t: 'the Great Wall of China being visible from space with the naked eye', cell: 'myth-no', settled: 'The Great Wall is NOT visible to the naked eye from space; astronauts confirm it is too narrow to see without aid.' },
  { t: 'sugar making children hyperactive', cell: 'myth-no' },
  { t: 'catching a cold from cold weather itself', cell: 'myth-no' },
  { t: 'the moon having a permanently dark side that never gets sunlight', cell: 'myth-no', settled: 'Every side of the Moon gets sunlight; we just always see the same face from Earth because the Moon rotates as it orbits.' },
  { t: 'humans and dinosaurs living at the same time', cell: 'myth-no', settled: 'Humans and (non-bird) dinosaurs never lived together — dinosaurs died out about 66 million years ago, long before humans existed.' },
  { t: 'a penny dropped from a tall building being able to kill', cell: 'myth-no' },
  // (c) safe things asked as if harmful — the correct card DENIES the harm ("Hindi, ligtas...")
  { t: 'vaccines (asked: are they dangerous?)', cell: 'safe-no', settled: 'Vaccines are safe and thoroughly tested; they teach the body to fight diseases and protect millions of children every year.' },
  { t: 'swallowing a fruit seed (asked: will a plant grow in my stomach?)', cell: 'safe-no', settled: 'A swallowed seed cannot grow in the stomach — plants need soil, light and air, and the seed simply passes out of the body.' },
  { t: 'accidentally swallowing gum once (asked: is it dangerous?)', cell: 'safe-no', settled: 'Accidentally swallowed gum is not dangerous — the body cannot digest it, but it passes out normally in a few days, not seven years.' },
  { t: 'touching an earthworm (asked: is it dangerous?)', cell: 'safe-no', settled: 'Earthworms are harmless to touch — they do not bite or sting, and they help plants by loosening and enriching the soil; just wash hands after.' },
  { t: 'reading in dim light (asked: does it permanently damage eyes?)', cell: 'safe-no', settled: 'Reading in dim light does not permanently damage the eyes — it can tire them for a while, but rest restores them.' },
  { t: 'sleeping with wet hair (asked: does it make you blind?)', cell: 'safe-no', settled: 'Sleeping with wet hair does not cause blindness or illness — sickness comes from germs like viruses and bacteria, not from wet hair.' },
  { t: 'microwaved food (asked: is it dangerous to eat?)', cell: 'safe-no', settled: 'Microwaved food is safe to eat — microwaves only heat the water inside food and do not make it radioactive or poisonous.' },
  { t: 'wifi signals at home (asked: are they dangerous radiation?)', cell: 'safe-no', settled: 'Home wifi signals are weak radio waves, not harmful radiation — they carry far too little energy to damage the body.' },
  { t: 'the sound of thunder (asked: can the sound itself hurt me?)', cell: 'safe-no' },
  { t: 'drinking cold water after playing (asked: does it cause sickness?)', cell: 'safe-no', settled: 'Drinking cold water after playing is safe and helps the body cool down and replace sweat — sickness comes from germs, not cold water.' },
  { t: 'watching a solar eclipse with certified eclipse glasses', cell: 'safe-no' },
  { t: 'touching a frog (asked: will I get warts?)', cell: 'safe-no', settled: 'Touching a frog or toad cannot give you warts — warts come from a human virus, not from amphibian skin; just wash hands after.' },
  { t: 'eating rice at night (asked: is it bad for the body?)', cell: 'safe-no', settled: 'Eating rice at night is not bad for the body — the body uses food energy the same way at any hour; total food and activity are what matter.' },
  { t: 'donating blood for adults (asked: does it make you weak forever?)', cell: 'safe-no', settled: 'Blood donation is safe for healthy adults — the body replaces the donated blood within days and the donor is not weakened for life.' },
  { t: 'x-rays at the doctor when needed (asked: are they dangerous?)', cell: 'safe-no', settled: 'A medical x-ray when the doctor orders one is safe — the dose is very small and carefully controlled, and it helps find problems inside the body.' },
  // (d) true science asked as if it were a myth — the correct card AFFIRMS ("Oo, totoo...")
  { t: 'the earth really being round', cell: 'true-yes', settled: 'Yes — the Earth is round (an oblate sphere), confirmed by photos from space and by ships sinking below the horizon.' },
  { t: 'the earth really orbiting the sun', cell: 'true-yes', settled: 'Yes — the Earth travels around the Sun once a year; the Sun does not orbit the Earth.' },
  { t: 'gravity really existing in space', cell: 'true-yes', settled: 'Yes — gravity exists in space; astronauts float because they are in constant free fall around Earth, not because gravity is gone.' },
  { t: 'the moon really causing ocean tides', cell: 'true-yes' },
  { t: 'the sun really being a star', cell: 'true-yes' },
  { t: 'whales really being mammals not fish', cell: 'true-yes' },
  { t: 'lightning really being electricity', cell: 'true-yes' },
  { t: 'plants really making their own food', cell: 'true-yes' },
  { t: 'day and night really being caused by the earth spinning', cell: 'true-yes', settled: 'Yes — day and night happen because the Earth spins on its axis once every 24 hours, turning each side toward and away from the Sun.' },
  { t: 'the moon really only reflecting sunlight, not making its own light', cell: 'true-yes' },
  { t: 'water really turning into invisible vapor when it evaporates', cell: 'true-yes' },
  { t: 'hot air really rising', cell: 'true-yes' },
  { t: 'seasons really being caused by the tilt of the earth', cell: 'true-yes', settled: 'Yes — seasons come from the tilt of the Earth’s axis as it orbits the Sun, not from the Earth getting closer to or farther from the Sun.' },
  { t: 'the human heart really pumping blood all day without stopping', cell: 'true-yes' },
  { t: 'blood really always being red, never blue', cell: 'true-yes' },
];

/** Out-of-vocab / pop-culture terms that can clear the retrieval floor yet land mismatched
 *  facts. Only candidates that ROUTE GROUNDED survive — the mismatch is real, not staged. */
const THIN_TERMS: string[] = [
  'the UAAP basketball finals', 'a volleyball championship game', 'sepak takraw rules',
  'Jollibee Chickenjoy', 'the newest cellphone model', 'a K-pop concert', 'a K-drama series',
  'an anime series', 'TikTok dance trends', 'a famous YouTube vlogger', 'the game Minecraft',
  'the game Mobile Legends', 'a Pokemon card collection', 'chess grandmasters',
  'a badminton tournament', 'a famous boxing match', 'Formula 1 race cars',
  'a big shopping mall', 'an amusement park ride', 'a beach resort vacation',
  'a singing contest on TV', 'a dance competition', 'a superhero movie', 'video game consoles',
  'basketball player heights', 'the World Cup', 'the Olympics medal count', 'e-sports teams',
  'a birthday party', 'Christmas gifts', 'a town fiesta parade', 'graduation ceremonies',
  'ice cream flavors', 'pizza toppings', 'milk tea flavors', 'lechon at parties',
  'karaoke songs', 'teleserye actors', 'movie tickets', 'roller skates',
  'skateboard tricks', 'a magic show', 'a circus performance', 'lotto jackpot numbers',
  'internet celebrities', 'viral memes', 'computer keyboards', 'headphones and earbuds',
  'trading card games', 'board games like snakes and ladders', 'jackstones and street games',
  'paper airplanes contests', 'yoyo tricks', 'spinning tops (trumpo)', 'marbles (jolen)',
  'hide and seek rules', 'patintero strategies', 'tumbang preso', 'luksong tinik',
  'sungka rules', 'text messaging slang', 'emoji meanings', 'password security',
  'wifi passwords', 'online shopping', 'delivery apps', 'jeepney fares', 'tricycle rides',
  'school uniforms', 'class field trips', 'summer vacation plans', 'weekend markets',
  'sari-sari store candies', 'halo-halo ingredients', 'taho vendors', 'balut vendors',
  'street basketball courts', 'barangay league games', 'school intramurals',
  'cheerleading squads', 'marching bands', 'drum and lyre corps', 'flag ceremonies',
  'classroom cleaners schedule', 'recess snacks', 'school canteens', 'library cards',
];

interface AbstainSeed {
  t: string;
  kind: 'abstain' | 'name';
}
/** 2/3 abstain-shape (the answer is NOT in the bank; never name beyond the facts) and 1/3
 *  name-when-grounded counterweight (the entity IS in the bank and MUST be named). */
const ABSTAIN_SEEDS: AbstainSeed[] = [
  // abstain-shape — superlatives/numbers/names the bank does not carry
  { t: 'the single biggest star in the whole universe', kind: 'abstain' },
  { t: 'the exact number of stars in the sky', kind: 'abstain' },
  { t: 'the exact number of fish in the ocean', kind: 'abstain' },
  { t: 'the name of the very first tree on Earth', kind: 'abstain' },
  { t: 'the exact number of grains of sand on a beach', kind: 'abstain' },
  { t: 'the tallest mountain on a planet outside our solar system', kind: 'abstain' },
  { t: 'the exact day the sun will burn out', kind: 'abstain' },
  { t: 'the name of the smartest animal ever born', kind: 'abstain' },
  { t: 'the exact number of ants in the Philippines', kind: 'abstain' },
  { t: 'the deepest cave that has never been explored', kind: 'abstain' },
  { t: 'the exact number of raindrops in a storm', kind: 'abstain' },
  { t: 'the biggest animal that ever lived on another planet', kind: 'abstain' },
  { t: 'the name of the first fish that swam', kind: 'abstain' },
  { t: 'the exact number of leaves on a mango tree', kind: 'abstain' },
  { t: 'the exact temperature at the very center of a black hole', kind: 'abstain' },
  { t: 'the number of volcanoes that will erupt next year', kind: 'abstain' },
  { t: 'the strongest typhoon that will come next season', kind: 'abstain' },
  { t: 'the exact number of cells in one specific child’s body', kind: 'abstain' },
  { t: 'the name of the oldest star still shining', kind: 'abstain' },
  { t: 'the exact number of islands that will exist in 1000 years', kind: 'abstain' },
  // name-when-grounded — the bank carries the entity; the card MUST say it
  { t: 'the biggest planet in our solar system', kind: 'name' },
  { t: 'the closest planet to the sun', kind: 'name' },
  { t: 'the biggest animal in the world', kind: 'name' },
  { t: 'the fastest land animal', kind: 'name' },
  { t: 'the highest mountain in the Philippines', kind: 'name' },
  { t: 'the longest river in the Philippines', kind: 'name' },
  { t: 'the biggest fish in the ocean', kind: 'name' },
  { t: 'the national bird of the Philippines', kind: 'name' },
  { t: 'the star closest to Earth', kind: 'name' },
  { t: 'the smallest planet in our solar system', kind: 'name' },
];

interface CompressSeed {
  t: string;
  kind: 'multifact' | 'taxonomy';
}
const COMPRESS_SEEDS: CompressSeed[] = [
  // multi-fact: sets carrying names/numbers that must survive a <=28-word compression
  { t: 'the moons of Jupiter and who discovered them', kind: 'multifact' },
  { t: 'the planets of the solar system in order', kind: 'multifact' },
  { t: 'the first person who walked on the moon and when', kind: 'multifact' },
  { t: 'the colors of the rainbow and their order', kind: 'multifact' },
  { t: 'the layers of the Earth', kind: 'multifact' },
  { t: 'the three states of matter with examples', kind: 'multifact' },
  { t: 'the phases of the moon and their names', kind: 'multifact' },
  { t: 'active volcanoes in the Philippines and their names', kind: 'multifact' },
  { t: 'the deepest spot in the ocean and how deep it is', kind: 'multifact' },
  { t: 'how fast light travels', kind: 'multifact' },
  { t: 'how far the sun is from the Earth', kind: 'multifact' },
  { t: 'how many bones the human body has', kind: 'multifact' },
  { t: 'the continents of the world and how many there are', kind: 'multifact' },
  { t: 'the oceans of the world and their names', kind: 'multifact' },
  { t: 'the parts of a plant and what each does', kind: 'multifact' },
  { t: 'the water cycle steps and their names', kind: 'multifact' },
  { t: 'the biggest island in the Philippines and its size', kind: 'multifact' },
  { t: 'how long the Earth takes to orbit the sun', kind: 'multifact' },
  { t: 'how long the moon takes to orbit the Earth', kind: 'multifact' },
  { t: 'the hottest planet and why it is hotter than Mercury', kind: 'multifact' },
  { t: 'the number of chambers in the human heart and their job', kind: 'multifact' },
  { t: 'the biggest volcano eruption in Philippine history', kind: 'multifact' },
  { t: 'how many teeth children and adults have', kind: 'multifact' },
  { t: 'the speed of sound compared to light in a thunderstorm', kind: 'multifact' },
  { t: 'the gases in the air we breathe and their amounts', kind: 'multifact' },
  { t: 'the planets that have rings', kind: 'multifact' },
  { t: 'the tallest animal and how tall it grows', kind: 'multifact' },
  { t: 'the biggest flower in the world and where it grows', kind: 'multifact' },
  { t: 'the parts of a seed and what they become', kind: 'multifact' },
  { t: 'famous Filipino scientists and what they discovered', kind: 'multifact' },
  // taxonomy: a contrast in the facts ("X is A, NOT B") that must survive compression
  { t: 'whether a dolphin is a fish or a mammal', kind: 'taxonomy' },
  { t: 'whether a whale is a fish or a mammal', kind: 'taxonomy' },
  { t: 'whether a bat is a bird or a mammal', kind: 'taxonomy' },
  { t: 'whether a penguin is a bird even if it cannot fly', kind: 'taxonomy' },
  { t: 'whether a spider is an insect', kind: 'taxonomy' },
  { t: 'whether a tomato is a fruit or a vegetable', kind: 'taxonomy' },
  { t: 'whether a mushroom is a plant', kind: 'taxonomy' },
  { t: 'whether coral is a plant or an animal', kind: 'taxonomy' },
  { t: 'whether a jellyfish is a fish', kind: 'taxonomy' },
  { t: 'whether a starfish is a fish', kind: 'taxonomy' },
  { t: 'whether a frog is a reptile or an amphibian', kind: 'taxonomy' },
  { t: 'whether a snake is an amphibian or a reptile', kind: 'taxonomy' },
  { t: 'whether a sea turtle (pawikan) is an amphibian or a reptile', kind: 'taxonomy' },
  { t: 'whether a seahorse is a real fish', kind: 'taxonomy' },
  { t: 'whether an eel is a snake or a fish', kind: 'taxonomy' },
  { t: 'whether a crocodile is an amphibian or a reptile', kind: 'taxonomy' },
  { t: 'whether a butterfly is a bird', kind: 'taxonomy' },
  { t: 'whether a duck is a mammal or a bird', kind: 'taxonomy' },
  { t: 'whether the sun is a planet or a star', kind: 'taxonomy' },
  { t: 'whether the moon is a planet or a satellite', kind: 'taxonomy' },
  { t: 'whether Pluto is still counted as a planet', kind: 'taxonomy' },
  { t: 'whether a banana plant is a tree', kind: 'taxonomy' },
  { t: 'whether a shark has bones like other fish', kind: 'taxonomy' },
  { t: 'whether rice is a grass', kind: 'taxonomy' },
  { t: 'whether an octopus is a fish', kind: 'taxonomy' },
];

const EN_TOPICS: string[] = [
  'why rain falls', 'how clouds form', 'why the sky changes color at sunset',
  'what makes a rainbow', 'why we see lightning before hearing thunder', 'what magnets attract',
  'how electricity gets to our homes', 'why ice floats on water', 'what makes things sink or float',
  'why metal feels colder than wood', 'how plants drink water', 'why leaves are green',
  'how seeds travel to new places', 'why flowers smell nice', 'what bees do for plants',
  'what a food chain is', 'why some animals sleep in the day', 'how fish breathe underwater',
  'why birds fly south', 'how chicks hatch from eggs', 'why we need to breathe',
  'why our heart beats faster when running', 'how our bones help us move', 'why we sweat when hot',
  'why we need to drink water', 'what causes earthquakes', 'why typhoons bring strong winds',
  'why the Philippines has many volcanoes', 'what causes high tide and low tide',
  'why we have day and night', 'why the moon changes shape', 'what stars are made of',
  'why the sun looks bigger than other stars', 'what comets are', 'why astronauts wear space suits',
  'what soil is made of', 'why recycling helps the Earth', 'where garbage goes',
  'what makes shadows', 'why mirrors flip your reflection', 'how sound reaches our ears',
  'why an echo repeats your voice', 'how a thermometer works', 'why bread gets moldy',
  'why fireflies glow at night',
];

// =======================================================================================
// Query authoring + card writing prompts
// =======================================================================================
const LANG_NAME: Record<CardLanguage, string> = {
  tagalog: 'Tagalog',
  cebuano: 'Cebuano (Bisaya)',
  english: 'English',
};

const QUERY_ANGLES = [
  'ask it directly and plainly',
  'ask it starting from a concrete everyday situation (home, school, weather, food)',
  'ask it as a doubt or something a friend/classmate claimed',
  'ask it as a comparison ("X ba o Y", "mas ... ba")',
  'ask it in very few words, almost just the topic keywords',
  'ask it with a follow-up-style emphasis word (talaga/gyud/really)',
];

async function authorQuery(topic: string, lang: CardLanguage, shape: string, seed: string): Promise<string> {
  const rng = seededRng(seed);
  const style = rng() < 0.5 ? 'polite (with "po" if Tagalog)' : 'casual, short';
  const angle = QUERY_ANGLES[Math.floor(rng() * QUERY_ANGLES.length)]!;
  const prompt =
    `Write ONE question a Filipino grade-school child (grades 3-10) would TYPE into a science app, in natural ${LANG_NAME[lang]}.\n` +
    `Topic: ${topic}\n` +
    `Question shape: ${shape}\n` +
    `Phrasing angle: ${angle} — the wording must be DISTINCT from the most obvious phrasing of this question.\n` +
    `Style: ${style}, kid spelling and phrasing, ONE short line. No quotes around it.\n` +
    `Reply with ONLY JSON: {"query":"..."}`;
  const raw = await fwGenerate(prompt, 0.9);
  return String(parseJson(raw)?.query ?? '').replace(/\s+/g, ' ').trim();
}

interface WriteSpec {
  query: string;
  lang: CardLanguage;
  grade: number;
  facts: string[];
  /** Bucket-specific target-content instruction. */
  directive: string;
  /** Canonical settled-science statement (safety sublist only). */
  canonical?: string;
  escape?: boolean;
  allowUngrounded?: boolean;
  /** The target content is by definition supported (e.g. abstain rows: "state what the FACTS
   *  do support") — skip the writer's covered-gate, which mis-fires on that shape. */
  alwaysCovered?: boolean;
  /** Entity deny-list enforced by lint inside the retry loop (abstain rows: gate entities). */
  deny?: RegExp[];
}

async function writeCard(spec: WriteSpec): Promise<{ card: string; covered: boolean; violations: string[] }> {
  const base =
    `You are writing the TARGET answer for ONE training example of a children's science fact-card model.\n` +
    `Card language: ${LANG_NAME[spec.lang]}. Reader: Grade ${spec.grade} Filipino child.\n\n` +
    `FACTS (retrieved by the app):\n${spec.facts.map((f) => `- ${f}`).join('\n') || '(none)'}\n\n` +
    `QUESTION: ${spec.query}\n\n` +
    `TARGET CONTENT: ${spec.directive}\n` +
    (spec.canonical ? `CANONICAL STATEMENT (the settled science this card must convey, in the card's language): ${spec.canonical}\n` : '') +
    `\nWrite the fact card:\n` +
    `- 1-2 plain sentences, ONE line, AT MOST ${spec.escape ? 30 : 28} words.\n` +
    `- Natural ${LANG_NAME[spec.lang]}, vocabulary for Grade ${spec.grade} (Grades 3-4: common words; Grades 8-10: keep technical terms).\n` +
    (spec.canonical
      ? `- Base the card on the CANONICAL STATEMENT (translated naturally); the FACTS here do not cover it.\n`
      : `- Use ONLY information from the FACTS. Never add facts from memory.\n`) +
    `- FORBIDDEN: greetings, praise, preamble, any question mark, hedging ("hindi ko alam"), emoji, markdown, [image:] tags, meta-talk about the facts.\n\n` +
    (spec.alwaysCovered
      ? `Reply with ONLY JSON: {"covered":true,"card":"..."}`
      : `First decide: do the FACTS (or the CANONICAL STATEMENT if given) actually support the TARGET CONTENT? ` +
        `If not, set covered=false and leave card empty.\n` +
        `Reply with ONLY JSON: {"covered":true|false,"card":"..."}`);
  let card = '';
  let covered = false;
  let violations: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? base : `${base}\n\nYour previous card was rejected for: ${violations.join('; ')}. Fix those and reply with ONLY JSON.`;
    const obj = parseJson(await fwGenerate(prompt, attempt === 0 ? 0.3 : 0.6));
    covered = spec.alwaysCovered ? true : obj?.covered === true;
    card = String(obj?.card ?? '').replace(/\s+/g, ' ').trim();
    if (!covered) return { card: '', covered: false, violations: ['facts-dont-cover'] };
    violations = card
      ? lintCard({ card, lang: spec.lang, facts: spec.facts, escape: spec.escape, allowUngrounded: spec.allowUngrounded, deny: spec.deny })
      : ['empty'];
    if (!violations.length) break;
  }
  return { card, covered, violations };
}

// =======================================================================================
// Bucket runners — each emits BuiltRow[] to out/bucket-<name>.jsonl + rejects.
// =======================================================================================
const LIM = Number(process.env.GEN_LIMIT ?? '0');
const cut = <T,>(a: T[]): T[] => (LIM > 0 ? a.slice(0, LIM) : a);

const rejects: Array<Record<string, unknown>> = [];
function reject(bucket: string, id: string, reason: string, extra: Record<string, unknown> = {}): void {
  rejects.push({ stage: 'generate', bucket, id, reason, ...extra });
}

/** lang cycle helpers — exact splits without randomness. */
function cycleLang(i: number, pattern: CardLanguage[]): CardLanguage {
  return pattern[i % pattern.length]!;
}

async function runSafety(): Promise<BuiltRow[]> {
  const cache = new Cache(join(CACHE, 'safety.gen.jsonl'));
  const N = 360; // over-generated; collection caps per (cell, language) below
  const pattern: CardLanguage[] = ['tagalog', 'tagalog', 'cebuano', 'tagalog', 'cebuano', 'english'];
  // Per-(cell, LANGUAGE) caps — the language-conditional polarity guard. The 2×2 grid used to
  // balance only globally, and Cebuano landed 19 affirm vs 32 deny (true-yes ceb = 7): a
  // 37:63 language-conditional skew of exactly the correlation the grid exists to kill,
  // invisible to the global affirmCells/denyCells counter. Equal caps per cell per language
  // (plus the top-up pass) make affirm ≈ deny per language, not just in aggregate.
  const CELL_LANG_CAP: Record<CardLanguage, number> = { tagalog: 28, cebuano: 18, english: 10 };
  const CELLS: Cell[] = ['harmful-yes', 'myth-no', 'safe-no', 'true-yes'];
  const LANGS: CardLanguage[] = ['tagalog', 'cebuano', 'english'];

  interface STask {
    id: string;
    topic: SafetyTopic;
    lang: CardLanguage;
  }
  const mainTasks: STask[] = Array.from({ length: N }, (_, i) => {
    const topic = SAFETY_TOPICS[i % SAFETY_TOPICS.length]!;
    const lang = cycleLang(i, pattern);
    return { id: rowId('safety', String(i), topic.t, lang), topic, lang };
  });

  const gen = async ({ id, topic, lang }: STask) => {
    if (cache.has(id)) return;
    const grade = sampleGrade(id);
    const shapeByCell: Record<Cell, string> = {
      'harmful-yes': 'a yes/no-style question asking whether the harmful thing is bad/dangerous, or whether it is okay to do it',
      'myth-no': 'a yes/no-style question asking whether the myth is true',
      'safe-no': 'a yes/no-style question asking, worriedly, whether the safe thing is dangerous/harmful',
      'true-yes': 'a doubting yes/no-style question asking whether the true science fact is REALLY true',
    };
    const query = await authorQuery(topic.t, lang, shapeByCell[topic.cell], id);
    if (!query || contamination(query)) {
      cache.put(id, { skip: true, reason: query ? 'contamination' : 'no-query' });
      return;
    }
    const r = await route(query, lang);
    // The legal-claim clause in harmful-yes: a medium-effort re-judge caught a smoking card
    // claiming an outright ban where the FACTS state only that SALE to minors is banned —
    // "harmful to the body" is the card's claim to affirm; legal claims only as stated.
    // Register cues are LANGUAGE-AWARE: the old Tagalog-only cues ("Oo, totoo...", "ligtas")
    // planted Tagalog function words into Cebuano cards — the medium-effort judge rejected
    // every ceb true-yes row for exactly that ("totoo" is not Cebuano; tinuod/luwas are).
    const CUE: Record<Cell, Record<CardLanguage, string>> = {
      'harmful-yes': { tagalog: '"Oo, masama/delikado..."', cebuano: '"Oo, daotan/peligroso kini..."', english: '"Yes, it is harmful..."' },
      'myth-no': { tagalog: '"Hindi totoo..."', cebuano: '"Dili tinuod..."', english: '"No, that is not true..."' },
      'safe-no': { tagalog: '"Hindi, ligtas..."', cebuano: '"Dili, luwas ra..."', english: '"No, it is safe..."' },
      'true-yes': { tagalog: '"Oo, totoo..."', cebuano: '"Oo, tinuod..."', english: '"Yes, it is true..."' },
    };
    const directiveByCell: Record<Cell, string> = {
      'harmful-yes':
        `The card must clearly AFFIRM that this is harmful (${CUE['harmful-yes'][lang]} register) and give the scientific reason. ` +
        `Keep harm claims and LEGAL claims separate: state a law ONLY exactly as a FACT states it ` +
        `(e.g. if a FACT says selling to minors is banned, do NOT claim the act itself is outright banned by law). Topic: ${topic.t}.`,
      'myth-no': `The card must clearly DENY the myth (${CUE['myth-no'][lang]} register) and give the real science. Topic: ${topic.t}.`,
      'safe-no': `The card must clearly say this is NOT harmful (${CUE['safe-no'][lang]} register) and give the scientific reason. Topic: ${topic.t}.`,
      'true-yes': `The card must clearly AFFIRM that this is true (${CUE['true-yes'][lang]} register) and give the science. Topic: ${topic.t}.`,
    };
    const useCanonical = !!topic.settled && r.outcome === 'grounded';
    // Settled-science rows may proceed even on retrieval mismatch — that IS the trained case.
    if (r.outcome !== 'grounded') {
      cache.put(id, { skip: true, reason: `route-${r.outcome}` });
      return;
    }
    const w = await writeCard({
      query,
      lang,
      grade,
      facts: r.facts,
      directive: directiveByCell[topic.cell],
      canonical: topic.settled,
      allowUngrounded: !!topic.settled,
    });
    cache.put(id, { query, factIds: r.ids, facts: r.facts, grade, lang, cell: topic.cell, topic: topic.t, settled: !!topic.settled, ...w, canonicalUsed: useCanonical });
  };
  await pooled(cut(mainTasks), FW_CONC, gen);

  // Top-up pass: generate extra rows for every (cell, language) the main cycle under-served
  // (measured: ceb true-yes had 7 rows) by cycling that cell's own topics in that language.
  const usable = (t: STask) => {
    const g = cache.get(t.id);
    return !!g && !g.skip && g.covered && !g.violations?.length;
  };
  const have = new Map<string, number>();
  for (const t of mainTasks) {
    if (usable(t)) have.set(`${t.topic.cell}|${t.lang}`, (have.get(`${t.topic.cell}|${t.lang}`) ?? 0) + 1);
  }
  const topupTasks: STask[] = [];
  for (const cell of CELLS) {
    const pool = SAFETY_TOPICS.filter((t) => t.cell === cell);
    for (const lang of LANGS) {
      const short = CELL_LANG_CAP[lang] - (have.get(`${cell}|${lang}`) ?? 0);
      for (let k = 0; k < Math.max(0, short) * 2; k++) {
        const topic = pool[k % pool.length]!;
        topupTasks.push({ id: rowId('safety-topup', topic.t, lang, String(k)), topic, lang });
      }
    }
  }
  if (topupTasks.length) console.log(`   safety top-up: ${topupTasks.length} extra tasks for under-served (cell,lang)`);
  await pooled(cut(topupTasks), FW_CONC, gen);

  // Collection: per-(cell,lang) caps + identical-card cap; report the per-language balance.
  const rows: BuiltRow[] = [];
  const got = new Map<string, number>();
  const cardCounts = new Map<string, number>();
  for (const t of [...mainTasks, ...topupTasks]) {
    const g = cache.get(t.id);
    if (!g || g.skip) {
      if (g?.skip) reject('safety-myth', t.id, g.reason);
      continue;
    }
    if (!g.covered || g.violations?.length) {
      reject('safety-myth', t.id, g.violations?.join('; ') || 'not-covered', { cell: g.cell });
      continue;
    }
    const key = `${g.cell}|${g.lang}`;
    if ((got.get(key) ?? 0) >= CELL_LANG_CAP[g.lang as CardLanguage]) continue;
    if (!underCardTextCap(cardCounts, g.lang, g.card)) {
      reject('safety-myth', t.id, 'dup-card', { cell: g.cell });
      continue;
    }
    got.set(key, (got.get(key) ?? 0) + 1);
    rows.push({
      id: t.id,
      bucket: 'safety-myth',
      lang: g.lang,
      grade: g.grade,
      query: g.query,
      factIds: g.factIds,
      facts: g.facts,
      card: g.card,
      source: `seed:${g.topic}`,
      polarity: g.cell,
      allowUngrounded: g.settled || undefined,
    });
  }
  const perLang: Record<string, { affirm: number; deny: number }> = {};
  for (const r of rows) {
    const p = (perLang[r.lang] ??= { affirm: 0, deny: 0 });
    if (r.polarity === 'harmful-yes' || r.polarity === 'true-yes') p.affirm++;
    else p.deny++;
  }
  console.log('   safety per (cell,lang):', Object.fromEntries([...got.entries()].sort()));
  console.log('   safety affirm/deny per language:', JSON.stringify(perLang));
  return rows;
}

async function runThin(): Promise<BuiltRow[]> {
  const cache = new Cache(join(CACHE, 'thin.gen.jsonl'));
  const rows: BuiltRow[] = [];
  const quota: Record<CardLanguage, number> = { tagalog: 120, cebuano: 90, english: 40 };
  const langs: CardLanguage[] = ['tagalog', 'cebuano', 'english'];
  const tasks: Array<{ term: string; lang: CardLanguage; v: number }> = [];
  THIN_TERMS.forEach((term) => {
    for (const lang of langs) for (const v of [0, 1]) tasks.push({ term, lang, v });
  });
  await pooled(cut(tasks), FW_CONC, async ({ term, lang, v }) => {
    const id = rowId('thin', term, lang, String(v));
    if (cache.has(id)) return;
    const query = await authorQuery(
      term,
      lang,
      v === 0 ? 'a what/who question about this' : 'a why/when/how question about this',
      id
    );
    if (!query || contamination(query)) {
      cache.put(id, { skip: true, reason: query ? 'contamination' : 'no-query' });
      return;
    }
    const r = await route(query, lang);
    if (r.outcome !== 'grounded') {
      // Only real floor-clearing mismatches train the escape; off-domain/gap are model-free.
      cache.put(id, { skip: true, reason: `route-${r.outcome}` });
      return;
    }
    const grade = sampleGrade(id);
    // The target is the nearest FACT restated whole. Deterministic when a fact fits.
    let card = '';
    let deterministic = false;
    for (const f of r.facts) {
      const t = f.replace(/\s+/g, ' ').trim();
      if (wordCount(t) <= 30 && !lintCard({ card: t, lang, facts: r.facts, escape: true }).length) {
        card = t;
        deterministic = true;
        break;
      }
    }
    let violations: string[] = [];
    if (!card) {
      const w = await writeCard({
        query,
        lang,
        grade,
        facts: r.facts,
        directive:
          `No FACT answers this question (it is about "${term}", which the fact bank does not cover). ` +
          `The card must RESTATE the first FACT faithfully and completely, trimmed to fit 30 words. ` +
          `It must NOT mention "${term}", must NOT define it from memory, and must NOT force any connection to the question.`,
        escape: true,
      });
      card = w.card;
      violations = w.violations;
    }
    cache.put(id, { query, factIds: r.ids, facts: r.facts, grade, lang, term, card, deterministic, violations, covered: !!card });
  });
  const got: Record<CardLanguage, number> = { tagalog: 0, cebuano: 0, english: 0 };
  const cardCounts = new Map<string, number>();
  for (const { term, lang, v } of tasks) {
    const id = rowId('thin', term, lang, String(v));
    const g = cache.get(id);
    if (!g || g.skip) {
      if (g?.skip) reject('thin-escape', id, g.reason, { lang });
      continue;
    }
    if (!g.card || g.violations?.length) {
      reject('thin-escape', id, g.violations?.join('; ') || 'no-card', { lang });
      continue;
    }
    if (got[lang] >= quota[lang]) continue;
    if (!underCardTextCap(cardCounts, g.lang, g.card)) {
      reject('thin-escape', id, 'dup-card', { lang });
      continue;
    }
    got[lang]++;
    rows.push({
      id,
      bucket: 'thin-escape',
      lang: g.lang,
      grade: g.grade,
      query: g.query,
      factIds: g.factIds,
      facts: g.facts,
      card: g.card,
      source: `seed:${g.term}${g.deterministic ? ' (verbatim-fact)' : ''}`,
      escape: true,
    });
  }
  return rows;
}

async function runAbstain(): Promise<BuiltRow[]> {
  const cache = new Cache(join(CACHE, 'abstain.gen.jsonl'));
  const rows: BuiltRow[] = [];
  const N = 420; // over-generated; collection caps at 200 abstain / 100 name
  const pattern: CardLanguage[] = ['tagalog', 'tagalog', 'tagalog', 'cebuano', 'cebuano', 'english'];
  const tasks = Array.from({ length: N }, (_, i) => i);
  await pooled(cut(tasks), FW_CONC, async (i) => {
    const seed = ABSTAIN_SEEDS[i % ABSTAIN_SEEDS.length]!;
    const lang = cycleLang(i, pattern);
    const id = rowId('abstain', String(i), seed.t, lang);
    if (cache.has(id)) return;
    const grade = sampleGrade(id);
    const query = await authorQuery(seed.t, lang, 'a question asking for the specific name/number/superlative', id);
    if (!query || contamination(query)) {
      cache.put(id, { skip: true, reason: query ? 'contamination' : 'no-query' });
      return;
    }
    const r = await route(query, lang);
    if (r.outcome !== 'grounded') {
      cache.put(id, { skip: true, reason: `route-${r.outcome}` });
      return;
    }
    const directive =
      seed.kind === 'abstain'
        ? `The FACTS are adjacent to the topic but do NOT contain the specific ${'name/number'} the question asks for. ` +
          `The card must state only what the FACTS DO support about the topic — it must NOT name any entity or number that is absent from the FACTS, ` +
          `and it must NOT hedge or say "nobody knows". State the closest supported fact, whole. ` +
          // The Sirius lesson: a FACT can name a record-holder for a DIFFERENT superlative
          // (brightest star, when the child asked biggest/oldest). Restating IT teaches the
          // model to answer superlative queries with the wrong entity — the gate's
          // abstain-biggest-star failure, red by training. Prefer the generic facts.
          `If a FACT names a specific record-holder for a DIFFERENT superlative or number than the one asked (e.g. the brightest star when the child asked the biggest), do NOT name that entity — restate a generic fact from the set instead.`
        : `The FACTS DO contain the specific answer. The card MUST name it explicitly (the entity/number from the FACTS) — never abstain when the facts answer.`;
    const w = await writeCard({
      query,
      lang,
      grade,
      facts: r.facts,
      directive,
      escape: seed.kind === 'abstain',
      alwaysCovered: seed.kind === 'abstain',
      deny: seed.kind === 'abstain' ? abstainDenyRes() : undefined,
    });
    cache.put(id, { query, factIds: r.ids, facts: r.facts, grade, lang, kind: seed.kind, topic: seed.t, ...w });
  });
  const cardCounts = new Map<string, number>();
  for (const i of tasks) {
    const seed = ABSTAIN_SEEDS[i % ABSTAIN_SEEDS.length]!;
    const lang = cycleLang(i, pattern);
    const id = rowId('abstain', String(i), seed.t, lang);
    const g = cache.get(id);
    if (!g || g.skip) {
      if (g?.skip) reject('abstain-name', id, g.reason, { kind: seed.kind });
      continue;
    }
    if (!g.covered || g.violations?.length) {
      reject('abstain-name', id, g.violations?.join('; ') || 'not-covered', { kind: g.kind });
      continue;
    }
    // Deny-list re-check on CACHED cards too — a cache entry written before the deny rule
    // existed may still name a gate entity (the three measured Sirius rows).
    if (g.kind === 'abstain' && abstainDenyRes().some((re) => re.test(g.card))) {
      reject('abstain-name', id, 'deny-entity: gate mustNotContain entity in an abstain card', { kind: g.kind });
      continue;
    }
    const kindCap = g.kind === 'abstain' ? 200 : 100;
    const kindHave = rows.filter((r) => r.polarity === g.kind).length;
    if (kindHave >= kindCap) continue;
    if (!underCardTextCap(cardCounts, g.lang, g.card)) {
      reject('abstain-name', id, 'dup-card', { kind: g.kind });
      continue;
    }
    rows.push({
      id,
      bucket: 'abstain-name',
      lang: g.lang,
      grade: g.grade,
      query: g.query,
      factIds: g.factIds,
      facts: g.facts,
      card: g.card,
      source: `seed:${g.topic}`,
      polarity: g.kind,
      escape: g.kind === 'abstain' || undefined,
    });
  }
  return rows;
}

async function runCeb(): Promise<BuiltRow[]> {
  const cache = new Cache(join(CACHE, 'ceb.gen.jsonl'));
  const rows: BuiltRow[] = [];
  // AUTHENTIC Cebuano seeds, two pools (the synth-ceb lesson: reshape real Cebuano, never
  // free-generate):
  //   1. bucket-ceb-neutral queries (65 unique — the pool is heavily duplicated) with their
  //      original answers as register reference;
  //   2. the fact bank's own curated `bis` text on gate-adjacent topics (body organs, plants,
  //      earth science, weather): Fireworks writes the CHILD QUESTION from the Cebuano fact,
  //      the fact's own bis text is the register reference.
  const seeds: Array<{ key: string; query?: string; factBis?: string; reference: string }> = [];
  const neutral = readJsonl<{ messages: Array<{ role: string; content: string }> }>(
    join(ROOT, 'finetuning/sft-v1/bucket-ceb-neutral.jsonl')
  );
  const seenQ = new Set<string>();
  for (const row of neutral) {
    const q = row.messages.find((m) => m.role === 'user')?.content.replace(/\s+/g, ' ').trim() ?? '';
    const a = row.messages.filter((m) => m.role === 'assistant').map((m) => m.content).join(' ');
    const key = q.toLowerCase();
    if (!q || q.length > 120 || seenQ.has(key) || contamination(q) || isChitchatQuery(q)) continue;
    seenQ.add(key);
    seeds.push({ key: `nq:${q}`, query: q, reference: a.slice(0, 600) });
  }
  const TOPIC_RE =
    /heart|blood|lung|bone|muscle|digest|breath|body|sense|plant|photosynth|seed|leaf|root|flower|volcan|earthquake|weather|typhoon|rain|cloud|water.?cycle|soil|rock|tide|season|animal|insect|fish|bird|mammal|energy|matter|force|magnet|light|sound/i;
  const bank = readJsonl<any>(join(ROOT, 'rag/bank/science-facts.jsonl'));
  const eligible = bank.filter(
    (f) => f?.fact?.bis && TOPIC_RE.test(`${f.topic} ${f.id}`) && String(f.fact.bis).length > 60
  );
  const rng = seededRng('ceb-bank-seeds');
  const picked = new Set<number>();
  while (picked.size < Math.min(430, eligible.length)) picked.add(Math.floor(rng() * eligible.length));
  for (const i of picked) {
    const f = eligible[i]!;
    seeds.push({ key: `bank:${f.id}`, factBis: String(f.fact.bis), reference: String(f.fact.bis) });
  }
  const TARGET = 300;
  await pooled(cut(seeds), FW_CONC, async (s) => {
    const id = rowId('cebq', s.key);
    if (cache.has(id)) return;
    const grade = sampleGrade(id);
    let query = s.query ?? '';
    if (!query) {
      const raw = await fwGenerate(
        `Here is a verified science fact in Cebuano (Bisaya):\n${s.factBis}\n\n` +
          `Write ONE question a Bisaya grade-school child would TYPE into a science app that THIS fact answers. ` +
          `Natural, conversational Cebuano, kid phrasing, ONE short line. Do not copy the fact's wording — ask about it.\n` +
          `Reply with ONLY JSON: {"query":"..."}`,
        0.7
      );
      query = String(parseJson(raw)?.query ?? '').replace(/\s+/g, ' ').trim();
    }
    if (!query || contamination(query)) {
      cache.put(id, { skip: true, reason: query ? 'contamination' : 'no-query' });
      return;
    }
    const r = await route(query, 'cebuano');
    if (r.outcome !== 'grounded') {
      cache.put(id, { skip: true, reason: `route-${r.outcome}` });
      return;
    }
    const w = await writeCard({
      query,
      lang: 'cebuano',
      grade,
      facts: r.facts,
      directive:
        `Answer the child's question from the FACTS in NATURAL, conversational Cebuano — never stilted word-by-word translation. ` +
        `The REGISTER REFERENCE below shows how natural Cebuano science prose sounds (do not copy its length or chat style):\n` +
        `REGISTER REFERENCE: ${s.reference}`,
    });
    cache.put(id, { query, factIds: r.ids, facts: r.facts, grade, lang: 'cebuano', ...w });
  });
  const cardCounts = new Map<string, number>();
  for (const s of seeds) {
    if (rows.length >= TARGET) break;
    const id = rowId('cebq', s.key);
    const g = cache.get(id);
    if (!g || g.skip) {
      if (g?.skip) reject('ceb-quality', id, g.reason);
      continue;
    }
    if (!g.covered || g.violations?.length) {
      reject('ceb-quality', id, g.violations?.join('; ') || 'not-covered');
      continue;
    }
    if (!underCardTextCap(cardCounts, 'cebuano', g.card)) {
      reject('ceb-quality', id, 'dup-card');
      continue;
    }
    rows.push({
      id,
      bucket: 'ceb-quality',
      lang: 'cebuano',
      grade: g.grade,
      query: g.query,
      factIds: g.factIds,
      facts: g.facts,
      card: g.card,
      source: s.key.startsWith('nq:') ? 'seed:bucket-ceb-neutral' : 'seed:bank-bis',
    });
  }
  return rows;
}

/** Deterministic entity-retention check for the compression bucket: numbers + capitalized
 *  mid-sentence names in the facts must survive into the card (>=2 when >=2 exist). */
function entityRetentionMiss(card: string, facts: string[]): string | null {
  const ents = new Set<string>();
  for (const f of facts) {
    for (const m of f.match(/\d[\d,.]*/g) ?? []) ents.add(m.replace(/[,.]$/, ''));
    for (const m of f.match(/(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/g) ?? []) ents.add(m);
  }
  if (!ents.size) return null;
  const inCard = [...ents].filter((e) => card.toLowerCase().includes(e.toLowerCase()));
  const need = Math.min(2, ents.size);
  if (inCard.length >= need) return null;
  return `entity-retention: card keeps ${inCard.length}/${ents.size} fact entities (need ${need})`;
}

async function runCompress(): Promise<BuiltRow[]> {
  const cache = new Cache(join(CACHE, 'compress.gen.jsonl'));
  const rows: BuiltRow[] = [];
  const N = 330; // over-generated; collection caps at 120 multifact / 100 taxonomy
  const pattern: CardLanguage[] = [
    'tagalog', 'tagalog', 'cebuano', 'tagalog', 'cebuano', 'english',
    'tagalog', 'cebuano', 'tagalog', 'tagalog', 'cebuano', 'english',
    'tagalog', 'cebuano', 'tagalog', 'tagalog', 'cebuano', 'english',
    'tagalog', 'cebuano', 'tagalog', 'english',
  ]; // 11 tl / 8 ceb (approx via cycle) — exact split reported by validate.mts
  const tasks = Array.from({ length: N }, (_, i) => i);
  await pooled(cut(tasks), FW_CONC, async (i) => {
    const seed = COMPRESS_SEEDS[i % COMPRESS_SEEDS.length]!;
    const lang = cycleLang(i, pattern);
    const id = rowId('compress', String(i), seed.t, lang);
    if (cache.has(id)) return;
    const grade = sampleGrade(id);
    const query = await authorQuery(seed.t, lang, 'a question asking about this (expects the names/numbers/classification in the answer)', id);
    if (!query || contamination(query)) {
      cache.put(id, { skip: true, reason: query ? 'contamination' : 'no-query' });
      return;
    }
    const r = await route(query, lang);
    if (r.outcome !== 'grounded') {
      cache.put(id, { skip: true, reason: `route-${r.outcome}` });
      return;
    }
    const directive =
      seed.kind === 'multifact'
        ? `Compress the FACTS into the card while KEEPING the load-bearing named entities and numbers (names, counts, dates). Dropping a name the answer depends on is a failure.`
        : `The FACTS contain a classification contrast (X is A, NOT B). The card must preserve the contrast explicitly — both the correct class and the rejected one.`;
    const w = await writeCard({ query, lang, grade, facts: r.facts, directive });
    let violations = w.violations;
    if (w.covered && !violations.length && seed.kind === 'multifact') {
      const miss = entityRetentionMiss(w.card, r.facts);
      if (miss) violations = [miss];
    }
    cache.put(id, { query, factIds: r.ids, facts: r.facts, grade, lang, kind: seed.kind, topic: seed.t, ...w, violations });
  });
  const cardCounts = new Map<string, number>();
  for (const i of tasks) {
    const seed = COMPRESS_SEEDS[i % COMPRESS_SEEDS.length]!;
    const lang = cycleLang(i, pattern);
    const id = rowId('compress', String(i), seed.t, lang);
    const g = cache.get(id);
    if (!g || g.skip) {
      if (g?.skip) reject('compress', id, g.reason, { kind: seed.kind });
      continue;
    }
    if (!g.covered || g.violations?.length) {
      reject('compress', id, g.violations?.join('; ') || 'not-covered', { kind: g.kind });
      continue;
    }
    const kindCap = g.kind === 'multifact' ? 120 : 100;
    const kindHave = rows.filter((r) => r.polarity === g.kind).length;
    if (kindHave >= kindCap) continue;
    if (!underCardTextCap(cardCounts, g.lang, g.card)) {
      reject('compress', id, 'dup-card', { kind: g.kind });
      continue;
    }
    rows.push({
      id,
      bucket: 'compress',
      lang: g.lang,
      grade: g.grade,
      query: g.query,
      factIds: g.factIds,
      facts: g.facts,
      card: g.card,
      source: `seed:${g.topic}`,
      polarity: g.kind,
    });
  }
  return rows;
}

async function runEn(): Promise<BuiltRow[]> {
  const cache = new Cache(join(CACHE, 'en.gen.jsonl'));
  const rows: BuiltRow[] = [];
  const N = 225; // over-generated; collection caps at 180
  const tasks = Array.from({ length: N }, (_, i) => i);
  await pooled(cut(tasks), FW_CONC, async (i) => {
    const topic = EN_TOPICS[i % EN_TOPICS.length]!;
    const id = rowId('en', String(i), topic);
    if (cache.has(id)) return;
    const grade = sampleGrade(id);
    const query = await authorQuery(topic, 'english', 'any curious question about this', id);
    if (!query || contamination(query)) {
      cache.put(id, { skip: true, reason: query ? 'contamination' : 'no-query' });
      return;
    }
    const r = await route(query, 'english');
    if (r.outcome !== 'grounded') {
      cache.put(id, { skip: true, reason: `route-${r.outcome}` });
      return;
    }
    const w = await writeCard({
      query,
      lang: 'english',
      grade,
      facts: r.facts,
      directive: 'Answer the question from the FACTS in plain English — the card must be pure English (no Filipino function words).',
    });
    cache.put(id, { query, factIds: r.ids, facts: r.facts, grade, lang: 'english', topic, ...w });
  });
  const cardCounts = new Map<string, number>();
  for (const i of tasks) {
    const topic = EN_TOPICS[i % EN_TOPICS.length]!;
    const id = rowId('en', String(i), topic);
    const g = cache.get(id);
    if (!g || g.skip) {
      if (g?.skip) reject('en-topup', id, g.reason);
      continue;
    }
    if (!g.covered || g.violations?.length) {
      reject('en-topup', id, g.violations?.join('; ') || 'not-covered');
      continue;
    }
    if (rows.length >= 180) continue;
    if (!underCardTextCap(cardCounts, 'english', g.card)) {
      reject('en-topup', id, 'dup-card');
      continue;
    }
    rows.push({
      id,
      bucket: 'en-topup',
      lang: 'english',
      grade: g.grade,
      query: g.query,
      factIds: g.factIds,
      facts: g.facts,
      card: g.card,
      source: `seed:${topic}`,
    });
  }
  return rows;
}

// =======================================================================================
async function main(): Promise<void> {
  assertFireworksKey();
  await assertEmbedder();
  const which = (process.env.BUCKETS ?? 'safety,thin,abstain,ceb,compress,en').split(',');
  const runners: Record<string, { file: string; run: () => Promise<BuiltRow[]> }> = {
    safety: { file: 'bucket-safety.jsonl', run: runSafety },
    thin: { file: 'bucket-thin.jsonl', run: runThin },
    abstain: { file: 'bucket-abstain.jsonl', run: runAbstain },
    ceb: { file: 'bucket-ceb.jsonl', run: runCeb },
    compress: { file: 'bucket-compress.jsonl', run: runCompress },
    en: { file: 'bucket-en.jsonl', run: runEn },
  };
  for (const name of which) {
    const r = runners[name.trim()];
    if (!r) continue;
    console.log(`\n== bucket ${name} ==`);
    const rows = await r.run();
    writeFileSync(join(OUT, r.file), rows.map((x) => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''));
    const byLang = new Map<string, number>();
    for (const row of rows) byLang.set(row.lang, (byLang.get(row.lang) ?? 0) + 1);
    console.log(`>> ${name}: ${rows.length} rows (pre-judge)`, Object.fromEntries(byLang));
  }
  writeFileSync(join(OUT, 'rejects-generate.jsonl'), rejects.map((r) => JSON.stringify(r)).join('\n') + (rejects.length ? '\n' : ''));
  const byReason = new Map<string, number>();
  for (const r of rejects) {
    const k = String(r.reason).split(':')[0]!.split(';')[0]!;
    byReason.set(k, (byReason.get(k) ?? 0) + 1);
  }
  console.log('>> generate rejects:', Object.fromEntries([...byReason.entries()].sort((a, b) => b[1] - a[1])));
  console.log('>> fireworks usage:', fwUsage());
}

await main();
