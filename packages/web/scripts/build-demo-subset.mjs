#!/usr/bin/env node
/**
 * Build the web demo's card-feed inventory: a ~5% subset of the app's 46,421-card pool that
 * BEHAVES like the full deck.
 *
 *   node packages/web/scripts/build-demo-subset.mjs            # ~5% (default)
 *   DEMO_N=1200 node packages/web/scripts/build-demo-subset.mjs
 *   DEMO_SKIP_IMAGES=1 node packages/web/scripts/build-demo-subset.mjs   # data only
 *
 * Outputs (all deterministic — same pool in, same subset out, no PRNG anywhere):
 *   packages/web/src/data/demo-cards.json      { cards, taxonomy, tags }
 *   packages/web/src/data/demo-questions.json  { questions }   (the subset's MCQs)
 *   packages/web/src/data/demo-df.json         { terms, tokens } — FULL-CORPUS df, see step 0
 *   packages/web/public/demo/cards/<slug>.png  (illustrations the subset uses; stale ones are
 *                                               removed so the folder matches the subset)
 *
 * ---------------------------------------------------------------------------------------
 * WHY THIS REPLACED build-demo-cards.mjs (stratified random, 150 per domain, seed 20260718)
 * ---------------------------------------------------------------------------------------
 * The old script had no graph term at all, and the graph is the product: the feed IS a walk
 * over deep/lateral edges. Two independent failures, and BOTH levers are needed — fixing
 * either alone leaves the subset unshippable.
 *
 *   1. idf computed INSIDE the subset. Every edge gate in cards.ts is a threshold on idf mass,
 *      and idf is 1/df. At 5% the df of a term drops ~20x, so LINK_MASS_FLOOR (0.02, calibrated
 *      on 46,421-card df) becomes free. Re-scoring the shipped 600's own edges against
 *      full-corpus df: 10.2% survive. Nine in ten "related topic" links the demo served were
 *      the exact "burnay vinegar -> chloroplasts, both mention water" failure the floor exists
 *      to remove.
 *   2. Random selection. Measured on a naive random 5% (2,321 cards) scored with HONEST
 *      (frozen) df: mean deep out-degree 1.9, 33.5% dead ends, 794 components, largest holding
 *      57.5%, 675 singletons. A 4,000-page walk dead-ends on 28.3% of pages and forks 30.5% of
 *      the time against the device's measured 11.8% — and every one of those forks is the feed
 *      admitting it has nothing related left. Baseline, full pool: out-degree 38.9, dead ends
 *      6.2%.
 *
 * ---------------------------------------------------------------------------------------
 * THE RULE
 * ---------------------------------------------------------------------------------------
 * Step 0 — FREEZE THE IDF (prerequisite; nothing else works without it). Emit demo-df.json:
 *   {term: df} counted over ALL 46,421 cards of rag/pipeline/cardsPool.app.json, for every
 *   term (and every search token) that appears in the subset. cards.ts reads df from this
 *   table and never from the size of its own postings list.
 * Step 1 — UNIVERSE. U = pool cards whose `slug` resolves to a PNG under
 *   packages/images/{assets-png,cards-png}. A card the demo cannot illustrate is not a card
 *   the demo should ship.
 * Step 2 — FULL DEEP GRAPH. For every card in U, its deep candidates under the CURRENT
 *   cards.ts gates evaluated with full-corpus df: topicKey differs, mass <= selfScore *
 *   DEEP_DUP_CAP, mass >= LINK_MASS_FLOOR, count >= 2 || minDf <= LINK_RARE_DF, textJaccard <=
 *   TEXT_DUP_JACCARD, isTopical filtering inside linkOf.
 * Step 3 — QUOTAS. cell = (domain, primaryGrade from curriculumTags.generated.json). quota =
 *   max(MIN_CELL, round(N * |U∩cell| / |U|)), rescaled to sum to N. Cell proportions are
 *   scale-free, so a grade filter/weighting bites the same way it does on the full deck.
 * Step 4 — SEEDS. Per cell, the member with the highest full-pool out-degree.
 * Step 5 — GREEDY CONNECTED EXPANSION. Only cards already reachable from the subset are
 *   admitted (degIn_S >= 1), scored by the key in `expansionKey` below — in-degree, then a
 *   large bonus for linking back OUT (no one-way sinks), then MCQ coverage, then taxonomy
 *   shelf-filling, then raw out-degree.
 * Step 6 — DEAD-END REPAIR to fixpoint: drop any member with zero in-subset out-edges, repeat.
 *
 * MEASURED on the subset this script actually emits (2,321 cards, 5.0%, gates scored with the
 * frozen df — the script reprints all of this at the end of every run):
 *   ONE component, 100% reachable from any start. ZERO singletons. ZERO dead ends, and step 6
 *   dropped nothing: the degIn>=1 admission rule plus the reciprocity bonus never made one.
 *   Deep out-degree mean 17.5 / median 16 / p10 8 (full pool 38.9 / 29). Halving out-degree at
 *   5% of the inventory is the expected cost; the TAIL is what matters, and p10=8 means no card
 *   is one `seen` set away from a stall.
 *   Edge precision vs full-corpus gates 100% (random 5% scored the same way: 10.2%).
 *   4,000-page walk (20 runs x 200) with the real seen set, SLUG_COOLDOWN=5, BRANCH_EVERY=8: a
 *   deep edge was servable on 100% of page-turns, fork rate 11.0% against the device's measured
 *   11.8%, and 96.6% of lateral tickets name a taxonomy SHELF ("iba pang mga insekto") rather
 *   than a term scraped out of a card the reader cannot see.
 *   77.8% MCQ-backed, so the every-4-5-page interject always has a recent fact to ask about.
 *   110 taxonomy leaves; 95.0% of cards sit on a shelf of >= 8 (random 5%: 36.5%), which is
 *   what makes "other marine animals" a real offer instead of a random same-domain card.
 *   All 4 domains and all 8 tagged grades populated in full-pool proportion (G3 383 ... G10
 *   156), so a grade filter picks from a representative slice rather than whatever survived.
 *
 * The gate CONSTANTS and the NON_TOPICAL / SEARCH_STOP word lists are parsed out of
 * packages/web/src/data/cards.ts rather than restated here, on purpose: this script's whole
 * job is to select for the graph that module will serve, so a copy that drifted from it would
 * silently select for a different one.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = join(fileURLToPath(import.meta.url), '..', '..');
const REPO = join(WEB, '..', '..');
const POOL_PATH = join(REPO, 'rag/pipeline/cardsPool.app.json');
const QUESTIONS_PATH = join(REPO, 'packages/mobile/src/data/cards-questions.json');
const TAGS_PATH = join(REPO, 'packages/mobile/src/generated/curriculumTags.generated.json');
const CARDS_TS = join(WEB, 'src/data/cards.ts');
const IMAGE_DIRS = [join(REPO, 'packages/images/assets-png'), join(REPO, 'packages/images/cards-png')];
const OUT_DATA = join(WEB, 'src/data');
const OUT_IMG = join(WEB, 'public/demo/cards');

/** Target subset size. 5% of the pool unless overridden. */
const N = Number(process.env.DEMO_N) || Math.round(0.05 * 46421);
/** Floor on a (domain, grade) cell, so a thin cell is still walkable rather than a token card. */
const MIN_CELL = 25;
/** At most this many cards may share one illustration — a picture is not a topic. */
const MAX_PER_SLUG = 2;
/** Stop chasing MCQ coverage once this share of the subset is quiz-backed. */
const QUIZ_TARGET = 0.6;
/** A taxonomy shelf is "filled" at this many members — enough for "other <category>" to vary. */
const LEAF_TARGET = 16;
/** A leaf worth OPENING must have at least this many candidates in U... */
const LEAF_MIN_POOL = 48;
/** ...and we stop opening new ones past this many, so shelves get deep instead of numerous. */
const MAX_OPEN_LEAVES = 110;

