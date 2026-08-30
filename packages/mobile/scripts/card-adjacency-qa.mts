/**
 * Card-feed ADJACENCY QA — the instrument for "does the next card make sense after this one?"
 *
 * Walks the REAL card graph (src/data/cards.ts) exactly the way cardStore.advance() walks it
 * — threadDepth / BRANCH_EVERY cadence, lateral-resets-the-thread, the session seen-set — and
 * emits every ADJACENT PAIR it produces, scored by the checks a machine can do alone:
 * illustration reuse, text overlap, term overlap. Anything a machine CANNOT see (two facts
 * that share the word "tubig" and nothing else) is left to a judging agent, which consumes
 * the sampled pairs written to $OUT.
 *
 * It deliberately does NOT reimplement nextChoices — it imports it, so the measurement can
 * never drift from what ships. It shims cards.ts's app-only imports (@hiraia/shared, the
 * generated pool, the questions JSON) to source paths so it runs under tsx without Metro
 * (same trick as card-harness.mts).
 *
 * Interject pages (quiz / reward / search) are not simulated: they intercept a page turn but
 * honor the choice afterwards, so they never change WHICH card follows which. Shake-to-reroll
 * is not simulated either — it is a deliberate topic break, not an adjacency claim.
 *
 *   npx tsx scripts/card-adjacency-qa.mts
 *   RUNS=30 CARDS=60 SAMPLE=300 npx tsx scripts/card-adjacency-qa.mts
 *   OUT=/tmp/before.json npx tsx scripts/card-adjacency-qa.mts        # save a baseline
 *   BASELINE=/tmp/before.json npx tsx scripts/card-adjacency-qa.mts   # BEFORE -> AFTER table
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CARDS_SRC, loadCards } from './load-cards-node.mts';

const MOBILE = new URL('..', import.meta.url).pathname;

// ---- config ----
const RUNS = Number(process.env.RUNS ?? 20);
const CARDS = Number(process.env.CARDS ?? 60);
const SAMPLE = Number(process.env.SAMPLE ?? 300);
const OUT = process.env.OUT ?? '/tmp/adjacency-pairs.json';
const BASELINE = process.env.BASELINE ?? '';
const LANG = (process.env.LANG_CODE ?? 'tagalog') as Lang;
// Fixed seed by default: the whole point of the BASELINE delta table is that a metric move
// is attributable to a tuning change, not to which random start cards a run happened to draw.
const SEED = Number(process.env.SEED ?? 20260822);

type Lang = 'tagalog' | 'english' | 'cebuano';

// ---- deterministic RNG, installed BEFORE cards.ts loads ----
// cards.ts picks lateral edges and start cards with Math.random(); overriding it globally is
// the only way to make the walk reproducible without touching that file (another agent owns it).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
Math.random = rand;

// ---- load the real graph ----
const STORE_SRC = readFileSync(join(MOBILE, 'src/store/cardStore.ts'), 'utf8');

/**
 * Does the app actually use the graph's illustration-cooldown trail?
 *
 * `recentIds` is optional on nextChoices, so the graph can support a cooldown that the
 * store never switches on — and then the harness would report numbers the device cannot
 * deliver. Both sides are detected from source rather than assumed, so this instrument
 * keeps measuring the SHIPPING path by itself as either file changes. TRAIL=on|off forces
 * it, which is how you A/B the cooldown without checking out an old revision.
 */
