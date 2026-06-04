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

export type OnDeviceModelKey = 'sailor2-3b' | 'sailor2-1b';

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
  /**
   * QVAC `modelSrc` for the base GGUF (registry id, URL, or on-device path).
   * NULL until the Sailor2 GGUF is bundled/downloaded — LocalEngine falls back
   * to a stock SDK model as a placeholder so the app still runs. This is the
   * main remaining integration (see NEXT in hiraia-mobile-ondevice memory).
   */
  modelSrc: string | null;
  note: string;
}

export const ON_DEVICE_MODELS: Record<OnDeviceModelKey, OnDeviceModel> = {
  // PRIMARY — current target. Quality close to the web demo, on-device.
  'sailor2-3b': {
    key: 'sailor2-3b',
    displayName: 'Sailor2-3B',
    params: '~3.6B',
    quant: 'Q4_K_M',
    sizeGB: 3.0, // measured: 3.01 GiB file (~2.2 GB resident, mmap'd)
    ramGB: 2.2,
    minRamGB: 6,
    adapterSizeMB: 102,
    // v3 LoRAs were trained at ctx 1024; 2048 gives room for the RAG grounding
    // block + a few turns. Extending further (RoPE) risks quality drift on these
    // adapters — retrain at longer ctx if we need bigger windows.
    ctxSize: 2048,
    modelSrc: null,
    note: 'Primary target — needs a 6GB+ phone (2025 budget norm).',
  },
  // LOW-END FALLBACK — pursue under the accessibility grant for 4GB devices.
  'sailor2-1b': {
    key: 'sailor2-1b',
    displayName: 'Sailor2-1B',
    params: '~1B',
    quant: 'Q4_K_M',
    sizeGB: 0.74, // measured: 739 MB base (bartowski/Sailor2-1B-Chat-GGUF)
    ramGB: 1.0,
    minRamGB: 4,
    adapterSizeMB: 141,
    ctxSize: 1024, // trained ctx; keep prompts tight on this tier
    modelSrc: null,
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
