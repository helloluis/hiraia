/**
 * On-device sampling config. Kept in its own file (not model.ts) so it can be
 * tuned and committed without touching the model source paths.
 */

/**
 * Chat-reply temperature. Lowered from the llama.cpp default (~0.8, which the
 * device inherits when no temp is set) to 0.5 after the temperature sweep
 * (finetuning/eval/harness/temp-sweep.mts): 0.8 added factual wandering /
 * confabulation with no pedagogical upside — the warmth and persona come from the
 * fine-tune and the system prompt, not the sampling temperature. 0.5 keeps enough
 * natural variation to not feel robotic while tightening accuracy. (Going to 0
 * makes long chats repetitive.)
 */
export const CHAT_TEMP = 0.5;

/**
 * Auto-compaction summaries should be FAITHFUL recaps, not creative — so sample
 * greedily (temp 0) for a deterministic, on-the-facts memory line.
 */
export const SUMMARY_TEMP = 0;

/**
 * Cap on generated tokens per reply. On-device 3B decode is ~1–5 tok/s (slower when
 * thermal-throttled after the big first-run download), so an UNBOUNDED open-ended reply
 * ("kwentuhan mo ako tungkol sa dinosaur") could run 5+ minutes. 220 keeps a full
 * 2–3-paragraph tutor answer + Socratic question while bounding the worst case — and
 * shorter replies suit a grade-schooler anyway.
 */
export const CHAT_MAX_TOKENS = 220;

// NB: GPU offload is NOT configured here. It travels with the model that was measured
// for it — config/model.ts ACTIVE_MODEL.runtime.gpuLayers (99 = all layers). This file
// used to export a second, unread GPU_LAYERS constant that could silently disagree with it.