// Provenance for an A/B: which revision of the graph produced these numbers. cards.ts is
// under active tuning, so a run can otherwise race a save and be silently attributed to the
// wrong revision (observed once while building this harness).
const GRAPH_HASH = createHash('sha1').update(CARDS_SRC).digest('hex').slice(0, 8);
const GRAPH_HAS_TRAIL = /recentIds/.test(CARDS_SRC);
const STORE_PASSES_TRAIL = /nextChoices\([\s\S]{0,200}?recentIds/.test(STORE_SRC);
const TRAIL =
  process.env.TRAIL === 'on' ? true
  : process.env.TRAIL === 'off' ? false
  : GRAPH_HAS_TRAIL && STORE_PASSES_TRAIL;

// cardStore.RECENT_WINDOW — the trail it keeps and hands to nextChoices.
const RECENT_WINDOW = 5;

const EMPTY_TEXT = { tl: '', en: '', bis: '' };
/** Text for a card, from the bulk map above. */
const textOf = (c: { id: string }) => TEXT.get(c.id) ?? EMPTY_TEXT;

interface CardFact {
  id: string;
  factId: string;
  domain: string;
  topic: string;
  terms: string[];
  slug: string;
}
interface CardChoice {
  factId: string;
  label: string;
  kind: 'deep' | 'lateral';
}

// ---- corpus statistics ----
// cards.ts keeps TERM_INDEX private, so document frequency is recomputed here from the SAME
// generated pool. Reading the JSON directly (rather than exporting the index) keeps this a
// read-only observer of a file another agent owns.
const POOL: CardFact[] = (
  JSON.parse(readFileSync(join(MOBILE, 'src/generated/cardsIndex.generated.json'), 'utf8')) as {
    cards: CardFact[];
  }
).cards;
/**
 * The card TEXT, read straight from the source the database is built from. The app fetches
 * this per card at runtime; the harness needs it in bulk to measure wording similarity, and
 * reading the JSON keeps it a read-only observer of a file it does not own.
 */
const TEXT = new Map<string, { tl: string; en: string; bis: string }>(
  (
    JSON.parse(readFileSync(join(MOBILE, '../../rag/pipeline/cardsPool.app.json'), 'utf8')) as {
      cards: Array<{ id: string; fact: { tl: string; en: string; bis: string } }>;
    }
  ).cards.map((c) => [c.id, c.fact])
);
const DF = new Map<string, number>();
for (const f of POOL) for (const t of new Set(f.terms)) DF.set(t, (DF.get(t) ?? 0) + 1);
const df = (t: string) => DF.get(t) ?? 1;

// A term is "high-DF" — too common to be evidence of a real relationship — at the 99th
// percentile of the pool's term-frequency distribution (measured: p99 = 58; the head is
// tubig 1179, water 1068, init 768). Two cards sharing ONLY such a term are the "middle
// band" the deterministic checks can flag but not resolve: they go to the judge.
const DF_COMMON = 58;

// Function words appear in essentially every Tagalog/English sentence, so leaving them in
// would give every unrelated pair a floor of shared tokens and flatten the jaccard signal.
const STOP = new Set([
  'ang', 'ng', 'sa', 'mga', 'ay', 'na', 'ba', 'ito', 'iyan', 'ang', 'may', 'para', 'kung',
  'nang', 'din', 'rin', 'ito', 'iyon', 'nito', 'niya', 'nila', 'kanilang', 'isang', 'isa',
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'is', 'are', 'be', 'it', 'its',
  'that', 'this', 'for', 'with', 'as', 'at', 'by', 'from', 'can', 'you', 'your', 'when',
  'ug', 'og', 'nga', 'kini', 'kana', 'usa', 'aduna', 'adunay', 'ka', 'mao',
]);
function contentTokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of (s.toLowerCase().match(/[a-z0-9ñ]+/gi) ?? [])) {
    const t = w.toLowerCase();
    if (t.length > 2 && !STOP.has(t)) out.add(t);
  }
  return out;
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
/** idf-weighted term overlap — same formula cards.ts ranks deep edges with. */
function idfOverlap(a: CardFact, b: CardFact): number {
  const bt = new Set(b.terms);
  let s = 0;
  for (const t of a.terms) if (bt.has(t)) s += 1 / df(t);
  return s;
}

// ---- pair record (this shape is the judge's input contract) ----
interface Pair {
  walk: number;
  index: number; // position of the FROM card in its walk
  policy: string;
  step: 'deep' | 'lateral';
  /** deep | lateral | fork-deep | fork-lateral — a fork is a page that offered two choices. */
  stepKind: string;
  /** why the page forked, when it did: the BRANCH_EVERY cadence, or a card with no neighbour. */
  forkReason: 'cadence' | 'dead-end' | null;
  fromId: string;
  toId: string;
  fromTopic: string;
  toTopic: string;
  fromDomain: string;
  toDomain: string;
  fromSlug: string;
  toSlug: string;
  sameSlug: boolean;
  fromTl: string;
  toTl: string;
  fromEn: string;
  toEn: string;
  jaccard: number;
  sharedTerms: string[];
  /** DF of the rarest shared term — the strongest evidence the two cards are related. */
  rarestSharedDf: number | null;
  idfOverlap: number;
  /** idfOverlap as a fraction of the FROM card's self-score (cards.ts's near-dup yardstick). */
  selfFrac: number;
  flags: string[];
}

