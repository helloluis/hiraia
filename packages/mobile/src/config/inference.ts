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

/**
 * GPU layers to offload (llama.cpp convention: 99 = "all"). Without this QVAC uses its
 * default, which left part of the 3B on CPU (slow decode). Full Vulkan/Adreno offload on
 * a 6GB+ device. If a low-end GPU ever fails to load, lower this.
 */
// Full GPU offload (99 = all layers). RESULT of the 2026-06-15 CPU-vs-GPU A/B on this
// flagship SM8850 (Adreno): GPU wins PREFILL decisively (~24s vs ~40–50s on full CPU i8mm),
// CPU only wins decode (~6 vs ~4 tok/s). Since prefill dominates TTFT, GPU stays. The
// research's "CPU beats mobile-GPU prefill" holds for weak Mali GPUs, NOT this Adreno. The
// real TTFT lever is fewer PREFILLED TOKENS (prompt/RAG compression + KV stable-history),
// not the backend. The only other QVAC LLM knob is `device` (untested).
export const GPU_LAYERS = 99;
