import type { Language } from '@hiraia/shared';

/**
 * Component versions surfaced in Settings. Each part of Hiraia ships and updates
 * INDEPENDENTLY — the on-device base model, the per-language fine-tuned adapters,
 * and the "Hiraiapedia" science databank — so we version them separately. This is
 * what lets us push piecemeal over-the-air updates later (e.g. a databank-only
 * refresh, or new adapters, without re-shipping the whole 3GB model). Bump the
 * relevant constant whenever that component changes.
 */

/** The curated science databank (the fact bank + its bundled semantic vectors). */
export const HIRAIAPEDIA_VERSION = '1.0.3';

/**
 * The per-language LoRA build applied on top of the base model. English runs the
 * base model with no adapter. Bump when a new adapter ships for that language.
 */
export const ADAPTER_VERSION: Record<Language, string> = {
  tagalog: 'v9 · intent + grounded + multi-turn', // distill-sailor-3b-v4 (r32, f16, md5 a1f563ff): adds multi-turn confirm-and-build (P4) + faithful settled-science confidence (P3, fixes "ilan ang planeta"→confident "8") atop v3's intent + grounding-faithfulness + image-tags; gate green 2026-06-15. NOTE: [image:] emission still evaporates on the GGUF path (v5-cycle issue, needs conversion fix not data) — engagement inconsistent.
  cebuano: 'v3 · beta',
  english: '— (via Tagalog adapter)',
};