/** Flags that count against the feed. An intended lateral jump is not a defect. */
const DEFECT_FLAGS = new Set(['same-slug', 'near-identical-text', 'deep-random-fallback', 'weak-link']);

const POLICIES: Array<{ name: string; pick: (i: number) => number }> = [
  // Policy only matters on a fork page (~1 card in 8), so runs cycle through all four
  // instead of multiplying wall-clock by four to cover them.
  { name: 'deep-diver', pick: () => 0 },
  { name: 'topic-hopper', pick: () => 1 },
  { name: 'wanderer', pick: (i) => i % 2 },
  { name: 'random', pick: () => (rand() < 0.5 ? 0 : 1) },
];

/** nextChoices options, with the trail included only when the app itself includes it. */
const opts = (threadDepth: number, recent: readonly string[]) =>
  TRAIL ? { threadDepth, recentIds: recent } : { threadDepth };

async function main() {
  const t0 = Date.now();
  const C = await loadCards();
  const BRANCH_EVERY: number = C.BRANCH_EVERY;

  const pairs: Pair[] = [];
  const slugSeqs: string[][] = []; // per-walk slug sequence, for the repeat-within-N metrics
  let stoppedEarly = 0;
  let cardsWalked = 0;

  for (let r = 0; r < RUNS; r++) {
    const policy = POLICIES[r % POLICIES.length]!;
    const seen = new Set<string>();
    const slugs: string[] = [];

    // mirrors cardStore.hydrate(): first card, threadDepth 0, trail = just this card
    let cur = C.startCard(seen) as CardFact;
    seen.add(cur.id);
    slugs.push(cur.slug);
    let recent = [cur.id];
    let depthUsed = 0; // the threadDepth that produced `choices`
    let choices = C.nextChoices(cur.id, seen, LANG, opts(depthUsed, recent)) as CardChoice[];
    let threadDepth = 0;
    cardsWalked++;

    for (let i = 0; i < CARDS - 1; i++) {
      if (!choices.length) {
        stoppedEarly++; // genuinely stuck — nextChoices returned nothing
        break;
      }
      const fork = choices.length > 1;
      const chosen = (fork ? choices[policy.pick(i) % choices.length] : choices[0]) as CardChoice;
      const next = C.getCard(chosen.factId) as CardFact | undefined;
      if (!next) break;

      pairs.push(makePair(cur, next, {
        walk: r,
        index: i,
        policy: policy.name,
        step: chosen.kind,
        fork,
        // a fork below the cadence can only have come from the dead-end escape hatch
        forkReason: fork ? (depthUsed >= BRANCH_EVERY ? 'cadence' : 'dead-end') : null,
      }));

      // cardStore.advance(): a lateral pick IS a topic switch, so it restarts the thread,
      // and the trail is pushed BEFORE the next lookup (it includes the card just turned to).
      const depth = chosen.kind === 'lateral' ? 0 : threadDepth + 1;
      seen.add(next.id);
      recent = [...recent, next.id].slice(-RECENT_WINDOW);
      depthUsed = depth;
      choices = C.nextChoices(next.id, seen, LANG, opts(depth, recent)) as CardChoice[];
      threadDepth = choices.length > 1 ? 0 : depth;
      cur = next;
      slugs.push(cur.slug);
      cardsWalked++;
    }
    slugSeqs.push(slugs);
  }

  const elapsed = (Date.now() - t0) / 1000;
  const metrics = computeMetrics(pairs, slugSeqs, cardsWalked, stoppedEarly);
  const dist = computeDistributions(pairs);
  const sample = evenSample(pairs, SAMPLE);

  const dump = {
    config: { RUNS, CARDS, SAMPLE, SEED, LANG, BRANCH_EVERY, trail: TRAIL, graphHash: GRAPH_HASH, pool: POOL.length, generated: new Date().toISOString() },
    metrics,
    dist,
    pairs: sample,
  };
  writeFileSync(OUT, JSON.stringify(dump, null, 1));

  report(metrics, dist, pairs, sample.length, elapsed, BRANCH_EVERY);
}

