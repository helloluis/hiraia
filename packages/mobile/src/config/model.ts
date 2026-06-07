/**
 * On-device model configuration (single source of truth for the mobile build).
 *
 * Strategy (2026-06-05): ship the **Sailor2-3B** for "good overall quality" on a
 * 2025-class budget phone (6GB+ RAM is now the norm even sub-₱10k), grounded by
 * the on-device RAG bank. The **Sailor2-1B** build is kept as a first-class
 * low-end fallback for 4GB devices — the path to pursue under the accessibility
 * grant to reach the most underserved hand-me-down phones. Both lean on RAG: for
 * the 1B it's a correctness lifeline; for the 3B it supplies specifics no model
 * can know (exact values, PH/DepEd curriculum framing, Hiraia self-knowledge).
 *
 * Mirrors the web demo's MODEL_INFO (packages/web/src/config/model.ts), which
 * already runs Sailor2-3B + the Tagalog/Bisaya LoRA adapters server-side.
 */

// Bundled LoRA adapter GGUFs (the Filipino fine-tune — the core value, shipped
// IN the APK, not downloaded). Metro packages these as assets; LocalEngine
// resolves them to an on-device path via expo-asset for QVAC's modelConfig.lora.
import adapterTagalog from '../../assets/models/adapter-tagalog.gguf';
import adapterBisaya from '../../assets/models/adapter-bisaya.gguf';

// LOCAL-MODEL MODE: HuggingFace migrated large GGUFs to its "Xet" CDN
// (302 → cas-bridge.xethub.hf.co), which QVAC's downloader can't finish — it
// reproducibly dies at ~85%. So we DON'T download: the GGUFs are adb-pushed over
// USB to the app's external files dir and loaded from there (modelSrc = a local
// absolute path, which loadModel accepts directly). No network, no Xet, no stall.
// Push target (USB):  adb push <gguf> /sdcard/Android/data/com.hiraia.app/files/models/
const LOCAL_MODELS_DIR = '/storage/emulated/0/Android/data/com.hiraia.app/files/models';

export type OnDeviceModelKey = 'sailor2-3b' | 'sailor2-1b';

/** Languages that have a fine-tuned adapter (English uses the base model). */
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
  /** Recommended device-RAM floor. */
  minRamGB: number;
  /** Per-language LoRA adapter size (MiB). */
  adapterSizeMB: number;
  /** Inference context window. */
  ctxSize: number;
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
   * Per-language fine-tuned LoRA adapters, BUNDLED IN THE APK (the core value —
   * shipped offline, not downloaded). Values are Metro asset module ids; the
   * engine resolves the one matching the active language to a file path via
   * expo-asset and passes it as `modelConfig.lora`. English uses the base model
   * (no entry). Empty = no adapters for this model yet.
   */
  loraAssets: Partial<Record<AdapterLanguage, number>>;
  note: string;
}

export const ON_DEVICE_MODELS: Record<OnDeviceModelKey, OnDeviceModel> = {
  // PRIMARY — current target. Quality close to the web demo, on-device.
  'sailor2-3b': {
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
    modelType: 'llm',
    // local file pushed over USB (see LOCAL_MODELS_DIR note) — was the HF Xet URL
    modelSrc: `${LOCAL_MODELS_DIR}/Sailor2-3B-Chat.Q4_K_M.gguf`,
    loraAssets: { tagalog: adapterTagalog, cebuano: adapterBisaya }, // f16, bundled (~102MB each)
    note: 'Primary target — needs a 6GB+ phone (2025 budget norm).',
  },
  // LOW-END FALLBACK — pursue under the accessibility grant for 4GB devices.
  'sailor2-1b': {
    key: 'sailor2-1b',
    displayName: 'Sailor2-1B',
    params: '~1B',
    quant: 'Q4_K_M',
    sizeGB: 0.74, // ~739 MB base (bartowski/Sailor2-1B-Chat-GGUF)
    ramGB: 1.0,
    minRamGB: 4,
    adapterSizeMB: 141,
    ctxSize: 1024, // trained ctx; keep prompts tight on this tier
    modelType: 'llm',
    // TODO: confirm exact bartowski filename before relying on the 4GB build.
    modelSrc:
      'https://huggingface.co/bartowski/Sailor2-1B-Chat-GGUF/resolve/main/Sailor2-1B-Chat-Q4_K_M.gguf',
    loraAssets: {}, // 1B v3 adapters are still safetensors — convert to GGUF before the 4GB build
    note: 'Low-end/4GB fallback — leans hard on RAG; science accuracy is shaky solo.',
  },
};

/** The model the on-device build loads. Flip to 'sailor2-1b' for the 4GB path. */
export const ACTIVE_MODEL_KEY: OnDeviceModelKey = 'sailor2-3b';
export const ACTIVE_MODEL: OnDeviceModel = ON_DEVICE_MODELS[ACTIVE_MODEL_KEY];

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
  // local file pushed over USB (same Xet-CDN workaround as the LLM)
  modelSrc: `${LOCAL_MODELS_DIR}/labse.Q4_K_M.gguf`,
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