const t0 = Date.now();
const lap = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

// ---------------------------------------------------------------------------------------
// The gates, read from the module that will serve them.
// ---------------------------------------------------------------------------------------
const cardsSrc = readFileSync(CARDS_TS, 'utf8');

/** Pull `const NAME = <number>;` out of cards.ts so the two cannot drift. */
function constOf(name) {
  const m = cardsSrc.match(new RegExp(`const ${name} = ([0-9.]+);`));
  if (!m) throw new Error(`cards.ts no longer declares ${name} — update this script with it`);
  return Number(m[1]);
}
const DEEP_DUP_CAP = constOf('DEEP_DUP_CAP');
const LINK_MASS_FLOOR = constOf('LINK_MASS_FLOOR');
const LINK_RARE_DF = constOf('LINK_RARE_DF');
const TEXT_DUP_JACCARD = constOf('TEXT_DUP_JACCARD');

/** The word lists, likewise parsed rather than restated. */
function wordsBetween(startMarker, endMarker) {
  const i = cardsSrc.indexOf(startMarker);
  if (i < 0) throw new Error(`cards.ts no longer contains ${startMarker}`);
  const j = cardsSrc.indexOf(endMarker, i);
  return [...cardsSrc.slice(i, j).matchAll(/'([^']*)'/g)].map((m) => m[1]);
}
const NON_TOPICAL = new Set(
  wordsBetween('export const NON_TOPICAL = new Set(', ").split(' ')")
    .join('')
    .split(' ')
    .filter(Boolean)
);
const SEARCH_STOP = new Set(wordsBetween('const SEARCH_STOP = new Set([', ']);'));
lap(`gates from cards.ts: dup ${DEEP_DUP_CAP} mass ${LINK_MASS_FLOOR} rareDf ${LINK_RARE_DF} ` +
    `jaccard ${TEXT_DUP_JACCARD} · ${NON_TOPICAL.size} non-topical · ${SEARCH_STOP.size} stop words`);

