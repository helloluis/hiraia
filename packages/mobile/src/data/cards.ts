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
  cardWeight,
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

import cardsPool from '../generated/cardsPool.generated.json';
// curriculumTags.generated.json (scripts/gen-curriculum-tags.mjs, v2 multi-label from
// rag/pipeline/assemble-competency-labels.py; ~97% of the pool): per card
// [competency, grade, quarter, confidence, cells[[grade, quarter, strength, norm]], codes] — a card
// serves up to three competencies (spiral curriculum), each cell carries its own strength and norm.
import curriculumTagsJson from '../generated/curriculumTags.generated.json';
import questionsJson from './cards-questions.json';

export interface CardFact {
  id: string; // factoid id (ffct-NNNNN)
  factId: string; // underlying source-fact id — the key into the MCQ bank
  domain: string;
  topic: string;
  terms: string[];
  fact: { tl: string; en: string; bis: string }; // feed-voice text (Q&A question baked in)
  slug: string; // bundled illustration
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
const QUESTIONS = new Map<string, CardQuestion>(
  (questionsJson as { questions: CardQuestion[] }).questions.map((q) => [q.f, q])
);

// ---- pool: image-backed facts only ----
// The card pool is the bundled-illustration subset of the 36k curriculum factoid bank
// (~17k cards across all four MATATAG elementary domains). Text is the feed-voice factoid
// (Q&A question baked in); `terms` come from the underlying source fact for retrieval.
const POOL: CardFact[] = (cardsPool as { cards: CardFact[] }).cards;

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
const INDEX_BY_ID = new Map<string, number>(POOL.map((f, i) => [f.id, i] as const));
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
    const i = INDEX_BY_ID.get(id);
    if (i !== undefined) EFFECTIVE[i] = EFFECTIVE[i]! * seenCardMultiplier(rec, ctx.now);
  }
  return {
    at: (i) => EFFECTIVE[i] ?? 0,
    // cards outside the pool are unsupported by the feed: lightest band, no overlays
    of: (card) => {
      const i = INDEX_BY_ID.get(card.id);
      return i === undefined ? DEFAULT_CURRICULUM_WEIGHTS.offCurriculum : EFFECTIVE[i]!;
    },
  };
}

/** w = curriculum × recency × seenCard × seenCompetency — always > 0, never a blocklist. */
export function weightOf(card: CardFact, ctx: FeedContext): number {
  return weigher(ctx).of(card);
}

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

const FACT_TOKENS = new Map<string, Set<string>>();
const TOKEN_DF = new Map<string, number>();
for (const f of POOL) {
  const toks = new Set<string>([
    ...searchTokens(f.topic),
    ...f.terms.flatMap((t) => searchTokens(t)),
    ...searchTokens(f.fact.en ?? ''),
    ...searchTokens(f.fact.tl ?? ''),
    ...searchTokens(f.fact.bis ?? ''),
  ]);
  FACT_TOKENS.set(f.id, toks);
  for (const t of toks) TOKEN_DF.set(t, (TOKEN_DF.get(t) ?? 0) + 1);
}

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
export function searchCards(query: string, currentId: string | null): SearchResult {
  const empty: SearchResult = { best: null, score: 0, suggestion: null };
  const qtoks = [...new Set(searchTokens(query))].filter((t) => TOKEN_DF.has(t));
  if (!qtoks.length) return empty;
  const idf = (t: string) => 1 / (TOKEN_DF.get(t) ?? POOL.length);
  const mass = qtoks.reduce((s, t) => s + idf(t), 0);
  if (mass <= 0) return empty;
  let best: CardFact | null = null;
  let bestScore = 0;
  for (const f of POOL) {
    if (f.id === currentId) continue;
    const toks = FACT_TOKENS.get(f.id)!;
    let s = 0;
    for (const t of qtoks) if (toks.has(t)) s += idf(t);
    const frac = s / mass;
    if (frac > bestScore) {
      bestScore = frac;
      best = f;
    }
  }
  return { best: bestScore >= SEARCH_FLOOR ? best : null, score: bestScore, suggestion: best };
}

const FALLBACK: Record<Language, Array<keyof CardFact['fact']>> = {
  tagalog: ['tl', 'en', 'bis'],
  english: ['en', 'tl', 'bis'],
  cebuano: ['bis', 'tl', 'en'],
};

