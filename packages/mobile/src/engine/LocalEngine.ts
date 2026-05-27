import {
  loadModel,
  completion,
  unloadModel,
  QWEN3_1_7B_INST_Q4,
} from '@qvac/sdk';
import type {
  TutorEngine,
  Message,
  ImageResult,
  RagResult,
  TutorConfig,
} from '@hiraia/shared';

/**
 * LocalEngine implementation using QVAC SDK
 * Runs Qwen3-1.7B locally on-device for privacy and offline capability
 */
export class LocalEngine implements TutorEngine {
  private modelId: string | null = null;
  private isReadyFlag = false;
  private config: TutorConfig | null = null;

  async initialize(config: TutorConfig): Promise<void> {
    try {
      console.log('Loading Qwen3-1.7B model...');

      // Load the Qwen3-1.7B model with Q4 quantization
      this.modelId = await loadModel({
        modelSrc: QWEN3_1_7B_INST_Q4,
        modelConfig: {
          ctx_size: 4096, // Context window size
        },
      });

      this.config = config;
      this.isReadyFlag = true;

      console.log('Qwen3-1.7B model loaded successfully');
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
    // For now, return empty array
    // In the future, we'll implement RAG search over curriculum documents
    throw new Error('RAG search not yet implemented');
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