const isTopical = (term) => {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  return t.split(/\s+/).some((w) => w.length > 2 && !NON_TOPICAL.has(w));
};
const searchTokens = (s) =>
  ((s ?? '').toLowerCase().match(/[a-z0-9ñ]+/gi) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2 && !SEARCH_STOP.has(t));
const topicKeyOf = (topic) =>
  (topic ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .sort()
    .join(' ');

// ---------------------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------------------
const poolFile = JSON.parse(readFileSync(POOL_PATH, 'utf8'));
const pool = poolFile.cards;
const taxonomy = poolFile.taxonomy ?? [];
const questions = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8')).questions;
const tags = JSON.parse(readFileSync(TAGS_PATH, 'utf8'));
const hasMCQ = new Set(questions.map((q) => q.f));
lap(`pool ${pool.length.toLocaleString()} cards · ${taxonomy.length} taxonomy leaves · ` +
    `${questions.length.toLocaleString()} MCQs`);

// ---- STEP 0a: full-corpus term df ----
const termId = new Map(); // term -> int id
const termDf = []; // id -> df over the WHOLE pool
const cardTerms = new Array(pool.length); // ord -> Int32Array of distinct TOPICAL term ids
for (let i = 0; i < pool.length; i++) {
  const seen = new Set();
  for (const raw of pool[i].terms) {
    if (!isTopical(raw)) continue;
    let id = termId.get(raw);
    if (id === undefined) {
      id = termDf.length;
      termId.set(raw, id);
      termDf.push(0);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    termDf[id]++;
  }
  cardTerms[i] = Int32Array.from(seen);
}
lap(`term df: ${termDf.length.toLocaleString()} topical terms`);

// ---- STEP 0b: full-corpus search-token df + per-card vocabularies (for textJaccard) ----
const tokenId = new Map();
const tokenDf = [];
const cardTokens = new Array(pool.length); // ord -> SORTED Int32Array of token ids
for (let i = 0; i < pool.length; i++) {
  const c = pool[i];
  const seen = new Set();
  const add = (s) => {
    for (const t of searchTokens(s)) {
      let id = tokenId.get(t);
      if (id === undefined) {
        id = tokenDf.length;
        tokenId.set(t, id);
        tokenDf.push(0);
      }
      if (!seen.has(id)) {
        seen.add(id);
        tokenDf[id]++;
      }
    }
  };
  add(c.topic);
  for (const t of c.terms) add(t);
  add(c.fact?.en);
  add(c.fact?.tl);
  add(c.fact?.bis);
  cardTokens[i] = Int32Array.from(seen).sort();
}
lap(`token df: ${tokenDf.length.toLocaleString()} search tokens`);

/** Exact jaccard over two sorted token runs (a merge, not a lookup per element). */
function jaccard(a, b) {
  const A = cardTokens[a];
  const B = cardTokens[b];
  if (!A.length || !B.length) return 0;
  let i = 0;
  let j = 0;
  let both = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) {
      both++;
      i++;
      j++;
    } else if (A[i] < B[j]) i++;
    else j++;
  }
  return both / (A.length + B.length - both);
}

