import type { ImageResult, Message, RagResult, TutorConfig } from '../types/index.js';

/**
 * Core interface for the AI tutor engine.
 *
 * This abstraction allows us to have different implementations:
 * - LocalEngine: Runs QVAC SDK directly on-device (mobile)
 * - RemoteEngine: Calls QVAC HTTP server (web demo)
 *
 * Both implementations must conform to this interface, ensuring consistent
 * behavior across platforms.
 */
export interface TutorEngine {
  /**
   * Initialize the engine with configuration.
   * This should load models and prepare for inference.
   */
  initialize(config: TutorConfig, onProgress?: (progress: number) => void): Promise<void>;

  /**
   * Generate a streaming response to a conversation.
   * Yields tokens as they are generated for real-time display.
   * `kvCacheKey` (optional) enables QVAC's on-device KV cache for this conversation:
   * the static system prompt is cached and reused across turns so only the new turn
   * re-prefills (the TTFT fix). Use a stable per-conversation id.
   */
  chat(messages: Message[], kvCacheKey?: string): AsyncIterable<string>;

  /**
   * Generate a visual/image based on a prompt.
   * Used when the tutor determines a concept would benefit from a visual.
   */
  generateVisual(prompt: string): Promise<ImageResult>;

  /**
   * Generate embeddings for text (used for RAG).
   */
  embed(text: string): Promise<number[]>;

  /**
   * Search the RAG knowledge base for relevant context. `context` (recent
   * conversation turns) is an optional low-weight signal that tips ambiguous
   * follow-up queries toward the conversation's topic without overriding a fresh
   * question.
   */
  ragSearch(
    query: string,
    topK: number,
    context?: string,
    seenIds?: ReadonlySet<string>
  ): Promise<RagResult[]>;

  /**
   * Compress a (usually long) assistant answer into a short factual recap, used
   * by the auto-compacter so older turns cost far fewer tokens in context.
   * Optional — callers should feature-detect.
   */
  summarize?(text: string): Promise<string>;

  /**
   * Generate ONE short, warm encouragement sentence for a question-cards "reward"
   * card, naming a few of the topics the child just read. GROUNDED on the provided
   * topic labels — the model writes only the celebratory framing and must NOT add new
   * facts (the caller guards + falls back to a template). Optional — feature-detect.
   */
  generateReward?(topics: string[], count: number, language: string): Promise<string>;

  /**
   * Grounded one-shot FACT CARD for a kid's typed query in the question-cards feed, used as the
   * FALLBACK when the feed's local card search finds nothing (the feed is retrieval-first).
   * Retrieves from the fact bank and states the answer STRICTLY from those facts; returns
   * `grounded:false` when retrieval cannot serve the query so the caller shows an honest
   * miss rather than a hallucination.
   *
   * `offDomain` splits that miss in two: true means the query was not science at all (nothing
   * in the bank shares a single word with it AND it is semantically far from everything), so
   * the caller should say we are only a science tutor instead of offering a science topic.
   * Absent/false = an in-domain gap. Optional — callers should feature-detect both.
   */
  answerQuery?(
    query: string,
    language: string
  ): Promise<{ text: string; grounded: boolean; offDomain?: boolean }>;

  /**
   * Resolve a text description to a bundled illustration slug via embedding
   * retrieval over the image catalog. Used two ways: (1) the tutor's own
   * `[image: <english desc>]` control token, and (2) RETRIEVAL-DRIVEN — the top
   * grounded fact's text, so a picture shows even when the (quant-fragile) model
   * emits no tag. `minCosine` overrides the default confidence floor (the fact path
   * is cross-lingual and wants a lower bar than the English tags). `domain` scopes the
   * candidate images to the grounded fact's science domain so the match can't drift
   * off-topic on a shared word (e.g. earthquake→pangolin). Returns null when nothing
   * matches confidently (better no picture than a wrong one). Optional — callers should
   * feature-detect.
   */
  resolveImageTag?(
    desc: string,
    minCosine?: number,
    domain?: string
  ): Promise<{ slug: string; cosine: number } | null>;

  /**
   * Check if the engine is ready to process requests.
   */
  isReady(): boolean;

  /**
   * Clean up resources and unload models.
   */
  shutdown(): Promise<void>;
}

/**
 * Factory function type for creating engine instances.
 */
export type EngineFactory = (config: TutorConfig) => Promise<TutorEngine>;
