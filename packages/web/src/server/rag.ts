/**
 * Server-side RAG for the public web demo — the same grounded retrieval the
 * shipped APK runs on-device, mirrored on the VPS so the web demo is a faithful
 * replica (not a weaker, ungrounded chat).
 *
 * Parity with mobile (packages/mobile/src/engine/LocalEngine.ts):
 *   1. Build a RagStore over the SAME bank (@hiraia/shared SCIENCE_FACTS).
 *   2. attachSemantic() the SAME bundled int8 LaBSE vectors blob (lang-major).
 *   3. Embed the query with the SAME model (LaBSE raw-CLS + L2) — here via a
 *      co-located llama-server (`--embedding --pooling cls`, localhost:8090)
 *      instead of QVAC's on-device embedder.
 *   4. retrieveForGroundingHybrid() with the SAME abstain floor + R2 contextual
 *      re-embed for topic-blind follow-ups.
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

import {
  RagStore,
  SemanticIndex,
  normalizeQuery,
  buildContextualQuery,
  type Language,
  type RagResult,
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
  const store = new RagStore(); // defaults to SCIENCE_FACTS — same bank as the blob
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
      })
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
 */
async function embed(text: string): Promise<Float32Array | undefined> {
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
 * Retrieve grounding facts for a query, mirroring the on-device path:
 *   - embed the NORMALIZED query (strip filler so covered topics clear the floor)
 *   - hybrid retrieve (semantic + lexical RRF) with the off-topic abstain floor
 *   - R2: if it abstains and we have conversation context, retry once with the
 *     topic folded into the embedding (rescues bare follow-ups)
 *
 * Returns RagResult[] shaped exactly like TutorEngine.retrieve(), ready for
 * formatGroundingBlock(). Empty array = abstain (off-topic) → ungrounded answer.
 */
export async function retrieveGrounding(
  query: string,
  language: Language,
  context = '',
  seenIds?: ReadonlySet<string>,
  topK = 3
): Promise<RagResult[]> {
  const store = await getStore();
  let queryVec: Float32Array | undefined;
  if (store.hasSemantic) {
    queryVec = await embed(normalizeQuery(query));
  }

  let hits = store.retrieveForGroundingHybrid(query, queryVec, language, topK, 0.5, context, seenIds);

  // R2 — topic-blind follow-up abstained; retry once with context folded in.
  if (hits.length === 0 && queryVec && context.trim()) {
    const foldedVec = await embed(buildContextualQuery(query, context));
    if (foldedVec) {
      hits = store.retrieveForGroundingHybrid(query, foldedVec, language, topK, 0.5, context, seenIds);
    }
  }

  return hits.map((h) => ({
    content: h.text,
    source: h.fact.source,
    score: h.score,
    metadata: { id: h.fact.id, topic: h.fact.topic, domain: h.fact.domain },
  }));
}

/** Eagerly warm the store (blob load) at server start so the first query isn't slow. */
export function warmRag(): void {
  void getStore();
}