function makePair(
  a: CardFact,
  b: CardFact,
  meta: { walk: number; index: number; policy: string; step: 'deep' | 'lateral'; fork: boolean; forkReason: 'cadence' | 'dead-end' | null }
): Pair {
  const shared = [...new Set(a.terms)].filter((t) => b.terms.includes(t));
  const j = jaccard(contentTokens(textOf(a) .tl), contentTokens(textOf(b).tl));
  const ov = idfOverlap(a, b);
  const self = idfOverlap(a, a) || 1;
  const rarest = shared.length ? Math.min(...shared.map(df)) : null;
  const flags: string[] = [];
  // Same rule as `sameSlug` below: an empty slug is not an illustration, so two typographic
  // cards in a row are not a repeat. Flagging them contradicted this script's own metric.
  if (a.slug !== '' && a.slug === b.slug) flags.push('same-slug');
  if (j > 0.5) flags.push('near-identical-text');
  // Zero overlap is the DESIGNED behaviour of a lateral fork (a deliberately fresh topic);
  // on a deep step it means the term index found nothing and a random fallback filled in.
  if (!shared.length) flags.push(meta.step === 'deep' ? 'deep-random-fallback' : 'zero-term-overlap');
  // exactly one shared term and it's a pool-wide common word: term overlap "sees" a link
  // that probably isn't one. This is the band only a semantic judge can settle.
  if (shared.length === 1 && rarest !== null && rarest >= DF_COMMON) flags.push('weak-link');
  return {
    walk: meta.walk,
    index: meta.index,
    policy: meta.policy,
    step: meta.step,
    stepKind: meta.fork ? `fork-${meta.step}` : meta.step,
    forkReason: meta.forkReason,
    fromId: a.id,
    toId: b.id,
    fromTopic: a.topic,
    toTopic: b.topic,
    fromDomain: a.domain,
    toDomain: b.domain,
    fromSlug: a.slug,
    toSlug: b.slug,
    // An EMPTY slug is not an illustration: a typographic card shows no picture at all, so
    // two of them in a row is not a repeat a reader can perceive. Since the DepEd cards and
    // the re-matched originals made typographic a common, legitimate state (11,712 cards),
    // counting '' === '' as a repeat inflated this metric and its own chance floor together.
    sameSlug: a.slug !== '' && a.slug === b.slug,
    fromTl: textOf(a).tl,
    toTl: textOf(b).tl,
    fromEn: textOf(a).en,
    toEn: textOf(b).en,
    jaccard: round(j, 3),
    sharedTerms: shared,
    rarestSharedDf: rarest,
    idfOverlap: round(ov, 4),
    selfFrac: round(ov / self, 3),
    flags,
  };
}

// ---- metrics (flat Record so the BASELINE delta table stays generic) ----
type Metrics = Record<string, number>;

