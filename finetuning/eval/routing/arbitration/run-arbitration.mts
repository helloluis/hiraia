// ============================================================================
// run-arbitration.mts — the QUERY-ARBITRATION gate for the question-cards feed.
//
// A typed query is arbitrated between FOUR outcomes. This gate asserts which one fired:
//
//   served-existing  an authored card already answers it, so serve THAT card. The best
//                    outcome: human/pipeline-authored prose, a verified illustration, a
//                    title, emphasis spans, quiz linkage.
//   generated        nothing answers it but the fact bank grounds it, so the model writes one.
//   gap              in domain, nothing retrievable — "I don't have a page about that yet".
//   offdomain        not science — "I'm only a science tutor".
//
// THE WHOLE POINT: every case asserts BOTH halves — what happened AND what did not. A
// `served-existing` case that gets back SOME card is not a pass; it has to be the RIGHT card,
// or it is the mangrove bug (measured: 36 of 38 natural web questions returned a confident
// existing card and they were the WRONG cards — "what is gravity" -> mangroves). A
// `generated` case must show search EXPLICITLY declining, or it cannot tell right from wrong.
// And gap vs offdomain must never swap: telling a child their real science question is
// off-topic is the product's worst failure.
//
// TWO HALVES, BOTH REQUIRED: cases.json is the tuning set and cases-holdout.json is a SEALED
// holdout with the same buckets and different strings. The gap/offdomain classes are not
// separable on the one signal that decides them, so the cheapest way to turn the tuning half
// green is a proper-noun denylist — the heuristic intent-detection CLAUDE.md forbids — and
// with every string in the repo the suite could not tell that from a real fix. The gate is
// GREEN only when BOTH halves are.
//
// WHAT IT DRIVES — production code, not a copy of it:
//   * search is the REAL `searchCards` out of packages/mobile/src/data/cards.ts, loaded under
//     Node through scripts/load-cards-node.mts (the same shim the card harness uses). So
//     SEARCH_FLOOR, the stop list, UNKNOWN_TOKEN_IDF and the scan order are the shipping ones
//     by construction — a replica would drift the first time one of them moved.
//   * the model-free half is the same retrieval + `isOffDomain` split that
//     LocalEngine.answerQuery makes, with the floors imported from @hiraia/shared, and it runs
//     in the CONFIGURED app language (`configLang`, default tagalog) because answerQuery reads
//     `config.language` and never the query's own language.
//
// NO LLM. The arbitration is entirely model-free: search decides outcome 1, and retrieval +
// the two floors decide the other three BEFORE a token is generated. What the model then
// writes for a `generated` case is the card gate's business (finetuning/eval/harness), not
// this one's. The LaBSE EMBEDDER is required though — `isOffDomain` reads a cosine, and
// without one every query looks off-domain. A missing embedder ABORTS; it never degrades to
// lexical-only, because that would silently turn this gate into a different gate.
//
//   run via run-arbitration.sh (boots the embedder). Standalone:
//   EMBED_ENDPOINT=http://localhost:8090 node_modules/.bin/tsx run-arbitration.mts
//
// Env: EMBED_ENDPOINT, CASES (substring id filter), BUCKETS (comma list), SET (tuning|holdout|
//      both), JSON_OUT.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RagStore,
  SemanticIndex,
  normalizeQuery,
  isOffDomain,
  OFFDOMAIN_OOV_FLOOR,
  OFFDOMAIN_HARD_FLOOR,
} from '../../../../packages/shared/src/rag/index.ts';
import { loadFactSource } from '../../../../packages/shared/src/rag/bankFile.ts';
import type { Language } from '../../../../packages/shared/src/types/index.ts';
import { loadCards } from '../../../../packages/mobile/scripts/load-cards-node.mts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const MOBILE = join(ROOT, 'packages/mobile');

