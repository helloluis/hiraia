/**
 * On-device model configuration (single source of truth for the mobile build).
 *
 * ONE device target (2026-09-01): **Hiraia-2B** — our CPT'd + SFT'd Qwen3.5-2B
 * ("we're not launching with Sailor2", Luis 2026-09-01) — on a phone with
 * **6 GB+ RAM**, the norm on a 2025-class budget handset, even sub-₱10k. It is a
 * FULL-PARAMETER SFT: there are NO LoRA adapters in this line — Tagalog, Cebuano
 * and English all live in the one set of weights. (The Sailor2-3B + v11-adapter
 * line, and before it the "kitten" Sailor2-1B tier, are retired — kept in
 * `finetuning/eval/` and git history as a record, they just no longer ship.)
 *
 * Qwen3.5 is a THINKING model: generation MUST send the shared
 * CARD_REASONING_BUDGET (0 = channel off) and CARD_STOP, or content comes back
 * empty / runs away — see @hiraia/shared prompts/cards.ts and LocalEngine.
 *
 * The model leans on the on-device RAG bank for the specifics no model can know
 * (exact values, PH/DepEd curriculum framing, Hiraia self-knowledge).
 *
 * The web demo's MODEL_INFO (packages/web/src/config/model.ts) still describes
 * the VPS demo deployment (Sailor2-3B + adapters, server-side) — it is a
 * separate deployment and does not gate this build.
 */

import type { RemoteAssetSpec } from '../engine/modelDownload';

// SELF-HOSTED MODEL HOST. Originally a workaround (HuggingFace's "Xet" CDN broke
// QVAC's downloader at ~85% — see hiraia-hf-xet-recheck), now simply where our
// OWN model lives: the Hiraia-2B GGUF is our fine-tune, published on our nginx
// (a plain static file with byte-range support + Accept-Ranges, downloaded +
// verified + cached on first run, then loaded from cache offline). Inference
// stays 100% on-device, so the privacy story is intact. Files live at
// /var/www/hiraia-models on the VPS, served at https://hiraia.b11.dev/models/.
// The LaBSE embedder row is still a verifiable mirror of the public model.
const MODELS_BASE_URL = 'https://hiraia.b11.dev/models';

/**
 * ============================================================================
 * THE INTEGRITY TABLE — measured, not guessed.
 * ============================================================================
 * Every remote asset the app downloads declares its exact size and MD5 here, and
 * `engine/modelDownload.ts` refuses to install bytes that do not match. This is
 * the single defence against the failure our users actually hit: a captive-portal
 * Wi-Fi (every school) answers `200 OK` with an HTML login page, and an earlier
 * build cached that page permanently as the model — an install that could only be
 * fixed by uninstalling the app.
 *
 * MD5, not SHA-256, for one concrete reason: expo-file-system computes MD5
 * NATIVELY and STREAMING (DigestUtils over a FileInputStream), so hashing a
 * multi-GB file costs one disk read and constant memory. There is no streaming
 * SHA-256 reachable from the JS thread — `expo-crypto` is not installed and its
 * API takes a string, which a 1.27 GB file cannot be. SHA-256 is recorded
 * alongside anyway so the values can be re-verified off-device.
 *
 * The SHA-256 column below is the same digest published for these files; MD5 was
 * measured from the exact bytes the mirror serves (and matches the server-side
 * md5sum byte-for-byte). To re-derive any row:
 *     curl -sO https://hiraia.b11.dev/models/<name>
 *     stat -f%z <name>; md5 -q <name>; shasum -a 256 <name>
 *
 *  hiraia-sft-2b-v2.Q4_K_M.gguf  1274396160 B
 *      sha256 b13e66678be6718252c692cb765bbe1d6bafd69c11772a1d1e9c23ee6ce0cd89
 *  labse.Q4_K_M.gguf              383762048 B
 *      sha256 3869330197b5a583afc572104bf93393e384c72473a15c2dae43cab43e194b3e
 *
 * (Retired rows, for the record: Sailor2-3B-Chat.Q4_K_M.gguf 3227563808 B md5
 *  a7b8f147b7ca995bb64fa59216740457; adapter-tagalog-v11.gguf / adapter-
 *  bisaya-v11.gguf 106772928 B each. They belonged to the Sailor2 line; nothing
 *  fetches them any more, so they are history, not config.)
 *
 * VERSIONING: the on-device cache keys on FILENAME only. Changing an asset's
 * CONTENT therefore requires a new filename (`-v1` → `-v2`) or existing installs
 * keep the old file forever. Bump the filename AND the digests together —
 * `hiraia-sft-2b-v1` is versioned in the filename for exactly this reason.
 */
