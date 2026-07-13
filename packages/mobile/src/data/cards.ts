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
import type { Language, ScienceFact } from '@hiraia/shared';
import { SCIENCE_FACTS } from '@hiraia/shared';

import { FACT_IMAGE } from '../generated/factImage';
import questionsJson from './cards-questions.json';

export interface CardFact {
  id: string;
  domain: string;
  topic: string;
  terms: string[];
  fact: { tl: string; en: string; bis: string };
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
const POOL: CardFact[] = (SCIENCE_FACTS as ScienceFact[])
  .filter((f) => FACT_IMAGE[f.id])
  .map((f) => ({
    id: f.id,
    domain: f.domain,
    topic: f.topic,
    terms: (f.terms ?? []).map((t) => t.toLowerCase()),
    fact: f.fact,
    slug: FACT_IMAGE[f.id]!,
  }));

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
  return QUESTIONS.get(id);
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
 * Falls back gracefully as the unseen pool thins; last resort allows seen cards.
 */
export function nextChoices(currentId: string, seen: ReadonlySet<string>, language: Language): CardChoice[] {
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