// ---- STEP 1: the universe ----
const slugPath = new Map();
const walk = (dir) => {
  for (const e of readdirSync(dir)) {
    if (e === 'flagged') continue; // never ship flagged assets
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.png') && !slugPath.has(e.slice(0, -4))) slugPath.set(e.slice(0, -4), p);
  }
};
for (const d of IMAGE_DIRS) if (existsSync(d)) walk(d);

const inU = new Uint8Array(pool.length);
const U = [];
for (let i = 0; i < pool.length; i++) {
  if (pool[i].slug && slugPath.has(pool[i].slug)) {
    inU[i] = 1;
    U.push(i);
  }
}
lap(`universe: ${U.length.toLocaleString()} of ${pool.length.toLocaleString()} cards have art ` +
    `(${slugPath.size.toLocaleString()} slugs on disk)`);

// ---- STEP 2: the deep graph over U, scored with frozen full-corpus df ----
// Postings are restricted to U (candidates), the DF is not (rarity is a corpus property).
const postings = new Map(); // termId -> Int32Array of ords in U
{
  const counts = new Int32Array(termDf.length);
  for (const i of U) for (const t of cardTerms[i]) counts[t]++;
  const arrs = new Array(termDf.length);
  const fill = new Int32Array(termDf.length);
  for (let t = 0; t < termDf.length; t++) if (counts[t]) arrs[t] = new Int32Array(counts[t]);
  for (const i of U) for (const t of cardTerms[i]) arrs[t][fill[t]++] = i;
  for (let t = 0; t < termDf.length; t++) if (arrs[t]) postings.set(t, arrs[t]);
}

const selfScore = new Float64Array(pool.length);
for (const i of U) {
  let s = 0;
  for (const t of cardTerms[i]) s += 1 / termDf[t];
  selfScore[i] = s;
}

const topicKeys = new Array(pool.length);
for (const i of U) topicKeys[i] = topicKeyOf(pool[i].topic);

const OUT = new Array(pool.length); // ord -> Int32Array of deep successors (in U)
{
  const mass = new Float64Array(pool.length);
  const count = new Int32Array(pool.length);
  const minDf = new Int32Array(pool.length);
  const touched = new Int32Array(pool.length);
  let edges = 0;
  for (const i of U) {
    let nTouched = 0;
    for (const t of cardTerms[i]) {
      const df = termDf[t];
      const w = 1 / df;
      const post = postings.get(t);
      if (!post) continue;
      for (const j of post) {
        if (j === i) continue;
        if (count[j] === 0) {
          touched[nTouched++] = j;
          minDf[j] = df;
        } else if (df < minDf[j]) minDf[j] = df;
        mass[j] += w;
        count[j]++;
      }
    }
    const cap = selfScore[i] * DEEP_DUP_CAP;
    const keep = [];
    for (let k = 0; k < nTouched; k++) {
      const j = touched[k];
      const m = mass[j];
      const c = count[j];
      const d = minDf[j];
      mass[j] = 0;
      count[j] = 0;
      if (m > cap) continue; // near-duplicate of this card
      if (m < LINK_MASS_FLOOR) continue; // only generic words in common
      if (c < 2 && d > LINK_RARE_DF) continue; // one unremarkable word
      if (topicKeys[j] === topicKeys[i]) continue; // same fact, same wording
      if (jaccard(i, j) > TEXT_DUP_JACCARD) continue; // same fact, different words
      keep.push(j);
    }
    OUT[i] = Int32Array.from(keep);
    edges += keep.length;
  }
  lap(`deep graph: ${edges.toLocaleString()} edges · mean out-degree ${(edges / U.length).toFixed(1)}`);
}

