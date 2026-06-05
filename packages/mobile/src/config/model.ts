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
    // v3 LoRAs were trained at ctx 1024; 2048 gives room for the RAG grounding
    // block + a few turns. Extending further (RoPE) risks quality drift on these
    // adapters — retrain at longer ctx if we need bigger windows.
    ctxSize: 2048,
    modelType: 'llm',
    modelSrc:
      'https://huggingface.co/mradermacher/Sailor2-3B-Chat-GGUF/resolve/main/Sailor2-3B-Chat.Q4_K_M.gguf',
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
