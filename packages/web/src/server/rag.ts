/**
 * Server-side RAG for the public web demo — the same grounded retrieval the
 * shipped APK runs on-device, mirrored on the VPS so a card printed on hiraia.org is the
 * card the APK would print.
 *
 * Parity with mobile (packages/mobile/src/engine/LocalEngine.ts):
 *   1. Build a RagStore over the SAME bank (rag/bank/science-facts.jsonl, the source of
 *      truth the phone's cards.db is also built from).
 *   2. attachSemantic() the SAME bundled int8 LaBSE vectors blob (lang-major).
 *   3. Embed the query with the SAME model (LaBSE raw-CLS + L2) — here via a
 *      co-located llama-server (`--embedding --pooling cls`, localhost:8090)
 *      instead of QVAC's on-device embedder.
 *   4. retrieveForGroundingHybrid() with the SAME abstain floor.
 *
 * ONE ENTRY POINT, `retrieveForCard`. The conversational `retrieveGrounding` (context-folding
 * R2 re-embed for topic-blind follow-ups, cross-turn `seenIds`) went with the demo chat route
 * that was its only caller: a card query is standalone, so there is no prior turn to fold in.
 *
 * Built ONCE per server process (module singleton). The 80MB int8 blob lives in
 * RAM for the process lifetime — same footprint the phone carries, trivial on the
 * VPS. Everything degrades gracefully: if the blob is missing the store stays
 * lexical-only; if the embedder is unreachable a query falls back to lexical
 * grounding; either way the route still answers (and can still canned-fallback).
 *
 * SERVER-ONLY. Never import this from a client component — it reads the filesystem
 * and pulls the whole bank into memory.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadFactSource } from '@hiraia/shared/node';
import {
  RagStore,
  SemanticIndex,
  normalizeQuery,
  isOffDomain,
  type Language,
  type RagResult,
  type ScienceFact,
} from '@hiraia/shared';

/** Where to embed a query. A second llama-server runs the LaBSE GGUF in embedding
 *  mode on the same box (not publicly exposed); override with HIRAIA_EMBED_URL. */
const EMBED_URL = process.env.HIRAIA_EMBED_URL || 'http://localhost:8090';

/** The bundled int8 vectors blob + its meta. Defaults to the mobile asset (the
 *  full repo is checked out on the VPS); override with HIRAIA_RAG_DIR. */
const RAG_DIR =
  process.env.HIRAIA_RAG_DIR ||
  path.join(process.cwd(), '..', 'mobile', 'assets', 'rag');
const BLOB_PATH = path.join(RAG_DIR, 'vectors-labse.i8.bin');
const META_PATH = path.join(RAG_DIR, 'vectors-labse.meta.json');

interface VectorsMeta {
  dims: number;
  scale: number;
  count: number;
  langs: ('tl' | 'bis' | 'en')[];
  bankHash: string;
}

/** Lazily built, then cached for the process lifetime. */
let storePromise: Promise<RagStore> | null = null;

function buildStore(): RagStore {
  // Read the bank from the JSONL rather than a bundled copy of it. The server has the repo
  // checked out and Node has no reason to go through SQLite: it holds the bank in RAM for the
  // process lifetime either way. `loadFactSource` also stamps it with md5(bank)[:12], which is
  // what lets attachSemantic below reject a blob built for a different bank of the same size.
  const store = new RagStore(loadFactSource());
  try {
    const meta = JSON.parse(readFileSync(META_PATH, 'utf8')) as VectorsMeta;
    const buf = readFileSync(BLOB_PATH); // Node Buffer (== Uint8Array)
    const data = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    // attachSemantic throws if count !== bank length (stale blob) — let it surface
    // in the log and stay lexical-only rather than serve a mismatched index.
    store.attachSemantic(
      new SemanticIndex({
        dims: meta.dims,
        scale: meta.scale,
        count: meta.count,
        langs: meta.langs,
        data,
      }),
      meta.bankHash
    );
    console.log(
      `[rag] semantic index attached: ${meta.count} facts × ${meta.langs.join('/')} (bank ${meta.bankHash})`
    );
  } catch (e) {
    console.warn('[rag] semantic init failed — lexical-only grounding:', e);
  }
  return store;
}

function getStore(): Promise<RagStore> {
  if (!storePromise) storePromise = Promise.resolve().then(buildStore);
  return storePromise;
}

/**
 * Embed a query with the co-located LaBSE server. Returns an L2-normalized
 * Float32Array (the abstain floor + int8 dot-product both assume a unit query —
 * matches the on-device `embdNormalize:2`). Returns undefined on any failure so
 * callers fall back to lexical grounding.
 *
 * EXPORTED because the card's ILLUSTRATION runs through the same embedder against the image
 * catalog (server/images.ts) — the phone reaches both through one `LocalEngine.embed`, and a
 * second copy of this fetch is a second place for the URL, the timeout or the normalization to
 * drift. Server-only, like the rest of this module.
 */