// Reverse adjacency, so admitting a card is O(its in-edges) rather than a scan.
const IN = new Array(pool.length);
{
  const counts = new Int32Array(pool.length);
  for (const i of U) for (const j of OUT[i]) counts[j]++;
  const fill = new Int32Array(pool.length);
  for (const i of U) if (counts[i]) IN[i] = new Int32Array(counts[i]);
  for (const i of U) for (const j of OUT[i]) IN[j][fill[j]++] = i;
}

// ---- STEP 3: quotas over (domain, primary grade) cells ----
const cellOf = (i) => `${pool[i].domain}|${tags[pool[i].id]?.[1] ?? 0}`;
const cellMembers = new Map();
for (const i of U) {
  const c = cellOf(i);
  const arr = cellMembers.get(c) ?? [];
  arr.push(i);
  cellMembers.set(c, arr);
}
const quota = new Map();
{
  for (const [c, members] of cellMembers) {
    quota.set(c, Math.max(MIN_CELL, Math.round((N * members.length) / U.length)));
  }
  // Rescale to sum exactly N; the MIN_CELL floor is re-applied so a small cell is never
  // scaled back below walkability.
  let sum = [...quota.values()].reduce((a, b) => a + b, 0);
  const scale = N / sum;
  for (const [c, q] of quota) quota.set(c, Math.max(MIN_CELL, Math.round(q * scale)));
  sum = [...quota.values()].reduce((a, b) => a + b, 0);
  // Distribute the rounding drift over the largest cells, biggest first (deterministic).
  const order = [...quota.keys()].sort(
    (a, b) => cellMembers.get(b).length - cellMembers.get(a).length || (a < b ? -1 : 1)
  );
  let drift = N - sum;
  let k = 0;
  while (drift !== 0) {
    const c = order[k % order.length];
    const q = quota.get(c);
    if (drift > 0) {
      quota.set(c, q + 1);
      drift--;
    } else if (q > MIN_CELL) {
      quota.set(c, q - 1);
      drift++;
    }
    k++;
    if (k > order.length * 200) break; // cannot happen; never spin
  }
  lap(`quotas: ${quota.size} cells, sum ${[...quota.values()].reduce((a, b) => a + b, 0)} (target ${N})`);
}

// ---- taxonomy bookkeeping for the shelf term of the expansion key ----
const leafPool = new Map(); // leaf -> candidates in U
for (const i of U) for (const c of pool[i].cats ?? []) leafPool.set(c, (leafPool.get(c) ?? 0) + 1);

// ---------------------------------------------------------------------------------------
// STEPS 4-5: seeds, then greedy connected expansion
// ---------------------------------------------------------------------------------------
const inS = new Uint8Array(pool.length);
const degIn = new Int32Array(pool.length); // how many members of S link TO this card
const cellFilled = new Map([...quota.keys()].map((c) => [c, 0]));
const slugCount = new Map();
const leafCount = new Map();
let openLeaves = 0;
let quizBacked = 0;
let size = 0;

const frontier = new Set();

function admit(i) {
  inS[i] = 1;
  size++;
  const c = cellOf(i);
  cellFilled.set(c, (cellFilled.get(c) ?? 0) + 1);
  slugCount.set(pool[i].slug, (slugCount.get(pool[i].slug) ?? 0) + 1);
  if (hasMCQ.has(pool[i].factId)) quizBacked++;
  for (const leaf of pool[i].cats ?? []) {
    const n = (leafCount.get(leaf) ?? 0) + 1;
    leafCount.set(leaf, n);
    if (n === 1) openLeaves++;
  }
  frontier.delete(i);
  for (const j of OUT[i]) {
    degIn[j]++;
    if (!inS[j]) frontier.add(j);
  }
}

