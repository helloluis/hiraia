/**
 * Question-cards feed — data layer (v1, NO generated content).
 *
 * The card pool is the IMAGE-BACKED subset of the bundled fact bank (~3.5k facts with a
 * FACT_IMAGE illustration) — enough for ~12h of unique feed while we test the UX. Card
 * text is the fact's own trilingual sentence verbatim; the engaging rewrite ("Alam mo
 * ba…" hooks) comes with the funded data build, as do curated choice labels and the
 * LaBSE-precomputed edge graph. Until then:
 *   - DEEP edge   = highest idf-weighted term-overlap fact (directly associated topic)
 *   - LATERAL edge = random same-domain fact with ~zero term overlap (new topic, same
 *     category)
 *   - choice labels are derived heuristically from the target fact's topic/terms
 *     (placeholder quality — flagged for the data build).
 *
 * Draws are WEIGHTED when the caller passes a FeedContext (rag/pipeline/FEED-WEIGHTING.md):
 * heaviest = the student's grade in the current curriculum quarter, lightest = already seen.
 * Without a context every draw is uniform (the headless harness relies on that).
 *
 * Everything here is deterministic + local: no model, no network, no latency.
 */
import {
  DEFAULT_CURRICULUM_WEIGHTS,
  curriculumMultiplier,
  recencyMultiplier,
  seenCardMultiplier,
  seenCompetencyMultiplier,
  type CurriculumTag,
  type GradeLevel,
  type Language,
  type Quarter,
  type SeenRecord,
} from '@hiraia/shared';

import cardsIndex from '../generated/cardsIndex.generated.json';
// curriculumTags.generated.json (scripts/gen-curriculum-tags.mjs, v2 multi-label from
// rag/pipeline/assemble-competency-labels.py; ~97% of the pool): per card
// [competency, grade, quarter, confidence, cells[[grade, quarter, strength, norm]], codes] — a card
// serves up to three competencies (spiral curriculum), each cell carries its own strength and norm.
import curriculumTagsJson from '../generated/curriculumTags.generated.json';

import {
  loadQuestions,
  loadText,
  questionOf,
  searchTokenRows,
  textOf,
  tokenJaccard,
} from './cardDb';

export interface CardFact {
  id: string; // factoid id (ffct-NNNNN)
  factId: string; // underlying source-fact id — the key into the MCQ bank
  domain: string;
  topic: string;
  terms: string[];
  /**
   * NOT on the card any more — see cardText()/cardTitle()/cardEmphasis(), which read it from
   * the database. Sequencing never needed a card's prose (it works off terms, slug, cats,
   * topic and domain), and carrying 19 MB of it through the JS bundle cost ~100 MB of
   * Hermes bytecode and 742 ms of module init.
   */
  slug: string; // bundled illustration
  /**
   * SHORT display title for the index band ("Eels & Eggs"), pregenerated per card.
   * Optional so the app keeps working before the generated titles are assembled into the
   * pool — the band falls back to `topic`, which is what it printed before. The topic is a
   * poor band label twice over: it restates the body text sitting directly beneath it, and
   * at a median 33 characters it truncated mid-word on most cards.
   *
   * Trilingual, mirroring `fact`, so the band follows the reader's language rather than
   * pinning English above Tagalog body copy.
   */
  /** Taxonomy leaf ids (rag/pipeline/card-taxonomy.json) — powers "other <category>". */
  cats?: string[];
  /**
   * The one or two words this card is ABOUT, as EXACT substrings of `fact` in each language.
   * Exactness is the contract: the renderer locates the span by string search, so anything
   * that is not present verbatim is simply not emphasised. rag/pipeline/wire-app-pool.py
   * re-checks every span against the text that ships and drops the stale ones.
   */
  /**
   * Set when the editorial pass judged this card STRONGER as typography than as a picture —
   * definitions, named laws, formulas, single striking numbers. Advisory: it says a card
   * would carry a poster well, not that it lacks art.
   */
}

export interface CardChoice {
  factId: string;
  label: string;
  kind: 'deep' | 'lateral';
}

// ---- interject questions (exact quiz MCQs keyed by factId; 75% of the pool) ----
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
/**
 * WHICH facts have an MCQ — that is all the interject needs to decide, and it is ~200 KB of
 * ids against 15.6 MB of questions. The question itself is fetched when one is actually
 * asked (see questionForFact).
 */
const HAS_QUESTION = new Set<string>(
  (cardsIndex as { questionFactIds?: string[] }).questionFactIds ?? []
);

// ---- pool: image-backed facts only ----
// The card pool is the bundled-illustration subset of the 36k curriculum factoid bank
// (~17k cards across all four MATATAG elementary domains). Text is the feed-voice factoid
// (Q&A question baked in); `terms` come from the underlying source fact for retrieval.
const POOL: CardFact[] = (cardsIndex as { cards: CardFact[] }).cards;

/** Card id -> its ordinal in the pool, which is how the binary token index is addressed. */
const ORD = new Map<string, number>(POOL.map((f, i) => [f.id, i]));

const BY_ID = new Map(POOL.map((f) => [f.id, f]));
const BY_DOMAIN = new Map<string, CardFact[]>();
for (const f of POOL) {
  const arr = BY_DOMAIN.get(f.domain) ?? [];
  arr.push(f);
  BY_DOMAIN.set(f.domain, arr);
}