export function cardText(fact: CardFact, language: Language): string {
  for (const k of FALLBACK[language] ?? FALLBACK.tagalog) {
    const v = fact.fact[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

export function poolSize(): number {
  return POOL.length;
}

export function getCard(id: string): CardFact | undefined {
  return BY_ID.get(id);
}

export function questionForFact(id: string): CardQuestion | undefined {
  // Cards are keyed by factoid id; the MCQ bank is keyed by the underlying source-fact id.
  const factId = BY_ID.get(id)?.factId ?? id;
  return QUESTIONS.get(factId);
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
  'what', 'why', 'how', 'is', 'are', 'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on',
  'to', 'does', 'do', 'its', 'their', 'has', 'have', 'ang', 'ng', 'sa', 'mga',
]);

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

/** idf-weighted term overlap between two pool facts. */
function overlap(a: CardFact, b: CardFact): number {
  let s = 0;
  const bTerms = new Set(b.terms);
  for (const t of a.terms) {
    if (bTerms.has(t)) {
      const df = TERM_INDEX.get(t)?.length ?? 1;
      s += 1 / df;
    }
  }
  return s;
}

/**
 * The two "turn the page" choices for the current card:
 *   deep    — most-associated unseen fact (shared distinctive terms)
 *   lateral — random same-domain unseen fact with ~no overlap (fresh topic)
 * With a feed context the neighbours are re-ranked by (edge score × weightOf): the drift
 * still follows edges, but leans toward this quarter's competencies and away from seen.
 * Falls back gracefully as the unseen pool thins; last resort allows seen cards.
 */
export function nextChoices(
  currentId: string,
  seen: ReadonlySet<string>,
  language: Language,
  ctx?: FeedContext
): CardChoice[] {
  const cur = BY_ID.get(currentId);
  if (!cur) return [];
  const usable = (f: CardFact) => f.id !== currentId && !seen.has(f.id);
  const w = ctx ? weigher(ctx) : undefined;
  const weight = (f: CardFact) => (w ? w.of(f) : 1);

  // deep: candidates sharing any term, ranked by idf-weighted overlap — but capped
  // below the NEAR-DUPLICATE band. The bank contains near-identical facts (same fact,
  // different grade/domain), and they score highest by construction; serving one right
  // after its twin reads as a repeat. A candidate sharing >55% of the current card's
  // weighted term mass (or the same topic wording) is treated as a dup, not a neighbor.
  const selfScore = overlap(cur, cur);
  const topicKey = (f: CardFact) =>
    f.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3).sort().join(' ');
  const curTopicKey = topicKey(cur);
  const candIds = new Set<string>();
  for (const t of cur.terms) for (const id of TERM_INDEX.get(t) ?? []) candIds.add(id);
  let deep: CardFact | undefined;
  let deepScore = 0;
  for (const id of candIds) {
    const f = BY_ID.get(id);
    if (!f || !usable(f)) continue;
    const s = overlap(cur, f);
    if (s > selfScore * 0.55) continue; // near-duplicate of the current card
    if (topicKey(f) === curTopicKey) continue; // same topic wording = same fact reworded
    const ranked = s * weight(f);
    if (ranked > deepScore) {
      deepScore = ranked;
      deep = f;
    }
  }

  // lateral: same domain, minimal overlap, not the deep pick, and NOT a reworded twin
  // of the current card (same-topic-wording facts exist across grades/domains).
  const domainPool = (BY_DOMAIN.get(cur.domain) ?? []).filter(
    (f) => usable(f) && f.id !== deep?.id && topicKey(f) !== curTopicKey
  );
  const fresh = domainPool.filter((f) => overlap(cur, f) < selfScore * 0.35);
  let lateral = draw(fresh.length ? fresh : domainPool, w);

  // fallbacks: thin pool → any unseen anywhere → any (seen allowed)
  if (!deep && !lateral) {
    lateral = drawFrom(usable, w) ?? drawFrom((f) => f.id !== currentId, w);
  }
  if (!deep && lateral) {
    const lat = lateral;
    deep = drawFrom((f) => usable(f) && f.id !== lat.id, w);
  }
  if (deep && !lateral) {
    const dp = deep;
    lateral = drawFrom((f) => usable(f) && f.id !== dp.id, w);
  }

  const out: CardChoice[] = [];
  if (deep) out.push({ factId: deep.id, label: choiceLabel(deep, language), kind: 'deep' });
  if (lateral) out.push({ factId: lateral.id, label: choiceLabel(lateral, language), kind: 'lateral' });
  // never offer two identical labels — retitle the second from its topic
  if (out.length === 2 && out[0]!.label === out[1]!.label) {
    const f = BY_ID.get(out[1]!.factId)!;
    out[1]!.label = f.topic.split(/\s+/).slice(0, 2).join(' ');
  }
  return out;
}
