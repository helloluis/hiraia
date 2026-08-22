/**
 * Question-cards feed — WEB DEMO data layer. A near-verbatim port of the mobile app's
 * packages/mobile/src/data/cards.ts (keep the two in sync), reading the 600-card demo
 * subset built by packages/web/scripts/build-demo-cards.mjs instead of the full pool.
 *
 * Everything here is deterministic + local: no model, no network, no latency.
 */
import type { LanguageKey } from '@/config/model';

import cardsPool from './demo-cards.json';
import questionsJson from './demo-questions.json';

export interface CardFact {
  id: string; // factoid id (ffct-NNNNN)
  factId: string; // underlying source-fact id — the key into the MCQ bank
  domain: string;
  topic: string;
  terms: string[];
  fact: { tl: string; en: string; bis: string }; // feed-voice text (Q&A question baked in)
  slug: string; // illustration → /demo/cards/<slug>.png
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

export interface NextStepOpts {
  /** Cards walked since a branch was last OFFERED; at >= BRANCH_EVERY the thread forks. */
  threadDepth?: number;
}

/**
 * The "turn the page" choice(s) for the current card.
 *
 * Returns ONE choice (the deep, associated next topic) on a normal page, and TWO (deep
 * plus a lateral jump) when the thread forks — on the BRANCH_EVERY cadence, or at once
 * when this card has no genuinely associated follow-on left. Callers can treat
 * `choices.length > 1` as "this page branches".
 *
 *   deep    — most-associated unseen fact (shared distinctive terms)
 *   lateral — random same-domain unseen fact with ~no overlap (fresh topic)
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
  const usable = (f: CardFact) => f.id !== currentId && !seen.has(f.id);

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
    if (s > deepScore) {
      deepScore = s;
      deep = f;
    }
  }

  // A card with no ASSOCIATED follow-on left is a dead end: whatever comes next is an
  // unrelated jump anyway, so the reader should get the choice. Captured before the
  // fallbacks below, which fill `deep` with a random card.
  const deadEnd = !deep;

  // lateral: same domain, minimal overlap, not the deep pick, and NOT a reworded twin
  // of the current card (same-topic-wording facts exist across grades/domains).
  const domainPool = (BY_DOMAIN.get(cur.domain) ?? []).filter(
    (f) => usable(f) && f.id !== deep?.id && topicKey(f) !== curTopicKey
  );
  const fresh = domainPool.filter((f) => overlap(cur, f) < selfScore * 0.35);
  let lateral = pick(fresh.length ? fresh : domainPool);

  // fallbacks: thin pool → any unseen anywhere → any (seen allowed)
  if (!deep && !lateral) {
    const anyUnseen = POOL.filter(usable);
    lateral = pick(anyUnseen.length ? anyUnseen : POOL.filter((f) => f.id !== currentId));
  }
  if (!deep && lateral) {
    const others = POOL.filter((f) => usable(f) && f.id !== lateral!.id);
    deep = pick(others);
  }
  if (deep && !lateral) {
    const others = POOL.filter((f) => usable(f) && f.id !== deep!.id);
    lateral = pick(others);
  }

  // Fork on the cadence, or immediately at a dead end. Otherwise the page is single-path.
  const branch = deadEnd || (opts.threadDepth ?? 0) >= BRANCH_EVERY;

  const out: CardChoice[] = [];
  if (deep) out.push({ factId: deep.id, label: choiceLabel(deep, language), kind: 'deep' });
  if (lateral) out.push({ factId: lateral.id, label: choiceLabel(lateral, language), kind: 'lateral' });

  if (!branch) return out.slice(0, 1); // single arrow: the associated next topic

  // never offer two identical labels — retitle the second from its topic
  if (out.length === 2 && out[0]!.label === out[1]!.label) {
    const f = BY_ID.get(out[1]!.factId)!;
    out[1]!.label = f.topic.split(/\s+/).slice(0, 2).join(' ');
  }
  return out;
}