// ---- curriculum tags: one MATATAG competency per card (rag/pipeline/tag-curriculum.py) ----
// [competency, grade, quarter, confidence] for the tagged ~85% of the pool; the rest are
// off-curriculum. The competency code is the feed's topic axis — never card.topic, which is
// a per-card slug (15,739 distinct values in 16,948 cards).
type TagRow = [string, number, number, number, [number, number, number, number][]?, string[]?];
const TAGS = new Map<string, CurriculumTag>();
for (const [id, [competency, grade, quarter, confidence, cells, codes]] of Object.entries(
  curriculumTagsJson as unknown as Record<string, TagRow>
)) {
  TAGS.set(id, {
    competency,
    grade,
    quarter,
    confidence,
    cells: cells?.map(([g, q, s, n]) => ({ grade: g, quarter: q, strength: s === 2 ? 2 : 1, norm: n })),
    codes,
  });
}

/** Every competency code a card serves (best first), or ['off'] — for competency_seen bumps. */
export function competencyKeys(id: string): string[] {
  const tag = TAGS.get(id);
  if (!tag || tag.confidence < DEFAULT_CURRICULUM_WEIGHTS.minConfidence) return ['off'];
  return tag.codes?.length ? [...tag.codes] : [tag.competency];
}

/** competency_seen key: the tag code, or 'off' for untagged / low-confidence cards (seen-store.sql). */
export function competencyKey(id: string): string {
  const tag = TAGS.get(id);
  return tag && tag.confidence >= DEFAULT_CURRICULUM_WEIGHTS.minConfidence ? tag.competency : 'off';
}

/**
 * Per-draw feed-weighting context: the student's grade, the curriculum quarter inferred from
 * the device date (null in summer), and the persistent seen-store (card_seen keyed by card id,
 * competency_seen keyed by competency code or 'off'). Optional at every draw site.
 */
export interface FeedContext {
  studentGrade: GradeLevel;
  currentQuarter: Quarter | null;
  now: number; // epoch ms
  cardSeen: ReadonlyMap<string, SeenRecord>;
  competencySeen: ReadonlyMap<string, SeenRecord>;
}

/**
 * Session weight table. The curriculum factor depends only on (grade, inferred quarter, tags), so
 * it is computed ONCE per session and rebuilt only when the grade or the quarter changes (rare —
 * settings edit, or the calendar rolling into the next quarter). What changes between draws is the
 * seen-store, and only for the few cards/competencies just shown, so it is applied per draw as a
 * SPARSE overlay: competency decay via a small per-code multiplier array and one tight loop over
 * pre-flattened int code lists, card decay by iterating the seen cards themselves. No per-card Map
 * lookups, no filtered copies of the pool.
 */
// (the id -> ordinal map the weight table indexes by is ORD, declared with the pool above)
const TAG_AT: (CurriculumTag | undefined)[] = POOL.map((f) => TAGS.get(f.id));
// competency codes as small ints; each card's codes flattened into CODE_LIST[CODE_OFFSETS[i] .. CODE_OFFSETS[i+1])
// 'off' (untagged / low-confidence) is deliberately NOT a competency here: 500+ unrelated cards must not
// decay together because a few of them were shown.
const CODE_INDEX = new Map<string, number>();
const CODE_OFFSETS = new Int32Array(POOL.length + 1);
const codeInts: number[] = [];
for (let i = 0; i < POOL.length; i += 1) {
  CODE_OFFSETS[i] = codeInts.length;
  for (const code of competencyKeys(POOL[i]!.id)) {
    if (code === 'off') continue;
    let k = CODE_INDEX.get(code);
    if (k === undefined) {
      k = CODE_INDEX.size;
      CODE_INDEX.set(code, k);
    }
    codeInts.push(k);
  }
}
CODE_OFFSETS[POOL.length] = codeInts.length;
const CODE_LIST = Int32Array.from(codeInts);
const CODE_MUL = new Float64Array(CODE_INDEX.size);
const weightTable = { key: '', base: new Float64Array(POOL.length) };
const EFFECTIVE = new Float64Array(POOL.length); // base × seen overlays, resolved once per draw
const SCRATCH = new Float64Array(POOL.length); // predicate-masked weights during selection
/** Test hook: how many times the session table has been (re)built. */
export const weightTableStats = { rebuilds: 0 };

function ensureWeightTable(ctx: FeedContext): Float64Array {
  const key = `${ctx.studentGrade}|${ctx.currentQuarter ?? 'summer'}`;
  if (weightTable.key !== key) {
    for (let i = 0; i < POOL.length; i += 1) {
      weightTable.base[i] =
        curriculumMultiplier(TAG_AT[i], ctx.studentGrade, ctx.currentQuarter) * recencyMultiplier();
    }
    weightTable.key = key;
    weightTableStats.rebuilds += 1;
  }
  return weightTable.base;
}

/** Weights bound to one draw: index form for pool scans, card form for small candidate lists. */
export interface Weigher {
  at(i: number): number;
  of(card: CardFact): number;
}

/**
 * Resolve base × seen overlays into EFFECTIVE once for this draw (~0.1–0.3 ms for the whole pool),
 * then every lookup is an array read. A Weigher is only valid until the next weigher() call.
 */
