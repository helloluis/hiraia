/**
 * On-device sampling config. Kept in its own file (not model.ts) so it can be
 * tuned and committed without touching the model source paths.
 */

/**
 * Temperature for the throwaway warm-up completion (LocalEngine.warmUp). Its single
 * token is discarded — only the prefill matters — so the value is near-irrelevant; it is
 * kept at the old chat sampling temperature (0.5, chosen in the temperature sweep
 * finetuning/eval/harness/temp-sweep.mts) so the warm-up prefill is unchanged.
 *
 * The temperature that MATTERS is CARD_TEMP in @hiraia/shared (prompts/cards.ts), which
 * both the phone (answerQuery) and the web demo's /api/demo/card use for the one card the
 * model actually writes.
 */
export const WARMUP_TEMP = 0.5;

/**
 * The throwaway prompt the warm-up prefills. The warm-up exists to compile the graph and heat
 * the kernels; nothing downstream reads its KV cache, and neither effect depends on how many
 * tokens go through — so every token here is cold-start time charged to the child for
 * nothing. It used to be a full `buildCardPrompt` (136 tokens), measured at 24.2 s of prefill
 * on the target Redmi's CPU (~5.6 tok/s cold). This is the tail of that same prompt — the
 * card writer's own question/answer scaffold, so the identical code path is exercised — at
 * ~10 tokens. (Luis, 2026-09-05: the first tap's wait was the complaint.)
 */
export const WARMUP_PROMPT = 'TANONG: tubig\n\nSAGOT:';

// NB: GPU offload is NOT configured here. It travels with the model that was measured
// for it — config/model.ts ACTIVE_MODEL.runtime.gpuLayers (99 = all layers). This file
// used to export a second, unread GPU_LAYERS constant that could silently disagree with it.