export const REMOTE_ASSETS = {
  /** The base GGUF — the ~1.27 GB first-run download. FULL-parameter SFT (no LoRA). */
  base: {
    url: `${MODELS_BASE_URL}/hiraia-sft-2b-v2.Q4_K_M.gguf`,
    filename: 'hiraia-sft-2b-v2.Q4_K_M.gguf',
    bytes: 1274396160,
    md5: 'fe2d0ab2ad856f2a42c5add5872c4234',
    label: 'Hiraia-2B base',
  },
  /** LaBSE embedder for the hybrid retriever (background download). */
  /**
   * The fact-bank semantic vectors (int8 LaBSE, 50,279 × 768). DOWNLOADED, not bundled —
   * 78.6 MB of APK for a blob that is inert until the 384 MB embedder lands anyway (the
   * same argument that moved the adapters out). The filename embeds the BANK HASH
   * (md5(science-facts.jsonl)[:12]) so a rebuilt bank can never silently pair with a stale
   * blob: attachSemantic hard-fails on hash mismatch, and the URL itself must change.
   */
  vectors: {
    url: `${MODELS_BASE_URL}/vectors-labse-af171fe8a9f9.i8.bin`,
    filename: 'vectors-labse-af171fe8a9f9.i8.bin',
    bytes: 115842816,
    md5: '4f80d21b0526db1aeadb7033b5aa8998',
    label: 'Hiraiapedia vectors',
  },
  embedder: {
    url: `${MODELS_BASE_URL}/labse.Q4_K_M.gguf`,
    filename: 'labse.Q4_K_M.gguf',
    bytes: 383762048,
    md5: '2667f69edfbcb68acf617187fe817fae',
    label: 'LaBSE embedder',
  },
} satisfies Record<string, RemoteAssetSpec>;

/** Identifier for the shipping on-device model. One tier, one member. */
export type OnDeviceModelKey = 'hiraia-2b';

/**
 * Languages that can have their OWN fine-tuned adapter. The type survives the
 * move to the full-parameter Hiraia-2B (whose `loraRemote` is empty BY DESIGN —
 * all three languages live in the one set of weights) so that a future
 * adapter-ful model slots back in without re-plumbing LocalEngine.
 */
export type AdapterLanguage = 'tagalog' | 'cebuano';

export interface OnDeviceModel {
  key: OnDeviceModelKey;
  displayName: string;
  /** Approx parameter count. */
  params: string;
  quant: string;
  /** Model file size on disk (GiB) — drives the first-run download estimate. */
  sizeGB: number;
  /** Approx resident RAM at runtime (GiB, mmap'd). */
  ramGB: number;
  /** Device-RAM floor. The app targets 6 GB+ phones and nothing below. */
  minRamGB: number;
  /** Inference context window. */
  ctxSize: number;
  /**
   * Runtime placement, kept here rather than hard-coded in the engine so the
   * placement travels with the model it was measured for. gpuLayers 99 = ask for
   * full GPU/Vulkan offload (the 2026-06-15 CPU-vs-GPU A/B on a working Adreno
   * had the GPU win PREFILL decisively, and prefill dominates TTFT), so
   * libqvac-ggml-vulkan.so stays load-bearing — do not strip the Vulkan/OpenCL
   * backends out of the APK. BUT this is a REQUEST, not a guarantee: on the
   * Filipino budget mainstream (measured 2026-09-01, Xiaomi SM6225 / Adreno 610,
   * 7.8 GB RAM) ggml-vulkan initialises and then MODEL_LOAD_FAILED (52200) — the
   * device passes minRamGB and still cannot run the GPU path. LocalEngine
   * probes GPU first and falls back ONCE to CPU (device:'cpu', gpuLayers:0),
   * then persists the verdict. See LocalEngine.initialize.
   */
  runtime: { gpuLayers: number };
  /** QVAC model type — 'llm' for all our chat models. */
  modelType: 'llm';
  /**
   * Base GGUF source passed to QVAC `loadModel`. Per the SDK this is a string:
   * an https HuggingFace URL (downloaded + cached on first run), a local/bundled
   * path, or a `pear://` Hyperdrive key. NULL → LocalEngine loads a stock SDK
   * model as a placeholder.
   */
  modelSrc: string | null;
  /**
   * Integrity contract for `modelSrc` when it is a remote URL. NON-NULL means the
   * engine must fetch it through `ensureRemoteAsset`, which will not install bytes
   * that fail the declared size + MD5. Null = `modelSrc` is a local/bundled path.
   */
  remote: RemoteAssetSpec | null;
  /**
   * Per-language fine-tuned LoRA adapters, downloaded from the mirror and
   * verified against the integrity table above, exactly like the base model.
   * When non-empty, the engine resolves the one matching the active language and
   * passes its local path as `modelConfig.lora` (QVAC's own loader cannot fetch
   * it: `modelConfig.lora` is a bare string the llama.cpp plugin never resolves).
   *
   * EMPTY ({}) = the model ships with NO adapters BY DESIGN — the Hiraia-2B is a
   * full-parameter SFT, so the engine loads it adapter-free without complaint.
   * That absence-by-design is distinct from a download failure: a language whose
   * spec IS declared here but cannot be fetched/verified still THROWS (see
   * LocalEngine.resolveAdapterPath).
   */
  loraRemote: Partial<Record<AdapterLanguage, RemoteAssetSpec>>;
  note: string;
}