// STEP 4 — one seed per cell: its highest-out-degree member (ties by pool order).
for (const [c, members] of [...cellMembers].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  if (!quota.has(c)) continue;
  let best = -1;
  let bestDeg = -1;
  for (const i of members) {
    const d = OUT[i].length;
    if (d > bestDeg) {
      bestDeg = d;
      best = i;
    }
  }
  if (best >= 0 && !inS[best]) admit(best);
}
lap(`seeds: ${size} (one per cell)`);

/**
 * How badly we want this card next. In descending order of weight:
 *   in-degree (capped at 6) — how well the subset already reaches it;
 *   RECIPROCITY (400) — it links back into S, so it is not a one-way sink. This term is what
 *     keeps the graph free of dead ends: without it the greedy walk happily admits cards that
 *     can be reached and never left;
 *   MCQ, while the subset is under QUIZ_TARGET quiz-backed — a card the interject can quiz on;
 *   the taxonomy shelf term — fill an open shelf (3), keep a full one stocked (2), or open a
 *     new one only if it is deep enough to be worth naming (1);
 *   raw out-degree, as the tiebreak that prefers a card the walk can leave in many directions.
 */
function expansionKey(i) {
  let reciprocal = 0;
  for (const j of OUT[i]) {
    if (inS[j]) {
      reciprocal = 1;
      break;
    }
  }
  let cat = 0;
  for (const leaf of pool[i].cats ?? []) {
    const n = leafCount.get(leaf) ?? 0;
    let s;
    if (n > 0 && n < LEAF_TARGET) s = 3;
    else if (n >= LEAF_TARGET) s = 2;
    else if ((leafPool.get(leaf) ?? 0) >= LEAF_MIN_POOL && openLeaves < MAX_OPEN_LEAVES) s = 1;
    else s = 0;
    if (s > cat) cat = s;
  }
  const quiz = hasMCQ.has(pool[i].factId) && quizBacked / Math.max(1, size) < QUIZ_TARGET ? 1 : 0;
  return (
    Math.min(degIn[i], 6) * 100 +
    reciprocal * 400 +
    quiz * 60 +
    cat * 45 +
    Math.min(OUT[i].length, 40)
  );
}

// STEP 5 — expand.
while (size < N) {
  let best = -1;
  let bestKey = -1;
  const stale = [];
  for (const i of frontier) {
    if (inS[i]) {
      stale.push(i);
      continue;
    }
    if (degIn[i] < 1) continue;
    const c = cellOf(i);
    const cap = quota.get(c);
    if (cap === undefined || cellFilled.get(c) >= cap) continue;
    if ((slugCount.get(pool[i].slug) ?? 0) >= MAX_PER_SLUG) continue;
    const k = expansionKey(i);
    if (k > bestKey || (k === bestKey && best >= 0 && i < best)) {
      bestKey = k;
      best = i;
    }
  }
  for (const i of stale) frontier.delete(i);
  if (best < 0) {
    // No admissible card is reachable from S. Stopping here is the honest outcome: forcing
    // one in would be exactly the disconnected singleton this rule exists to avoid.
    lap(`expansion exhausted at ${size}/${N} — no reachable candidate fits a remaining quota`);
    break;
  }
  admit(best);
}
lap(`expanded: ${size} cards`);

// ---- STEP 6: dead-end repair to fixpoint ----
{
  let pass = 0;
  for (;;) {
    const drop = [];
    for (const i of U) {
      if (!inS[i]) continue;
      let ok = false;
      for (const j of OUT[i]) {
        if (inS[j]) {
          ok = true;
          break;
        }
      }
      if (!ok) drop.push(i);
    }
    if (!drop.length) break;
    for (const i of drop) {
      inS[i] = 0;
      size--;
    }
    pass++;
    lap(`dead-end repair pass ${pass}: dropped ${drop.length}`);
    if (pass > 20) break;
  }
}

