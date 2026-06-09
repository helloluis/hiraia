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
  tagalog: 'v6 · grounded · rebalanced',
  cebuano: 'v3 · beta',
  english: '— (base model)',
};