function computeMetrics(pairs: Pair[], slugSeqs: string[][], cards: number, stoppedEarly: number): Metrics {
  const n = pairs.length || 1;
  const m: Metrics = {};
  m['pairs'] = pairs.length;
  m['cards'] = cards;
  m['walksStoppedEarly'] = stoppedEarly;

  // --- illustration repeats ---
  m['sameSlugRate'] = pct(pairs.filter((p) => p.sameSlug).length, n);
  for (const N of [1, 3, 5]) m[`slugRepeatWithin${N}`] = repeatWithin(slugSeqs, N);
  // Per WALK, not pooled: a child sees one session, so cross-session slug reuse is not a
  // repeat they can perceive.
  m['distinctSlugRate'] = round(
    mean(
      slugSeqs
        .map((s) => s.filter(Boolean))
        .filter((s) => s.length)
        .map((s) => (100 * new Set(s).size) / s.length)
    ),
    2
  );
  m['sameSlugChanceFloor'] = chanceFloor();
  for (const k of ['deep', 'lateral', 'fork-deep', 'fork-lateral']) {
    const sub = pairs.filter((p) => p.stepKind === k);
    if (sub.length) m[`sameSlugRate.${k}`] = pct(sub.filter((p) => p.sameSlug).length, sub.length);
  }

  // --- text similarity ---
  const js = pairs.map((p) => p.jaccard).sort((a, b) => a - b);
  m['jaccardMean'] = round(mean(js), 3);
  m['jaccardMedian'] = round(quantile(js, 0.5), 3);
  m['jaccardP90'] = round(quantile(js, 0.9), 3);
  m['jaccardP99'] = round(quantile(js, 0.99), 3);
  m['jaccardGt50Rate'] = pct(pairs.filter((p) => p.jaccard > 0.5).length, n);
  m['jaccardGt30Rate'] = pct(pairs.filter((p) => p.jaccard > 0.3).length, n);

  // --- term overlap ---
  const st = pairs.map((p) => p.sharedTerms.length).sort((a, b) => a - b);
  m['sharedTermsMean'] = round(mean(st), 2);
  m['sharedTermsMedian'] = round(quantile(st, 0.5), 2);
  m['zeroOverlapRate'] = pct(pairs.filter((p) => !p.sharedTerms.length).length, n);
  for (const k of ['deep', 'lateral'] as const) {
    const sub = pairs.filter((p) => p.step === k);
    if (sub.length) m[`zeroOverlapRate.${k}`] = pct(sub.filter((p) => !p.sharedTerms.length).length, sub.length);
  }
  m['oneTermRate'] = pct(pairs.filter((p) => p.sharedTerms.length === 1).length, n);
  // Median DF of the single link term: if it is small the lone shared term is distinctive
  // (a real edge); if it is large the pair is held together by a word like "tubig".
  m['oneTermLinkDfMedian'] = quantile(
    pairs.filter((p) => p.sharedTerms.length === 1).map((p) => p.rarestSharedDf ?? 0).sort((a, b) => a - b),
    0.5
  );
  m['weakLinkRate'] = pct(pairs.filter((p) => p.flags.includes('weak-link')).length, n);
  m['idfOverlapMean'] = round(mean(pairs.map((p) => p.idfOverlap)), 4);
  m['selfFracMean'] = round(mean(pairs.map((p) => p.selfFrac)), 3);

  // --- step mix ---
  m['forkRate'] = pct(pairs.filter((p) => p.forkReason).length, n);
  m['deadEndForkRate'] = pct(pairs.filter((p) => p.forkReason === 'dead-end').length, n);
  m['lateralRate'] = pct(pairs.filter((p) => p.step === 'lateral').length, n);
  m['crossDomainRate'] = pct(pairs.filter((p) => p.fromDomain !== p.toDomain).length, n);

  // --- one headline number: pairs a child could read as a repeat or a non-sequitur ---
  // `zero-term-overlap` is excluded: on a lateral fork it is the intended fresh topic, and
  // counting an intended jump as a defect would make the headline unfalsifiable.
  m['suspectRate'] = pct(pairs.filter((p) => p.flags.some((f) => DEFECT_FLAGS.has(f))).length, n);
  return m;
}

/** Share of cards whose illustration already appeared in the previous N cards of that walk. */
function repeatWithin(slugSeqs: string[][], N: number): number {
  let hits = 0;
  let total = 0;
  for (const seq of slugSeqs) {
    for (let i = 1; i < seq.length; i++) {
      total++;
      if (!seq[i]) continue; // a card with no illustration cannot repeat one
      for (let k = Math.max(0, i - N); k < i; k++) {
        if (seq[k] && seq[k] === seq[i]) {
          hits++;
          break;
        }
      }
    }
  }
  return pct(hits, total || 1);
}

/**
 * Probability that a UNIFORMLY RANDOM next card would share the current card's illustration.
 * The pool has ~6 cards per slug, so some same-slug adjacency is structural — this is the
 * floor any tuning is measured against, not zero.
 */
function chanceFloor(): number {
  // Over the ILLUSTRATED cards only, to match sameSlug above.
  const illustrated = POOL.filter((f) => f.slug);
  const counts = new Map<string, number>();
  for (const f of illustrated) counts.set(f.slug, (counts.get(f.slug) ?? 0) + 1);
  let num = 0;
  for (const c of counts.values()) num += c * (c - 1);
  return pct(num, illustrated.length * (illustrated.length - 1));
}

function computeDistributions(pairs: Pair[]) {
  const jBuckets = ['0-.05', '.05-.1', '.1-.2', '.2-.3', '.3-.5', '.5-1'];
  const jHist = new Array(jBuckets.length).fill(0);
  for (const p of pairs) {
    const j = p.jaccard;
    const i = j < 0.05 ? 0 : j < 0.1 ? 1 : j < 0.2 ? 2 : j < 0.3 ? 3 : j < 0.5 ? 4 : 5;
    jHist[i]++;
  }
  const tLabels = ['0', '1', '2', '3', '4', '5+'];
  const tHist = new Array(tLabels.length).fill(0);
  for (const p of pairs) tHist[Math.min(p.sharedTerms.length, 5)]++;
  const flagCounts: Record<string, number> = {};
  for (const p of pairs) for (const f of p.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
  return { jaccard: { labels: jBuckets, counts: jHist }, sharedTerms: { labels: tLabels, counts: tHist }, flags: flagCounts };
}

/**
 * Evenly strided sample. Even (not random, not worst-first) so the judge sees the true mix
 * of a real session — a sample biased to the flagged pairs would answer a question the
 * deterministic checks already answered.
 */
function evenSample<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return arr;
  const stride = arr.length / k;
  const out: T[] = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.floor(i * stride)]!);
  return out;
}