export async function embedText(text: string): Promise<Float32Array | undefined> {
  try {
    const res = await fetch(`${EMBED_URL}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text, model: 'labse' }),
      // a single short query — keep the route snappy if the embedder hangs
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return undefined;
    // L2-normalize (CLS pooling output is not guaranteed unit-length).
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    const out = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) out[i] = vec[i]! / norm;
    return out;
  } catch {
    return undefined;
  }
}

/**
 * The three-way outcome of a FEED CARD query, decided before any model runs.
 * Mirrors LocalEngine.answerQuery's classification on the phone.
 */
export type CardOutcome =
  /** grounding that can be printed → generate a fact card from `hits` */
  | 'grounded'
  /** it is science, we just have no page for it → honest gap card, model-free */
  | 'gap'
  /** not science at all → "I'm only a science tutor", model-free, NO nearest topic */
  | 'offdomain';

export interface CardRetrieval {
  outcome: CardOutcome;
  hits: RagResult[];
  /**
   * The hits as WHOLE facts, PARALLEL to `hits`, not the display-language strings `hits`
   * carries. All of them, not just the best one: the printed card may restate any of the four
   * (the prompt permits it), so the route attributes the card to one of them before resolving
   * the illustration from it — and that needs the fact's id for the curated map, its domain
   * for scoping and its ENGLISH body to embed, none of which RagResult keeps. Mirrors
   * LocalEngine.ragSearchDiag's `facts`.
   */
  facts: ScienceFact[];
  /** Diagnostics, for the route log — the numbers the outcome was decided on. */
  topCos: number;
  lexEmpty: boolean;
  /** Whether the embedder actually ran; when false NEITHER diagnostic may classify. */
  semantic: boolean;
}

/**
 * Retrieval for the feed's DYNAMIC CARD path — the same routing the phone runs in
 * LocalEngine.answerQuery, with the same floors, so a query typed into hiraia.org lands on
 * the same one of three cards it would land on in the APK.
 *
 * Deliberately CONTEXT-FREE (no R2 context fold): a card query is a standalone question typed
 * into the feed's ask box, not a follow-up in a conversation, and folding an earlier topic in
 * would answer a question the child did not ask.
 *
 * The order of the gates is load-bearing:
 *   1. OFF-DOMAIN — only classifiable when the embedder ran. Without it topCos is 0 and every
 *      query would look off-domain, so a cold/failed embedder falls through to the gap card
 *      rather than telling a child their science question isn't science. The gate is
 *      `isOffDomain` (shared), and its OOV arm takes lexical UNREACHABILITY — the spelling
 *      probe — not bare emptiness, so "batirya"/"amiba"/"erthquake" are not called off-topic.
 *   2. GAP form 1 — no word of the query exists anywhere in the bank. Semantic retrieval still
 *      returns its nearest neighbours (that is what a nearest-neighbour search does) but they
 *      are about something else, and grounding we know is unrelated is not grounding.
 *   3. GAP form 2 — retrieval abstained outright (top cosine under the bank's own floor).
 * Anything that survives all three is grounded and gets a printed card.
 */
export async function retrieveForCard(
  query: string,
  language: Language,
  topK = 4
): Promise<CardRetrieval> {
  const store = await getStore();
  let queryVec: Float32Array | undefined;
  if (store.hasSemantic) queryVec = await embedText(normalizeQuery(query));

  const r = store.retrieveForGroundingHybridDiag(query, queryVec, language, topK, 0.5, '');
  const semantic = !!queryVec && store.hasSemantic;
  const hits: RagResult[] = r.hits.map((h) => ({
    content: h.text,
    source: h.fact.source,
    score: h.score,
    metadata: { id: h.fact.id, topic: h.fact.topic, domain: h.fact.domain },
  }));

  // `lexicallyUnreachable` runs the spelling probe, so it is asked HERE, behind `lexEmpty`,
  // rather than being returned by retrieval — it is a card-routing question, not a retrieval
  // result. Retrieval used this language, so the probe must too.
  const unreachable = semantic && r.lexEmpty && store.lexicallyUnreachable(query, language);
  let outcome: CardOutcome = 'grounded';
  if (semantic && isOffDomain(r.topCos, unreachable)) outcome = 'offdomain';
  else if (semantic && r.lexEmpty) outcome = 'gap';
  else if (!hits.length) outcome = 'gap';

  return {
    outcome,
    hits,
    facts: r.hits.map((h) => h.fact),
    topCos: r.topCos,
    lexEmpty: r.lexEmpty,
    semantic,
  };
}

/** Eagerly warm the store (blob load) at server start so the first query isn't slow. */
export function warmRag(): void {
  void getStore();
}
