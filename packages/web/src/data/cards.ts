/**
 * Question-cards feed — WEB DEMO data layer. A port of the mobile app's
 * packages/mobile/src/data/cards.ts (keep the two in sync), reading the ~5% demo subset built
 * by packages/web/scripts/build-demo-subset.mjs instead of the full 46,421-card pool.
 *
 * Everything here is deterministic + local: no model, no network, no latency. (The ask box's
 * MISS path does call the server — see useCardDemoStore.ask — but the walk never does.)
 *
 * THE FROZEN DF TABLE, and why it is not optional. Every gate below is a threshold on idf
 * mass, and idf is 1/df. Computing df inside a 5% subset inflates it ~20x, which turns
 * LINK_MASS_FLOOR into a no-op and lets through exactly the "burnay vinegar -> chloroplasts,
 * both mention water" edges the floor was measured to remove: scored against full-corpus df,
 * only 10.2% of the edges a locally-scored 5% subset serves survive. So `demo-df.json` carries
 * the document frequency of every term and search token in the subset, counted over ALL 46,421
 * cards, and is the ONLY source of df here. The subset itself is chosen for connectivity under
 * these same frozen gates, which is what keeps the demo's graph one component with no dead
 * ends; see the rule at the top of the generator.
 */
import {
  curriculumMultiplier,
  inferCurriculumQuarter,
  weightedPick,
  type CurriculumTag,
  type Quarter,
} from '@hiraia/shared/curriculum';

import type { GradeLevel } from '@/config/grades';
import type { LanguageKey } from '@/config/model';

import cardsPool from './demo-cards.json';
import dfTable from './demo-df.json';
import questionsJson from './demo-questions.json';

export interface CardFact {
  id: string; // factoid id (ffct-NNNNN)
  factId: string; // underlying source-fact id — the key into the MCQ bank
  domain: string;
  topic: string;
  terms: string[];
  fact: { tl: string; en: string; bis: string }; // feed-voice text (Q&A question baked in)
  slug: string; // illustration → /demo/cards/<slug>.png
  /** Taxonomy leaves this card sits on — the shelves the lateral fork ascends to. */
  cats?: string[];
}

export interface CardChoice {
  factId: string;
  label: string;
  kind: 'deep' | 'lateral';
}

// ---- interject questions (exact quiz MCQs keyed by factId) ----
interface Tri {
  en?: string;
  tl?: string;
  bis?: string;
}
export interface CardQuestion {
  f: string; // factId
  q: Tri;
  o: Tri[];
  a: number; // canonical answer index (UI shuffles at render)
  e: Tri;
  d: number;
}
const QUESTIONS = new Map<string, CardQuestion>(
  (questionsJson as { questions: CardQuestion[] }).questions.map((q) => [q.f, q])
);

const POOL: CardFact[] = (cardsPool as { cards: CardFact[] }).cards;

const BY_ID = new Map(POOL.map((f) => [f.id, f]));
/** Card id -> its ordinal in the pool, which is how the weight table below is addressed. */
const ORD = new Map<string, number>(POOL.map((f, i) => [f.id, i]));
const BY_DOMAIN = new Map<string, CardFact[]>();
for (const f of POOL) {
  const arr = BY_DOMAIN.get(f.domain) ?? [];
  arr.push(f);
  BY_DOMAIN.set(f.domain, arr);
}

// ---- the taxonomy: the shelves the lateral fork ascends to ----
interface TaxonomyLeaf {
  id: string;
  parent: string | null;
  label_en: string;
  label_tl: string;
  label_bis: string;
}
const TAXONOMY: TaxonomyLeaf[] = (cardsPool as { taxonomy?: TaxonomyLeaf[] }).taxonomy ?? [];
const LEAF = new Map(TAXONOMY.map((l) => [l.id, l]));

// ---- curriculum weighting: what the grade slide actually buys (FEED-WEIGHTING.md) ----
/**
 * One MATATAG competency tag per card, for the ~94% of the subset that carries one
 * (`tags` in demo-cards.json, emitted by scripts/build-demo-subset.mjs out of the app's
 * curriculumTags.generated.json). The row is the app's TagRow minus `codes`, which only
 * exists for the phone's competency_seen decay — the browser demo has no seen-store.
 */
type TagRow = [string, number, number, number, [number, number, number, number][]?];
const TAGS = new Map<string, CurriculumTag>();
for (const [id, [competency, grade, quarter, confidence, cells]] of Object.entries(
  (cardsPool as unknown as { tags?: Record<string, TagRow> }).tags ?? {}
)) {
  TAGS.set(id, {
    competency,
    grade,
    quarter,
    confidence,
    cells: cells?.map(([g, q, st, norm]) => ({ grade: g, quarter: q, strength: st === 2 ? 2 : 1, norm })),
  });
}

/**
 * Draw weights for one student, bound to a grade and the curriculum quarter inferred from
 * today's date — the SAME `curriculumMultiplier` the phone runs, imported from
 * @hiraia/shared/curriculum rather than restated, so the demo cannot drift from the ruleset it
 * is demonstrating.
 *
 * What the web port deliberately omits is the seen decay: the phone has a persistent
 * seen-store (rag/pipeline/seen-store.sql) keyed by card and by competency, and a browser demo
 * that resets on reload has nothing to persist into it. The session's own `seen` set already
 * blocks repeats, which is the part a visitor can perceive in one sitting.
 *
 * Cached on (grade, quarter): the multiplier depends on nothing else, and a fresh Float64Array
 * over 2,321 cards per page-turn would be pure waste.
 */
export interface FeedWeigher {
  of(card: CardFact): number;
}
const weightCache = { key: '', weights: new Float64Array(0) };

