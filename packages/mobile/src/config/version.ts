import type { Language } from '@hiraia/shared';
import { ACTIVE_MODEL_KEY } from './model';

/**
 * Component versions surfaced in Settings. Each part of Hiraia ships and updates
 * INDEPENDENTLY — the on-device base model, the per-language fine-tuned adapters,
 * and the "Hiraiapedia" science databank — so we version them separately. This is
 * what lets us push piecemeal over-the-air updates later (e.g. a databank-only
 * refresh, or new adapters, without re-shipping the whole 3GB model). Bump the
 * relevant constant whenever that component changes.
 */

/**
 * The curated science databank (the fact bank + its bundled semantic vectors).
 * 1.1.0: quiz-recall expansion to ~40k trilingual facts (inventors, named constants,
 * planetary stats, world/PH records, historical firsts) — the discrete who/what/how-much
 * layer kids get asked in quizzes. Bundled in BOTH tiers.
 */
export const HIRAIAPEDIA_VERSION = '1.1.0';

/**
 * The per-language LoRA build applied on top of the base model. English runs through
 * the Tagalog adapter (no separate English LoRA). Bump when a new adapter ships.
 *
 * Tier-aware: cat (Sailor2-3B) and kitten (Sailor2-1B) are the SAME app code built
 * with a different ACTIVE_MODEL_KEY, but they carry DIFFERENT adapters — so the
 * "tagalog" string is resolved per tier to stay honest in Settings.
 */
const TAGALOG_ADAPTER =
  ACTIVE_MODEL_KEY === 'sailor2-1b'
    ? 'kitten v7 · + English bucket' // Sailor2-1B (r16/a16, mirror-downloaded): adds an English bucket so English-mode queries answer in English (fixes the v6 English-answered-in-Tagalog regression) atop the focused ~4k-row v5/v6 lineage.
    : 'v10 · intent + grounded + multi-turn'; // distill-sailor-3b-v10 (r32, f16, md5 eb8069dd): multi-turn confirm-and-build (P4) + faithful settled-science confidence (P3) + smoking-safety negation fix, atop v3's intent + grounding-faithfulness + image-tags; gate green. NOTE: [image:] emission still evaporates on the GGUF path (needs a conversion fix, not data).

export const ADAPTER_VERSION: Record<Language, string> = {
  tagalog: TAGALOG_ADAPTER,
  cebuano: 'v3 · beta',
  english: '— (via Tagalog adapter)',
};
