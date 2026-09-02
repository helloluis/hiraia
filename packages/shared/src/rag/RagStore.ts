import { FIELD_BIT, MemoryFactSource, type FactSource } from './FactSource.js';
import { tokenize } from './tokenize.js';
import type { Language } from '../types/index.js';
import type { FactHit, ScienceFact } from './types.js';
import type { SemanticIndex } from './SemanticIndex.js';


/**
 * Lexical retriever over the curated science-fact bank.
 *
 * Ranking mirrors `build-bank.py`'s column-weighted bm25: a hit in the `topic` field
 * outranks a hit in `terms`, which outranks a hit in the fact body. Scoring is idf-weighted
 * token overlap — deterministic, dependency-free, and easy to reason about.
 *
 * WHERE THE BANK LIVES is the caller's business (see FactSource). This class used to import
 * all 50,279 facts itself as a default constructor argument, which put a 43.5 MB TypeScript
 * array into the Metro bundle — 41.2 MB of Hermes bytecode (measured with the toolchain's own
 * hermesc), STORED uncompressed because React Native's gradle plugin puts the bundle extension
 * in `noCompress`. It now reads through an INVERTED INDEX it does not own: `fact_token` in
 * cards.db on the phone, an in-RAM index over the JSONL in Node. Only the ~10 facts a query
 * returns are ever materialised.
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
// How many top candidates from EACH of the lexical + semantic rankings get RRF-fused.
const HYBRID_CAND = 10; // fuse the top-10 of each list (matches the 450-query benchmark)

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
  // `man` is the Cebuano interrogative particle ("unsa MAN ang photosynthesis", "ngano MAN") —
  // topic-less, same class as naman/lang/ba. Unstripped it is a measured junk attractor:
  // ~10 facts carry English "man" in their TOPIC (man-made detergents/fibres, Tabon Man,
  // first-man-in-space), so every short "unsa man …" query put detergent-made-from-petroleum
  // at lexical #1 (8×idf) and garbled the Cebuano card (gate: ceb-photosynthesis). English
  // queries survive the strip: "first man on the moon" still ranks on first/moon/armstrong.
  `bakit paano ano anong kung saan kailan sino sinong alin para kaya
   ngano nganong unsa unsay asa kinsa giunsa pila naunsa
   ito iyan iyon nito niyan kini kana kanang
   ang mga yung nga kang iya niya nila ila
   may mayroon meron adunay naa
   bang ba kaya nga daw raw pala naman lang lamang man
   totoo totoong tutoo tutuo tinuod tuod
   picture pic larawan litrato hulagway drawing pakita ipakita
   oo opo oho oonga sige gusto payag game pwede mao sure
   what why how when where who whom which whose
   the are does did can could would should about from with into
   your you they them this that these those
   teach tell explain show describe learn
   ituro ipaliwanag ikwento kwentuhan pakituro pakipaliwanag pakikwento
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
  // ENGLISH/Taglish imperative TEACHING framing: "teach me about / tell me about / explain /
  // show me / describe X", "I want to learn/know about X". Without this, "Teach me about
  // photosynthesis" embeds toward TEACHING facts and grounded on "a vaccine TEACHES the body"
  // + a lichen fact, burying the core photosynthesis fact (on-device QA 2026-06-20). The bare
  // topic ("photosynthesis") retrieves correctly — so strip the framing, keep the noun.
  s = s.replace(/\b(?:(?:can|could|will|would)\s+you\s+|you\s+|please\s+)*(?:teach|tell|explain|show|describe)\s+(?:me|us)\s+(?:about|the|on|regarding)?\s*/gi, ' ');
  s = s.replace(/\b(?:please\s+)?(?:explain|describe)\s+(?:to\s+(?:me|us)\s+)?(?:about\s+|the\s+)?/gi, ' ');
  s = s.replace(/\bi\s+(?:just\s+)?(?:want|wanna|would\s+like|'?d\s+like|like)\s+(?:to\s+)?(?:learn|know|hear|understand)\s+(?:more\s+)?(?:about|of)?\s*/gi, ' ');
  // Tagalog teaching framing: "ituro/ipaliwanag/ikwento mo (sa akin) (ang/tungkol sa) X", "pakituro".
  s = s.replace(/\b(?:ituro|pakituro|ipaliwanag|pakipaliwanag|ikwento|pakikwento|kwentuhan)\s+(?:mo\s+)?(?:po\s+)?(?:ako\s+)?(?:sa\s+akin\s+)?(?:naman\s+)?(?:ang\s+|kung\s+|tungkol\s+(?:sa\s+)?|ng\s+|about\s+)?/gi, ' ');
  // 2) framing SUFFIXES (claim-checks)
  s = s.replace(/,?\s*totoo\s+(?:po\s+)?ba(?:ng)?(?:\s+po)?\s*\??\s*$/gi, ' ');
  s = s.replace(/,?\s*(?:tama|mali)\s+(?:po\s+)?ba(?:\s+po)?\s*\??\s*$/gi, ' ');
  s = s.replace(/\bdi\s+ba\s*(?:po)?\s*\??\s*$/gi, ' ');
  const framed = s.replace(/\s+/g, ' ').trim();
  // 3) standalone politeness/discourse PARTICLES dilute the embedding but could eat a terse
  // reply's ONLY content, so strip them ONLY for originally-long inputs (MIN_NORMALIZE_LEN).
  // The framing prefixes/suffixes above are EXPLICIT patterns (never fire on a bare terse
  // reply), so they already ran at any length — which is what fixes a short framed query like
  // "explain the water cycle" (≈23 chars) that previously skipped normalization entirely.
  if (original.length >= MIN_NORMALIZE_LEN) {
    const stripped = ` ${framed} `
      .replace(/\b(?:po|pô|naman|kasi|nga|talaga|ba|raw|daw|pala|eh|kaya)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (stripped.length >= 3) return stripped;
  }
  // Keep single content words (good!), but if stripping left only a scrap, use original.
  return framed.length >= 3 ? framed : original;
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

/** The field bit a language's BODY occupies in a posting mask (FactSource.FIELD_BIT). */
const BODY_BIT: Record<LangKey, number> = { tl: FIELD_BIT.tl, en: FIELD_BIT.en, bis: FIELD_BIT.bis };

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

// OFF-DOMAIN GATE (the feed's dynamic-card path). A query that retrieval cannot serve has TWO
// very different causes and they deserve different cards: an in-domain GAP ("we have no page on
// that yet") vs a query that is not science at all ("roblox" — we are only a science tutor).
// Neither cosine nor lexical unreachability separates them alone; their conjunction does.
//
// ALL NUMBERS BELOW ARE THE PHONE'S. They were re-measured through labse.Q4_K_M.gguf — the
// exact file `model.ts` downloads — against the shipped 50,279-fact bank (bankHash
// af171fe8a9f9), 110 hand-labelled probes × three languages = 330 routings. An earlier
// calibration used an fp16 LaBSE and its margins were NOT the phone's: quantization moves
// top-1 cosine by min -0.037 / median -0.006 / max +0.033 (mean |shift| 0.009), which is
// larger than the headroom either floor has, and it flipped five probes across a cliff
// (narwhal tl .633→.596, narwhal en .622→.588, himaymay en .507→.492). Re-tune HERE, on
// Q4_K_M, or the floor you pick is not the floor that ships.
//
//   - Cosine alone fails BOTH ways. Pop culture outranks real Filipino science: mobile legends
//     .697-.720, spiderman .694-.702, taylor swift .679-.689, jollibee .682-.730 all sit ABOVE
//     alitaptap .534 tl, coelacanth .549 bis, dugong .555 tl, tamaraw .557 tl.
//   - Lexical emptiness alone is too blunt: it fires on pterodactyl, brontosaurus, narwhal and
//     the misspelled "fotosintesis" — real science we must never call off-topic.
//   - So the OOV arm is conjunctive, and it takes lexical UNREACHABILITY (`lexicallyUnreachable`
//     — not one word of the query is in the bank, nor is any one-character respelling of one),
//     not bare emptiness. Bare emptiness sent 18 of the 273 science routings to "I'm only a
//     science tutor", and they were not exotic: batirya .561-.569 (baterya), amiba .523-.554
//     (ameba), erthquake .523-.554 (earthquake), photosinthesis .589-.601 (photosynthesis) —
//     ordinary Grade-5 spellings of ordinary Grade-5 words, all lexically unscoreable and all
//     under this floor, so the cosine could not save them and nothing else was looking. The
//     spelling probe rescues those twelve routings; the hard floor below rescues the
//     thirteenth. Residual: bactirya (TWO edits from bakterya/bacteria — the probe is one) and
//     narwhal, which is spelled correctly and simply is not in the bank.
//   - What the arm still catches with the probe in place: roblox .584-.603, bts .543-.562,
//     blackpink .542-.582, hahahaha .545-.563, "..." .574-.597, asdfgh .416-.441. It loses
//     tiktok (one edit from "tuktok") and gcash (one from "cash"), which now get the honest gap
//     card instead. That asymmetry is the point: a false NEGATIVE costs a vaguer card, a false
//     POSITIVE tells a child that batirya is not science.
// OOV floor: bounded ABOVE by out-of-vocabulary science the probe cannot rescue — fotosintesis
// .635 tl, pterodactyl .644 tl, narwhal .632 bis. 0.62 is the last value with margin, and it
// is bounded BELOW by roblox .584: there is no cut that keeps roblox and rescues narwhal
// (.588 en), so two residual misfires are accepted and written down rather than tuned away.
// HARD floor (the unconditional arm): only for queries so far from the corpus that no lexical
// evidence could redeem them — "mahal mo ba ako" .333-.369. It was 0.50, which fired on
// himaymay (fibre — a real Tagalog science word whose own token IS in the bank) at .492 en,
// i.e. it could call a query off-domain while holding facts that contain the very word the
// child typed. 0.40 keeps a wide margin under every real science probe.
export const OFFDOMAIN_OOV_FLOOR = 0.62;
export const OFFDOMAIN_HARD_FLOOR = 0.4;

/**
 * Is this query outside the tutor's subject altogether (as opposed to an in-domain gap)?
 * `topCos` comes out of `retrieveForGroundingHybridDiag`; `lexUnreachable` is a separate ask
 * (`lexicallyUnreachable`) because it costs a spelling probe and only this gate reads it. ONLY
 * meaningful when the semantic index actually ran — with no embedder topCos is 0 and every
 * query would look off-domain, so callers must gate on that themselves.
 */
export function isOffDomain(topCos: number, lexUnreachable: boolean): boolean {
  return (lexUnreachable && topCos < OFFDOMAIN_OOV_FLOOR) || topCos < OFFDOMAIN_HARD_FLOOR;
}

// SPELLING PROBE (the OOV arm's lexical half). Alphabet = the letters `tokenize` keeps, so a
// candidate respelling can actually be a token; digits are left out because no misspelling of
// a science word is a digit away from it.
const SPELL_ALPHABET = 'abcdefghijklmnopqrstuvwxyzñ';
// Below five characters a one-edit neighbourhood reaches most of the vocabulary, which would
// make every short word "reachable" and retire the arm. ("bts" is 3.)
const SPELL_MIN_LEN = 5;
// A query that gets this far scored NOTHING lexically, so it is short by construction; the cap
// only bounds the pathological case (a sentence of gibberish), at ~54 membership lookups per
// character of each word probed.
const SPELL_MAX_TOKENS = 4;

export class RagStore {
  private readonly source: FactSource;
  /** Corpus size for idf. `|| 1` keeps an empty bank from dividing by zero, as before. */
  private readonly n: number;
  private semantic?: SemanticIndex;

  /**
   * Build over a bank. Pass a `ScienceFact[]` (Node: `loadFactBank()` from the JSONL) and it
   * is indexed in RAM; pass a `FactSource` and nothing is loaded until a query asks for it
   * (the phone: `SqlFactSource` over cards.db).
   *
   * There is no default. It used to be all 50,279 facts, which meant every consumer that
   * wrote `new RagStore()` silently pulled the whole bundled bank — including the app, which
   * is the one place that could least afford it.
   */
  constructor(bank: ScienceFact[] | FactSource) {
    this.source = Array.isArray(bank) ? new MemoryFactSource(bank) : bank;
    this.n = this.source.count || 1;
  }

  get size(): number {
    return this.source.count;
  }

  /**
   * Smoothed idf (BM25-style); always positive so common words still help a little.
   *
   * Computed per query from the token's stored `df` rather than cached at construction: the
   * expression, its operands and their order are unchanged, so the double is bit-identical
   * to the one the old prebuilt map held — which matters, because these feed a running sum
   * and floating-point addition is not associative.
   */
  private idf(df: number): number {
    return Math.log(1 + (this.n - df + 0.5) / (df + 0.5));
  }

  /**
   * Accumulate idf-weighted field scores for `tokens` into `into`, keyed by fact ordinal.
   *
   * This is the whole ranking, and it walks the index the other way round from the old code:
   * per TOKEN over its postings, instead of per FACT over the query. The arithmetic is the
   * same for every fact — a fact's contributions still arrive in query-token order, because
   * the tokens are visited in that order — so the sums are bit-identical while the work drops
   * from 50,279 facts to the few hundred that carry the query's words.
   *
   * The field weight comes from the posting's mask: topic 8, terms 4, the ACTIVE language's
   * body 1, the English body 0.5 as a code-switch bridge ("ngano blue ang langit", "oxygen"),
   * FIRST match wins. The OTHER vernacular's body is deliberately never scored — Tagalog and
   * Cebuano share enough vocabulary that a blended index produced wrong-language distractors.
   */
  private accumulate(
    tokens: Iterable<string>,
    key: LangKey,
    into: Map<number, number>
  ): Map<number, number> {
    const bodyBit = BODY_BIT[key];
    const bridge = key !== 'en';
    for (const t of tokens) {
      const p = this.source.postings(t);
      if (!p) continue; // not in the bank's vocabulary — it could never have scored
      const idf = this.idf(p.df);
      const { ords, masks } = p;
      for (let i = 0; i < ords.length; i++) {
        const m = masks[i]!;
        const w =
          m & FIELD_BIT.topic
            ? FIELD_WEIGHT.topic
            : m & FIELD_BIT.terms
              ? FIELD_WEIGHT.terms
              : m & bodyBit
                ? FIELD_WEIGHT.body
                : bridge && m & FIELD_BIT.en
                  ? FIELD_WEIGHT.bridge
                  : 0;
        if (w > 0) {
          const o = ords[i]!;
          into.set(o, (into.get(o) ?? 0) + w * idf);
        }
      }
    }
    return into;
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
    return this.searchDiag(query, topK, language, context, seenIds).hits;
  }

  /**
   * The lexical query/context token sets, shared by `searchDiag` and `lexicalEmpty` so both
   * derive tokens the SAME way. The two fallbacks below are load-bearing, which is exactly
   * why they are shared rather than re-implemented: a simpler second tokenizer would
   * disagree with the ranker it is being used to gate.
   */
  private queryTokens(
    query: string,
    context: string
  ): { qTokens: Set<string>; ctxTokens: Set<string> } {
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
    // Context is a reduced-weight tiebreaker for a contentful query; when it already
    // became the query (acceptance fallback) there's no separate context layer.
    const ctxTokens = usingCtxAsQuery
      ? new Set<string>()
      : new Set(ctxStripped.filter((t) => !qTokens.has(t)));
    return { qTokens, ctxTokens };
  }

  /**
   * True when the lexical retriever can score NOTHING: no content token of the query has a
   * posting in the bank's vocabulary, i.e. not one fact in the bank contains any word the
   * child typed. Postings-only (no ranking, no fact rows read), and semantically meaningful
   * rather than heuristic — whatever a model then writes cannot be about what was asked.
   *
   * Answers a BOOLEAN by looking for the first evidence against it, rather than by scoring the
   * whole query and measuring the result: the abstain branch that computes this is shared with
   * the chat path, which never reads it, and `ang` alone would have walked 49,037 postings to
   * establish something the first one settles.
   */
  lexicalEmpty(query: string, language: Language = 'english', context = ''): boolean {
    const { qTokens } = this.queryTokens(query, context);
    return this.lexicalEmptyTokens(qTokens, LANG_KEY[language]);
  }

  /**
   * `lexicalEmpty` on an already-derived token set. Exactly `accumulate(...).size === 0` —
   * same postings, same field-weight rule, first match wins — stopped at the first token that
   * would have scored.
   */
  private lexicalEmptyTokens(qTokens: ReadonlySet<string>, key: LangKey): boolean {
    if (qTokens.size === 0) return true;
    const bodyBit = BODY_BIT[key];
    const bridge = key !== 'en';
    for (const t of qTokens) {
      const p = this.source.postings(t);
      if (!p) continue; // not in the bank's vocabulary — it could never have scored
      const { masks } = p;
      for (let i = 0; i < masks.length; i++) {
        const m = masks[i]!;
        const scores =
          m & FIELD_BIT.topic || m & FIELD_BIT.terms || m & bodyBit || (bridge && m & FIELD_BIT.en);
        if (scores) return false;
      }
    }
    return true;
  }

  /**
   * True when not one word of the query can reach the bank AT ALL — not even through a
   * one-character misspelling of a word we do stock. The stronger half of `isOffDomain`.
   *
   * `lexicalEmpty` on its own cannot carry that arm, because the commonest reason a Grade-5
   * query scores nothing lexically is that it is SPELLED like a Grade-5 query: batirya,
   * amiba, erthquake, photosinthesis, dinosawr. Those are science, and the difference between
   * them and "roblox" is not in the cosine (measured: they interleave — see the gate comment)
   * but in the orthography, so that is where it is read. Vocabulary membership only: any
   * spelling that exists anywhere in the bank, in any language or field, counts as reachable.
   * The asymmetry is deliberate — a false "reachable" costs the honest gap card, a false
   * "unreachable" tells a child their science question is not science.
   */
  lexicallyUnreachable(query: string, language: Language = 'english', context = ''): boolean {
    const { qTokens } = this.queryTokens(query, context);
    if (!this.lexicalEmptyTokens(qTokens, LANG_KEY[language])) return false;
    return !this.spellReachable(qTokens);
  }

  /** Does any probed token have a one-edit neighbour in the vocabulary? */
  private spellReachable(qTokens: ReadonlySet<string>): boolean {
    let probed = 0;
    for (const t of qTokens) {
      if (t.length < SPELL_MIN_LEN) continue;
      if (probed++ >= SPELL_MAX_TOKENS) break;
      if (this.nearVocabulary(t)) return true;
    }
    return false;
  }

  /**
   * Is some deletion / transposition / substitution / insertion of one character of `token` a
   * token of the bank? Generated and looked up rather than compared against the vocabulary:
   * the source answers membership by key (a SQLite point query on the phone), so this is
   * ~54 lookups per character and needs no vocabulary scan, no prefix index and no new table.
   * It runs ONLY when the whole query scored nothing lexically — the rare miss path.
   */
  private nearVocabulary(token: string): boolean {
    const n = token.length;
    // Deletion first: the cheapest family (n candidates) and the one that catches a doubled
    // or inserted letter, the commonest typo of all.
    for (let i = 0; i < n; i++) {
      if (this.source.hasToken(token.slice(0, i) + token.slice(i + 1))) return true;
    }
    for (let i = 0; i + 1 < n; i++) {
      const swapped = token.slice(0, i) + token[i + 1]! + token[i]! + token.slice(i + 2);
      if (this.source.hasToken(swapped)) return true;
    }
    for (let i = 0; i < n; i++) {
      const head = token.slice(0, i);
      const tail = token.slice(i + 1);
      for (const c of SPELL_ALPHABET) {
        if (c !== token[i] && this.source.hasToken(head + c + tail)) return true;
      }
    }
    for (let i = 0; i <= n; i++) {
      const head = token.slice(0, i);
      const tail = token.slice(i);
      for (const c of SPELL_ALPHABET) {
        if (this.source.hasToken(head + c + tail)) return true;
      }
    }
    return false;
  }

  /**
   * `search` plus the by-product callers need for the off-domain split: whether the lexical
   * side scored anything at all. Same work as before — the flag falls out of the two early
   * returns that already existed — so nothing pays for it.
   */
  private searchDiag(
    query: string,
    topK = 3,
    language: Language = 'english',
    context = '',
    seenIds?: ReadonlySet<string>
  ): { hits: FactHit[]; lexEmpty: boolean } {
    const { qTokens, ctxTokens } = this.queryTokens(query, context);
    if (qTokens.size === 0) return { hits: [], lexEmpty: true };
    const key = LANG_KEY[language];

    const score = this.accumulate(qTokens, key, new Map());
    if (score.size === 0) return { hits: [], lexEmpty: true };
    // context tips ties at a fraction of the weight; never drives ranking alone.
    const ctxScore = ctxTokens.size ? this.accumulate(ctxTokens, key, new Map()) : undefined;
    // A fact already shown this conversation is demoted by id; resolve those ids to ordinals
    // ONCE rather than reading every candidate's id back out to compare it.
    const seenOrds = seenIds?.size ? this.source.ordsOf([...seenIds]) : undefined;

    // ASCENDING ORDINAL, then a stable sort by score — the two orderings the old loop got for
    // free by walking `docs` in order and letting Array.prototype.sort (stable since ES2019)
    // keep ties as it found them. The bank has a great many ties, so losing this would shuffle
    // results without changing a single score.
    const ranked: Array<[number, number]> = [];
    for (const o of [...score.keys()].sort((a, b) => a - b)) {
      const s = score.get(o)!;
      // Novelty: a fact already shown this conversation gets its query score
      // demoted AND no context boost — the previous answer's TEXT lives in
      // `context`, which would otherwise re-surface the very fact we're moving
      // past (the "same fact back-to-back" bug). Fresh facts get the context tip.
      const seen = seenOrds?.has(o) ?? false;
      ranked.push([o, seen ? s * SEEN_PENALTY : s + CONTEXT_WEIGHT * (ctxScore?.get(o) ?? 0)]);
    }
    ranked.sort((a, b) => b[1] - a[1]);

    // Only NOW are any facts read — the page being returned, not the corpus.
    const top = ranked.slice(0, topK);
    const facts = this.source.facts(top.map(([o]) => o));
    const hits: FactHit[] = [];
    for (let i = 0; i < top.length; i++) {
      const fact = facts[i];
      if (!fact) continue; // a scored ordinal with no row means a corrupt bank, not a miss
      hits.push({ fact, text: fact.fact[key], score: top[i]![1] });
    }
    return { hits, lexEmpty: false };
  }

  /**
   * Attach the bundled semantic index (LaBSE int8 vectors). Loaded by the engine
   * at startup from the bundled blob. Optional: without it, searchHybrid() falls
   * back to lexical-only (graceful degradation while the embed model loads).
   *
   * The blob is POSITIONAL — vector i belongs to bank row i — so a blob built against a
   * different bank version silently makes every fact retrieve someone else's embedding. The
   * count check is the guard that has always caught that, and it still is: `source.count` is
   * the bank's own row count (from `fact_meta` on the phone, the array length in Node).
   *
   * `blobBankHash` tightens it where the caller has one. Counts collide — an edit that
   * rewrites facts without adding or removing any leaves the count identical and the vectors
   * wrong — so a caller that can read `vectors-labse.meta.json`'s `bankHash` should pass it,
   * and it is compared against the bank's own stamp. Absent on either side, the count check
   * stands alone, exactly as before.
   */
  attachSemantic(index: SemanticIndex, blobBankHash?: string): void {
    if (index.count !== this.source.count) {
      throw new Error(`semantic index size ${index.count} != bank ${this.source.count} (stale vectors blob?)`);
    }
    const bankHash = this.source.bankHash;
    if (bankHash && blobBankHash && bankHash !== blobBankHash) {
      throw new Error(
        `semantic index was built for bank ${blobBankHash}, this bank is ${bankHash} (stale vectors blob?)`
      );
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
    if (!this.semantic || !queryVec) {
      return this.search(query, HYBRID_CAND, language, context, seenIds).slice(0, topK);
    }
    const sem = this.semantic.search(queryVec, language, HYBRID_CAND);
    return this.fuseHybrid(query, sem, topK, language, context, seenIds).hits;
  }

  /**
   * RRF-fuse a PRECOMPUTED semantic ranking with the lexical ranking. Factored out of
   * searchHybrid so a caller that ALREADY ran the semantic scan (the grounding-diag path,
   * which needs `topCos` from the same scan) reuses it instead of paying for a SECOND full
   * 40k-vector scan — the dominant repeated cost of an on-device query. Bit-identical to
   * the old inline fusion: same `sem`, same lexical pass, same RRF + seen-penalty + sort.
   */
  private fuseHybrid(
    query: string,
    sem: ReturnType<SemanticIndex['search']>,
    topK: number,
    language: Language,
    context: string,
    seenIds?: ReadonlySet<string>
  ): { hits: FactHit[]; lexEmpty: boolean } {
    const { hits: lex, lexEmpty } = this.searchDiag(query, HYBRID_CAND, language, context, seenIds);
    const key = LANG_KEY[language];
    const score = new Map<string, number>();
    const factById = new Map<string, ScienceFact>();
    lex.forEach((h, r) => {
      score.set(h.fact.id, (score.get(h.fact.id) ?? 0) + 1 / (RRF_K + r + 1));
      factById.set(h.fact.id, h.fact);
    });
    // The semantic side ranks by ORDINAL, so its candidates are the only facts this path has
    // to read beyond the lexical page — fetched in one batch, ten rows at HYBRID_CAND.
    const semFacts = this.source.facts(sem.map((h) => h.index));
    sem.forEach((h, r) => {
      const f = semFacts[r];
      if (!f) return; // a vector with no fact row means a corrupt bank, not a miss
      score.set(f.id, (score.get(f.id) ?? 0) + 1 / (RRF_K + r + 1));
      factById.set(f.id, f);
    });
    // POST-FUSION novelty demotion. The lexical side already passed `seenIds` and
    // demoted seen facts inside `this.search`, but the SEMANTIC side does not —
    // an already-shown fact whose embedding still matches the follow-up query
    // re-surfaces at the top of `sem`, and RRF puts it right back as #1 (the
    // "same fact back-to-back" bug we hit asking a follow-up about Mars on-device).
    // Applying the penalty to the FUSED score makes the dedup work
    // regardless of which side ranked the seen fact.
    if (seenIds) {
      for (const [id, s] of score) {
        if (seenIds.has(id)) score.set(id, s * SEEN_PENALTY);
      }
    }
    const hits = [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, s]) => {
        const f = factById.get(id)!;
        return { fact: f, text: f.fact[key], score: s };
      });
    return { hits, lexEmpty };
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
   *
   * ALSO returns `lexEmpty` — true when no query token has a posting anywhere in the bank (see
   * `lexicalEmpty`). It says "do not write a card from this grounding, it is about something
   * else", and it is free: on the grounded branch it falls out of the lexical pass fuseHybrid
   * already runs. The off-domain gate needs the STRONGER `lexicallyUnreachable`, which is NOT
   * returned here: it costs a spelling probe, only the feed's miss path reads it, and this
   * retrieval is shared with chat.
   */
  retrieveForGroundingHybridDiag(
    query: string,
    queryVec: Float32Array | undefined,
    language: Language = 'english',
    max = 3,
    floorRatio = 0.5,
    context = '',
    seenIds?: ReadonlySet<string>
  ): { hits: FactHit[]; topCos: number; lexEmpty: boolean } {
    if (!this.semantic || !queryVec) {
      // Lexical-only (embedder still warming, or it failed). topCos is not measured here, so it
      // is 0 and `isOffDomain` must NOT be applied to it — see the gate on the caller's side.
      const hits = this.retrieveForGrounding(query, language, max, floorRatio, context, seenIds);
      return { hits, topCos: 0, lexEmpty: hits.length === 0 };
    }
    // ONE semantic scan, reused for BOTH the topCos abstain gate and the hybrid fusion.
    // The bare-query topCos scan and searchHybrid's candidate scan were identical full-
    // corpus passes over the same queryVec — folding them halves the semantic-scan cost
    // on every confident query (the on-device hot path). search() returns cosine-desc, so
    // sem[0] is the same top hit search(…,1) gave → topCos is bit-identical.
    const sem = this.semantic.search(queryVec, language, HYBRID_CAND);
    const topCos = sem[0]?.cosine ?? 0;
    if (topCos < SEMANTIC_FLOOR) {
      // Off-topic → abstain. This branch skips fuseHybrid, which is where lexEmpty otherwise
      // falls out, so ask the lexical half directly: postings only, no ranking, no rows read —
      // strictly cheaper than the fusion this branch is not doing.
      return { hits: [], topCos, lexEmpty: this.lexicalEmpty(query, language, context) };
    }
    const { hits, lexEmpty } = this.fuseHybrid(query, sem, max, language, context, seenIds);
    if (hits.length === 0) return { hits: [], topCos, lexEmpty };
    const top = hits[0]!.score;
    return { hits: hits.filter((h) => h.score >= top * floorRatio), topCos, lexEmpty };
  }
}
