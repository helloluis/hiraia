/**
 * Single source of truth for the deployed model + adapters.
 * Drives the status bar (display stats) and the inference wiring
 * (server model id + per-language LoRA selection + system prompts).
 */

export const MODEL_INFO = {
  /** Friendly name shown in the status bar. */
  displayName: 'Sailor2-3B',
  /** What the model has been adapted for (status bar subtitle). */
  tagline: 'Fine-tuned with Filipino & Bisaya adapters',
  /** Underlying base architecture. */
  arch: 'Qwen2 / SEA-grounded',
  /** Approx parameter count. */
  params: '~3.6B',
  /** On-device deployment quantization. */
  quant: 'Q4_K_M',
  /** Quantized base size on disk/RAM (GB) — the mradermacher Q4_K_M build we serve. */
  baseSizeGB: 3.0,
  /** Each LoRA adapter size (MB). */
  adapterSizeMB: 102,
  /**
   * Model id sent to the QVAC/llama.cpp server in the `model` field.
   * Match this to however your server advertises the model (often the
   * gguf filename stem). Most llama.cpp servers ignore/echo this, so the
   * value that actually changes behavior is the per-request `lora` below.
   */
  serverModelId: 'sailor2-3b-chat',
} as const;

export type LanguageKey = 'english' | 'tagalog' | 'cebuano';

/**
 * Per-language config. `loraId` is the index of the adapter as loaded by the
 * server, e.g. launching with:
 *   llama-server -m sailor2-3b-chat.gguf \
 *     --lora adapter-sailor-tagalog-f16.gguf \   # -> id 0
 *     --lora adapter-sailor-bisaya-f16.gguf      # -> id 1
 * English uses no adapter (base model handles English fine).
 */
export const LANGUAGES: Record<LanguageKey, {
  label: string;
  adapterLabel: string;
  loraId: number | null;
  system: string;
}> = {
  english: {
    label: 'English',
    adapterLabel: 'base model (no adapter)',
    loraId: null,
    system:
      'You are Hiraia, a friendly science tutor for Filipino students (grades 3-10). ' +
      'Explain concepts simply and correctly for the age, use the Socratic method, and ' +
      'keep answers short (a few sentences). End with one guiding follow-up question.',
  },
  tagalog: {
    label: 'Tagalog',
    adapterLabel: 'Tagalog adapter',
    loraId: 0,
    // Exact system prompt used during fine-tuning / eval.
    system:
      'Ikaw si Hiraia, isang AI tutor na tumutulong sa mga estudyanteng Pilipino na ' +
      'matuto ng Science. Gumagamit ka ng Socratic method at natural na Tagalog.',
  },
  cebuano: {
    label: 'Cebuano (Bisaya)',
    adapterLabel: 'Bisaya adapter',
    loraId: 1,
    system:
      'Ikaw si Hiraia, usa ka AI tutor nga nagtabang sa mga estudyanteng Pilipino nga ' +
      'makat-on og Science. Naggamit ka og Socratic method ug natural nga Bisaya.',
  },
};

/** All adapter ids the server is expected to have loaded (derived from LANGUAGES). */
export const ALL_LORA_IDS: number[] = Object.values(LANGUAGES)
  .map((l) => l.loraId)
  .filter((id): id is number => id !== null);

/**
 * Build the full per-request `lora` scale array for a language: the selected
 * adapter at scale 1.0, every other loaded adapter explicitly at 0.0 (so a
 * server that loaded all adapters at default scale 1.0 doesn't stack them).
 * English (loraId null) yields all-zero -> base model.
 */
export function loraScalesFor(language: LanguageKey): Array<{ id: number; scale: number }> {
  const active = LANGUAGES[language]?.loraId ?? null;
  return ALL_LORA_IDS.map((id) => ({ id, scale: id === active ? 1.0 : 0.0 }));
}

/** Short stats string for the status bar. */
export const MODEL_STATS_LINE =
  `${MODEL_INFO.params} params · ${MODEL_INFO.quant} (~${MODEL_INFO.baseSizeGB} GB) ` +
  `· +${MODEL_INFO.adapterSizeMB} MB adapter · runs on-device`;