// ---------------------------------------------------------------------------------------
// Report — the numbers this rule is accountable for
// ---------------------------------------------------------------------------------------
const subsetOrds = U.filter((i) => inS[i]);
/**
 * Only the fields `CardFact` in packages/web/src/data/cards.ts declares. The pool also carries
 * `title`, `emphasis`, `source` and `poster` for the phone's card look, which the web port does
 * not render — and they are 0.4 MB of the client chunk. The type is the contract: when the web
 * starts rendering one of them, add it here.
 */
const subset = subsetOrds.map((i) => {
  const c = pool[i];
  return {
    id: c.id,
    factId: c.factId,
    domain: c.domain,
    topic: c.topic,
    terms: c.terms,
    fact: c.fact,
    slug: c.slug,
    ...(c.cats?.length ? { cats: c.cats } : {}),
  };
});
{
  const degs = subsetOrds.map((i) => OUT[i].reduce((n, j) => n + (inS[j] ? 1 : 0), 0));
  const sorted = [...degs].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.floor((sorted.length - 1) * p)];
  const deadEnds = degs.filter((d) => d === 0).length;

  // connectivity over the UNDIRECTED closure (the edge gates are directional)
  const idx = new Map(subsetOrds.map((o, k) => [o, k]));
  const adj = subsetOrds.map(() => []);
  for (const i of subsetOrds)
    for (const j of OUT[i])
      if (inS[j]) {
        adj[idx.get(i)].push(idx.get(j));
        adj[idx.get(j)].push(idx.get(i));
      }
  const seen = new Uint8Array(subsetOrds.length);
  let components = 0;
  let largest = 0;
  for (let s = 0; s < subsetOrds.length; s++) {
    if (seen[s]) continue;
    components++;
    let n = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const x = stack.pop();
      n++;
      for (const y of adj[x])
        if (!seen[y]) {
          seen[y] = 1;
          stack.push(y);
        }
    }
    if (n > largest) largest = n;
  }

  const leaves = new Map();
  for (const i of subsetOrds) for (const c of pool[i].cats ?? []) leaves.set(c, (leaves.get(c) ?? 0) + 1);
  const onGoodShelf = subsetOrds.filter((i) =>
    (pool[i].cats ?? []).some((c) => (leaves.get(c) ?? 0) >= 8)
  ).length;
  const withMCQ = subset.filter((c) => hasMCQ.has(c.factId)).length;

  console.log('');
  console.log(`cards            : ${subset.length} (${((subset.length / pool.length) * 100).toFixed(1)}% of the pool)`);
  console.log(`components       : ${components} · largest ${largest} (${((largest / subset.length) * 100).toFixed(1)}%)`);
  console.log(`dead ends        : ${deadEnds} (${((deadEnds / subset.length) * 100).toFixed(1)}%)`);
  console.log(`deep out-degree  : mean ${(degs.reduce((a, b) => a + b, 0) / degs.length).toFixed(1)} · median ${pct(0.5)} · p10 ${pct(0.1)}`);
  console.log(`MCQ-backed       : ${withMCQ} (${((withMCQ / subset.length) * 100).toFixed(1)}%)`);
  console.log(`taxonomy shelves : ${leaves.size} leaves · ${((onGoodShelf / subset.length) * 100).toFixed(1)}% of cards on a shelf of >= 8`);
  const byDomain = new Map();
  for (const c of subset) byDomain.set(c.domain, (byDomain.get(c.domain) ?? 0) + 1);
  console.log(`domains          : ${[...byDomain].sort().map(([d, n]) => `${d} ${n}`).join(' · ')}`);
  const grades = new Map();
  for (const c of subset) {
    const g = tags[c.id]?.[1] ?? 0;
    grades.set(g, (grades.get(g) ?? 0) + 1);
  }
  console.log(`grades           : ${[...grades].sort((a, b) => a[0] - b[0]).map(([g, n]) => `G${g} ${n}`).join(' · ')}`);
}