export function weigher(ctx: FeedContext): Weigher {
  EFFECTIVE.set(ensureWeightTable(ctx));
  let anyCode = false;
  CODE_MUL.fill(1);
  for (const [code, rec] of ctx.competencySeen) {
    const k = CODE_INDEX.get(code);
    if (k === undefined) continue; // 'off' and unknown codes never decay a group
    CODE_MUL[k] = seenCompetencyMultiplier(rec, ctx.now);
    anyCode = true;
  }
  if (anyCode) {
    // every code the card serves decays it; the strongest decay wins
    for (let i = 0; i < POOL.length; i += 1) {
      let m = 1;
      for (let p = CODE_OFFSETS[i]!; p < CODE_OFFSETS[i + 1]!; p += 1) {
        const v = CODE_MUL[CODE_LIST[p]!]!;
        if (v < m) m = v;
      }
      if (m < 1) EFFECTIVE[i] = EFFECTIVE[i]! * m;
    }
  }
  for (const [id, rec] of ctx.cardSeen) {
    const i = ORD.get(id);
    if (i !== undefined) EFFECTIVE[i] = EFFECTIVE[i]! * seenCardMultiplier(rec, ctx.now);
  }
  return {
    at: (i) => EFFECTIVE[i] ?? 0,
    // cards outside the pool are unsupported by the feed: lightest band, no overlays
    of: (card) => {
      const i = ORD.get(card.id);
      return i === undefined ? DEFAULT_CURRICULUM_WEIGHTS.offCurriculum : EFFECTIVE[i]!;
    },
  };
}

/** w = curriculum × recency × seenCard × seenCompetency — always > 0, never a blocklist. */
export function weightOf(card: CardFact, ctx: FeedContext): number {
  return weigher(ctx).of(card);
}

/**
 * TAXONOMY — the mid-level category layer between a card and its domain.
 *
 * The pool's only built-in grouping is `domain`, which has FOUR values across ~17k cards, so
 * it can express "other living things" and nothing finer. The generated leaves (about a
 * hundred, median ~70 cards) are what let the feed offer "other marine animals".
 *
 * Optional at runtime: the taxonomy is written into the generated pool by
 * rag/pipeline/assemble-card-titles.py, so before that runs these are simply empty and the
 * feed falls back to its previous same-domain lateral. The feature appears when the data does.
 */
interface TaxonomyLeaf {
  id: string;
  parent: string | null;
  label_en: string;
  label_tl: string;
  label_bis: string;
}
const TAXONOMY: TaxonomyLeaf[] = (cardsIndex as { taxonomy?: TaxonomyLeaf[] }).taxonomy ?? [];
const LEAF = new Map(TAXONOMY.map((l) => [l.id, l]));

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
const OTHER_PREFIX: Record<Language, string> = {
  tagalog: 'iba pang',
  english: 'other',
  cebuano: 'ubang',
};

function leafLabel(id: string, language: Language): string {
  const l = LEAF.get(id);
  if (!l) return '';
  if (language === 'english') return l.label_en;
  if (language === 'cebuano') return l.label_bis || l.label_tl || l.label_en;
  return l.label_tl || l.label_en;
}

/**
 * A category the reader has NOT just been shown. Ascending is only worth doing if it opens a
 * genuinely different shelf — offering "other marine animals" three cards running is the same
 * broken-record failure as repeating an illustration, one level up.
 */
function freshCategory(
  cur: CardFact,
  recentIds: readonly string[] | undefined,
  exclude: ReadonlySet<string>
): string | undefined {
  const cats = (cur.cats ?? []).filter((c) => BY_CAT.has(c) && !exclude.has(c));
  if (!cats.length) return undefined;
  const recentCats = new Set<string>();
  for (const id of (recentIds ?? []).slice(-CAT_COOLDOWN)) {
    for (const c of BY_ID.get(id)?.cats ?? []) recentCats.add(c);
  }
  const unused = cats.filter((c) => !recentCats.has(c));
  return pick(unused.length ? unused : cats);
}

/** How many recent cards' categories are held back before a category may be offered again. */
const CAT_COOLDOWN = 6;

// term -> factIds (within the pool) + document frequency for idf weighting
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
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'in',
  'on',
  'to',
  'is',
  'are',
  'be',
  'it',
  'its',
  'that',
  'this',
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'does',
  'do',
  'can',
  'for',
  'with',
  'as',
  'at',
  'by',
  'about',
  'tell',
  'me',
  'my',
  'ang',
  'ng',
  'sa',
  'mga',
  'ay',
  'na',
  'ba',
  'ito',
  'iyan',
  'yan',
  'ako',
  'ko',
  'mo',
  'niya',
  'ni',
  'kung',
  'kapag',
  'para',
  'may',
  'ano',
  'bakit',
  'paano',
  'saan',
  'sino',
  'kailan',
  'gusto',
  'malaman',
  'tungkol',
  'unsa',
  'nga',
  'og',
  'ug',
  'kang',
  'kini',
  'kana',
  'ngano',
  'giunsa',
  'hibaw',
]);

function searchTokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9ñ]+/gi) ?? [])
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 2 && !SEARCH_STOP.has(t));
}

/**
 * The search index used to be built HERE, tokenising all three languages of all 29,737 cards
 * at module init — 427 ms on a desktop, several times that on the phone, and the one thing
 * that genuinely required the whole inventory to be resident. It is precomputed into the
 * database now (46,177 tokens), and searchCards looks up only the query's own tokens.
 */