export function feedWeigher(grade: GradeLevel, now: Date = new Date()): FeedWeigher {
  const quarter: Quarter | null = inferCurriculumQuarter(now).quarter;
  const key = `${grade}|${quarter ?? 'summer'}`;
  if (weightCache.key !== key) {
    const w = new Float64Array(POOL.length);
    for (let i = 0; i < POOL.length; i += 1) w[i] = curriculumMultiplier(TAGS.get(POOL[i]!.id), grade, quarter);
    weightCache.key = key;
    weightCache.weights = w;
  }
  const w = weightCache.weights;
  return { of: (card) => w[ORD.get(card.id) ?? -1] ?? 1 };
}

/** leaf id -> the cards in it (only leaves that actually hold cards appear). */
const BY_CAT = new Map<string, CardFact[]>();
for (const f of POOL) {
  for (const c of f.cats ?? []) {
    const arr = BY_CAT.get(c) ?? [];
    arr.push(f);
    BY_CAT.set(c, arr);
  }
}

/** "other <category>", in the reader's language. */
const OTHER_PREFIX: Record<LanguageKey, string> = {
  tagalog: 'iba pang',
  english: 'other',
  cebuano: 'ubang',
};

function leafLabel(id: string, language: LanguageKey): string {
  const l = LEAF.get(id);
  if (!l) return '';
  if (language === 'english') return l.label_en;
  if (language === 'cebuano') return l.label_bis || l.label_tl || l.label_en;
  return l.label_tl || l.label_en;
}

/** How many recent cards' categories are held back before a category may be offered again. */
const CAT_COOLDOWN = 6;

/**
 * A category the reader has NOT just been shown. Ascending is only worth doing if it opens a
 * genuinely different shelf — offering "other marine animals" three cards running is the same
 * broken-record failure as repeating an illustration, one level up.
 */
function freshCategory(cur: CardFact, recentIds?: readonly string[]): string | undefined {
  const cats = (cur.cats ?? []).filter((c) => BY_CAT.has(c));
  if (!cats.length) return undefined;
  const recentCats = new Set<string>();
  for (const id of (recentIds ?? []).slice(-CAT_COOLDOWN)) {
    for (const c of BY_ID.get(id)?.cats ?? []) recentCats.add(c);
  }
  const unused = cats.filter((c) => !recentCats.has(c));
  return pickAny(unused.length ? unused : cats);
}

// ---- the frozen df tables (see the file header) ----
const TERM_DF: Record<string, number> = (dfTable as { terms: Record<string, number> }).terms;
const TOKEN_DF: Record<string, number> = (dfTable as { tokens: Record<string, number> }).tokens;

/**
 * Document frequency of a term over the FULL 46,421-card pool. A term missing from the table
 * appears in no pool card at all, so 1 (the rarest a term can be) is the honest reading and
 * also the value `idf = 1/df` caps at.
 */
function termDf(term: string): number {
  return TERM_DF[term] ?? 1;
}

// term -> ids of the SUBSET cards carrying it. This is a candidate index only: it answers
// "which cards might be neighbours", never "how rare is this term" — that is termDf's job.
const TERM_INDEX = new Map<string, string[]>();
for (const f of POOL) {
  for (const t of new Set(f.terms)) {
    const arr = TERM_INDEX.get(t) ?? [];
    arr.push(f.id);
    TERM_INDEX.set(t, arr);
  }
}

// full-text token index for the SEARCH BOX. A kid's typed query is tokenized and matched
// against each card's topic + terms + trilingual text, weighted by inverse document
// frequency so distinctive words ("bulkan", "photosynthesis") dominate over common ones.
// Zero-model, local, instant — the same doctrine as the rest of the feed.
const SEARCH_STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'is', 'are', 'be', 'it', 'its',
  'that', 'this', 'what', 'why', 'how', 'when', 'where', 'who', 'does', 'do', 'can', 'for',
  'with', 'as', 'at', 'by', 'about', 'tell', 'me', 'my',
  'ang', 'ng', 'sa', 'mga', 'ay', 'na', 'ba', 'ito', 'iyan', 'yan', 'ako', 'ko', 'mo',
  'niya', 'ni', 'kung', 'kapag', 'para', 'may', 'ano', 'bakit', 'paano', 'saan', 'sino',
  'kailan', 'gusto', 'malaman', 'tungkol',
  'unsa', 'nga', 'og', 'ug', 'kang', 'kini', 'kana', 'ngano', 'giunsa', 'hibaw',
]);

function searchTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9ñ]+/gi) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2 && !SEARCH_STOP.has(t));
}

// Each card's whole vocabulary — used by the search box AND by textJaccard's duplicate check.
// Only the SETS are built here; how rare each token is comes from the frozen table above.
const FACT_TOKENS = new Map<string, Set<string>>();
for (const f of POOL) {
  FACT_TOKENS.set(
    f.id,
    new Set<string>([
      ...searchTokens(f.topic),
      ...f.terms.flatMap((t) => searchTokens(t)),
      ...searchTokens(f.fact.en ?? ''),
      ...searchTokens(f.fact.tl ?? ''),
      ...searchTokens(f.fact.bis ?? ''),
    ])
  );
}

/**
 * Each card's SUBJECT vocabulary — its topic and its retrieval terms, and NOT the prose of the
 * fact itself — with, for each token, HOW CENTRAL it is to the card. This is the difference
 * between a card that IS about a word and a card that merely mentions it, and the search box
 * needs it to tell those apart (see searchCards).
 *
 * Centrality is POSITION, because `terms` is salience-ordered by the bank that produced it: the
 * subject leads and the incidentals trail ("photosynthesis process" opens with `photosynthesis`,
 * "seagrass releases oxygen…" carries the same word fifth, behind four terms about oxygen).
 * Position is also the only such signal that works in all three languages — `topic` is
 * English-only, so a Tagalog or Cebuano query can never match it, and every score built out of
 * the topic string alone silently ranks the demo's DEFAULT language at random. Topic tokens get
 * rank 0; the i-th term gets rank i + 1; the lowest wins.
 *
 * (The obvious alternative — the match's share of the card's total idf — was measured and
 * REJECTED: it rewards a card for listing few rare terms, so "photosynthesis process" (29 head
 * tokens, all of them about photosynthesis) scored 0.002 and lost to a seagrass card at 0.058.)
 */