const EMBED_ENDPOINT = process.env.EMBED_ENDPOINT ?? 'http://localhost:8090';
/** LocalEngine.answerQuery and the web's retrieveForCard both retrieve at topK 4. */
const CARD_TOPK = 4;
/** The app's own default (packages/mobile/src/config/languages.ts DEFAULT_LANGUAGE). */
const DEFAULT_CONFIG_LANG: Language = 'tagalog';
/** A verdict decided inside this much of its floor is a coin flip on the embedder build. */
const UNSTABLE_MARGIN = 0.02;
const CASE_FILTER = (process.env.CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const BUCKET_FILTER = (process.env.BUCKETS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SET_FILTER = (process.env.SET ?? 'both').trim();

// ---------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------
/** What the arbitration DID. `served-wrong` is not an app state — it is this gate's name for
 *  "search served a card and it was not one of the ground-truth ones", which is the single
 *  failure mode the suite exists to make visible. Without it, the mangrove bug hides inside
 *  `served-existing` and the confusion matrix reads as a clean diagonal. */
type Actual = 'served-existing' | 'served-wrong' | 'generated' | 'gap' | 'offdomain';
type Expect = 'served-existing' | 'generated' | 'gap' | 'offdomain';
type Bucket =
  | 'has-card'
  | 'borderline'
  | 'out-of-scope'
  | 'chitchat'
  | 'misspelling'
  | 'tokenisation';
type SetName = 'tuning' | 'holdout';

interface Case {
  id: string;
  bucket: Bucket;
  /** The language the QUERY is written in. Documentation only — routing uses `configLang`. */
  lang: Language;
  /** The language the APP is set to, which is the one LocalEngine.answerQuery routes on. */
  configLang?: Language;
  langNeutral?: boolean;
  form: 'term' | 'sentence';
  query: string;
  /** This sentence reduces to the same tokens as that term case: same test for the search half. */
  searchDuplicateOf?: string;
  expect: Expect;
  /** Two outcomes both acceptable (misspellings: a right card OR a written card; chitchat:
   *  a polite decline OR the science of the thing the child named). */
  expectAny?: Expect[];
  /** Outcomes that are a FAIL whatever else passed. The misspelling bucket's hard rule. */
  forbid?: Actual[];
  /** Right for the product, unreachable for the current machinery — reported, never gating. */
  aspirational?: boolean;
  acceptIds?: string[];
  acceptRule?: { topic: string; domain?: string };
  /** Accept set materialised from the card's own PROSE (all regexes must match). */
  acceptProse?: { lang: 'en' | 'tl' | 'bis'; all: string[] };
  why: string;
}

function fatal(msg: string): never {
  console.error(`\nERR: ${msg}\n`);
  process.exit(2);
}

function loadSet(file: string, set: SetName): Array<Case & { set: SetName }> {
  const p = join(HERE, file);
  if (!existsSync(p)) fatal(`${file} missing — the ${set} half of this gate is not optional.`);
  const cfg = JSON.parse(readFileSync(p, 'utf8')) as { cases: Case[] };
  return cfg.cases.map((c) => ({ ...c, set }));
}
const ALL_CASES = [
  ...(SET_FILTER === 'holdout' ? [] : loadSet('cases.json', 'tuning')),
  ...(SET_FILTER === 'tuning' ? [] : loadSet('cases-holdout.json', 'holdout')),
];
const cases = ALL_CASES.filter((c) => !CASE_FILTER.length || CASE_FILTER.some((s) => c.id.includes(s))).filter(
  (c) => !BUCKET_FILTER.length || BUCKET_FILTER.includes(c.bucket)
);
if (!cases.length) fatal('no cases selected');
const PARTIAL = cases.length !== ALL_CASES.length || SET_FILTER !== 'both';

// ---------------------------------------------------------------------------------------
// PROVENANCE. The runner reads cards.ts, cards.db and the pool live out of the working tree,
// so a baseline that records only a timestamp cannot tell "the fix worked" from "the corpus
// regenerated in between". Everything that can move the numbers is hashed here.
// ---------------------------------------------------------------------------------------
function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}
function sha(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
  } catch {
    return 'missing';
  }
}
const PORCELAIN = sh('git', ['status', '--porcelain']);
const PROVENANCE = {
  head: sh('git', ['rev-parse', 'HEAD']).slice(0, 12) || 'unknown',
  branch: sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
  dirtyFiles: PORCELAIN ? PORCELAIN.split('\n').length : 0,
  dirtyDigest: PORCELAIN ? createHash('sha256').update(PORCELAIN).digest('hex').slice(0, 12) : 'clean',
  cardsTs: sha(join(MOBILE, 'src/data/cards.ts')),
  cardsDb: sha(join(MOBILE, 'assets/data/cards.db')),
  cardsIndex: sha(join(MOBILE, 'src/generated/cardsIndex.generated.json')),
  embedder: '',
};

// ---------------------------------------------------------------------------------------
// Ground truth. Materialised from the corpus, NEVER from what the app returned — an accept
// set derived from the code under test would certify that code against itself.
//
// The pool and the card prose are read DIRECTLY here (cardsIndex + cards.db), deliberately
// not through cards.ts: the module being tested must not also be the module that decides
// what the right answer was.
// ---------------------------------------------------------------------------------------
const POOL_JSON = JSON.parse(readFileSync(join(MOBILE, 'src/generated/cardsIndex.generated.json'), 'utf8'));
const POOL: Array<{ id: string; topic: string; domain: string; slug?: string; factId?: string }> =
  POOL_JSON.cards;
const CARDS_DB = join(MOBILE, 'assets/data/cards.db');
if (!existsSync(CARDS_DB)) fatal(`cards.db missing (${CARDS_DB})`);
const cdb = new DatabaseSync(CARDS_DB, { readOnly: true });

