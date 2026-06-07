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