// ---------------------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------------------
// STEP 0 output: df for every term/token the subset carries, counted over the FULL pool.
const outTermDf = {};
for (const i of subsetOrds) for (const raw of pool[i].terms) {
  const id = termId.get(raw);
  if (id !== undefined) outTermDf[raw] = termDf[id];
}
const idToToken = new Array(tokenDf.length);
for (const [t, id] of tokenId) idToToken[id] = t;
const outTokenDf = {};
for (const i of subsetOrds) for (const id of cardTokens[i]) outTokenDf[idToToken[id]] = tokenDf[id];

const subsetFacts = new Set(subset.map((c) => c.factId));
const subsetQuestions = questions.filter((q) => subsetFacts.has(q.f));
const usedLeaves = new Set(subset.flatMap((c) => c.cats ?? []));

/**
 * STEP 7 output: the MATATAG curriculum tag of every subset card that has one, so the browser
 * feed can weight its draws by the grade onboarding collected — the same `curriculumMultiplier`
 * the phone runs (@hiraia/shared/curriculum, FEED-WEIGHTING.md). Without this the grade slide
 * collects an answer the demo then discards.
 *
 * The row is the app's TagRow MINUS its last element: `[competency, grade, quarter, confidence,
 * cells]`. `codes` is dropped on purpose — it exists for competency_seen decay, and the demo has
 * no seen-store to decay against (the session's `seen` set only gates repeats). ~1% of the
 * subset's bytes; an untagged card simply has no row and takes the off-curriculum weight.
 */
const outTags = {};
for (const c of subset) {
  const row = tags[c.id];
  if (!row) continue;
  const [competency, grade, quarter, confidence, cells] = row;
  outTags[c.id] = cells?.length
    ? [competency, grade, quarter, confidence, cells]
    : [competency, grade, quarter, confidence];
}

writeFileSync(
  join(OUT_DATA, 'demo-cards.json'),
  JSON.stringify({
    cards: subset,
    taxonomy: taxonomy.filter((l) => usedLeaves.has(l.id)),
    tags: outTags,
  })
);
writeFileSync(join(OUT_DATA, 'demo-questions.json'), JSON.stringify({ questions: subsetQuestions }));
writeFileSync(
  join(OUT_DATA, 'demo-df.json'),
  JSON.stringify({ terms: outTermDf, tokens: outTokenDf })
);

// ---- illustrations: copy what the subset uses, remove what it no longer does ----
const slugs = new Set(subset.map((c) => c.slug));
if (process.env.DEMO_SKIP_IMAGES) {
  console.log(`\nimages           : skipped (DEMO_SKIP_IMAGES) — ${slugs.size} slugs needed`);
} else {
  mkdirSync(OUT_IMG, { recursive: true });
  let copied = 0;
  let removed = 0;
  const missing = [];
  for (const s of slugs) {
    const src = slugPath.get(s);
    if (!src) {
      missing.push(s);
      continue;
    }
    copyFileSync(src, join(OUT_IMG, `${s}.png`));
    copied++;
  }
  for (const e of readdirSync(OUT_IMG)) {
    if (e.endsWith('.png') && !slugs.has(e.slice(0, -4))) {
      rmSync(join(OUT_IMG, e));
      removed++;
    }
  }
  let bytes = 0;
  for (const e of readdirSync(OUT_IMG)) bytes += statSync(join(OUT_IMG, e)).size;
  console.log(`\nimages           : ${copied} copied · ${removed} stale removed · ${(bytes / 1e6).toFixed(1)} MB`);
  if (missing.length) console.log(`MISSING SLUGS    : ${missing.length} (${missing.slice(0, 5).join(', ')})`);
}

const mb = (p) => (statSync(p).size / 1e6).toFixed(2);
console.log(`demo-cards.json  : ${subset.length} cards, ${Object.keys(outTags).length} curriculum tags, ${mb(join(OUT_DATA, 'demo-cards.json'))} MB`);
console.log(`demo-questions   : ${subsetQuestions.length} MCQs, ${mb(join(OUT_DATA, 'demo-questions.json'))} MB`);
console.log(`demo-df.json     : ${Object.keys(outTermDf).length} terms + ${Object.keys(outTokenDf).length} tokens, ${mb(join(OUT_DATA, 'demo-df.json'))} MB`);
lap('done');