interface CardMeta {
  title: string;
  emph: boolean;
  poster: boolean;
  en: string;
  tl: string;
  bis: string;
}
const CARD_META = new Map<string, CardMeta>();
for (const r of cdb.prepare('SELECT id, title_en, emph_en, poster, en, tl, bis FROM card_text').all() as any[]) {
  CARD_META.set(String(r.id), {
    title: r.title_en ?? '',
    emph: !!(r.emph_en && String(r.emph_en).length),
    poster: !!r.poster,
    en: r.en ?? '',
    tl: r.tl ?? '',
    bis: r.bis ?? '',
  });
}
/** Which facts carry an interject MCQ — one of the four things `served-existing` is worth. */
const HAS_QUIZ = new Set<string>(
  (cdb.prepare('SELECT factId FROM card_question').all() as any[]).map((r) => String(r.factId))
);
const FACT_OF = new Map<string, string>(POOL.map((p) => [p.id, p.factId ?? '']));
/** Which slugs are actually BUNDLED — the manifest artPresence installs, not a guess about file
 *  names: card art is keyed by `slug`, and 4,271 of those slugs are shared clip art. */
const IMAGE_SLUGS = new Set<string>(
  [...readFileSync(join(MOBILE, 'src/generated/imageMap.ts'), 'utf8').matchAll(/^\s*"([^"]+)":\s*require/gm)].map(
    (m) => m[1]
  )
);
if (IMAGE_SLUGS.size < 1000) fatal('imageMap.ts parsed to <1000 slugs — the quality columns would lie');
const SLUG_OF = new Map<string, string>(POOL.map((p) => [p.id, p.slug ?? '']));
const hasArt = (id: string) => {
  const s = SLUG_OF.get(id) ?? '';
  return !!s && (IMAGE_SLUGS.has(s) || IMAGE_SLUGS.has(s.replace(/-g\d+$/, '')));
};

/** The accept set for a case, as an id list — printed with the result so an accept set that
 *  silently empties (a renamed topic, a re-minted id) is a visible failure, not a free pass.
 *
 *  The regexes are the CASE's own, and they are expected to carry their own word boundaries:
 *  unanchored, /rock/ admits 38 rocket-propulsion cards and /nail/ admits 130 snail cards, so
 *  a wrong card would score PASS. `domain` is a full-match regex, so a case can say
 *  `MATTER|LIVING_THINGS` where one sense spans two domains. */