/** The model the on-device build loads. */
export const ACTIVE_MODEL: OnDeviceModel = {
  key: 'hiraia-2b',
  displayName: 'Hiraia-2B',
  // CPT'd (Filipino corpus) + full-parameter SFT'd Qwen3.5-2B — our own build,
  // published on the mirror as hiraia-sft-2b-v1.
  params: '~2B',
  quant: 'Q4_K_M',
  sizeGB: 1.27, // hiraia-sft-2b-v2.Q4_K_M.gguf, 1,274,396,000 B
  ramGB: 1.4, // ~1.27 GB weights mmap'd + KV cache at ctx 4096
  minRamGB: 6,
  // 4096: the card prompt is ~500 tokens and every generation is single-turn
  // (one card prompt, no history), so the ceiling is barely pressed; 4096 keeps
  // headroom without inflating the KV cache.
  ctxSize: 4096,
  runtime: { gpuLayers: 99 }, // ASK for full GPU offload; LocalEngine falls back to CPU (see interface note)
  modelType: 'llm',
  // self-hosted mirror (see MODELS_BASE_URL note)
  modelSrc: REMOTE_ASSETS.base.url,
  remote: REMOTE_ASSETS.base,
  // FULL-PARAMETER SFT — no adapters exist for this model, by design. The v11
  // Tagalog/Bisaya adapters belong to the retired Sailor2 line and do NOT apply.
  loraRemote: {},
  note: 'Needs a 6GB+ phone (2025 budget norm).',
};

/** Short, truthful stats line for a status/about display. */
export const MODEL_STATS_LINE =
  `${ACTIVE_MODEL.displayName} · ${ACTIVE_MODEL.params} · ${ACTIVE_MODEL.quant} · ` +
  `${ACTIVE_MODEL.sizeGB} GB · needs ${ACTIVE_MODEL.minRamGB}GB+ RAM`;

// The bundled int8 semantic-vectors blob + its meta (built by
// rag/scripts/build-vectors.py from the SAME bank version). Cross-package assets
// under the workspace root; Metro packages the .bin, expo-asset reads its bytes.
// vectors-labse.i8.bin is NO LONGER BUNDLED — see REMOTE_ASSETS.vectors above.
import vectorsMeta from '../../assets/rag/vectors-labse.meta.json';

/**
 * On-device semantic embedder (LaBSE) for the hybrid retriever. Runs through the
 * QVAC SDK's `llamacpp-embedding` plugin. LaBSE is BERT-native with CLS pooling
 * and no dense head, so the GGUF == what we benchmarked (raw-CLS). The 384MB Q4
 * GGUF is DOWNLOADED on first run (public HF model, like the LLM) to keep the APK
 * light; only the 49MB vectors blob is bundled.
 *
 * CRITICAL: `pooling:'cls'` + `embdNormalize:2` make the live query vector live in
 * the SAME space as the bundled corpus blob (parity 0.99999, verified). Changing
 * the model/pooling REQUIRES rebuilding the blob with the matching embedder.
 */
export const EMBEDDER = {
  // self-hosted mirror (same as the LLM — see MODELS_BASE_URL)
  modelSrc: REMOTE_ASSETS.embedder.url,
  /** Integrity contract for the download (see the table above). */
  remote: REMOTE_ASSETS.embedder as RemoteAssetSpec,
  modelType: 'llamacpp-embedding' as const,
  // CPU: one short query per turn — avoids the GPU/OpenCL kernel cold-start; the
  // batch corpus embedding (where GPU would help) happens at build time, not here.
  modelConfig: { pooling: 'cls' as const, embdNormalize: 2, device: 'cpu' as const },
  /** vector dimensionality — must match the blob meta. */
  dims: 768 as const,
} as const;

/** The bundled semantic-vectors blob asset (int8) + its build metadata. */
export const VECTORS_META = vectorsMeta as {
  model: string;
  dims: number;
  scale: number;
  count: number;
  langs: ('tl' | 'bis' | 'en')[];
  bankHash: string;
};

// The bundled IMAGE-TAG retrieval blob: one LaBSE vector per bundled 512x512 PNG
// (built by rag/scripts/build-image-vectors.py from the image catalog captions).
// Lets the tutor's free-form `[image: <english desc>]` control token resolve to a
// real bundled illustration on-device (brute-force cosine over ~4k vectors).
import imageVectorsBlobAsset from '../../assets/rag/image-vectors-labse.i8.bin';
import imageVectorsMeta from '../../assets/rag/image-vectors-labse.meta.json';

/** The bundled image-tag vectors blob asset (int8) + its build metadata. */
export const IMAGE_VECTORS_BLOB_ASSET: number = imageVectorsBlobAsset;
export const IMAGE_VECTORS_META = imageVectorsMeta as {
  model: string;
  dims: number;
  scale: number;
  count: number;
  slugs: string[];
};
