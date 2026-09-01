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
 * The throwaway query + fact the warm-up feeds through `buildCardPrompt`, so the prompt it
 * prefills has the SHAPE the card writer actually sends rather than the shape of the deleted
 * chat surface. Deliberately trivial and short: the warm-up exists to compile the graph and
 * heat the kernels, and nothing downstream reads its KV cache, so every extra token in here
 * is cold-start time charged to the child for nothing.
 */
export const WARMUP_QUERY = 'tubig';
export const WARMUP_FACT = 'Ang tubig ay likido.';

// NB: GPU offload is NOT configured here. It travels with the model that was measured
// for it — config/model.ts ACTIVE_MODEL.runtime.gpuLayers (99 = all layers). This file
// used to export a second, unread GPU_LAYERS constant that could silently disagree with it.
