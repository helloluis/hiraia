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
  initialize(config: TutorConfig): Promise<void>;

  /**
   * Generate a streaming response to a conversation.
   * Yields tokens as they are generated for real-time display.
   */
  chat(messages: Message[]): AsyncIterable<string>;

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
   * Search the RAG knowledge base for relevant context.
   */
  ragSearch(query: string, topK: number): Promise<RagResult[]>;

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