export interface SearchResult {
  /** Best card at/above the confidence floor, else null (→ caller abstains or generates). */
  best: CardFact | null;
  /** Fraction (0..1) of the query's idf mass the top card covers. */
  score: number;
  /** Top card regardless of floor — a "did you mean" anchor for the abstention path. */
  suggestion: CardFact | null;
}

// A card must cover at least this fraction of the query's information (idf mass) to be
// served as a confident answer; below it the caller abstains or falls to generation.
export const SEARCH_FLOOR = 0.34;

/**
 * Retrieval for the search box: score every pool card by the idf-weighted overlap of the
 * query's tokens with the card's tokens, return the best (with its normalized score) plus
 * the top card as an abstention suggestion. Excludes the current card.
 */
export async function searchCards(query: string, currentId: string | null): Promise<SearchResult> {
  const empty: SearchResult = { best: null, score: 0, suggestion: null };
  const qtoks = [...new Set(searchTokens(query))];
  if (!qtoks.length) return empty;

  // Only the query's own tokens are fetched, and only the cards carrying one of them are
  // scored. The old version walked the whole pool because its index ran the wrong way.
  const rows = await searchTokenRows(qtoks);
  if (!rows.length) return empty;

  const idf = (df: number) => 1 / (df || POOL.length);
  const mass = rows.reduce((s, r) => s + idf(r.df), 0);
  if (mass <= 0) return empty;

  // ordinal -> accumulated idf mass. Same score as before: the fraction of the query's mass
  // a card covers. A card carrying none of the tokens scored 0 and could never win, which is
  // why skipping it entirely changes nothing (verified: identical picks on every probe).
  const acc = new Map<number, number>();
  for (const r of rows) {
    const w = idf(r.df);
    for (const part of r.ords.split(',')) {
      const o = +part;
      acc.set(o, (acc.get(o) ?? 0) + w);
    }
  }

  let best: CardFact | null = null;
  let bestScore = 0;
  for (const [ord, s] of acc) {
    const f = POOL[ord];
    if (!f || f.id === currentId) continue;
    const frac = s / mass;
    if (frac > bestScore) {
      bestScore = frac;
      best = f;
    }
  }
  return { best: bestScore >= SEARCH_FLOOR ? best : null, score: bestScore, suggestion: best };
}

const FALLBACK: Record<Language, Array<'tl' | 'en' | 'bis'>> = {
  tagalog: ['tl', 'en', 'bis'],
  english: ['en', 'tl', 'bis'],
  cebuano: ['bis', 'tl', 'en'],
};

/**
 * The card's text in the reader's language.
 *
 * Read from the database's warm map rather than the card, because the prose is 19 MB and
 * carrying it through the JS bundle cost ~100 MB of Hermes bytecode. '' means the card has
 * not been warmed yet — the store warms a page and its successors before either is shown, so
 * in practice this is only reachable for one frame on a cold start.
 */