const HEAD_RANK = new Map<string, Map<string, number>>();
for (const f of POOL) {
  const rank = new Map<string, number>();
  const put = (tok: string, r: number) => {
    const prev = rank.get(tok);
    if (prev === undefined || r < prev) rank.set(tok, r);
  };
  for (const t of searchTokens(f.topic)) put(t, 0);
  f.terms.forEach((term, i) => {
    for (const t of searchTokens(term)) put(t, i + 1);
  });
  HEAD_RANK.set(f.id, rank);
}

/**
 * The salience rank of a token that appears only in a card's PROSE. The widest head in the
 * full corpus is 45 tokens, so a prose mention is always weaker than any head mention — this
 * is a structural constant, not a tuned one. Mirrors PROSE_RANK in the app's cards.ts.
 */
const PROSE_RANK = 32;

/**
 * Harmonic numbers H(n) = Σ 1/i: the total salience a card's OWN head carries when its i-th
 * head token is worth 1/(1+i). This is the divisor that turns a matched salience sum into a
 * SHARE of the card — without it a card with twenty terms that mentions the query word fifth
 * ranks alongside a card whose entire subject is that word.
 *
 * H(0) = 1 rather than 0: a headless card can only be matched in its prose, and dividing by
 * zero would hand it +Infinity.
 */
const HEAD_MASS: number[] = (() => {
  let widest = 1;
  for (const rank of HEAD_RANK.values()) widest = Math.max(widest, rank.size);
  const h = [1];
  let sum = 0;
  for (let i = 1; i <= widest; i += 1) {
    sum += 1 / i;
    h.push(sum);
  }
  return h;
})();

export interface SearchResult {
  /** Best card that clears every confidence test below, else null (→ caller generates). */
  best: CardFact | null;
  /** Fraction (0..1) of the query's idf mass the top card covers. Diagnostic. */
  score: number;
  /** Aboutness share of the same card `score` describes. Diagnostic; the split reads `weak`. */
  about: number;
  /**
   * True when `best` was served on THIN evidence (aboutness under WEAK_ABOUT): no card is
   * really ABOUT the words typed, something merely mentions them. A weak hit is still a hit —
   * serving it is always safe — but the caller should consult the off-domain gate first
   * (useCardDemoStore.ask → /api/demo/card classifyOnly), because this band is where junk
   * queries land when they match a card on shared vocabulary alone.
   */
  weak: boolean;
  /** Top card regardless of the tests — a "did you mean" anchor for the abstention path. */
  suggestion: CardFact | null;
}

// A card must cover at least this fraction of the query's information (idf mass) to be
// served as a confident answer; below it the caller abstains or falls to generation.
export const SEARCH_FLOOR = 0.34;

/**
 * How many of the query's content words the answering card has to actually contain — two,
 * unless the visitor typed only one, in which case one is all there is.
 *
 * COVERAGE IS NOT CONFIDENCE, and at 5% of the deck that gap is the whole ballgame. `frac`
 * below is a share of the query's idf mass, and idf = 1/df decays so fast that one rare word
 * carries almost the whole denominator: in "how hot is lightning" the token `lightning`
 * (df 304) is 0.80 of the mass and `hot` (df 1233) is 0.20, so a card matching ONLY the first
 * scored 0.802 and was served as a confident answer — it was about fireflies. Worse, a query
 * with a single content word gives every card containing it a score of exactly 1.000 (42 cards
 * tied for "gravity", 38 for "langit"), and a strict `>` comparison broke those ties by
 * position in demo-cards.json: "what is gravity" answered with a card about mangroves.
 *
 * Measured on this 2,321-card subset over 38 natural questions: the old rule served a
 * confident local card for 36 of them, roughly two thirds of those topically unrelated, which
 * also meant the server's real answer (/api/demo/card) was never reached for the queries a
 * visitor is most likely to type. This is subset-specific — on the full 46,421-card deck the
 * earliest card carrying a rare token is usually genuinely about it — so it is a cost of
 * shipping 5% and has to be paid here.
 */
const MIN_MATCHED_TOKENS = 2;

/** Float slack when comparing two coverage fractions computed from the same idf values. */
const SCORE_EPSILON = 1e-12;

// What one out-of-vocabulary query token contributes to that information. `idf(df) = 1/df`
// peaks at 1 for a token in a single card, and a token in NO card cannot be commoner than
// that, so 1 is the value the scale already implies rather than a tuned constant.
const UNKNOWN_TOKEN_IDF = 1;

/**
 * The WEAK BAND threshold — aboutness under this marks a served hit as `weak` (see
 * SearchResult.weak). NOT a serving floor: weakness only decides which hits consult the
 * off-domain gate before serving, and every degradation (gate unreachable, gate says
 * in-domain) serves the match. Value + derivation live with the app's copy
 * (packages/mobile/src/data/cards.ts, WEAK_ABOUT). Keep the two in sync.
 *
 * THE VALUE IS THE APP'S BUT THE METRIC HERE IS NOT: this file computes salience as
 * `w/(1+rank)` with no slot-width divisor (the app divides by the head slot's token width)
 * over the demo subset, so the app's band derivation does not transfer by analogy. Measured
 * through THIS implementation (2026-09-01, the arbitration gate's junk + weak rows plus five
 * functional phrasings): all four junk queries MISS this pool outright (nothing served, the
 * server's calibrated gate decides them), the in-domain weak rows land weak (0.010–0.032)
 * or legitimately strong ("ngano nga pula ang atong dugo" 0.049), and NO junk query is
 * served strong — so the analogy holds on every probed query, with the calibrated consult
 * bounding whatever residual skew remains (a weak serve here gets the same judgement a miss
 * would). Re-measure through this file if the demo pool or the formula changes.
 */
