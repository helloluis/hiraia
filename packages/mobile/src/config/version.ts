import type { Language } from '@hiraia/shared';

/**
 * Component versions surfaced in Settings. Each part of Hiraia ships and updates
 * INDEPENDENTLY — the on-device base model and the "Hiraiapedia" science
 * databank — so we version them separately. This is what lets us push piecemeal
 * over-the-air updates later (e.g. a databank-only refresh, or a new model
 * revision via a versioned filename, without re-shipping the APK). Bump the
 * relevant constant whenever that component changes.
 */

/**
 * The curated science databank (the fact bank + its bundled semantic vectors).
 * 1.1.0: quiz-recall expansion to ~40k trilingual facts (inventors, named constants,
 * planetary stats, world/PH records, historical firsts) — the discrete who/what/how-much
 * layer kids get asked in quizzes.
 */
export const HIRAIAPEDIA_VERSION = '1.1.0';

/**
 * Per-language fine-tune, as shown in the Settings "Adapter" row. The shipping
 * Hiraia-2B (hiraia-sft-2b-v1) is a FULL-PARAMETER SFT: Tagalog, Cebuano and
 * English all live in the one set of weights, so there is no separate adapter
 * artifact for any language — the row states that honestly instead of a LoRA
 * version.
 *
 * History (Sailor2 line, retired 2026-09-01 — "we're not launching with
 * Sailor2"): tagalog ran distill-sailor-3b-v11 ('v11 · intent + grounded +
 * English-clean', md5 9730e560), cebuano 'v3 · beta', english rode the Tagalog
 * adapter. Those v11 adapter files do not apply to the full-parameter 2B.
 */
const BUILT_IN = 'built-in · full-parameter SFT (hiraia-sft-2b v1)';

export const ADAPTER_VERSION: Record<Language, string> = {
  tagalog: BUILT_IN,
  cebuano: BUILT_IN,
  english: BUILT_IN,
};