export function cardText(fact: CardFact, language: Language): string {
  const row = textOf(fact.id);
  if (!row) return '';
  for (const k of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = row.fact[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/**
 * The card's band title in the reader's language, or '' when it has none. Callers fall back
 * to `topic`. Same fallback chain as cardText, so a missing Cebuano title shows Tagalog
 * before English.
 */
/**
 * The band title for a card id, in the reader's language, or '' when the row has not been
 * warmed yet. The reward recap resolves titles at DISPLAY time through this: at LOG time the
 * lazily-loaded card database may not have the row yet, and falling back to `topic` there put
 * raw English slugs ("ants farm aphids for honeydew") into a Tagalog list.
 */
export function cardTitleById(id: string, language: Language): string {
  const row = textOf(id);
  if (!row?.title) return '';
  for (const k of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = row.title[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

export function cardTitle(fact: CardFact, language: Language): string {
  const row = textOf(fact.id);
  if (!row?.title) return '';
  for (const k of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = row.title[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/** The emphasis spans for this card in the reader's language, if it has been warmed. */
export function cardEmphasis(fact: CardFact, language: Language): string[] | undefined {
  const k = language === 'english' ? 'en' : language === 'cebuano' ? 'bis' : 'tl';
  return textOf(fact.id)?.emphasis?.[k];
}

/** Whether this card reads better as a poster than with a picture (editorial judgement). */
export function cardIsPoster(fact: CardFact): boolean {
  return textOf(fact.id)?.poster === true;
}

export function poolSize(): number {
  return POOL.length;
}

export function getCard(id: string): CardFact | undefined {
  return BY_ID.get(id);
}

export function questionForFact(id: string): CardQuestion | undefined {
  const factId = BY_ID.get(id)?.factId ?? id;
  if (!HAS_QUESTION.has(factId)) return undefined;
  return (questionOf(factId) as CardQuestion | null) ?? undefined;
}

/** Whether a card HAS an MCQ — resident, so the interject can decide without a query. */
export function hasQuestionForFact(id: string): boolean {
  const factId = BY_ID.get(id)?.factId ?? id;
  return HAS_QUESTION.has(factId);
}

function pick<T>(arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

/**
 * One card from the pool matching `pred`: uniform without a context (the headless harness path),
 * else proportional to the session weight table × seen overlays — a single pass over the pool
 * into a reused scratch buffer, no filtered copies of the pool.
 */
function drawFrom(pred: (f: CardFact) => boolean, w?: Weigher): CardFact | undefined {
  if (!w) return pick(POOL.filter(pred));
  let total = 0;
  for (let i = 0; i < POOL.length; i += 1) {
    const v = pred(POOL[i]!) ? w.at(i) : 0;
    SCRATCH[i] = v;
    total += v;
  }
  if (total <= 0) return undefined;
  let r = Math.random() * total;
  let last: CardFact | undefined;
  for (let i = 0; i < POOL.length; i += 1) {
    const v = SCRATCH[i] ?? 0;
    if (v <= 0) continue;
    last = POOL[i];
    r -= v;
    if (r < 0) return last;
  }
  return last;
}

/** Uniform pick from a small candidate array, or proportional to the session weights when a context is given. */
function draw(arr: CardFact[], w?: Weigher): CardFact | undefined {
  if (!w || arr.length === 0) return pick(arr);
  let total = 0;
  for (let k = 0; k < arr.length; k += 1) {
    const v = w.of(arr[k]!);
    SCRATCH[k] = v;
    total += v;
  }
  if (total <= 0) return pick(arr);
  let r = Math.random() * total;
  for (let k = 0; k < arr.length; k += 1) {
    r -= SCRATCH[k] ?? 0;
    if (r < 0) return arr[k];
  }
  return arr[arr.length - 1];
}

/** Entry card (session start). Prefers unseen; weighted by the feed context when given. */
export function startCard(seen: ReadonlySet<string>, ctx?: FeedContext): CardFact {
  const w = ctx ? weigher(ctx) : undefined;
  return (drawFrom((f) => !seen.has(f.id), w) ?? drawFrom(() => true, w) ?? POOL[0]) as CardFact;
}

/**
 * "Shake to reroll" — teleport to a completely unrelated card: a random unseen fact from
 * a DIFFERENT domain than the current one (so the kid escapes a thread that's gone too
 * deep / stale). Falls back across domains then the whole pool as the unseen set thins.
 */
export function jumpCard(currentId: string | null, seen: ReadonlySet<string>, ctx?: FeedContext): CardFact {
  const cur = currentId ? BY_ID.get(currentId) : undefined;
  const usable = (f: CardFact) => f.id !== currentId && !seen.has(f.id);
  const w = ctx ? weigher(ctx) : undefined;
  return (
    drawFrom((f) => usable(f) && (!cur || f.domain !== cur.domain), w) ??
    drawFrom(usable, w) ??
    drawFrom((f) => f.id !== currentId, w) ??
    POOL[0]
  ) as CardFact;
}

/**
 * Short, kid-tappable label for a choice. PLACEHOLDER heuristic until the data build
 * ships curated trilingual edge labels: prefer a distinctive term that appears in the
 * localized fact text (so the label matches the app language), else the topic's first
 * significant words.
 */
const TOPIC_STOP = new Set([
  'what',
  'why',
  'how',
  'is',
  'are',
  'the',
  'a',
  'an',
  'of',
  'and',
  'or',
  'in',
  'on',
  'to',
  'does',
  'do',
  'its',
  'their',
  'has',
  'have',
  'ang',
  'ng',
  'sa',
  'mga',
]);

// Generic verbs/adjectives that slip through as terms but read as non-topics for a
// choice label ("tumutubo" = grows, "heart puso" = a bilingual gloss pair). Reject as
// labels; the topic-word fallback gives something more specific.
/**
 * NON-TOPICAL words: they describe a MODIFIER, never a subject.
 *
 * One list, because one bug produced three separate symptoms the owner reported:
 *   - a fact about the OUTER / MIDDLE / INNER ear was illustrated with the SOLAR SYSTEM
 *     (slug `inner-vs-outer-planets`, matched on {inner, outer})
 *   - next-card NON-SEQUITURS: the Sun's surface -> an Etruscan shrew, linked by a numeral;
 *     stratosphere -> a barquillos wafer, linked by Cebuano `matahum` ("beautiful")
 *   - a next-card LABEL that read "once" — a quantity adverb, and also the ANSWER to the
 *     question printed on the card the reader was looking at
 * All three are term overlap treating a modifier as if it carried subject meaning. Rarity is
 * not aboutness: a token can be vanishingly rare in the bank and still say nothing about what
 * a card is ABOUT, which is why no idf threshold ever reached this class.
 *
 * Trilingual by necessity — `terms` mixes EN/TL/BIS, so an English-only list leaves the
 * Cebuano and Tagalog halves of the same failure untouched. Mirrors NONTOPIC in
 * rag/pipeline/build-factoid-src.py, which applies the same rule when illustrations are
 * assigned upstream; keep the two in sync.
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
    // directional adverbs and 'unremarkable' words: a card labelled "upward" or
    // "regular" tells a reader nothing, and both slipped through the first list.
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

const BAD_LABELS = new Set([
  'tumutubo',
  'lumalaki',
  'ginagawa',
  'gumagawa',
  'nagmumula',
  'nabubuo',
  'ginagamit',
  'matatagpuan',
  'makikita',
  'tawag',
  'uri',
  'iba',
  'bawat',
  'grows',
  'made',
  'used',
  'found',
  'heart puso',
  // inflected generic verbs the term index surfaces (caught by the harness) — they read
  // as actions, not topics, so they make poor choice labels.
  'humahawak',
  'humuhigop',
  'sumusuporta',
  'kumakain',
  'naglalabas',
  'naglalaman',
  'nagpapalipat',
  'pumoprotekta',
  'tumutulong',
  'nagpaparami',
  'kumikilos',
]);

export function choiceLabel(fact: CardFact, language: Language): string {
  const text = cardText(fact, language).toLowerCase();
  // Language-matched distinctive term present in the localized text. Multiword terms
  // ("anino ng buwan", "underground river") read like topics; short single words are
  // often generic adjectives — so prefer multiword/longer terms, then rarity.
  let best: string | undefined;
  let bestKey = -Infinity;
  for (const t of fact.terms) {
    if (t.length < 4 || t.length > 22) continue;
    if (BAD_LABELS.has(t)) continue;
    // A modifier is not a topic. This is what produced the "once" ticket: `deep sea`
    // was present in the card's terms and would have won, but the displayed text said
    // "deep ocean", so the includes() test below dropped it and the quantity adverb
    // `once` — which is literally the ANSWER on screen — became the label instead.
    if (!isTopical(t)) continue;
    if (!text.includes(t)) continue;
    const df = TERM_INDEX.get(t)?.length ?? 1;
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
    // contribute ranking weight, must not count toward the link-strength floors, and above
    // all must not become the rarest shared term — minDf is the specificity signal, and a
    // rare-but-meaningless token (a numeral, a colour, a Cebuano adjective) hijacking it is
    // exactly how "the Sun's surface" came to sit next to "the Etruscan shrew".
    if (!isTopical(t)) continue;
    seenTerm.add(t);
    const df = TERM_INDEX.get(t)?.length ?? 1;
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

/**
 * Cards walked on one thread before the feed offers a fork. The feed is SINGLE-PATH by
 * default (one arrow, one next topic); a branch is an occasional, deliberate moment.
 *
 * Why a cadence counter and not "the thread ran out": measured over 40 x 60-card walks of
 * the real graph, the median card has ONE follow-on above 15% term overlap and 46% have
 * none, with a smooth strength distribution (median 0.163 of self-score, no bimodality).
 * No threshold separates "healthy thread" from "exhausted thread" — branching on
 * exhaustion fires on ~half of all cards, the opposite of occasional. The heuristic edges
 * are not strong enough to carry that signal; the LaBSE edge graph from the funded data
 * build is what will make thread strength meaningful. Until then a counter gives an exact,
 * tunable rate, and the dead-end case below still catches genuine no-neighbour cards.
 */
export const BRANCH_EVERY = 8;

/**
 * How many just-read cards' illustrations are off-limits for the next pick (on top of the
 * current card's own).
 *
 * 2,837 distinct pictures back the 16,948 cards, so one picture stands in for a whole
 * cluster of restatements — and a child notices the repeated PICTURE long before the
 * repeated wording. Measured by the harness over 1,920 walked pages: 24.0% of page-turns
 * reused the current card's illustration and 28.6% reused one of the last three. Blocking
 * a short trailing window takes both to 0.0% and costs almost nothing: the deep pick is
 * lost on 0.3% of pages, and those become forks (a real choice), not dead air.
 *
 * Kept short — 5 is exactly cardStore's RECENT_WINDOW, the whole trail it already keeps —
 * because this is a freshness rule, not a de-dup rule: 4 still let 0.5% of pictures come
 * back at 5 cards' distance, while a window longer than the trail would start pushing
 * genuinely related follow-ons out of reach on picture-dense topics like the water cycle.
 */
const SLUG_COOLDOWN = 5;

/**
 * Near-duplicate cap: a candidate carrying more than this fraction of the current card's
 * own term mass is the same fact reworded, not a next topic.
 *
 * The old 0.55 was too loose, but the cap alone is NOT the lever for restatements: swept on
 * its own over 3.1k cards, 0.55 -> 0.25 moved the same-illustration rate only 25.9% ->
 * 24.1%, because a reworded fact is a near-duplicate in PICTURE and topic far more often
 * than in term mass. The illustration cooldown above is what removes them. With it in
 * place, swept over 8,456 cards, the cap does clean up the residual wording band —
 * jaccard>0.35: 2.44% (0.55) -> 2.35% (0.45) -> 1.75% (0.25) -> 1.49% (0.15) — while
 * candidates lost stay flat (1.23% -> 1.29%) until 0.15, where the cost jumps to 1.71% for
 * a smaller gain. 0.25 is that knee. The trade it buys is visible and intended: deep picks
 * carry less shared term mass (median 0.40 -> 0.34) precisely because the near-twins are
 * gone.
 */
const DEEP_DUP_CAP = 0.25;

/**
 * Floor for a candidate to count as GENUINELY associated ("deep") rather than a card that
 * merely happens to share a common word — the "burnay vinegar -> chloroplasts, both mention
 * water" failure. Two clauses, because one shared term and several shared terms fail in
 * different ways.
 *
 * LINK_MASS_FLOOR (several shared terms): why idf mass and not a term COUNT — terms are
 * trilingual, so one concept appears up to three times ("araw"/"adlaw"/"sun"). A plain "two
 * distinct shared terms" rule is passed by pairs sharing a single generic concept in two
 * languages; measured examples: "how far is the Sun from Earth" -> "green algae in pond
 * water" (araw:375, adlaw:208) and "nearest star to Earth" -> "plants make the energy
 * stored in go foods" (sun:139, araw:375, adlaw:208). Summed idf mass is alias-proof: those
 * score 0.008 and 0.015, while a real link ("pangolin rolling defense" -> "Philippine
 * pangolin has scales", df 21-46) scores 0.15. 0.02 = "as distinctive as one term appearing
 * in 1 card in 50" — the p1 of accepted links is 0.06, so this only bites the junk tail.
 *
 * LINK_RARE_DF (a single shared term): document frequency, not mass, decides whether one
 * word can carry a thread by itself. Measured: single-term links are the largest healthy
 * band (21.5% of picks) and are overwhelmingly df<=5 — both cards sit in a tiny cluster
 * about that exact thing. The single-term NON-SEQUITURS cluster at df 15-40, where the
 * shared word is a generic descriptor that happens to be phrased unusually: "leaf insect
 * mimics damaged leaf" -> "soft feather edges muffle sound" (gilid:30, "edge"), "SI base
 * unit for amount of substance" -> "hirudin in leeches" (sangkap:29, "component"),
 * "surface temperature of the Sun" -> "water plants shade keeps shrimp cool" (init sa
 * adlaw:15). Requiring df<=10 removes that whole band; the tightening cost nothing
 * measurable (fork rate 11.8% -> 11.8%, dead-end forks 0.3% of pages), while df<=5 starts
 * charging for it (0.7%).
 */
const LINK_MASS_FLOOR = 0.02;
const LINK_RARE_DF = 10;

/**
 * Text-overlap cap on the deep pick: the last way a restatement gets through.
 *
 * Term mass and the illustration cooldown both miss the case where the bank holds the SAME
 * fact written twice with different vocabulary and a different picture — measured examples
 * (illustration cooldown already on): "abaca-fiber-stripping" -> "abaca-fiber-bundle",
 * "organ-heart" -> "blood-circulation-loop", "drum" -> "tambol-marching-drum". They read as
 * the app saying the same sentence again.
 *
 * FACT_TOKENS is already built for the search box (topic + terms + all three languages), so
 * the check is a jaccard over two prepared sets, and it runs only when a candidate is about
 * to become the new best — a handful of times per page turn, not once per candidate.
 *
 * Swept on the adjacency QA (1,180 walked pairs), heavy-restatement pairs (tagalog
 * content-word jaccard > 0.30): 1.9% with no cap -> 1.7% at 0.40 -> 1.2% at 0.35 -> 1.1% at
 * 0.30, with the fork rate flat (11.6%) and mean idf overlap essentially unmoved (0.381 ->
 * 0.379). 0.35 is the knee; below it the cap starts costing link strength for almost no
 * further gain.
 */
const TEXT_DUP_JACCARD = 0.35;

/** Fraction of the two cards' combined vocabulary (topic + terms + tl/en/bis) they share. */
function textJaccard(a: CardFact, b: CardFact): number {
  return tokenJaccard(ORD.get(a.id) ?? -1, ORD.get(b.id) ?? -1);
}

export interface NextStepOpts {
  /**
   * Cards walked since a branch was last OFFERED; at >= BRANCH_EVERY the thread forks.
   * The caller owns this counter (see cardStore) so this module stays pure/stateless.
   */
  threadDepth?: number;
  /**
   * Card ids the reader just saw, oldest first (cardStore's `recent` trail). Only their
   * ILLUSTRATIONS are used here — the last SLUG_COOLDOWN pictures are not served again.
   * Passing ids rather than slugs keeps the caller in the vocabulary it already has; the
   * lookup is a pool read, so the module stays pure.
   */
  recentIds?: readonly string[];
  /**
   * Curriculum weighting for this draw (rag/pipeline/FEED-WEIGHTING.md). Omitted → every
   * choice is drawn uniformly, which is the path the headless harnesses walk.
   */
  ctx?: FeedContext;
}

/**
 * Illustrations that would read as a repeat right now: the current card's + the trail's.
 *
 * An empty slug is NOT an illustration and must never enter this set. A card without a
 * picture renders as a typographic card (see CardPage), and thousands of them share the
 * empty string — pooled into the cooldown they would all block each other, so one imageless
 * card in the trail would make every other imageless card unservable and the feed would
 * narrow to the illustrated bank alone.
 */
function cooldownSlugs(cur: CardFact, recentIds?: readonly string[]): Set<string> {
  const slugs = new Set<string>();
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
 *   lateral — unseen same-domain fact with ~no overlap (fresh topic, same category)
 *
 * With a feed context (opts.ctx) the surviving neighbours are re-RANKED by (edge score ×
 * card weight): the drift still follows the card graph — every gate below is unchanged —
 * but leans toward this quarter's competencies and away from what has been seen.
 * Falls back gracefully as the unseen pool thins; last resort allows seen cards.
 */
export function nextChoices(
  currentId: string,
  seen: ReadonlySet<string>,
  language: Language,
  opts: NextStepOpts = {}
): CardChoice[] {
  const cur = BY_ID.get(currentId);
  if (!cur) return [];
  // One weigher for this whole call: it reads the session weight table through a shared
  // buffer and is only valid until the next weigher(), so it is taken once and passed down.
  const w = opts.ctx ? weigher(opts.ctx) : undefined;
  const weight = (f: CardFact) => (w ? w.of(f) : 1);

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
  // Servable next to THIS card: unseen, a different picture from the last few pages, and
  // not the same fact reworded under the same topic wording (those exist across grades).
  const servable = (f: CardFact) =>
    unseen(f) && !(f.slug && blockedSlugs.has(f.slug)) && topicKey(f) !== curTopicKey;

  // deep: candidates sharing any term, ranked by idf-weighted overlap, but only those whose
  // shared terms are specific enough to be a real thread (see LINK_MASS_FLOOR) and not so
  // heavy that the candidate is this card restated (see DEEP_DUP_CAP).
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
    // The curriculum weight re-RANKS the survivors; it never re-gates them. The three floors
    // above are calibrated on RAW idf mass, so folding the weight in before them would let a
    // heavily-weighted junk edge through and drop a genuine follow-on for being off-quarter.
    // Applied here, the thread still walks the graph and the weight only decides between
    // edges that are already good enough to serve.
    const ranked = link.mass * weight(f);
    if (ranked <= deepScore) continue;
    if (textJaccard(cur, f) > TEXT_DUP_JACCARD) continue; // same fact, different words
    deepScore = ranked;
    deep = f;
  }

  // A card with no ASSOCIATED follow-on left is a dead end. Anything served next is an
  // unrelated jump anyway, so the reader picks it rather than having it picked for them —
  // and we label both options for what they are (lateral), instead of dressing a random
  // card up as the "related" one.
  const deadEnd = !deep;

  // lateral: fresh topic in the same domain — minimal term overlap so it reads as a real
  // change of subject, with the servable filter keeping the picture and wording fresh too.
  const domainPool = (BY_DOMAIN.get(cur.domain) ?? []).filter(
    (f) => servable(f) && f.id !== deep?.id
  );
  const fresh = domainPool.filter((f) => overlap(cur, f) < selfScore * 0.35);
  const lateralPool = fresh.length ? fresh : domainPool;
  let lateral = draw(lateralPool, w);

  /**
   * ...but prefer to go UP THE STACK rather than sideways by keyword.
   *
   * A random same-domain card is an unlabelled promise: the ticket can only name some term
   * scraped out of the destination, which is how a next-card button came to read "once". A
   * CATEGORY names the shelf — "other marine animals" — and draws from ~70 cards instead of
   * one, so the reader is choosing a direction rather than a specific card they cannot see.
   * That is also why this is the better answer to a dead end: with no associated follow-on
   * left, the honest offer is a subject, not a card picked at random and dressed up as
   * related.
   */
  let lateralCat: string | undefined;
  const cat = freshCategory(cur, opts.recentIds, new Set());
  if (cat) {
    const inCat = (BY_CAT.get(cat) ?? []).filter((f) => servable(f) && f.id !== deep?.id);
    const chosen = draw(inCat, w);
    if (chosen) {
      lateral = chosen;
      lateralCat = cat;
    }
  }

  // fallbacks as the unseen pool thins: relax the picture cooldown first (a repeated
  // illustration beats an empty page), then allow any unseen card, then any card at all.
  if (!lateral) {
    lateral =
      drawFrom((f) => unseen(f) && f.id !== deep?.id, w) ?? drawFrom((f) => f.id !== currentId, w);
  }

  const out: CardChoice[] = [];
  if (deep) out.push({ factId: deep.id, label: choiceLabel(deep, language), kind: 'deep' });
  if (lateral) {
    // When the lateral came from a category, LABEL IT AS THE CATEGORY. This is the whole
    // point of ascending: "iba pang hayop-dagat" tells the reader what shelf they are moving
    // to, where a term lifted out of the destination card tells them nothing and occasionally
    // spoils the card they are still reading. Falls back to the term label when the card has
    // no category yet (before the generated taxonomy is assembled into the pool).
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

  // Dead end: the second option is another fresh topic, not a fake "related" card. Prefer
  // one from a different domain so the two escapes are visibly different offers.
  if (deadEnd && lateral) {
    const second =
      drawFrom((f) => servable(f) && f.domain !== cur.domain && f.id !== lateral!.id, w) ??
      draw(
        lateralPool.filter((f) => f.id !== lateral!.id),
        w
      ) ??
      drawFrom((f) => unseen(f) && f.id !== lateral!.id, w);
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

/**
 * Warm everything a page needs before it is shown: its own text, the text of the cards it can
 * turn to, and the MCQs for the recent trail the interject draws from.
 *
 * The feed is linear — from a card you can only reach its own choices — so warming one page
 * ahead is enough for the reader never to meet a cold one.
 *
 * The successors are PASSED IN, never re-derived here. Draws are weighted (grade, quarter,
 * seen-decay) and the weights move between calls, so recomputing `nextChoices` in this
 * function would warm a different card than the one the reader can actually tap — and the
 * page they do tap would paint with empty body text (`textOf` is a synchronous cache read).
 * The store already knows its real targets: it hands them over.
 */
export async function warmPage(
  ids: readonly (string | null | undefined)[],
  recentFactIds: readonly string[] = []
): Promise<void> {
  const cards = ids.filter((x): x is string => !!x && BY_ID.has(x));
  await Promise.all([
    loadText(cards),
    recentFactIds.length ? loadQuestions(recentFactIds) : Promise.resolve(),
  ]);
}
