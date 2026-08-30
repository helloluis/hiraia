/**
 * On-device model configuration (single source of truth for the mobile build).
 *
 * ONE device target (2026-08-29): the **Sailor2-3B**, full GPU/Vulkan offload,
 * on a phone with **6 GB+ RAM** — the norm on a 2025-class budget handset, even
 * sub-₱10k. The second "kitten" tier (Sailor2-1B, CPU-only, 4 GB devices) has
 * been RETIRED: it needed its own adapter, its own native-library configuration
 * and its own APK, and the 1B could not carry the safety/myth behaviour the
 * tutor has to get right (see `finetuning/eval/` and the kitten findings — the
 * experiment is kept there as a record, it just no longer ships).
 *
 * The model leans on the on-device RAG bank for the specifics no model can know
 * (exact values, PH/DepEd curriculum framing, Hiraia self-knowledge).
 *
 * Mirrors the web demo's MODEL_INFO (packages/web/src/config/model.ts), which
 * already runs Sailor2-3B + the Tagalog/Bisaya LoRA adapters server-side.
 */

import type { RemoteAssetSpec } from '../engine/modelDownload';

// SELF-HOSTED MODEL MIRROR. HuggingFace migrated large GGUFs to its "Xet" CDN
// (302 → cas-bridge.xethub.hf.co), which QVAC's downloader can't finish — it
// reproducibly dies at ~85%. So instead of downloading from HF, we serve the GGUFs
// from our own nginx (a plain static file with byte-range support, which QVAC
// downloads + caches on first run, then loads from cache offline). It is a
// VERIFIABLE MIRROR of the PUBLIC base model — inference stays 100% on-device, so
// the privacy story is intact. Files live at /var/www/hiraia-models on the VPS,
// served at https://hiraia.b11.dev/models/. Recheck HF/Xet ~2026-06-21 (if fixed,
// switch back to the HF URL and retire the mirror — see hiraia-hf-xet-recheck).
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
 * NATIVELY and STREAMING (DigestUtils over a FileInputStream), so hashing 3.23 GB
 * costs one disk read and constant memory. There is no streaming SHA-256 reachable
 * from the JS thread — `expo-crypto` is not installed and its API takes a string,
 * which a 3.23 GB file cannot be. SHA-256 is recorded alongside anyway so the
 * values can be re-verified off-device.
 *
 * The SHA-256 column below is the same digest published for these files; MD5 was
 * measured from the exact bytes the mirror serves. To re-derive any row:
 *     curl -sO https://hiraia.b11.dev/models/<name>
 *     stat -f%z <name>; md5 -q <name>; shasum -a 256 <name>
 *
 *  Sailor2-3B-Chat.Q4_K_M.gguf  3227563808 B
 *      sha256 5dd6d16a367424e5e0056536efca2a2d30c3f9deab26810e417426f5422b8c62
 *  labse.Q4_K_M.gguf             383762048 B
 *      sha256 3869330197b5a583afc572104bf93393e384c72473a15c2dae43cab43e194b3e
 *  adapter-tagalog-v11.gguf      106772928 B
 *      sha256 4dd919fad41092514401e09b51abf64b4c3a4c43262542dcb17e8fec1bc01651
 *  adapter-bisaya-v11.gguf       106772928 B
 *      sha256 2fdb08ee26394c722a79bb728a48f5679a5de0ba46c9df8962c8603ef074cd0e
 *
 * VERSIONING: the on-device cache keys on FILENAME only. Changing an asset's
 * CONTENT therefore requires a new filename (`-v11` → `-v12`) or existing installs
 * keep the old file forever. Bump the filename AND the digests together.
 */
export const REMOTE_ASSETS = {
  /** The base GGUF — the ~3.23 GB first-run download. */
  base: {
    url: `${MODELS_BASE_URL}/Sailor2-3B-Chat.Q4_K_M.gguf`,
    filename: 'Sailor2-3B-Chat.Q4_K_M.gguf',
    bytes: 3227563808,
    md5: 'a7b8f147b7ca995bb64fa59216740457',
    label: 'Sailor2-3B base',
  },
  /** LaBSE embedder for the hybrid retriever (background download). */
  embedder: {
    url: `${MODELS_BASE_URL}/labse.Q4_K_M.gguf`,
    filename: 'labse.Q4_K_M.gguf',
    bytes: 383762048,
    md5: '2667f69edfbcb68acf617187fe817fae',
    label: 'LaBSE embedder',
  },
  /** Tagalog LoRA (also serves English — see LocalEngine.resolveAdapterPath). */
  adapterTagalog: {
    url: `${MODELS_BASE_URL}/adapter-tagalog-v11.gguf`,
    filename: 'adapter-tagalog-v11.gguf',
    bytes: 106772928,
    md5: '9730e560faf56e8936e6cd5ef2d6038d',
    label: 'Tagalog adapter v11',
  },
  /** Bisaya/Cebuano LoRA. */
  adapterBisaya: {
    url: `${MODELS_BASE_URL}/adapter-bisaya-v11.gguf`,
    filename: 'adapter-bisaya-v11.gguf',
    bytes: 106772928,
    md5: 'da082f56e84c173cb1c124c4923fe7dc',
    label: 'Bisaya adapter v11',
  },
} satisfies Record<string, RemoteAssetSpec>;

