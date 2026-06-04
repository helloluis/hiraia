import type { Language } from '../types/index.js';
import type { FactHit, ScienceFact } from './types.js';
import { SCIENCE_FACTS } from './facts.generated.js';

/**
 * In-memory lexical retriever over the curated science-fact bank.
 *
 * Design: 295 short facts fit trivially in RAM, so we skip SQLite/FTS5 (and its
 * native module + bundled .db) entirely. Ranking mirrors `build-bank.py`'s
 * column-weighted bm25: a hit in the `topic` field outranks a hit in `terms`,
 * which outranks a hit in the fact body. Scoring is idf-weighted token overlap —
 * deterministic, dependency-free, and easy to reason about at this corpus size.
 *
 * Recall mitigation for the known Tagalog/Cebuano morphology gap: every field is
 * indexed (topic + terms + ALL THREE language bodies), and `terms` already packs
 * TL+BIS+EN keywords. There is no stemming — inflected query forms can still miss
 * (see hiraia-rag-grounding memory); the fix is richer terms or a stemmer.
 */

const FIELD_WEIGHT = { topic: 8, terms: 4, body: 1 } as const;
const MIN_TOKEN_LEN = 3; // matches build-bank.py's `len(t) > 2`

/**
 * Tagalog + Cebuano + English question/function words to drop from QUERIES.
 * Kids phrase questions as "bakit/paano/ano …" / "ngano/unsa/giunsa …"; these
 * words carry no topic signal and (since facts are indexed on their own body
 * text) would otherwise match the wrong facts. Stripping them focuses scoring
 * on content words like "kuryente", "asul", "langit", "bakhaw".
 */
const QUERY_STOP = new Set(
  `bakit paano ano anong kung saan kailan sino sinong alin para kaya
   ngano nganong unsa unsay asa kinsa giunsa pila naunsa
   ito iyan iyon nito niyan kini kana kanang
   what why how when where who whom which whose
   the are does did can could would should about from with into
   your you they them this that these those`
    .split(/\s+/)
    .filter(Boolean)
);

/** Lowercase, strip punctuation, split. Keeps ñ + a few accents for "niño" etc. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9ñáéíóúàèìòù]+/i)
    .filter((t) => t.length >= MIN_TOKEN_LEN);
}

interface IndexedFact {
  fact: ScienceFact;
  topic: Set<string>;
  terms: Set<string>;
  body: Set<string>;
}

const LANG_KEY: Record<Language, 'tl' | 'en' | 'bis'> = {
  english: 'en',
  tagalog: 'tl',
  cebuano: 'bis',
};

export class RagStore {
  private docs: IndexedFact[] = [];
  private idf = new Map<string, number>();

  constructor(facts: ScienceFact[] = SCIENCE_FACTS) {
    const df = new Map<string, number>();
    for (const fact of facts) {
      const topic = new Set(tokenize(fact.topic));
      const terms = new Set(tokenize(fact.terms.join(' ')));
      const body = new Set(
        tokenize(`${fact.fact.tl} ${fact.fact.en} ${fact.fact.bis}`)
      );
      this.docs.push({ fact, topic, terms, body });

      // Document frequency: count each token once per fact (any field).
      const seen = new Set([...topic, ...terms, ...body]);
      for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
    }

    const N = this.docs.length || 1;
    for (const [t, d] of df) {
      // Smoothed idf (BM25-style); always positive so common words still help a little.
      this.idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
    }
  }

  get size(): number {
    return this.docs.length;
  }

  /**
   * Return the top-k facts for a query, best first. Body text is resolved to the
   * given language. Facts with zero overlap are dropped.
   */
  search(query: string, topK = 3, language: Language = 'english'): FactHit[] {
    // Normally we drop question/glue words so content words drive ranking. But a
    // bare identity question ("sino ka", "ano kayo", "para saan to") is ALL such
    // words — stripping leaves nothing. In that case fall back to the raw tokens
    // so the pronouns/question words themselves can match the ABOUT_HIRAIA facts
    // (which carry "sino", "kayo", "para", … as terms).
    const stripped = tokenize(query).filter((t) => !QUERY_STOP.has(t));
    const qTokens = new Set(stripped.length > 0 ? stripped : tokenize(query));
    if (qTokens.size === 0) return [];
    const key = LANG_KEY[language];

    const scored: FactHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const t of qTokens) {
        const w = doc.topic.has(t)
          ? FIELD_WEIGHT.topic
          : doc.terms.has(t)
            ? FIELD_WEIGHT.terms
            : doc.body.has(t)
              ? FIELD_WEIGHT.body
              : 0;
        if (w > 0) score += w * (this.idf.get(t) ?? 0);
      }
      if (score > 0) {
        scored.push({ fact: doc.fact, text: doc.fact.fact[key], score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Search, then keep only confidently-relevant hits: at most `max`, and only
   * those scoring within `floorRatio` of the top hit. Use this to decide what to
   * inject as grounding — a small 1B is misled by loosely-related facts, so we
   * prefer a tight set (or none) over a noisy one.
   */
  retrieveForGrounding(
    query: string,
    language: Language = 'english',
    max = 3,
    floorRatio = 0.5
  ): FactHit[] {
    const hits = this.search(query, max, language);
    if (hits.length === 0) return [];
    const top = hits[0]!.score;
    return hits.filter((h) => h.score >= top * floorRatio);
  }
}