export const WEAK_ABOUT = 0.04;

/**
 * Retrieval for the search box. THE SAME CONTRACT the app runs (packages/mobile/src/data/
 * cards.ts, `searchCards`) — keep the two in sync; they have drifted once already, and the
 * drift is what served 90% junk.
 *
 * TWO DIRECTIONS, ranked lexicographically, because one cannot rank cards that all contain
 * the query:
 *   1. COVERAGE  frac = matched idf mass / the query's total — how much of the QUESTION the
 *      card answers. The confidence quantity, gated at SEARCH_FLOOR. On its own it SATURATES:
 *      when every typed word is in the vocabulary the numerator equals the denominator, so
 *      every card carrying those words scores exactly 1.000 (42 tied for "gravity" here, 3,129
 *      for "araw" in the full deck) and a strict `>` keeps whichever the scan reached first.
 *   2. ABOUTNESS how much of the CARD the question explains: the same matched mass weighted by
 *      each token's SALIENCE in that card — 1/(1+rank), rank 0 = its topic, rank i+1 = its
 *      i-th term, PROSE_RANK for a passing mention — over the card's own head mass H(|head|).
 *
 * Salience is POSITION and never the topic STRING: `topic` is English-only, so any score built
 * out of it silently ranks the demo's two DEFAULT languages at random. Position works in all
 * three. (The other obvious alternative — the match's share of the card's total IDF — was
 * measured and rejected: it rewards a card for listing few rare terms.)
 *
 * THREE tests, all of which a confident answer must pass:
 *   a. it covers SEARCH_FLOOR of the query's idf mass;
 *   b. it contains at least `needed` of the query's distinct content words (MIN_MATCHED_TOKENS);
 *   c. at least one of them is HEAD-level — the card is ABOUT a word the visitor typed rather
 *      than merely mentioning it. Binary, so it needs no threshold, and unlike an absolute
 *      aboutness floor it has the same meaning in all three languages.
 *
 * `suggestion` is the top card by the same ranking with (b), (c) and the floor removed: the
 * abstention page still needs somewhere to land, and it inherits the same fix.
 *
 * Ties that survive both directions are broken on the curriculum weight when the caller has one
 * (the same `feedWeigher` the draws use), then on whether the card is furnished with an
 * illustration, then on pool position as a stable last resort.
 *
 * Tokens the vocabulary has never seen are still part of what the visitor asked, and they are
 * the RAREST part of it — so they belong in the DENOMINATOR. Counting only the words we
 * happened to recognise is what let "taylor swift" navigate to a swift-nest card at a confident
 * 1.00. That failure matters more here than on the phone, because this demo carries 5% of the
 * deck: nearly every query has out-of-subset words in it, and a false hit is a query that never
 * reaches the server's real answer (see useCardDemoStore.ask).
 */
export function searchCards(
  query: string,
  currentId: string | null,
  weights?: FeedWeigher
): SearchResult {
  const empty: SearchResult = { best: null, score: 0, about: 0, weak: false, suggestion: null };
  const qtoks = [...new Set(searchTokens(query))];
  if (!qtoks.length) return empty;
  const known = qtoks.filter((t) => TOKEN_DF[t] !== undefined);
  if (!known.length) return empty;
  // Only ever called on tokens the frozen table has — `known` is exactly that filter.
  const idf = (t: string) => 1 / TOKEN_DF[t]!;
  const mass =
    known.reduce((s, t) => s + idf(t), 0) + (qtoks.length - known.length) * UNKNOWN_TOKEN_IDF;
  if (mass <= 0) return empty;

  // Unknown words count toward the requirement but can never satisfy it, so a query with an
  // out-of-vocabulary word in it ("taylor swift") can no longer be answered from one half.
  const needed = Math.min(MIN_MATCHED_TOKENS, qtoks.length);

  let best: CardFact | null = null;
  let bestFrac = 0;
  let bestAbout = -1;
  let bestWeight = -1;
  let bestRich = -1;
  let top: CardFact | null = null; // the suggestion: top card whether or not it qualifies
  let topFrac = 0;
  let topAbout = -1;
  let topWeight = -1;
  let topRich = -1;

  // POOL is walked in pool order, so the strict `>` comparisons below keep the FIRST card at
  // any fully-tied score — position in demo-cards.json, which is the stable last resort the app
  // spells out explicitly (it accumulates into a touch list and cannot rely on scan order).
  for (const f of POOL) {
    if (f.id === currentId) continue;
    const toks = FACT_TOKENS.get(f.id)!;
    const head = HEAD_RANK.get(f.id)!;
    let matchedMass = 0;
    let salience = 0;
    let matched = 0;
    let headLevel = false;
    for (const t of known) {
      if (!toks.has(t)) continue;
      matched += 1;
      const w = idf(t);
      matchedMass += w;
      const rank = head.get(t);
      if (rank === undefined) {
        salience += w / (1 + PROSE_RANK);
      } else {
        salience += w / (1 + rank);
        headLevel = true;
      }
    }
    if (!matched) continue;
    const frac = matchedMass / mass;
    const about = salience / (mass * (HEAD_MASS[head.size] ?? 1));
    const cw = weights ? weights.of(f) : 1;
    // Furnished with a picture, as a property of the CARD rather than of what this browser has
    // finished downloading.
    const rich = f.slug ? 1 : 0;

    if (
      frac > topFrac + SCORE_EPSILON ||
      (frac > topFrac - SCORE_EPSILON &&
        (about > topAbout + SCORE_EPSILON ||
          (about > topAbout - SCORE_EPSILON &&
            (cw > topWeight + SCORE_EPSILON ||
              (cw > topWeight - SCORE_EPSILON && rich > topRich)))))
    ) {
      top = f;
      topFrac = frac;
      topAbout = about;
      topWeight = cw;
      topRich = rich;
    }
    if (matched < needed || !headLevel || frac < SEARCH_FLOOR) continue;
    if (
      frac > bestFrac + SCORE_EPSILON ||
      (frac > bestFrac - SCORE_EPSILON &&
        (about > bestAbout + SCORE_EPSILON ||
          (about > bestAbout - SCORE_EPSILON &&
            (cw > bestWeight + SCORE_EPSILON ||
              (cw > bestWeight - SCORE_EPSILON && rich > bestRich)))))
    ) {
      best = f;
      bestFrac = frac;
      bestAbout = about;
      bestWeight = cw;
      bestRich = rich;
    }
  }

  return {
    best,
    score: best ? bestFrac : topFrac,
    about: Math.max(best ? bestAbout : topAbout, 0),
    weak: !!best && bestAbout < WEAK_ABOUT,
    suggestion: top,
  };
}

