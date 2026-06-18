import type { Language } from '../types/index.js';
import type { FactHit, ScienceFact } from './types.js';
import type { SemanticIndex } from './SemanticIndex.js';
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
// Facts already shown this conversation are scored down so "tell me more" surfaces
// FRESH facts instead of repeating the same top-3. Soft (not excluded): a re-ask
// with no better alternative still returns the fact.
const SEEN_PENALTY = 0.25;
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
  // `totoo/tinuod (ba)` is myth-framing ("is it TRUE that 10% of the brain…") — left in,
  // its high IDF hijacks myth queries to "X-is-not-real" facts (dreams-not-real,
  // sound-cannot-be-seen) instead of the topic's debunk fact. Strip it so the content
  // noun (utak) drives, same rationale as the process verbs above.
  // image-REQUEST framing ("may PICTURE/LARAWAN ka ba ng dinosaur", "PAKITA mo ng X") asks
  // to SEE X — the content is X, but unstripped "picture/larawan" hijacks to facts ABOUT
  // pictures (screen pixels, pictograph, the eye's inverted image). Strip the request
  // words so the topic (dinosaur) drives; the illustration still rides the top fact.
  `bakit paano ano anong kung saan kailan sino sinong alin para kaya
   ngano nganong unsa unsay asa kinsa giunsa pila naunsa
   ito iyan iyon nito niyan kini kana kanang
   ang mga yung nga kang iya niya nila ila
   may mayroon meron adunay naa
   bang ba kaya nga daw raw pala naman lang lamang
   totoo totoong tutoo tutuo tinuod tuod
   picture pic larawan litrato hulagway drawing pakita ipakita
   oo opo oho oonga sige gusto payag game pwede mao sure
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

// Below this many characters a query isn't "padded" — it's a terse reply/follow-up
// ("oo", "bakit?", "ulan ba?"), so stripping filler would risk removing its only
// content for zero dilution benefit. Skip normalization entirely below it. (Every R1
// win is a 30+ char padded query, so this never undoes them.)
const MIN_NORMALIZE_LEN = 24;

/**
 * Normalize a raw kid query before EMBEDDING it for semantic retrieval. Real kids
 * wrap questions in conversational/politeness filler ("po", "may project ako about
 * sa…", "sabi ng teacher ko…", "totoo po ba"), which dilutes the LaBSE sentence
 * vector and drops covered topics under the abstain floor (measured: ~0.15 cosine).
 * This strips that framing so the embedding reflects the CONTENT. Lexical search is
 * unaffected (it has its own QUERY_STOP); only the embed input is normalized.
 *
 * SHORT inputs are returned untouched (see MIN_NORMALIZE_LEN) — a single-word reply
 * has no padding to strip. We DO keep single-CONTENT-word RESULTS ("puso") since
 * those are the ideal output; only an empty/scrap result falls back to the original.
 */
// Query-side colloquial/abbreviation expansion (R3): map a kid's slang to the formal
// term the curriculum uses, applied to BOTH retrieval paths. Whole-word only, query
// only (NOT the index — the corpus's literal "Las Piñas" must stay "pinas"). Fixes the
// homonym collision where "pinas" (slang for Pilipinas) matched the place "Las Piñas":
// "lindol sa pinas" retrieved Las Piñas shorebirds; "lindol sa pilipinas" retrieves the
// Ring-of-Fire / fault facts. Keep this list short and unambiguous.
// NB: do NOT add "ph"→"pilipinas" — pH (acids/bases) is a real grade-school science term.
const COLLOQUIAL: [RegExp, string][] = [
  [/\bpinas\b/gi, 'pilipinas'],
];
export function expandColloquial(text: string): string {
  return COLLOQUIAL.reduce((s, [re, to]) => s.replace(re, to), text);
}

export function normalizeQuery(text: string): string {
  const original = expandColloquial(text.trim()); // expand regardless of length
  if (original.length < MIN_NORMALIZE_LEN) return original; // terse reply — leave it
  let s = ` ${original} `;
  // 1) framing PREFIXES that carry no science content (a kid wrapping a question)
  s = s.replace(
    /\b(?:may|meron|mayroon)\s+(?:akong?\s+)?(?:homework|project|assignment|report|takdang[-\s]?aralin|gawain|proyekto)\s+(?:po\s+)?(?:ako\s+)?(?:na\s+)?(?:tungkol|about|ukol)\s+(?:sa\s+)?/gi,
    ' '
  );
  // "kailangan ko(ng) gumawa/gawin ng report/project/essay tungkol sa X" and the
  // "gusto ko(ng) gumawa ..." variant — a SECOND school-work framing the original
  // pattern missed. Without this, "Kailangan kong gumawa ng report tungkol sa mga
  // planeta" embeds the whole framed string and the semantic side hijacks onto a
  // "school project"/"report" fact instead of the planets (gate: planets-project).
  s = s.replace(
    /\b(?:kailangan|gusto|kelangan)\s+(?:ko(?:ng)?\s+)?(?:po\s+)?(?:gumawa|gawin|mag-?gawa|magsulat|sumulat)\s+(?:po\s+)?(?:ng\s+)?(?:homework|project|proyekto|report|ulat|assignment|takdang[-\s]?aralin|gawain|sanaysay|essay)\s+(?:po\s+)?(?:tungkol|about|ukol|hinggil)\s+(?:sa\s+)?/gi,
    ' '
  );
  s = s.replace(
    /\bsabi\s+(?:po\s+)?(?:ng\s+)?(?:aking\s+|akong\s+)?(?:teacher|guro|titser|kaibigan|kaklase|kapatid|nanay|tatay|magulang|lolo|lola)\s+(?:ko\s+)?(?:na\s+)?/gi,
    ' '
  );
  s = s.replace(/\b(?:pwede|puwede)\s+(?:po\s+)?(?:ba\s+)?(?:akong?\s+)?(?:patulong|matulungan|magtanong|magpaturo)\s+(?:sa\s+)?/gi, ' ');
  s = s.replace(/\bpatulong\s+(?:po\s+)?(?:naman\s+)?(?:sa\s+)?/gi, ' ');
  // 2) framing SUFFIXES (claim-checks)
  s = s.replace(/,?\s*totoo\s+(?:po\s+)?ba(?:ng)?(?:\s+po)?\s*\??\s*$/gi, ' ');
  s = s.replace(/,?\s*(?:tama|mali)\s+(?:po\s+)?ba(?:\s+po)?\s*\??\s*$/gi, ' ');
  s = s.replace(/\bdi\s+ba\s*(?:po)?\s*\??\s*$/gi, ' ');
  // 3) standalone politeness/discourse PARTICLES that dilute the embedding (kept out
  // of QUERY_STOP because the lexical side handles them differently)
  s = s.replace(/\b(?:po|pô|naman|kasi|nga|talaga|ba|raw|daw|pala|eh|kaya)\b/gi, ' ');
  const result = s.replace(/\s+/g, ' ').trim();
  // Keep single content words (good!), but if stripping left only a scrap, use original.
  return result.length >= 3 ? result : original;
}

// How much recent conversation to fold in as a topical anchor (chars). Enough to
// carry the topic, bounded so a verbose prior answer can't crowd out the follow-up.
const CONTEXT_ANCHOR_CHARS = 220;

/**
 * Build the EMBED input for a context-dependent follow-up (R2). A bare follow-up
 * ("anong pinakamalaki sa kanila?", "bakit sila namatay?") is topic-blind, so its
 * LaBSE vector lands far from any fact and the abstain floor fires. Folding a slice
 * of the recent conversation in front of the (normalized) follow-up restores the
 * topic — measured: bare ~0.49 → folded ~0.89, retrieving the right facts.
 *
 * Use as a FALLBACK only when the bare query abstains (so it never overrides a
 * full question that switched topics — that one grounds on its own). Context first,
 * follow-up last as the focus.
 */
export function buildContextualQuery(query: string, context: string): string {
  const q = normalizeQuery(query);
  const ctx = (context || '').replace(/\s+/g, ' ').trim();
  return ctx ? `${ctx.slice(-CONTEXT_ANCHOR_CHARS)} ${q}` : q;
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

// Reciprocal-rank-fusion constant. Standard k=60; the benchmark (R@3 .607) was
// tuned at this value, fusing lexical + semantic candidate lists equally.
const RRF_K = 60;
// Semantic-similarity floor for abstention: below this top-1 cosine the query is
// off-topic (return nothing → the tutor abstains). Originally 0.58 from the 450-query
// benchmark (positives mean 0.68, negatives 0.50). RETUNED to 0.55 (R1, 2026-06-07)
// after chat-driver probing showed REAL kid phrasing on COVERED topics lands at
// 0.54–0.56 (e.g. "paano gumagana ang puso natin" 0.563) — the benchmark used clean
// queries. 0.55 recovers those while genuinely-out-of-bank queries still abstain
// (Einstein's-dog 0.542, dragon-wing 0.522, off-topic 0.39). Paired with
// `normalizeQuery` (strips conversational filler before embedding). Guarded by
// rag/pipeline/hybrid-stress.mts — re-tune there, not by feel.
// Re-calibrated 0.55 → 0.53 for the 29,779-fact blob (2026-06-09): the larger corpus
// shifted top-1 cosines down slightly, pushing covered topics (octopus 0.54, plant-parts
// 0.53) below the old floor → spurious abstain. 0.53 recovers them while off-domain
// (math 0.52, gibberish 0.49, chitchat ≤0.48) still abstains. Validated vs hybrid-stress.
const SEMANTIC_FLOOR = 0.53;

// Context-fold GATE (multi-turn): if the BARE query's top semantic cosine is at/above this, it's a
// confident, self-sufficient question → retrieve context-FREE (folding the prior turn in would
// pollute it). Below this (but above the abstain floor) → a topic-blind follow-up that needs the
// conversation topic folded in (the R2 path). Sits between SEMANTIC_FLOOR (0.53) and the ~0.65-0.70
// of confident full questions. Tune in rag/pipeline stress, not by feel.
export const CONTEXT_FALLBACK_FLOOR = 0.62;

export class RagStore {
  private docs: IndexedFact[] = [];
  private idf = new Map<string, number>();
  private semantic?: SemanticIndex;

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
  search(
    query: string,
    topK = 3,
    language: Language = 'english',
    context = '',
    seenIds?: ReadonlySet<string>
  ): FactHit[] {
    // Normally we drop question/glue words so content words drive ranking. But a
    // bare identity question ("sino ka", "ano kayo", "para saan to") is ALL such
    // words — stripping leaves nothing. In that case fall back to the raw tokens
    // so the pronouns/question words themselves can match the ABOUT_HIRAIA facts
    // (which carry "sino", "kayo", "para", … as terms).
    const stripped = tokenize(expandColloquial(query)).filter((t) => !QUERY_STOP.has(t));
    const ctxStripped = tokenize(expandColloquial(context)).filter((t) => !QUERY_STOP.has(t));
    // A pure glue/acceptance query ("oo", "sige", "oo gusto ko", "para saan to")
    // strips to nothing. If there's conversation context, ground on IT (a follow-up
    // acceptance grounds on what was just offered); else fall back to the raw tokens
    // (bare identity questions → the ABOUT_HIRAIA facts).
    const usingCtxAsQuery = stripped.length === 0 && ctxStripped.length > 0;
    const qTokens = new Set(
      stripped.length > 0 ? stripped : usingCtxAsQuery ? ctxStripped : tokenize(query)
    );
    if (qTokens.size === 0) return [];
    // Context is a reduced-weight tiebreaker for a contentful query; when it already
    // became the query (acceptance fallback) there's no separate context layer.
    const ctxTokens = usingCtxAsQuery
      ? new Set<string>()
      : new Set(ctxStripped.filter((t) => !qTokens.has(t)));
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
        const seen = seenIds?.has(doc.fact.id) ?? false;
        // Novelty: a fact already shown this conversation gets its query score
        // demoted AND no context boost — the previous answer's TEXT lives in
        // `context`, which would otherwise re-surface the very fact we're moving
        // past (the "same fact back-to-back" bug). Fresh facts get the context tip.
        const total = seen ? score * SEEN_PENALTY : score + CONTEXT_WEIGHT * ctxScore;
        scored.push({ fact: doc.fact, text: doc.fact.fact[key], score: total });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Attach the bundled semantic index (LaBSE int8 vectors). Loaded by the engine
   * at startup from the bundled blob. Optional: without it, searchHybrid() falls
   * back to lexical-only (graceful degradation while the embed model loads).
   */
  attachSemantic(index: SemanticIndex): void {
    if (index.count !== this.docs.length) {
      throw new Error(`semantic index size ${index.count} != bank ${this.docs.length} (stale vectors blob?)`);
    }
    this.semantic = index;
  }

  get hasSemantic(): boolean {
    return this.semantic !== undefined;
  }

  /**
   * Hybrid retrieval: reciprocal-rank-fuse the lexical ranking with semantic
   * (LaBSE) cosine ranking. `queryVec` is the L2-normalized query embedding from
   * the on-device embedder. On the 450-query benchmark this lifts Recall@3 from
   * .509 (lexical) to .607 — semantic and lexical cover complementary blind spots
   * (morphology/paraphrase vs exact terms/numbers/proper nouns).
   *
   * Falls back to lexical-only when no semantic index is attached or no query
   * vector is supplied (e.g. embed model still warming up). `seenIds`/`context`
   * keep the lexical half's novelty + follow-up behavior.
   */
  searchHybrid(
    query: string,
    queryVec: Float32Array | undefined,
    topK = 3,
    language: Language = 'english',
    context = '',
    seenIds?: ReadonlySet<string>
  ): FactHit[] {
    const CAND = 10; // fuse the top-10 of each list (matches the benchmark)
    const lex = this.search(query, CAND, language, context, seenIds);
    if (!this.semantic || !queryVec) return lex.slice(0, topK);

    const sem = this.semantic.search(queryVec, language, CAND);
    const key = LANG_KEY[language];
    const score = new Map<string, number>();
    const factById = new Map<string, ScienceFact>();
    lex.forEach((h, r) => {
      score.set(h.fact.id, (score.get(h.fact.id) ?? 0) + 1 / (RRF_K + r + 1));
      factById.set(h.fact.id, h.fact);
    });
    sem.forEach((h, r) => {
      const f = this.docs[h.index]!.fact;
      score.set(f.id, (score.get(f.id) ?? 0) + 1 / (RRF_K + r + 1));
      factById.set(f.id, f);
    });
    // POST-FUSION novelty demotion. The lexical side already passed `seenIds` and
    // demoted seen facts inside `this.search`, but the SEMANTIC side does not —
    // an already-shown fact whose embedding still matches the follow-up query
    // re-surfaces at the top of `sem`, and RRF puts it right back as #1 (the
    // "same fact back-to-back" bug we hit when asking a follow-up about Mars on
    // the kitten). Applying the penalty to the FUSED score makes the dedup work
    // regardless of which side ranked the seen fact.
    if (seenIds) {
      for (const [id, s] of score) {
        if (seenIds.has(id)) score.set(id, s * SEEN_PENALTY);
      }
    }
    return [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, s]) => {
        const f = factById.get(id)!;
        return { fact: f, text: f.fact[key], score: s };
      });
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
    context = '',
    seenIds?: ReadonlySet<string>
  ): FactHit[] {
    const hits = this.search(query, max, language, context, seenIds);
    if (hits.length === 0) return [];
    const top = hits[0]!.score;
    return hits.filter((h) => h.score >= top * floorRatio);
  }

  /**
   * Hybrid grounding: like retrieveForGrounding but fuses semantic + lexical, and
   * ABSTAINS (returns []) when the query is off-topic — i.e. the best semantic
   * cosine is below SEMANTIC_FLOOR. That floor is the clean signal the lexical
   * score can't give: a bare keyword can spuriously match the bank, but a low
   * cosine means nothing in the bank is really about this. Falls back to the
   * lexical grounding path when no semantic index/query vector is available.
   */
  retrieveForGroundingHybrid(
    query: string,
    queryVec: Float32Array | undefined,
    language: Language = 'english',
    max = 3,
    floorRatio = 0.5,
    context = '',
    seenIds?: ReadonlySet<string>
  ): FactHit[] {
    return this.retrieveForGroundingHybridDiag(query, queryVec, language, max, floorRatio, context, seenIds).hits;
  }

  /**
   * Same as retrieveForGroundingHybrid but ALSO returns `topCos` — the best semantic cosine of the
   * BARE query (computed anyway for the abstain floor, so it's free). Callers use it to GATE
   * multi-turn context-folding: a CONFIDENT bare query (topCos high) carries its own topic and must
   * NOT have prior-turn context folded in (that pollutes it — the "solar system"→solar-panel
   * collision); a WEAK bare query (low topCos, even if non-abstaining) is a topic-blind follow-up
   * ("anong pinakamabilis sa kanila?") that DOES need the conversation topic folded in. So the
   * caller's R2 fallback should fire on (hits empty OR topCos < CONTEXT_FALLBACK_FLOOR), not just empty.
   */
  retrieveForGroundingHybridDiag(
    query: string,
    queryVec: Float32Array | undefined,
    language: Language = 'english',
    max = 3,
    floorRatio = 0.5,
    context = '',
    seenIds?: ReadonlySet<string>
  ): { hits: FactHit[]; topCos: number } {
    if (!this.semantic || !queryVec) {
      return { hits: this.retrieveForGrounding(query, language, max, floorRatio, context, seenIds), topCos: 0 };
    }
    const topCos = this.semantic.search(queryVec, language, 1)[0]?.cosine ?? 0;
    if (topCos < SEMANTIC_FLOOR) return { hits: [], topCos }; // off-topic → abstain
    const hits = this.searchHybrid(query, queryVec, max, language, context, seenIds);
    if (hits.length === 0) return { hits: [], topCos };
    const top = hits[0]!.score;
    return { hits: hits.filter((h) => h.score >= top * floorRatio), topCos };
  }
}
