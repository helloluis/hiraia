import type { Language } from '@hiraia/shared';

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
 * layer kids get asked in quizzes.
 */
export const HIRAIAPEDIA_VERSION = '1.1.0';

/**
 * The per-language LoRA build applied on top of the base model. English runs through
 * the Tagalog adapter (no separate English LoRA). Bump when a new adapter ships.
 */
// distill-sailor-3b-v11 (r32, f16, md5 9730e560): v9plus + a 363-row English bucket that
// fixes the English→Tagalog leak on chitchat/identity/off-topic + Taglish-contaminated
// input (role-play QA 6→0 leaks); keeps v10's intent + grounding + multi-turn; gate green.
// NOTE: [image:] emission still evaporates on the GGUF path (needs a conversion fix, not data).
const TAGALOG_ADAPTER = 'v11 · intent + grounded + English-clean';

export const ADAPTER_VERSION: Record<Language, string> = {
  tagalog: TAGALOG_ADAPTER,
  cebuano: 'v3 · beta',
  english: '— (via Tagalog adapter)',
};
