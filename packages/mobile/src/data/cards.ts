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
 * Everything here is deterministic + local: no model, no network, no latency.
 */
import type { Language } from '@hiraia/shared';

import cardsPool from '../generated/cardsPool.generated.json';
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

/** Random entry card (session start). Prefers unseen. */
export function startCard(seen: ReadonlySet<string>): CardFact {
  const unseen = POOL.filter((f) => !seen.has(f.id));
  return (pick(unseen.length ? unseen : POOL) ?? POOL[0]) as CardFact;
}

/**
 * "Shake to reroll" — teleport to a completely unrelated card: a random unseen fact from
 * a DIFFERENT domain than the current one (so the kid escapes a thread that's gone too
 * deep / stale). Falls back across domains then the whole pool as the unseen set thins.
 */
export function jumpCard(currentId: string | null, seen: ReadonlySet<string>): CardFact {
  const cur = currentId ? BY_ID.get(currentId) : undefined;
  const usable = (f: CardFact) => f.id !== currentId && !seen.has(f.id);
  const otherDomain = POOL.filter((f) => usable(f) && (!cur || f.domain !== cur.domain));
  if (otherDomain.length) return pick(otherDomain)!;
  const anyUnseen = POOL.filter(usable);
  if (anyUnseen.length) return pick(anyUnseen)!;
  return (pick(POOL.filter((f) => f.id !== currentId)) ?? POOL[0]) as CardFact;
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
  const A = FACT_TOKENS.get(a.id);
  const B = FACT_TOKENS.get(b.id);
  if (!A?.size || !B?.size) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both += 1;
  return both / (A.size + B.size - both);
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
}

/** Illustrations that would read as a repeat right now: the current card's + the trail's. */
function cooldownSlugs(cur: CardFact, recentIds?: readonly string[]): Set<string> {
  const slugs = new Set<string>([cur.slug]);
  for (const id of (recentIds ?? []).slice(-SLUG_COOLDOWN)) {
    const f = BY_ID.get(id);
    if (f) slugs.add(f.slug);
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

  const blockedSlugs = cooldownSlugs(cur, opts.recentIds);
  const topicKey = (f: CardFact) =>
    f.topic.toLowerCase().split(/\s+/).filter((w) => w.length > 3).sort().join(' ');
  const curTopicKey = topicKey(cur);

  const unseen = (f: CardFact) => f.id !== currentId && !seen.has(f.id);
  // Servable next to THIS card: unseen, a different picture from the last few pages, and
  // not the same fact reworded under the same topic wording (those exist across grades).
  const servable = (f: CardFact) =>
    unseen(f) && !blockedSlugs.has(f.slug) && topicKey(f) !== curTopicKey;

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
    if (link.mass <= deepScore) continue;
    if (textJaccard(cur, f) > TEXT_DUP_JACCARD) continue; // same fact, different words
    deepScore = link.mass;
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
  let lateral = pick(lateralPool);

  // fallbacks as the unseen pool thins: relax the picture cooldown first (a repeated
  // illustration beats an empty page), then allow any unseen card, then any card at all.
  if (!lateral) {
    const anyUnseen = POOL.filter((f) => unseen(f) && f.id !== deep?.id);
    lateral = pick(anyUnseen.length ? anyUnseen : POOL.filter((f) => f.id !== currentId));
  }

  const out: CardChoice[] = [];
  if (deep) out.push({ factId: deep.id, label: choiceLabel(deep, language), kind: 'deep' });
  if (lateral) out.push({ factId: lateral.id, label: choiceLabel(lateral, language), kind: 'lateral' });

  // Fork on the cadence, or immediately at a dead end. Otherwise the page is single-path.
  if (!deadEnd && (opts.threadDepth ?? 0) < BRANCH_EVERY) return out.slice(0, 1);

  // Dead end: the second option is another fresh topic, not a fake "related" card. Prefer
  // one from a different domain so the two escapes are visibly different offers.
  if (deadEnd && lateral) {
    const otherDomain = POOL.filter(
      (f) => servable(f) && f.domain !== cur.domain && f.id !== lateral!.id
    );
    const second =
      pick(otherDomain) ??
      pick(lateralPool.filter((f) => f.id !== lateral!.id)) ??
      pick(POOL.filter((f) => unseen(f) && f.id !== lateral!.id));
    if (second) out.push({ factId: second.id, label: choiceLabel(second, language), kind: 'lateral' });
  }

  // never offer two identical labels — retitle the second from its topic
  if (out.length === 2 && out[0]!.label === out[1]!.label) {
    const f = BY_ID.get(out[1]!.factId)!;
    out[1]!.label = f.topic.split(/\s+/).slice(0, 2).join(' ');
  }
  return out;
}
