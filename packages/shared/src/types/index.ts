/**
 * Core types for the Hiraia AI tutor system.
 * These types define the fundamental data structures used throughout the application.
 */

/**
 * Supported languages for the tutor interface and responses.
 * - english: Default language, no LoRA adapter needed
 * - tagalog: Filipino/Tagalog with LoRA adapter
 * - cebuano: Cebuano Bisaya with LoRA adapter
 */
export type Language = 'english' | 'tagalog' | 'cebuano';

/**
 * Grade levels supported by the tutor.
 * Aligned with Philippine K-12 curriculum.
 */
export type GradeLevel = 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/**
 * Represents a single message in a conversation.
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
  metadata?: MessageMetadata;
}

/**
 * Metadata attached to messages for tracking and analytics.
 */
export interface MessageMetadata {
  language?: Language;
  gradeLevel?: GradeLevel;
  topicContext?: string[];
  visualPromptGenerated?: boolean;
}

/**
 * Result from visual/image generation.
 */
export interface ImageResult {
  buffer: Uint8Array;
  prompt: string;
  width: number;
  height: number;
  format: 'png' | 'jpeg';
  generationTimeMs: number;
}

/**
 * Result from RAG search.
 */
export interface RagResult {
  content: string;
  source: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Model configuration for loading AI models.
 */
export interface ModelConfig {
  modelId: string;
  modelType: 'llm' | 'diffusion' | 'embeddings';
  device: 'gpu' | 'cpu';
  ctxSize?: number;
  loraAdapter?: string;
}

/**
 * Tutor configuration combining all settings.
 */
export interface TutorConfig {
  language: Language;
  gradeLevel: GradeLevel;
  modelConfig: ModelConfig;
  enableVisuals: boolean;
  enableRag: boolean;
}

/**
 * Streaming token event from LLM generation.
 */
export interface StreamEvent {
  type: 'token' | 'visual_trigger' | 'error' | 'done';
  data: string;
}

/**
 * Error codes for standardized error handling.
 */
export enum ErrorCode {
  MODEL_NOT_LOADED = 'MODEL_NOT_LOADED',
  MODEL_LOAD_FAILED = 'MODEL_LOAD_FAILED',
  INFERENCE_FAILED = 'INFERENCE_FAILED',
  VISUAL_GENERATION_FAILED = 'VISUAL_GENERATION_FAILED',
  RAG_SEARCH_FAILED = 'RAG_SEARCH_FAILED',
  INVALID_CONFIG = 'INVALID_CONFIG',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Standardized error type for the application.
 */
export interface HiraiaError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  timestamp: Date;
}
