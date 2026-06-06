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
 * LANGUAGE SCOPING: the fact bodies are indexed per-language, and a query is
 * scored against the ACTIVE language's body only — plus a low-weight English
 * bridge (kids code-switch — "ngano blue ang langit", "oxygen", "gravity") — but
 * NOT the other vernacular's body. Tagalog and Cebuano share enough vocabulary
 * that a blended index produced wrong-language distractors; scoping kills those.
 * The language-neutral anchors (topic + terms, which pack TL+BIS+EN keywords) are
 * always scored. No stemming yet — inflected forms can still miss (see
 * hiraia-rag-grounding memory); the fix is richer terms or a stemmer.
 */

const FIELD_WEIGHT = { topic: 8, terms: 4, body: 1, bridge: 0.5 } as const;
// Recent-conversation context is scored at this fraction of query weight — enough
// to tip ambiguous follow-ups, too little to override a fresh question's match.
const CONTEXT_WEIGHT = 0.35;
const MIN_TOKEN_LEN = 3; // matches build-bank.py's `len(t) > 2`

/**
 * Tagalog + Cebuano + English question/function words to drop from QUERIES.
 * Kids phrase questions as "bakit/paano/ano …" / "ngano/unsa/giunsa …"; these
 * words carry no topic signal and (since facts are indexed on their own body
 * text) would otherwise match the wrong facts. Stripping them focuses scoring
 * on content words like "kuryente", "asul", "langit", "bakhaw".
 */
const QUERY_STOP = new Set(
  // Generic question/glue words PLUS topic-less PROCESS verbs a kid prepends to any
  // topic ("paano gumagana ang X", "saan nagmumula ang Y", "ano ang ginagawa ng Z").
  // Unstripped, those verbs hijack matches at 5k scale — the content noun must drive
  // ranking. Kept conservative: only clearly topic-less operation verbs, NOT content
  // verbs like humihinga/lumilipad/kumakain. TL + a few BIS forms.
  `bakit paano ano anong kung saan kailan sino sinong alin para kaya
   ngano nganong unsa unsay asa kinsa giunsa pila naunsa
   ito iyan iyon nito niyan kini kana kanang
   ang mga yung nga kang iya niya nila ila
   may mayroon meron adunay naa
   what why how when where who whom which whose
   the are does did can could would should about from with into
   your you they them this that these those
   gumagana gumana paggana gampanan
   nagmumula nagmula magmula nanggaling nanggagaling pinagmumulan pinanggagalingan
   ginagawa gumagawa ginawa gawin
   nagiging naging magiging nagagawa
   nangyayari nangyari mangyayari nagaganap naganap
   ginagamit gumagamit gamitin
   lumalaki tumataas bumababa
   gibuhat gihimo nahimo nahitabo mahitabo gigamit gigikanan`
    .split(/\s+/)
    .filter(Boolean)
);

/**
 * Conservative plural collapse so singular/plural forms unify (the query "dinosaur"
 * must reach the fact whose terms say "dinosaurs"). Applied to BOTH index and query,
 * so it only needs to be CONSISTENT, not linguistically correct — over-stemming a
 * word the same way on both sides still matches. Excludes -ss/-us/-is/-os/-as/-ous
 * and short words so proper nouns (Uranus, Venus) and Tagalog/Cebuano words survive.
 */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y'; // batteries->battery
  if (t.length > 4 && t.endsWith('s') && !/(ss|us|is|os|as|ous)$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Lowercase, strip punctuation, split, stem. Keeps ñ + a few accents for "niño". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9ñáéíóúàèìòù]+/i)
    .filter((t) => t.length >= MIN_TOKEN_LEN)
    .map(stem);
}

type LangKey = 'tl' | 'en' | 'bis';

interface IndexedFact {
  fact: ScienceFact;
  topic: Set<string>;
  terms: Set<string>;
  body: Record<LangKey, Set<string>>; // one token set per language body
}

const LANG_KEY: Record<Language, LangKey> = {
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
      const body: Record<LangKey, Set<string>> = {
        tl: new Set(tokenize(fact.fact.tl)),
        en: new Set(tokenize(fact.fact.en)),
        bis: new Set(tokenize(fact.fact.bis)),
      };
      this.docs.push({ fact, topic, terms, body });

      // Document frequency: count each token once per fact (across all fields, so
      // idf reflects the full multilingual vocabulary).
      const seen = new Set([...topic, ...terms, ...body.tl, ...body.en, ...body.bis]);
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
   *
   * `context` (recent conversation turns) is scored at a fraction of the query's
   * weight (CONTEXT_WEIGHT): the current message dominates ranking for a fresh,
   * self-contained question, while context only TIPS otherwise-ambiguous matches —
   * e.g. a follow-up "Dahil sa asteroid?" after a dinosaur-extinction turn picks the
   * impact fact over the asteroid-belt fact, without contaminating an unrelated
   * next question.
   */
  search(query: string, topK = 3, language: Language = 'english', context = ''): FactHit[] {
    // Normally we drop question/glue words so content words drive ranking. But a
    // bare identity question ("sino ka", "ano kayo", "para saan to") is ALL such
    // words — stripping leaves nothing. In that case fall back to the raw tokens
    // so the pronouns/question words themselves can match the ABOUT_HIRAIA facts
    // (which carry "sino", "kayo", "para", … as terms).
    const stripped = tokenize(query).filter((t) => !QUERY_STOP.has(t));
    const qTokens = new Set(stripped.length > 0 ? stripped : tokenize(query));
    if (qTokens.size === 0) return [];
    // Context tokens that aren't already in the query (those would double-count).
    const ctxTokens = new Set(
      tokenize(context).filter((t) => !QUERY_STOP.has(t) && !qTokens.has(t))
    );
    const key = LANG_KEY[language];

    // Field weight for a token in a doc: topic/terms are language-neutral anchors;
    // body is scoped to the active language + a low-weight English bridge for
    // code-switched terms. The OTHER vernacular's body is deliberately not scored.
    const fieldWeight = (doc: IndexedFact, t: string): number => {
      if (doc.topic.has(t)) return FIELD_WEIGHT.topic;
      if (doc.terms.has(t)) return FIELD_WEIGHT.terms;
      if (doc.body[key].has(t)) return FIELD_WEIGHT.body;
      if (key !== 'en' && doc.body.en.has(t)) return FIELD_WEIGHT.bridge;
      return 0;
    };

    const scored: FactHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const t of qTokens) {
        const w = fieldWeight(doc, t);
        if (w > 0) score += w * (this.idf.get(t) ?? 0);
      }
      // context tips ties at a fraction of the weight; never drives ranking alone.
      let ctxScore = 0;
      for (const t of ctxTokens) {
        const w = fieldWeight(doc, t);
        if (w > 0) ctxScore += w * (this.idf.get(t) ?? 0);
      }
      if (score > 0) {
        scored.push({ fact: doc.fact, text: doc.fact.fact[key], score: score + CONTEXT_WEIGHT * ctxScore });
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
    floorRatio = 0.5,
    context = ''
  ): FactHit[] {
    const hits = this.search(query, max, language, context);
    if (hits.length === 0) return [];
    const top = hits[0]!.score;
    return hits.filter((h) => h.score >= top * floorRatio);
  }
}