const FALLBACK: Record<LanguageKey, Array<keyof CardFact['fact']>> = {
  tagalog: ['tl', 'en', 'bis'],
  english: ['en', 'tl', 'bis'],
  cebuano: ['bis', 'tl', 'en'],
};

export function cardText(fact: CardFact, language: LanguageKey): string {
  for (const k of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = fact.fact[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** Per-language text with the same fallback chain (questions, options, explanations). */
export function localize(tri: Tri | undefined, language: LanguageKey): string {
  for (const k of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = tri?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

export function poolSize(): number {
  return POOL.length;
}

export function getCard(id: string): CardFact | undefined {
  return BY_ID.get(id);
}

/** Overlay no-op: quiz bank is already in the feed chunk on this tree. */
export function warmQuestions(): void {}

export function questionForFact(id: string): CardQuestion | undefined {
  // Cards are keyed by factoid id; the MCQ bank is keyed by the underlying source-fact id.
  const factId = BY_ID.get(id)?.factId ?? id;
  return QUESTIONS.get(factId);
}

/** Uniform pick from any list (categories, labels — anything that is not a card). */
function pickAny<T>(arr: readonly T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

/**
 * Uniform pick from a candidate list of CARDS, or proportional to the student's curriculum
 * weights when a weigher is given. Every UNFORCED choice the feed makes goes through here,
 * which is what makes the grade slide's answer visible: a Grade 3 session and a Grade 10
 * session walk different decks out of the same pool. The DEEP edge deliberately does not —
 * see NextStepOpts.weights.
 */
function pick(arr: CardFact[], w?: FeedWeigher): CardFact | undefined {
  if (!arr.length) return undefined;
  return w ? weightedPick(arr, (f) => w.of(f)) : pickAny(arr);
}

/** Random entry card (session start). Prefers unseen; curriculum-weighted when asked. */
export function startCard(seen: ReadonlySet<string>, w?: FeedWeigher): CardFact {
  const unseen = POOL.filter((f) => !seen.has(f.id));
  return (pick(unseen.length ? unseen : POOL, w) ?? POOL[0]) as CardFact;
}

/**
 * "Shake to reroll" — teleport to a completely unrelated card: a random unseen fact from
 * a DIFFERENT domain than the current one (so the kid escapes a thread that's gone too
 * deep / stale). Falls back across domains then the whole pool as the unseen set thins.
 */
export function jumpCard(currentId: string | null, seen: ReadonlySet<string>, w?: FeedWeigher): CardFact {
  const cur = currentId ? BY_ID.get(currentId) : undefined;
  const usable = (f: CardFact) => f.id !== currentId && !seen.has(f.id);
  const otherDomain = POOL.filter((f) => usable(f) && (!cur || f.domain !== cur.domain));
  if (otherDomain.length) return pick(otherDomain, w)!;
  const anyUnseen = POOL.filter(usable);
  if (anyUnseen.length) return pick(anyUnseen, w)!;
  return (pick(POOL.filter((f) => f.id !== currentId), w) ?? POOL[0]) as CardFact;
}

/**
 * Short, kid-tappable label for a choice. PLACEHOLDER heuristic until the data build
 * ships curated trilingual edge labels: prefer a distinctive term that appears in the
 * localized fact text (so the label matches the app language), else the topic's first
 * significant words.
 */
const TOPIC_STOP = new Set([
  'what', 'why', 'how', 'is', 'are', 'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on',
  'to', 'does', 'do', 'its', 'their', 'has', 'have', 'ang', 'ng', 'sa', 'mga',
]);

/**
 * Terms that are MODIFIERS, not subjects: sizes, colours, positions, quantities, numbers and
 * the "thing/part/kind/way" class. They occur across every domain, so two cards sharing one
 * are not related — that is the "burnay vinegar -> chloroplasts, both mention water" failure,
 * one level below the idf floors. And they occur at every rarity, which is why no idf
 * threshold ever reached this class: a Cebuano colour word can be as rare as a real subject.
 *
 * Trilingual by necessity — `terms` mixes EN/TL/BIS, so an English-only list leaves the
 * Cebuano and Tagalog halves of the same failure untouched. Kept VERBATIM in sync with
 * packages/mobile/src/data/cards.ts (the subset generator parses this very declaration out of
 * this file, so the graph it selects for is the graph this module then serves).
 */
export const NON_TOPICAL = new Set(
  (
    'inner outer upper lower middle centre center front back side top bottom left right ' +
    'loob labas taas baba gitna harap likod sulod gawas ibabaw ubos ' +
    'first second third last next new old young big small large little long short tall ' +
    'high low deep shallow fast slow hot cold warm cool wet dry hard soft light heavy ' +
    'dark bright thick thin wide narrow strong weak clean dirty ' +
    'malaki maliit mabilis mabagal mainit malamig mataas mababa mahaba maikli ' +
    'dako gamay paspas hinay init bugnaw halapad hataas ' +
    'once twice many few all some none each every other another same different ' +
    'one two three four five six seven eight nine ten hundred thousand million ' +
    'isa dalawa tatlo apat lima marami konti lahat iba pareho ' +
    'usa duha tulo upat daghan tanan lain ' +
    'red blue green yellow black white brown grey gray orange purple pink ' +
    'pula asul berde dilaw itim puti kayumanggi kahel lila rosas ' +
    'thing things part kind kinds type types way ways sort form ' +
    'bagay bahagi uri paraan anyo butang klase ' +
    'upward downward inward outward forward backward sideways lengthwise regular normal usual common typical ordinary simple general basic main major minor karaniwan pangkaraniwan normal kasagaran ordinaryo pangunahing more less most least very quite just only also then than such both either neither'
  ).split(' ')
);

/** True when a term says nothing about what a card is ABOUT (see NON_TOPICAL). */
function isTopical(term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  // A multiword term counts as topical only if some word in it is itself topical:
  // "deep sea" is a subject, "deep blue" is not.
  return t.split(/\s+/).some((w) => w.length > 2 && !NON_TOPICAL.has(w));
}

// Generic verbs/adjectives that slip through as terms but read as non-topics for a
// choice label ("tumutubo" = grows, "heart puso" = a bilingual gloss pair). Reject as
// labels; the topic-word fallback gives something more specific.
const BAD_LABELS = new Set([
  'tumutubo', 'lumalaki', 'ginagawa', 'gumagawa', 'nagmumula', 'nabubuo', 'ginagamit',
  'matatagpuan', 'makikita', 'tawag', 'uri', 'iba', 'bawat', 'grows', 'made', 'used',
  'found', 'heart puso',
  // inflected generic verbs the term index surfaces (caught by the harness) — they read
  // as actions, not topics, so they make poor choice labels.
  'humahawak', 'humuhigop', 'sumusuporta', 'kumakain', 'naglalabas', 'naglalaman',
  'nagpapalipat', 'pumoprotekta', 'tumutulong', 'nagpaparami', 'kumikilos',
]);

export function choiceLabel(fact: CardFact, language: LanguageKey): string {
  const text = cardText(fact, language).toLowerCase();
  // Language-matched distinctive term present in the localized text. Multiword terms
  // ("anino ng buwan", "underground river") read like topics; short single words are
  // often generic adjectives — so prefer multiword/longer terms, then rarity.
  let best: string | undefined;
  let bestKey = -Infinity;
  for (const t of fact.terms) {
    if (t.length < 4 || t.length > 22) continue;
    if (BAD_LABELS.has(t)) continue;
    // A modifier is not a topic. This is what produced the "once" ticket: `deep sea` was
    // present in the card's terms and would have won, but the displayed text said "deep
    // ocean", so the includes() test below dropped it and the quantity adverb `once` — which
    // is literally the ANSWER on screen — became the label instead.
    if (!isTopical(t)) continue;
    if (!text.includes(t)) continue;
    const df = termDf(t);
    if (df > 30) continue; // too common to be a topic
    const multi = t.includes(' ') || t.length >= 8 ? 1 : 0;
    const key = multi * 1000 - df; // multiword/long first, then rarest
    if (key > bestKey) {
      bestKey = key;
      best = t;
    }
  }
  if (best) return best;
  // fallback: topic head words
  const words = fact.topic
    .toLowerCase()
    .split(/[^a-z0-9'-]+/)
    .filter((w) => w.length > 2 && !TOPIC_STOP.has(w));
  return words.slice(0, 2).join(' ') || fact.domain.toLowerCase().replace(/_/g, ' ');
}

/**
 * How two pool facts are related, in one pass over the shared terms:
 *   mass  — idf-weighted overlap (the ranking score; rare shared terms dominate)
 *   count — how many terms they share at all
 *   minDf — document frequency of the RAREST shared term (its specificity)
 * Together these separate "both mention water" from "both are about pangolin scales".
 * Every df here is the FROZEN full-corpus one — see the file header.
 */
interface Link {
  mass: number;
  count: number;
  minDf: number;
}

function linkOf(a: CardFact, b: CardFact): Link {
  let mass = 0;
  let count = 0;
  let minDf = Infinity;
  const bTerms = new Set(b.terms);
  const seenTerm = new Set<string>();
  for (const t of a.terms) {
    if (!bTerms.has(t) || seenTerm.has(t)) continue;
    // A shared MODIFIER is not a relationship. Filtering here rather than at the call sites
    // keeps mass/count/minDf consistent: a term that cannot express aboutness must not
    // contribute ranking weight, must not count toward the link-strength floors, and above all
    // must not become the rarest shared term — minDf is the specificity signal, and a
    // rare-but-meaningless token hijacking it is exactly how "the Sun's surface" came to sit
    // next to "the Etruscan shrew".
    if (!isTopical(t)) continue;
    seenTerm.add(t);
    const df = termDf(t);
    mass += 1 / df;
    count += 1;
    if (df < minDf) minDf = df;
  }
  return { mass, count, minDf };
}

/** idf-weighted term overlap between two pool facts (the ranking score alone). */
function overlap(a: CardFact, b: CardFact): number {
  return linkOf(a, b).mass;
}

/** Fraction of the two cards' combined vocabulary (topic + terms + tl/en/bis) they share. */
function textJaccard(a: CardFact, b: CardFact): number {
  const as = FACT_TOKENS.get(a.id);
  const bs = FACT_TOKENS.get(b.id);
  if (!as || !bs || !as.size || !bs.size) return 0;
  let both = 0;
  const [small, large] = as.size <= bs.size ? [as, bs] : [bs, as];
  for (const t of small) if (large.has(t)) both++;
  return both / (as.size + bs.size - both);
}

/**
 * Cards walked on one thread before the feed offers a fork. Mirrors the mobile app
 * (packages/mobile/src/data/cards.ts) — keep the two in sync.
 *
 * Why a cadence counter and not "the thread ran out": measured over 40 x 60-card walks of
 * the real graph, the median card has ONE follow-on above 15% term overlap and 46% have
 * none, with no bimodality in the strength distribution. Branching on exhaustion fires on
 * ~half of all cards, the opposite of occasional. The LaBSE edge graph from the funded
 * data build is what will make thread strength a usable signal.
 */
export const BRANCH_EVERY = 8;

/**
 * How many just-read cards' illustrations are off-limits for the next pick (on top of the
 * current card's own).
 *
 * One picture stands in for a whole cluster of restatements, and a child notices the repeated
 * PICTURE long before the repeated wording. Measured on the phone over 1,920 walked pages:
 * 24.0% of page-turns reused the current card's illustration and 28.6% reused one of the last
 * three. Blocking a short trailing window takes both to 0.0% and costs almost nothing — the
 * deep pick is lost on 0.3% of pages, and those become forks (a real choice), not dead air.
 *
 * Kept short — 5 is exactly the store's RECENT_WINDOW, the whole trail it already keeps —
 * because this is a freshness rule, not a de-dup rule.
 */
const SLUG_COOLDOWN = 5;

/**
 * Near-duplicate cap: a candidate carrying more than this fraction of the current card's own
 * term mass is the same fact reworded, not a next topic. Swept on the phone over 8,456 cards
 * with the illustration cooldown in place: heavy-restatement pairs 2.44% (0.55) -> 1.75%
 * (0.25) -> 1.49% (0.15), while candidates lost stay flat until 0.15, where the cost jumps.
 * 0.25 is that knee. (The web fork ran 0.55 for as long as it computed df inside the subset,
 * where a ~20x-inflated idf made every threshold here meaningless anyway.)
 */
const DEEP_DUP_CAP = 0.25;

/**
 * Floor for a candidate to count as GENUINELY associated ("deep") rather than a card that
 * merely happens to share a common word — the "burnay vinegar -> chloroplasts, both mention
 * water" failure. Two clauses, because one shared term and several shared terms fail in
 * different ways.
 *
 * LINK_MASS_FLOOR (several shared terms): idf mass, not a term COUNT, because terms are
 * trilingual — one concept appears up to three times ("araw"/"adlaw"/"sun"), so a plain "two
 * distinct shared terms" rule is passed by pairs sharing a single generic concept in two
 * languages. Summed idf mass is alias-proof: those score 0.008-0.015 while a real link
 * (pangolin scales, df 21-46) scores 0.15. 0.02 = "as distinctive as one term in 1 card in
 * 50"; the p1 of accepted links is 0.06, so this only bites the junk tail.
 *
 * LINK_RARE_DF (a single shared term): df, not mass, decides whether one word can carry a
 * thread alone. Single-term links are the largest healthy band (21.5% of picks) and are
 * overwhelmingly df<=5; the single-term NON-SEQUITURS cluster at df 15-40, where the shared
 * word is a generic descriptor phrased unusually. df<=10 removes that band at no measurable
 * cost, while df<=5 starts charging for it.
 */
const LINK_MASS_FLOOR = 0.02;
const LINK_RARE_DF = 10;

/**
 * Text-overlap cap on the deep pick: the last way a restatement gets through — the bank
 * holding the SAME fact written twice with different vocabulary AND a different picture
 * ("abaca-fiber-stripping" -> "abaca-fiber-bundle"). FACT_TOKENS is already built for the
 * search box, so the check is a jaccard over two prepared sets, and it runs only when a
 * candidate is about to become the new best. Swept on the phone: heavy-restatement pairs 1.9%
 * uncapped -> 1.2% at 0.35 -> 1.1% at 0.30, with the fork rate flat. 0.35 is the knee.
 */
const TEXT_DUP_JACCARD = 0.35;

export interface NextStepOpts {
  /**
   * Cards walked since a branch was last OFFERED; at >= BRANCH_EVERY the thread forks. The
   * caller owns this counter (see useCardDemoStore) so this module stays pure/stateless.
   */
  threadDepth?: number;
  /**
   * Card ids the reader just saw, oldest first (the store's `recent` trail). Only their
   * ILLUSTRATIONS and CATEGORIES are used here — the last SLUG_COOLDOWN pictures are not
   * served again, and the last CAT_COOLDOWN shelves are not offered again.
   */
  recentIds?: readonly string[];
  /**
   * The student's curriculum weights (feedWeigher). Applied to the LATERAL fork and to the
   * dead-end escapes — every place this function picks a fresh topic rather than following the
   * graph. It is deliberately NOT applied to the DEEP edge: that one is the thread, chosen by
   * idf mass, and re-ranking it by curriculum would let an off-quarter follow-on lose to a
   * weaker link and break the very association the page just promised. Same call the app makes
   * (packages/mobile/src/data/cards.ts: "the weight re-RANKS the survivors; it never re-gates
   * them"), one step more conservative because the web fork has no seen-decay to soften it.
   */
  weights?: FeedWeigher;
}

/** Illustrations that would read as a repeat right now: the current card's + the trail's. */
function cooldownSlugs(cur: CardFact, recentIds?: readonly string[]): Set<string> {
  const slugs = new Set<string>();
  // An empty slug is NOT an illustration and must never enter this set: cards without one
  // would all block each other, and one imageless card in the trail would make every other
  // imageless card unservable.
  if (cur.slug) slugs.add(cur.slug);
  for (const id of (recentIds ?? []).slice(-SLUG_COOLDOWN)) {
    const f = BY_ID.get(id);
    if (f?.slug) slugs.add(f.slug);
  }
  return slugs;
}

/**
 * The "turn the page" choice(s) for the current card.
 *
 * Returns ONE choice — the deep, associated next topic — on a normal page, and TWO when the
 * thread forks: either the BRANCH_EVERY cadence (deep + a lateral jump) or a dead end, where
 * this card has no genuinely associated follow-on left and the reader gets two fresh topics
 * instead of one silently-random "related" card. Callers can treat `choices.length > 1` as
 * "this page branches".
 *
 *   deep    — most-associated unseen fact: shared terms above LINK_MASS_FLOOR, below the
 *             near-duplicate cap, and NOT reusing a recently-shown illustration
 *   lateral — a fresh topic, preferring to go UP THE STACK: a taxonomy shelf ("iba pang mga
 *             insekto") names where the reader is going, where a term scraped out of the
 *             destination card names nothing and occasionally spoils the card they are still
 *             reading. Falls back to a same-domain card with ~no overlap.
 *
 * Falls back gracefully as the unseen pool thins; last resort allows seen cards.
 */
export function nextChoices(
  currentId: string,
  seen: ReadonlySet<string>,
  language: LanguageKey,
  opts: NextStepOpts = {}
): CardChoice[] {
  const cur = BY_ID.get(currentId);
  if (!cur) return [];

  const blockedSlugs = cooldownSlugs(cur, opts.recentIds);
  const topicKey = (f: CardFact) =>
    f.topic
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .sort()
      .join(' ');
  const curTopicKey = topicKey(cur);

  const unseen = (f: CardFact) => f.id !== currentId && !seen.has(f.id);
  /**
   * Servable next to THIS card: unseen, not a picture the reader just saw, and not the same
   * fact reworded under the same topic wording (those exist across grades).
   */
  const servable = (f: CardFact) =>
    unseen(f) && !blockedSlugs.has(f.slug) && topicKey(f) !== curTopicKey;

  // deep: candidates sharing any term, ranked by idf-weighted overlap, but only those whose
  // shared terms are specific enough to be a real thread (LINK_MASS_FLOOR / LINK_RARE_DF) and
  // not so heavy that the candidate is this card restated (DEEP_DUP_CAP).
  const selfScore = overlap(cur, cur);
  const candIds = new Set<string>();
  for (const t of cur.terms) for (const id of TERM_INDEX.get(t) ?? []) candIds.add(id);
  let deep: CardFact | undefined;
  let deepScore = 0;
  for (const id of candIds) {
    const f = BY_ID.get(id);
    if (!f || !servable(f)) continue;
    const link = linkOf(cur, f);
    if (link.mass > selfScore * DEEP_DUP_CAP) continue; // near-duplicate of the current card
    if (link.mass < LINK_MASS_FLOOR) continue; // only generic words in common
    if (link.count < 2 && link.minDf > LINK_RARE_DF) continue; // one unremarkable word
    if (link.mass <= deepScore) continue;
    if (textJaccard(cur, f) > TEXT_DUP_JACCARD) continue; // same fact, different words
    deepScore = link.mass;
    deep = f;
  }

  // A card with no ASSOCIATED follow-on left is a dead end. Anything served next is an
  // unrelated jump anyway, so the reader picks it rather than having it picked for them.
  const deadEnd = !deep;

  // lateral: fresh topic in the same domain — minimal term overlap so it reads as a real
  // change of subject, with the servable filter keeping the picture and wording fresh too.
  const domainPool = (BY_DOMAIN.get(cur.domain) ?? []).filter(
    (f) => servable(f) && f.id !== deep?.id
  );
  const fresh = domainPool.filter((f) => overlap(cur, f) < selfScore * 0.35);
  const lateralPool = fresh.length ? fresh : domainPool;
  const w = opts.weights;
  let lateral = pick(lateralPool, w);

  // ...but prefer to go UP THE STACK rather than sideways by keyword. A CATEGORY names the
  // shelf — "other marine animals" — and draws from a whole leaf instead of one card, so the
  // reader is choosing a direction rather than a specific card they cannot see.
  let lateralCat: string | undefined;
  const cat = freshCategory(cur, opts.recentIds);
  if (cat) {
    const inCat = (BY_CAT.get(cat) ?? []).filter((f) => servable(f) && f.id !== deep?.id);
    const chosen = pick(inCat, w);
    if (chosen) {
      lateral = chosen;
      lateralCat = cat;
    }
  }

  // fallbacks as the unseen pool thins: relax the picture cooldown first (a repeated
  // illustration beats an empty page), then allow any card at all.
  if (!lateral) {
    lateral =
      pick(POOL.filter((f) => unseen(f) && f.id !== deep?.id), w) ??
      pick(POOL.filter((f) => f.id !== currentId), w);
  }

  const out: CardChoice[] = [];
  if (deep) out.push({ factId: deep.id, label: choiceLabel(deep, language), kind: 'deep' });
  if (lateral) {
    const catLabel = lateralCat
      ? `${OTHER_PREFIX[language] ?? OTHER_PREFIX.tagalog} ${leafLabel(lateralCat, language)}`.trim()
      : '';
    out.push({
      factId: lateral.id,
      label: catLabel || choiceLabel(lateral, language),
      kind: 'lateral',
    });
  }

  // Fork on the cadence, or immediately at a dead end. Otherwise the page is single-path.
  if (!deadEnd && (opts.threadDepth ?? 0) < BRANCH_EVERY) return out.slice(0, 1);

  // Dead end: the second option is another fresh topic, not a fake "related" card. Prefer one
  // from a different domain so the two escapes are visibly different offers.
  if (deadEnd && lateral) {
    const second =
      pick(POOL.filter((f) => servable(f) && f.domain !== cur.domain && f.id !== lateral!.id), w) ??
      pick(lateralPool.filter((f) => f.id !== lateral!.id), w) ??
      pick(POOL.filter((f) => unseen(f) && f.id !== lateral!.id), w);
    if (second)
      out.push({ factId: second.id, label: choiceLabel(second, language), kind: 'lateral' });
  }

  // never offer two identical labels — retitle the second from its topic
  if (out.length === 2 && out[0]!.label === out[1]!.label) {
    const f = BY_ID.get(out[1]!.factId)!;
    out[1]!.label = f.topic.split(/\s+/).slice(0, 2).join(' ');
  }
  return out;
}