function acceptSet(c: Case): Set<string> | null {
  if (c.acceptIds) return new Set(c.acceptIds);
  const out = new Set<string>();
  if (c.acceptProse) {
    const res = c.acceptProse.all.map((r) => new RegExp(r, 'i'));
    for (const p of POOL) {
      const text = CARD_META.get(p.id)?.[c.acceptProse.lang] ?? '';
      if (text && res.every((re) => re.test(text))) out.add(p.id);
    }
    return out;
  }
  if (!c.acceptRule) return null;
  const re = new RegExp(c.acceptRule.topic, 'i');
  const dom = c.acceptRule.domain ? new RegExp(`^(?:${c.acceptRule.domain})$`) : null;
  for (const p of POOL) {
    if (dom && !dom.test(p.domain)) continue;
    if (re.test(p.topic) || re.test(CARD_META.get(p.id)?.title ?? '')) out.add(p.id);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The two halves of the arbitration.
// ---------------------------------------------------------------------------------------
const C = await loadCards();
if (typeof C.searchCards !== 'function') fatal('loadCards() gave no searchCards — the shim is stale');

const store = new RagStore(loadFactSource());
{
  const METAF = join(MOBILE, 'assets/rag/vectors-labse.meta.json');
  const BIN = join(MOBILE, 'assets/rag/vectors-labse.i8.bin');
  if (!existsSync(METAF) || !existsSync(BIN)) {
    fatal(`vectors blob missing (${BIN}) — the off-domain arm cannot run without semantic retrieval.`);
  }
  const meta = JSON.parse(readFileSync(METAF, 'utf8'));
  const bytes = readFileSync(BIN);
  store.attachSemantic(
    new SemanticIndex({
      dims: meta.dims,
      scale: meta.scale,
      count: meta.count,
      langs: meta.langs,
      data: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    }),
    meta.bankHash
  );
  console.log(`>> bank:  ${meta.count} facts x ${meta.langs.join('/')} (hash ${meta.bankHash})`);
}
console.log(`>> cards: ${POOL.length} pool cards · SEARCH_FLOOR ${C.SEARCH_FLOOR}`);

/**
 * WHICH embedder. The floors were re-measured through labse.Q4_K_M and some verdicts here sit
 * inside 0.005 of one, so a different LaBSE build (f16, another pooling, another model
 * entirely) silently turns a verdict about the routing into a verdict about the substrate.
 * run-arbitration.sh refuses to BOOT anything else; this refuses to RUN against anything else,
 * which is the case the reuse path used to wave through — it only ever curled /health.
 */
async function assertEmbedder(): Promise<string> {
  let path = '';
  try {
    const props = (await (await fetch(`${EMBED_ENDPOINT}/props`)).json()) as any;
    path = String(props.model_path ?? props.model_alias ?? '');
  } catch {
    /* fall through to /v1/models */
  }
  if (!path) {
    try {
      const models = (await (await fetch(`${EMBED_ENDPOINT}/v1/models`)).json()) as any;
      path = String(models?.data?.[0]?.id ?? '');
    } catch (e: any) {
      fatal(`NO EMBEDDER at ${EMBED_ENDPOINT} (${e.message}). Run it through run-arbitration.sh.`);
    }
  }
  if (!/labse/i.test(path) || !/q4_k_m/i.test(path)) {
    fatal(
      `WRONG EMBEDDER on ${EMBED_ENDPOINT}: "${path}".\n` +
        `     This gate routes on cosines against OFFDOMAIN_OOV_FLOOR ${OFFDOMAIN_OOV_FLOOR} /\n` +
        `     OFFDOMAIN_HARD_FLOOR ${OFFDOMAIN_HARD_FLOOR}, re-measured through labse.Q4_K_M. Some verdicts sit\n` +
        `     within ${UNSTABLE_MARGIN} of a floor, so on another build this would report a verdict about the\n` +
        `     embedder while looking like a verdict about the routing.`
    );
  }
  return path;
}
PROVENANCE.embedder = await assertEmbedder();

/**
 * Embed, or DIE. Deliberately not the `catch -> undefined` the product uses: on the phone a
 * warm-up embedder that is not ready yet must fall through to the vaguer gap card rather than
 * misclassify, but a GATE that quietly lost its embedder would report a verdict about the
 * missing embedder while looking like a verdict about the routing. Two thirds of the outcomes
 * here are decided on a LaBSE cosine against floors with very little headroom.
 */
async function embedQuery(text: string): Promise<Float32Array> {
  let res: Response;
  try {
    res = await fetch(`${EMBED_ENDPOINT}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'labse' }),
    });
  } catch (e: any) {
    fatal(
      `NO EMBEDDER at ${EMBED_ENDPOINT} (${e.message}).\n` +
        `     The gap/offdomain split is a LaBSE cosine against OFFDOMAIN_OOV_FLOOR 0.62 /\n` +
        `     OFFDOMAIN_HARD_FLOOR 0.40. Without it every query looks off-domain and this gate\n` +
        `     would be measuring the missing embedder. Run it through run-arbitration.sh.`
    );
  }
  if (!res.ok) fatal(`embedder HTTP ${res.status} — ${(await res.text()).slice(0, 200)}`);
  const v: number[] = (await res.json()).data[0].embedding;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

/**
 * The model-free three-way split, in the same ORDER LocalEngine.answerQuery makes it
 * (packages/mobile/src/engine/LocalEngine.ts, `answerQuery`): off-domain first, then the
 * lexically-empty gap, then the abstain gap, else grounded — i.e. generation.
 *
 * Duplicated rather than imported because answerQuery lives behind the QVAC bindings and is
 * not loadable in Node — but both FLOORS and the gate itself come from @hiraia/shared, so the
 * part most likely to drift cannot. Same shape as finetuning/eval/harness/run-eval.mts:route.
 *
 * `lang` is the CONFIGURED language, not the query's: answerQuery reads `this.config.language`
 * for retrieval AND for the spelling probe, so a child typing English into a Tagalog-configured
 * app is routed in Tagalog. Passing the query's language modelled a state that only exists once
 * the child has switched the app — and three verdicts move on the difference.
 *
 * `grounded` is reported as `generated`: reaching this branch IS the decision to generate.
 * Whether the card the model then writes is any good is the card gate's question.
 */
async function routeModelFree(query: string, lang: Language) {
  const qvec = await embedQuery(normalizeQuery(query));
  const r = store.retrieveForGroundingHybridDiag(query, qvec, lang, CARD_TOPK, 0.5, '');
  const unreachable = r.lexEmpty && store.lexicallyUnreachable(query, lang);
  let outcome: Actual = 'generated';
  if (isOffDomain(r.topCos, unreachable)) outcome = 'offdomain';
  else if (r.lexEmpty) outcome = 'gap';
  else if (!r.hits.length) outcome = 'gap';
  // Which floor decided it, and by how much. isOffDomain fires on
  // (unreachable && topCos < OOV) || topCos < HARD, so the binding floor is the OOV one for an
  // unreachable query and the hard one otherwise.
  const floor = unreachable ? OFFDOMAIN_OOV_FLOOR : OFFDOMAIN_HARD_FLOOR;
  return { outcome, topCos: r.topCos, lexEmpty: r.lexEmpty, unreachable, margin: r.topCos - floor };
}

// ---------------------------------------------------------------------------------------
// Run. Search first, exactly as cardStore.ask does: a confident card short-circuits and the
// model path is never consulted (which is WHY an over-eager search is invisible to every
// other instrument in the repo — it wins before anything else gets a vote).
// ---------------------------------------------------------------------------------------
interface Row {
  id: string;
  set: SetName;
  bucket: Bucket;
  lang: Language;
  configLang: Language;
  form: string;
  searchDuplicateOf: string | null;
  aspirational: boolean;
  query: string;
  expect: Expect;
  expectLabel: string;
  expectAny: Expect[] | null;
  actual: Actual;
  pass: boolean;
  forbidden: boolean;
  /** The hit sat in searchCards' weak band, so it paid the off-domain consult (one embed). */
  weak: boolean;
  /** …and the consult refused it: actual becomes `offdomain`, nothing is served. */
  weakRefused: boolean;
  served: string | null;
  servedTopic: string | null;
  score: number;
  /** What the served card actually CARRIES — the reason served-existing is worth fighting for. */
  servedArt: boolean | null;
  servedTitle: boolean | null;
  servedEmph: boolean | null;
  servedQuiz: boolean | null;
  accept: number | null;
  acceptSample: string[];
  topCos: number | null;
  lexEmpty: boolean | null;
  unreachable: boolean | null;
  margin: number | null;
  unstable: boolean;
  why: string;
}

const rows: Row[] = [];

for (const c of cases) {
  const accept = acceptSet(c);
  // `currentId` is null: the gate asks from a cold feed, so no card is excluded.
  const search = await C.searchCards(c.query, null);
  const served: { id: string; topic: string } | null = search.best ?? null;
  const configLang: Language = c.configLang ?? DEFAULT_CONFIG_LANG;

  let actual: Actual;
  let topCos: number | null = null;
  let lexEmpty: boolean | null = null;
  let unreachable: boolean | null = null;
  let margin: number | null = null;
  // Did the WEAK-hit consult refuse the match? (Then nothing was served — the product shows
  // the science-tutor card.)
  let weakRefused = false;

  if (served) {
    // WEAK-HIT CONSULT — the same sequencing production runs (cardStore.ask /
    // useCardDemoStore.ask): a hit in searchCards' weak band asks the off-domain gate before
    // being served — through the SAME calibrated gate the miss path uses, with the OOV arm
    // gated on real lexical UNREACHABILITY, mirroring LocalEngine.weakHitOffDomain verbatim.
    // An earlier revision forced the OOV arm (`isOffDomain(topCos, true)`) and scored 65/94 —
    // but the live-pipeline probes showed that arm refusing "para saan ang ating puso" and
    // four other canonical grade-school questions, which land in the same weak band as junk
    // (topCos 0.537–0.586 vs 0.479–0.545). The runner mirrors production, not the version
    // that measured best: a gate that flatters a refusal doctrine the product rejected would
    // be measuring dead code. A strong hit is served with no embed at all, exactly as before.
    // (In production an unavailable embedder serves the match; here the embedder is
    // mandatory, so the gate exercises the judged path — the degradation path is by
    // construction today's behaviour.)
    if (search.weak) {
      const qvec = await embedQuery(normalizeQuery(c.query));
      const r = store.retrieveForGroundingHybridDiag(c.query, qvec, configLang, CARD_TOPK, 0.5, '');
      topCos = r.topCos;
      margin = r.topCos - OFFDOMAIN_OOV_FLOOR;
      weakRefused = isOffDomain(r.topCos, r.lexEmpty && store.lexicallyUnreachable(c.query, configLang));
    }
    // BOTH HALVES. Served the right card, or served a card — the distinction the mangrove bug
    // lives in. A case with no accept set (nothing in the corpus should have been served at
    // all) is simply `served-existing`, which its expectation already fails.
    actual = weakRefused
      ? 'offdomain'
      : accept
        ? accept.has(served.id)
          ? 'served-existing'
          : 'served-wrong'
        : 'served-existing';
  } else {
    const r = await routeModelFree(c.query, configLang);
    actual = r.outcome;
    topCos = r.topCos;
    lexEmpty = r.lexEmpty;
    unreachable = r.unreachable;
    margin = r.margin;
  }

  const allowed: Expect[] = c.expectAny ?? [c.expect];
  // `served-wrong` is never allowed: it is not one of the four outcomes, it is a served-existing
  // that got the wrong card.
  const pass = (allowed as string[]).includes(actual);
  const forbidden = !!c.forbid?.includes(actual);

  rows.push({
    id: c.id,
    set: c.set,
    bucket: c.bucket,
    lang: c.lang,
    configLang,
    form: c.form,
    searchDuplicateOf: c.searchDuplicateOf ?? null,
    aspirational: !!c.aspirational,
    query: c.query,
    expect: c.expect,
    expectLabel: c.expectAny ? c.expectAny.join('|') : c.expect,
    expectAny: c.expectAny ?? null,
    actual,
    pass: pass && !forbidden,
    forbidden,
    weak: !!(served && search.weak),
    weakRefused,
    // A refused weak hit serves NOTHING (the product shows the science-tutor card), so the
    // served columns are empty — the match search found is still visible in `score`.
    served: weakRefused ? null : (served?.id ?? null),
    servedTopic: weakRefused ? null : (served?.topic ?? null),
    score: Number(search.score.toFixed(3)),
    servedArt: served && !weakRefused ? hasArt(served.id) : null,
    servedTitle: served && !weakRefused ? !!CARD_META.get(served.id)?.title : null,
    servedEmph: served && !weakRefused ? !!CARD_META.get(served.id)?.emph : null,
    servedQuiz: served && !weakRefused ? HAS_QUIZ.has(FACT_OF.get(served.id) ?? '') : null,
    accept: accept ? accept.size : null,
    acceptSample: accept ? [...accept].slice(0, 4) : [],
    topCos: topCos === null ? null : Number(topCos.toFixed(3)),
    lexEmpty,
    unreachable,
    margin: margin === null ? null : Number(margin.toFixed(3)),
    unstable: margin !== null && Math.abs(margin) < UNSTABLE_MARGIN,
    why: c.why,
  });
}

// ---------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------
const B = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const R = (s: string, n: number) => (s.length >= n ? s : ' '.repeat(n - s.length) + s);
const BUCKETS: Bucket[] = ['has-card', 'borderline', 'out-of-scope', 'chitchat', 'misspelling', 'tokenisation'];
const ACTUALS: Actual[] = ['served-existing', 'served-wrong', 'generated', 'gap', 'offdomain'];
const SETS: SetName[] = ['tuning', 'holdout'];
/** Gating rows only: aspirational cases are reported, never counted. */
const gating = (rs: Row[]) => rs.filter((r) => !r.aspirational);

console.log(
  `\n>> provenance: HEAD ${PROVENANCE.head} (${PROVENANCE.branch}) · worktree ` +
    `${PROVENANCE.dirtyFiles ? `DIRTY ${PROVENANCE.dirtyFiles} files / ${PROVENANCE.dirtyDigest}` : 'clean'}` +
    `\n>>             cards.ts ${PROVENANCE.cardsTs} · cards.db ${PROVENANCE.cardsDb} · pool ${PROVENANCE.cardsIndex}` +
    `\n>>             embedder ${relative(ROOT, PROVENANCE.embedder) || PROVENANCE.embedder}`
);

for (const set of SETS) {
  const inSet = rows.filter((r) => r.set === set);
  if (!inSet.length) continue;
  console.log(`\n${'#'.repeat(112)}\n#  ${set.toUpperCase()} SET  (${inSet.length} cases)\n${'#'.repeat(112)}`);
  for (const b of BUCKETS) {
    const inB = inSet.filter((r) => r.bucket === b);
    if (!inB.length) continue;
    console.log(`\n${'='.repeat(112)}\n  ${b.toUpperCase()}  (${inB.length} cases)\n${'='.repeat(112)}`);
    for (const r of inB) {
      const mark = r.aspirational ? 'asp.' : r.pass ? 'PASS' : 'FAIL';
      const carries = `[${r.servedArt ? 'art' : '---'} ${r.servedTitle ? 'ttl' : '---'} ${
        r.servedEmph ? 'emp' : '---'
      } ${r.servedQuiz ? 'quiz' : '----'}]`;
      const detail = r.served
        ? `${r.served} "${(r.servedTopic ?? '').slice(0, 40)}" @${r.score.toFixed(3)} ${carries}` +
          (r.weak
            ? ` (weak, consulted: topCos ${r.topCos} margin ${(r.margin ?? 0) >= 0 ? '+' : ''}${r.margin}${
                r.unstable ? ' UNSTABLE' : ''
              })`
            : '')
        : r.weakRefused
          ? `weak hit @${r.score.toFixed(3)} REFUSED by the off-domain gate · topCos ${r.topCos} · margin ${
              (r.margin ?? 0) >= 0 ? '+' : ''
            }${r.margin}${r.unstable ? ' UNSTABLE' : ''}`
          : `search declined @${r.score.toFixed(3)} · topCos ${r.topCos} · lexEmpty ${r.lexEmpty} · unreach ${
              r.unreachable
            } · margin ${(r.margin ?? 0) >= 0 ? '+' : ''}${r.margin}${r.unstable ? ' UNSTABLE' : ''}`;
      console.log(
        `${mark}  ${B(r.lang.slice(0, 3), 3)}/${B(r.configLang.slice(0, 3), 3)} ${B(r.form, 8)} ${B(r.query, 40)} ` +
          `${B(r.expectLabel, 24)} -> ${B(r.actual, 15)} ${detail}` +
          (r.accept !== null ? `  [accept ${r.accept}: ${r.acceptSample.join(' ')}]` : '') +
          (r.forbidden ? '  <<< FORBIDDEN OUTCOME' : '') +
          (r.searchDuplicateOf ? `  (search-dup of ${r.searchDuplicateOf})` : '')
      );
    }
  }

  const g = gating(inSet);
  console.log(`\n${'='.repeat(112)}\n  PER-BUCKET — ${set}\n${'='.repeat(112)}`);
  console.log(`${B('bucket', 16)}${R('pass', 6)}${R('fail', 6)}${R('total', 7)}${R('rate', 8)}`);
  for (const b of BUCKETS) {
    const inB = g.filter((r) => r.bucket === b);
    if (!inB.length) continue;
    const p = inB.filter((r) => r.pass).length;
    console.log(
      `${B(b, 16)}${R(String(p), 6)}${R(String(inB.length - p), 6)}${R(String(inB.length), 7)}` +
        `${R(((100 * p) / inB.length).toFixed(0) + '%', 8)}`
    );
  }
  const gp = g.filter((r) => r.pass).length;
  console.log(
    `${B('TOTAL', 16)}${R(String(gp), 6)}${R(String(g.length - gp), 6)}${R(String(g.length), 7)}` +
      `${R(((100 * gp) / g.length).toFixed(0) + '%', 8)}`
  );

  // Split by query FORM — but only over cases whose search half is actually distinct. Several
  // "sentences" reduce to exactly the token set of a term case (SEARCH_STOP strips
  // what/is/ano/ang/unsa/ngano), so counting them here would compare a form against itself.
  const formRows = g.filter((r) => !r.searchDuplicateOf);
  console.log(
    `\n${B('form', 16)}${R('pass', 6)}${R('fail', 6)}${R('total', 7)}${R('rate', 8)}` +
      `   (excludes ${g.length - formRows.length} search-duplicate sentences)`
  );
  for (const f of ['term', 'sentence']) {
    const inF = formRows.filter((r) => r.form === f);
    if (!inF.length) continue;
    const p = inF.filter((r) => r.pass).length;
    console.log(
      `${B(f, 16)}${R(String(p), 6)}${R(String(inF.length - p), 6)}${R(String(inF.length), 7)}` +
        `${R(((100 * p) / inF.length).toFixed(0) + '%', 8)}`
    );
  }

  // The matrix Luis reads: WHERE the strategy leaks, not just how much.
  console.log(
    `\n${'='.repeat(112)}\n  CONFUSION MATRIX — expected (rows) x actual (cols) — ${set}\n${'='.repeat(112)}`
  );
  const expectLabels = [...new Set(g.map((r) => r.expectLabel))];
  console.log(`${B('expected \\ actual', 26)}${ACTUALS.map((a) => R(a, 17)).join('')}`);
  for (const el of expectLabels) {
    const inE = g.filter((r) => r.expectLabel === el);
    console.log(
      `${B(el, 26)}` +
        ACTUALS.map((a) => {
          const n = inE.filter((r) => r.actual === a).length;
          const ok = n && inE.some((r) => r.actual === a && r.pass);
          return R(n ? `${n}${ok ? ' ok' : ' XX'}` : '.', 17);
        }).join('')
    );
  }
  console.log(
    `${B('(all)', 26)}` + ACTUALS.map((a) => R(String(g.filter((r) => r.actual === a).length), 17)).join('')
  );
}

// ASPIRATIONAL — reported, never gating.
const asp = rows.filter((r) => r.aspirational);
if (asp.length) {
  console.log(`\n${'='.repeat(112)}\n  ASPIRATIONAL (reported, NOT part of the verdict)\n${'='.repeat(112)}`);
  for (const r of asp) {
    console.log(
      `      ${B(r.id, 34)} ${B(r.query, 20)} want ${B(r.expect, 10)} got ${B(r.actual, 15)} ` +
        (r.pass ? 'would pass' : 'would fail')
    );
  }
  console.log(
    `  Each needs a CONCEPT-level coverage check that does not exist: the head token IS in the bank, so lexEmpty\n` +
      `  is false and the route can only ever answer 'generated'. Kept visible so the gate cannot silently demand an\n` +
      `  unbuilt feature — and so nobody quietly deletes the requirement either.`
  );
}

// HARD ASSERTIONS — the ones that are not just "a case failed".
const G = gating(rows);
const wrongCard = G.filter((r) => r.actual === 'served-wrong');
const scienceCalledOffdomain = G.filter((r) => r.actual === 'offdomain' && r.expect !== 'offdomain');
// "answered an off-domain query with a card" counts only where a card was NOT an allowed
// outcome: the chitchat bucket allows an ON-TOPIC card by design (decline politely OR teach the
// science the child named), and a card from outside its accept set already lands in served-wrong.
const offdomainServedCard = G.filter(
  (r) =>
    r.expect === 'offdomain' &&
    !(r.expectAny ?? []).includes('served-existing') &&
    (r.actual === 'served-existing' || r.actual === 'served-wrong')
);
const missOffdomain = G.filter(
  (r) => (r.bucket === 'misspelling' || r.bucket === 'tokenisation') && r.actual === 'offdomain'
);
const gapCalledGenerated = G.filter((r) => r.expect === 'gap' && r.actual === 'generated');
const servedNoArt = G.filter((r) => r.pass && r.actual === 'served-existing' && !r.servedArt);
const servedNoTitle = G.filter((r) => r.pass && r.actual === 'served-existing' && !r.servedTitle);
const unstable = G.filter((r) => r.unstable);
console.log(`\n${'='.repeat(112)}\n  HARD ASSERTIONS\n${'='.repeat(112)}`);
console.log(`wrong card served (the mangrove bug) .................. ${wrongCard.length}`);
console.log(`in-domain query told it is off-domain ................. ${scienceCalledOffdomain.length}`);
console.log(`  of which a child's SPELLING or SPACING .............. ${missOffdomain.length}   [must be 0]`);
console.log(`off-domain query answered with a confident card ....... ${offdomainServedCard.length}`);
console.log(`ungrounded query sent to generation anyway ............ ${gapCalledGenerated.length}`);

console.log(`\n${'-'.repeat(112)}\n  SOFT — what the CORRECT cards actually carried\n${'-'.repeat(112)}`);
console.log(`right card served with NO illustration ................ ${servedNoArt.length}`);
console.log(`right card served with NO title band ................. ${servedNoTitle.length}`);
console.log(
  `  Card art and typography are DISJOINT populations in this corpus (a poster card has title+emphasis and no\n` +
    `  picture; an illustrated card has no title), so a green gate is compatible with a feed that quietly stopped\n` +
    `  showing pictures for typed queries. Advisory — never part of the verdict.`
);
// The COST of the weak-hit consult: only these rows paid the extra embed. Strong hits and
// declines are exactly as cheap as before.
const weakRows = G.filter((r) => r.weak);
console.log(
  `\nweak hits (paid the one-embed off-domain consult) ..... ${weakRows.length}` +
    `   (refused: ${weakRows.filter((r) => r.weakRefused).length})`
);
console.log(`\nverdicts decided within ${UNSTABLE_MARGIN} of their floor (coin flips) . ${unstable.length}`);
for (const r of unstable) {
  console.log(`      ${B(r.id, 40)} topCos ${r.topCos} · margin ${(r.margin ?? 0) >= 0 ? '+' : ''}${r.margin}`);
}

// ---------------------------------------------------------------------------------------
// Verdict — BOTH halves, gating rows only.
// ---------------------------------------------------------------------------------------
const perSet = SETS.map((s) => {
  const rs = gating(rows.filter((r) => r.set === s));
  return { set: s, pass: rs.filter((r) => r.pass).length, total: rs.length };
}).filter((x) => x.total);
const verdict = perSet.every((x) => x.pass === x.total) && !PARTIAL;
console.log(
  `\n>> embedder: ${EMBED_ENDPOINT}` +
    perSet.map((x) => `\n>> ${B(x.set, 8)} ${x.pass}/${x.total}`).join('') +
    (asp.length ? `\n>> aspirational (not gating): ${asp.filter((r) => r.pass).length}/${asp.length}` : '') +
    `\n>> ARBITRATION GATE ${verdict ? 'GREEN' : 'RED'} — ${G.filter((r) => r.pass).length}/${G.length} gating cases` +
    (PARTIAL ? '  (PARTIAL RUN — a filtered run is never a verdict)' : '  (green requires BOTH halves)') +
    `\n`
);

if (process.env.JSON_OUT) {
  writeFileSync(
    process.env.JSON_OUT,
    JSON.stringify(
      {
        when: new Date().toISOString(),
        provenance: PROVENANCE,
        floors: { OFFDOMAIN_OOV_FLOOR, OFFDOMAIN_HARD_FLOOR, SEARCH_FLOOR: C.SEARCH_FLOOR },
        sets: perSet,
        aspirational: { total: asp.length, pass: asp.filter((r) => r.pass).length },
        partial: PARTIAL,
        rows,
      },
      null,
      2
    )
  );
  console.log(`>> wrote ${process.env.JSON_OUT}`);
}
process.exit(verdict ? 0 : 1);
