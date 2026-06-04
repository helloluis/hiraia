import {
  loadModel,
  completion,
  unloadModel,
  QWEN3_1_7B_INST_Q4,
} from '@qvac/sdk';
import { ACTIVE_MODEL } from '../config/model';
import type {
  TutorEngine,
  Message,
  ImageResult,
  RagResult,
  TutorConfig,
  Language,
} from '@hiraia/shared';
import { RagStore } from '@hiraia/shared';

/**
 * LocalEngine implementation using QVAC SDK.
 * Runs the configured Hiraia model (ACTIVE_MODEL — Sailor2-3B by default)
 * locally on-device for privacy and offline capability.
 */
export class LocalEngine implements TutorEngine {
  private modelId: string | null = null;
  private isReadyFlag = false;
  private config: TutorConfig | null = null;
  // In-memory grounding bank (295 curated science facts). Built at init; no
  // native deps, so it works in Expo Go and offline.
  private rag: RagStore | null = null;

  async initialize(config: TutorConfig): Promise<void> {
    try {
      console.log(`Loading ${ACTIVE_MODEL.displayName} model...`);

      if (ACTIVE_MODEL.modelSrc) {
        // Load the configured GGUF from its source (an https HuggingFace URL,
        // downloaded + cached by QVAC on first run). The string-source overload
        // needs an explicit modelType. `lora`, when set, applies our fine-tuned
        // Tagalog/Bisaya adapter; without it the base model runs.
        this.modelId = await loadModel({
          modelSrc: ACTIVE_MODEL.modelSrc,
          modelType: ACTIVE_MODEL.modelType,
          modelConfig: {
            ctx_size: ACTIVE_MODEL.ctxSize,
            ...(ACTIVE_MODEL.loraSrc ? { lora: ACTIVE_MODEL.loraSrc } : {}),
          },
          onProgress: (p) =>
            console.log(
              `[LocalEngine] ${ACTIVE_MODEL.displayName} loading: ${Math.round(p.percentage ?? 0)}%`
            ),
        });
      } else {
        // No source configured — load a stock SDK model as a placeholder so the
        // app still runs.
        console.warn(
          `[LocalEngine] ${ACTIVE_MODEL.displayName} has no modelSrc — loading a stock SDK model as a placeholder.`
        );
        this.modelId = await loadModel({
          modelSrc: QWEN3_1_7B_INST_Q4,
          modelConfig: { ctx_size: ACTIVE_MODEL.ctxSize },
        });
      }

      this.config = config;

      // Build the grounding retriever (cheap: indexes ~295 short facts in RAM).
      this.rag = new RagStore();
      console.log(`RAG bank ready: ${this.rag.size} facts`);

      this.isReadyFlag = true;

      console.log(`${ACTIVE_MODEL.displayName} model loaded successfully`);
    } catch (error) {
      console.error('Failed to load model:', error);
      throw new Error(
        `Failed to initialize LocalEngine: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async *chat(messages: Message[]): AsyncIterable<string> {
    if (!this.modelId || !this.isReadyFlag) {
      throw new Error('Engine not initialized. Call initialize() first.');
    }

    try {
      // Convert our Message format to QVAC's expected format
      const history = messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Get streaming completion from QVAC
      const run = completion({
        modelId: this.modelId,
        history,
        stream: true,
      });

      // Yield each token as it's generated
      for await (const event of run.events) {
        if (event.type === 'contentDelta' && event.text) {
          yield event.text;
        }
      }
    } catch (error) {
      console.error('Error during chat completion:', error);
      throw new Error(
        `Chat inference failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  async generateVisual(prompt: string): Promise<ImageResult> {
    // For now, return a placeholder
    // In the future, we'll integrate with an image generation model
    throw new Error('Visual generation not yet implemented');
  }

  async embed(text: string): Promise<number[]> {
    // For now, return empty array
    // In the future, we'll integrate with an embedding model for RAG
    throw new Error('Embedding not yet implemented');
  }

  async ragSearch(query: string, topK: number): Promise<RagResult[]> {
    if (!this.rag) return [];
    const language: Language = this.config?.language ?? 'english';
    // Only confidently-relevant hits — a 1B is misled by loosely-related facts.
    const hits = this.rag.retrieveForGrounding(query, language, topK);
    return hits.map((h) => ({
      content: h.text,
      source: h.fact.source,
      score: h.score,
      metadata: { id: h.fact.id, topic: h.fact.topic, domain: h.fact.domain },
    }));
  }

  isReady(): boolean {
    return this.isReadyFlag;
  }

  async shutdown(): Promise<void> {
    if (this.modelId) {
      try {
        await unloadModel({ modelId: this.modelId });
        console.log('Model unloaded successfully');
      } catch (error) {
        console.error('Error unloading model:', error);
      }
      this.modelId = null;
      this.isReadyFlag = false;
    }
  }
}
