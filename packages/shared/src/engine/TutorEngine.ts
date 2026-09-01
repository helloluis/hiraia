import type { ImageResult, RagResult, TutorConfig } from '../types/index.js';

/**
 * Core interface for the AI tutor engine.
 *
 * SINGLE-TURN ONLY. There is no `chat(messages)` here any more: the product has no
 * conversational surface, and the model's whole job is to print ONE card for one typed
 * topic (`answerQuery`) plus the feed's one-line reward (`generateReward`). Both send a
 * single user message and take no history, so an engine implementation needs no notion of
 * a conversation, a turn window, or a per-thread KV cache.
 */
export interface TutorEngine {
  /**
   * Initialize the engine with configuration.
   * This should load models and prepare for inference.
   */
  initialize(config: TutorConfig, onProgress?: (progress: number) => void): Promise<void>;

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
   * Search the RAG knowledge base for relevant context. `context` is an optional
   * low-weight signal that tips an ambiguous query toward a topic without overriding a
   * fresh question; with the chat surface gone the only caller passes none.
   */
  ragSearch(
    query: string,
    topK: number,
    context?: string,
    seenIds?: ReadonlySet<string>
  ): Promise<RagResult[]>;

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
   *
   * `slug` is the card's ILLUSTRATION — a catalog slug the ENGINE resolved from the top
   * grounded fact (curated map, then LaBSE over the image catalog; see @hiraia/shared
   * rag/images.ts). The model is never asked what to draw. Null is the ordinary answer at the
   * measured floor and means the card prints text-only through the poster layout; it is only
   * ever non-null on the grounded outcome. Absent = the engine resolves no pictures at all.
   */
  answerQuery?(
    query: string,
    language: string
  ): Promise<{ text: string; grounded: boolean; offDomain?: boolean; slug?: string | null }>;

  /**
   * Is this query OFF-DOMAIN, judged for a WEAK search hit — one the local card search matched
   * on shared vocabulary rather than subject (see `searchCards`' weak band)? Model-FREE: one
   * embed plus the in-RAM retrieval scan, no generation and no model lock, so it is cheap
   * enough to sit between a weak hit and its serve. Judged on the shared `isOffDomain` gate's
   * OOV arm, because a weak hit IS a query with no lexical evidence that the corpus knows it
   * as a subject.
   *
   * Returns null when it cannot judge (embedder still downloading/warming/failed) — the caller
   * must then SERVE the hit, exactly as it would have before this method existed: never refuse
   * a child a card because a model was missing. Optional — callers feature-detect.
   */
  weakHitOffDomain?(query: string): Promise<boolean | null>;

  /**
   * Resolve a text description to a bundled illustration slug via embedding
   * retrieval over the image catalog. Two intended inputs: (1) an `[image: <english
   * desc>]` control token the model emits, and (2) RETRIEVAL-DRIVEN — the top grounded
   * fact's text, so a picture shows even when the (quant-fragile) model emits no tag.
   * `minCosine` overrides the default confidence floor (the fact path is cross-lingual
   * and wants a lower bar than the English tags). `domain` scopes the candidate images to
   * the grounded fact's science domain so the match can't drift off-topic on a shared word
   * (e.g. earthquake→pangolin). Returns null when nothing matches confidently (better no
   * picture than a wrong one). Optional — callers should feature-detect.
   *
   * KEPT WITH NO CALLER, still deliberately. Illustrating a generated card is BUILT now, but
   * it does not come through here: the card path resolves from the grounded FACT the card
   * states
   * (`answerQuery`'s `slug`), because the settled architecture is that the model does not pick
   * illustrations. This entry point is for the model-supplied description it is shaped for,
   * should one ever be wanted again. See LocalEngine.resolveImageTag.
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