// ---- report ----
function report(m: Metrics, dist: ReturnType<typeof computeDistributions>, pairs: Pair[], sampled: number, elapsed: number, branchEvery: number) {
  const L: string[] = [];
  const p1 = (x: number) => `${x.toFixed(1)}%`;
  const bar = (n: number, max: number) => '#'.repeat(Math.max(0, Math.round((28 * n) / (max || 1))));
  const row = (label: string, value: string, note = '') =>
    `  ${label.padEnd(34, '.')} ${value.padStart(8)}${note ? `   ${note}` : ''}`;

  L.push('==================== CARD ADJACENCY QA ====================');
  L.push(
    `pool ${POOL.length} cards / ${new Set(POOL.map((f) => f.slug)).size} illustrations | ` +
      `${RUNS} walks x ${CARDS} cards | seed ${SEED} | BRANCH_EVERY ${branchEvery} | cards.ts ${GRAPH_HASH}`
  );
  L.push(`${m['pairs']} adjacent pairs from ${m['cards']} cards in ${elapsed.toFixed(1)}s` +
    (m['walksStoppedEarly'] ? ` | ${m['walksStoppedEarly']} walk(s) stuck early` : ''));
  L.push(
    `illustration-cooldown trail: ${TRAIL ? 'ON' : 'OFF'}` +
      ` (graph ${GRAPH_HAS_TRAIL ? 'supports' : 'has no'} recentIds, store ${STORE_PASSES_TRAIL ? 'passes' : 'does NOT pass'} it` +
      `${process.env.TRAIL ? `, forced TRAIL=${process.env.TRAIL}` : ''})`
  );
  if (GRAPH_HAS_TRAIL && !STORE_PASSES_TRAIL && process.env.TRAIL !== 'on') {
    // A cooldown the store never switches on is a fix that does not reach the device; say
    // so loudly rather than reporting the graph's best case as the product's behaviour.
    L.push('  WARNING: cards.ts supports the picture cooldown but cardStore never passes');
    L.push('           recentIds — it is INERT on device. TRAIL=on measures it anyway.');
  }
  L.push('');

  L.push('ILLUSTRATION REPEATS   (the failure this harness was built to catch)');
  L.push(row('adjacent pair, same slug', p1(m['sameSlugRate']!), `chance floor ${p1(m['sameSlugChanceFloor']!)}`));
  L.push(row('slug repeat within 1 card', p1(m['slugRepeatWithin1']!), 'same measure, per-card'));
  L.push(row('slug repeat within 3 cards', p1(m['slugRepeatWithin3']!)));
  L.push(row('slug repeat within 5 cards', p1(m['slugRepeatWithin5']!), 'still reads as a repeat'));
  L.push(row('distinct slugs / cards, per walk', p1(m['distinctSlugRate']!)));
  L.push(
    '  by step: ' +
      ['deep', 'lateral', 'fork-deep', 'fork-lateral']
        .filter((k) => m[`sameSlugRate.${k}`] !== undefined)
        .map((k) => `${k} ${p1(m[`sameSlugRate.${k}`]!)}`)
        .join(' | ')
  );
  L.push('');

  L.push('TEXT SIMILARITY   (content-word jaccard, tagalog)');
  L.push(row('mean / median', `${m['jaccardMean']} / ${m['jaccardMedian']}`, `p90 ${m['jaccardP90']} p99 ${m['jaccardP99']}`));
  L.push(row('> 0.50 near-identical wording', p1(m['jaccardGt50Rate']!)));
  L.push(row('> 0.30 heavy restatement', p1(m['jaccardGt30Rate']!)));
  {
    const max = Math.max(...dist.jaccard.counts);
    dist.jaccard.labels.forEach((lab, i) => {
      L.push(`    ${lab.padStart(6)} ${String(dist.jaccard.counts[i]).padStart(5)} ${bar(dist.jaccard.counts[i]!, max)}`);
    });
  }
  L.push('');

  L.push('TERM OVERLAP   (shared source-fact terms)');
  L.push(row('mean / median shared terms', `${m['sharedTermsMean']} / ${m['sharedTermsMedian']}`));
  L.push(row('ZERO shared terms, DEEP step', p1(m['zeroOverlapRate.deep'] ?? 0), 'random fallback fired'));
  L.push(row('ZERO shared terms, lateral step', p1(m['zeroOverlapRate.lateral'] ?? 0), 'by design: fresh topic'));
  L.push(row('exactly one shared term', p1(m['oneTermRate']!), `median df of that term ${m['oneTermLinkDfMedian']}`));
  L.push(row(`weak link (1 term, df>=${DF_COMMON})`, p1(m['weakLinkRate']!), 'judge-only band'));
  L.push(row('idf overlap mean', String(m['idfOverlapMean']), `self-frac ${m['selfFracMean']}`));
  {
    const max = Math.max(...dist.sharedTerms.counts);
    dist.sharedTerms.labels.forEach((lab, i) => {
      L.push(`    ${lab.padStart(6)} ${String(dist.sharedTerms.counts[i]).padStart(5)} ${bar(dist.sharedTerms.counts[i]!, max)}`);
    });
  }
  L.push('');

  L.push('STEP MIX');
  L.push(row('pages that forked', p1(m['forkRate']!), `dead-end escapes ${p1(m['deadEndForkRate']!)}`));
  L.push(row('lateral picks taken', p1(m['lateralRate']!), `cross-domain ${p1(m['crossDomainRate']!)}`));
  L.push('');

  L.push(`SUSPECT PAIRS: ${p1(m['suspectRate']!)} of adjacencies carry >=1 defect flag`);
  for (const [f, c] of Object.entries(dist.flags).sort((a, b) => b[1] - a[1])) {
    const note = DEFECT_FLAGS.has(f) ? '' : '  (informational — intended by design)';
    L.push(`  ${f.padEnd(22)} ${String(c).padStart(5)}  (${p1(pct(c, pairs.length || 1))})${note}`);
  }
  L.push('');

  // Same-illustration pairs are the worst read, but once they are fixed the section must
  // still show something useful — fall back to the residual restatement band.
  const sameSlugPairs = pairs.filter((x) => x.sameSlug);
  const worst = (sameSlugPairs.length ? sameSlugPairs : pairs)
    .slice()
    .sort((a, b) => b.jaccard - a.jaccard)
    .slice(0, 6);
  L.push(
    sameSlugPairs.length
      ? 'WORST OFFENDERS   (same illustration AND highest text overlap)'
      : 'WORST OFFENDERS   (no same-illustration pairs — showing the most restated wording)'
  );
  for (const p of worst) {
    L.push(`  [${p.stepKind}] j=${p.jaccard.toFixed(2)} ${p.sameSlug ? `slug=${p.fromSlug}` : `${p.fromSlug} -> ${p.toSlug}`}`);
    L.push(`     ${clip(p.fromTl)}`);
    L.push(`  -> ${clip(p.toTl)}`);
  }
  L.push('');
  L.push('NON-SEQUITUR CANDIDATES   (for the judge: link is one common word or none)');
  if (!pairs.some((x) => x.flags.some((f) => f !== 'same-slug' && f !== 'near-identical-text')))
    L.push('  none');
  const nonSeq = pairs
    .filter((x) => x.flags.some((f) => f === 'weak-link' || f === 'deep-random-fallback' || f === 'zero-term-overlap'))
    .sort((a, b) => rank(a) - rank(b)); // deep misses first: an unintended jump beats an intended one
  for (const p of nonSeq.slice(0, 6)) {
    const link = p.sharedTerms.length ? `"${p.sharedTerms[0]}" (df ${p.rarestSharedDf})` : 'nothing';
    L.push(`  [${p.stepKind}] link=${link}`);
    L.push(`     ${clip(p.fromTl)}`);
    L.push(`  -> ${clip(p.toTl)}`);
  }
  L.push('');
  L.push(`JUDGE SAMPLE -> ${OUT}  (${sampled} pairs, evenly strided across the run)`);

  if (BASELINE) L.push(...deltaTable(m));
  console.log(L.join('\n'));
}