/** Identifier for the shipping on-device model. One tier, one member. */
export type OnDeviceModelKey = 'sailor2-3b';

/**
 * Languages that have their OWN fine-tuned adapter. English has no separate
 * LoRA — LocalEngine routes it through the tagalog adapter (measured better
 * than the base model on the English capability probes, 3.75 vs 1.78 / 5).
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
  /** Per-language LoRA adapter size (MiB). */
  adapterSizeMB: number;
  /** Inference context window. */
  ctxSize: number;
  /**
   * Runtime placement, kept here rather than hard-coded in the engine so the
   * placement travels with the model it was measured for. Full GPU/Vulkan
   * offload (gpuLayers 99): the 2026-06-15 CPU-vs-GPU A/B on the target Adreno
   * had the GPU win PREFILL decisively (~24s vs ~40–50s), and prefill dominates
   * TTFT. libqvac-ggml-vulkan.so is therefore load-bearing — do not strip the
   * Vulkan/OpenCL backends out of the APK.
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
   * Per-language fine-tuned LoRA adapters, DOWNLOADED from the mirror (v11) and
   * verified against the integrity table above, exactly like the base model. The
   * engine resolves the one matching the active language and passes its local path
   * as `modelConfig.lora`. English rides the TAGALOG adapter (see
   * LocalEngine.resolveAdapterPath). Empty = no adapters yet.
   *
   * These used to be Metro-bundled assets inside the APK. They are remote now, so
   * they get the same verification as every other downloaded byte — QVAC's own
   * loader CANNOT do this for us: `modelConfig.lora` is a bare string that the
   * llama.cpp plugin never resolves (it only resolves `projectionModelSrc`), so an
   * https value there is handed straight to the addon and fails to open.
   */
  loraRemote: Partial<Record<AdapterLanguage, RemoteAssetSpec>>;
  note: string;
}

/** The model the on-device build loads. */
export const ACTIVE_MODEL: OnDeviceModel = {
  key: 'sailor2-3b',
  displayName: 'Sailor2-3B',
  params: '~3.6B',
  quant: 'Q4_K_M',
  sizeGB: 3.23, // mradermacher Sailor2-3B-Chat.Q4_K_M.gguf (~2.2 GB resident, mmap'd)
  ramGB: 2.2,
  minRamGB: 6,
  adapterSizeMB: 102,
  // The grounded adapter trains at seq 2048, but the tag-aware grounded system
  // prompt alone is ~1.2k tokens — at ctx 2048 even a few turns overflowed and
  // threw exceed_context_size_error. 4096 gives headroom (base Qwen2.5 supports
  // it; LoRA is context-length-agnostic); chatStore also windows history.
  ctxSize: 4096,
  runtime: { gpuLayers: 99 }, // full GPU/Vulkan offload
  modelType: 'llm',
  // self-hosted mirror (see MODELS_BASE_URL note) — was the HF Xet URL
  modelSrc: REMOTE_ASSETS.base.url,
  remote: REMOTE_ASSETS.base,
  loraRemote: { tagalog: REMOTE_ASSETS.adapterTagalog, cebuano: REMOTE_ASSETS.adapterBisaya },
  note: 'Needs a 6GB+ phone (2025 budget norm).',
};

/** Short, truthful stats line for a status/about display. */
export const MODEL_STATS_LINE =
  `${ACTIVE_MODEL.displayName} · ${ACTIVE_MODEL.params} · ${ACTIVE_MODEL.quant} · ` +
  `${ACTIVE_MODEL.sizeGB} GB · needs ${ACTIVE_MODEL.minRamGB}GB+ RAM`;

// The bundled int8 semantic-vectors blob + its meta (built by
// rag/scripts/build-vectors.py from the SAME bank version). Cross-package assets
// under the workspace root; Metro packages the .bin, expo-asset reads its bytes.
import vectorsBlobAsset from '../../assets/rag/vectors-labse.i8.bin';
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
export const VECTORS_BLOB_ASSET: number = vectorsBlobAsset;
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