/** Metrics where DOWN is an improvement; everything else is neutral or up-is-better. */
const LOWER_IS_BETTER = new Set([
  'sameSlugRate', 'slugRepeatWithin1', 'slugRepeatWithin3', 'slugRepeatWithin5',
  'jaccardMean', 'jaccardMedian', 'jaccardP90', 'jaccardP99', 'jaccardGt50Rate',
  'jaccardGt30Rate', 'zeroOverlapRate', 'zeroOverlapRate.deep', 'weakLinkRate', 'suspectRate',
  'deadEndForkRate',
  'walksStoppedEarly',
]);
const HIGHER_IS_BETTER = new Set(['distinctSlugRate', 'sharedTermsMean', 'sharedTermsMedian', 'idfOverlapMean']);

function deltaTable(now: Metrics): string[] {
  const L: string[] = ['', '==================== BEFORE -> AFTER ===================='];
  let base: Metrics;
  let baseCfg: Record<string, unknown> = {};
  try {
    const raw = JSON.parse(readFileSync(BASELINE, 'utf8'));
    base = (raw.metrics ?? raw) as Metrics;
    baseCfg = raw.config ?? {};
  } catch (e) {
    return [...L, `  could not read BASELINE=${BASELINE}: ${(e as Error).message}`];
  }
  L.push(`  baseline: ${BASELINE}`);
  // Seed-to-seed spread on the rate metrics is ~3pp at RUNS=30 (measured over seeds 1/2/3),
  // which is larger than most tuning wins — so a differing seed makes the table unreadable.
  if (baseCfg.SEED !== undefined && baseCfg.SEED !== SEED) {
    L.push(`  WARNING: baseline seed ${baseCfg.SEED} != current seed ${SEED} — these are`);
    L.push('           different walks, so deltas below include walk-to-walk noise (~3pp).');
  }
  if (baseCfg.graphHash === GRAPH_HASH && baseCfg.trail === TRAIL) {
    L.push(`  NOTE: same cards.ts (${GRAPH_HASH}) and same knobs on both sides — an A/A run.`);
  } else if (baseCfg.graphHash === GRAPH_HASH) {
    L.push(`  same cards.ts (${GRAPH_HASH}); the difference below is the harness knobs alone.`);
  } else if (baseCfg.graphHash) {
    L.push(`  cards.ts ${baseCfg.graphHash} -> ${GRAPH_HASH}`);
  }
  for (const k of ['RUNS', 'CARDS', 'trail'] as const) {
    const b = baseCfg[k];
    const now = k === 'RUNS' ? RUNS : k === 'CARDS' ? CARDS : TRAIL;
    if (b !== undefined && b !== now) L.push(`  WARNING: baseline ${k}=${b} != current ${k}=${now}`);
  }
  L.push(`  ${'metric'.padEnd(30)} ${'before'.padStart(9)} ${'after'.padStart(9)} ${'delta'.padStart(9)}`);
  const keys = Object.keys(now).filter((k) => typeof base[k] === 'number');
  for (const k of keys) {
    const b = base[k]!;
    const a = now[k]!;
    const d = a - b;
    // Sub-0.05 moves on a rate are sampling noise at these run sizes, not a result.
    const verdict =
      Math.abs(d) < 0.05
        ? 'same'
        : LOWER_IS_BETTER.has(k)
          ? d < 0 ? 'BETTER' : 'worse'
          : HIGHER_IS_BETTER.has(k)
            ? d > 0 ? 'BETTER' : 'worse'
            : '';
    L.push(
      `  ${k.padEnd(30)} ${fmt(b).padStart(9)} ${fmt(a).padStart(9)} ${(d >= 0 ? '+' : '') + fmt(d)}`.padEnd(62) +
        `  ${verdict}`
    );
  }
  const missing = Object.keys(base).filter((k) => now[k] === undefined);
  if (missing.length) L.push(`  (baseline-only keys ignored: ${missing.join(', ')})`);
  return L;
}

// ---- small helpers ----
const round = (x: number, d: number) => Number(x.toFixed(d));
const pct = (n: number, d: number) => round((100 * n) / d, 2);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0;
const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
// Feed-voice factoids embed a paragraph break ("Bakit…?\n\nDahil…"); collapse it so a
// report line stays one line.
/** Sort key for the judge-facing non-sequitur list: unintended jumps outrank intended ones. */
const rank = (p: Pair) =>
  p.flags.includes('deep-random-fallback') ? 0 : p.flags.includes('weak-link') ? 1 : 2;
const clip = (s: string, n = 96) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
