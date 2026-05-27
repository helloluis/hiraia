import { create } from 'zustand';
import { LocalEngine } from '../engine/LocalEngine';
import type { TutorEngine, TutorConfig } from '@hiraia/shared';

interface EngineState {
  engine: TutorEngine | null;
  isInitialized: boolean;
  isReady: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  shutdown: () => Promise<void>;
}

export const useEngineStore = create<EngineState>((set, get) => ({
  engine: null,
  isInitialized: false,
  isReady: false,
  error: null,

  initialize: async () => {
    try {
      const engine = new LocalEngine();

      // Default configuration for Hiraia tutor
      const config: TutorConfig = {
        language: 'english',
        gradeLevel: 7,
        modelConfig: {
          modelId: 'qwen3-1.7b',
          modelType: 'llm',
          device: 'gpu',
          ctxSize: 4096,
        },
        enableVisuals: false, // Will enable when we implement image generation
        enableRag: false, // Will enable when we implement RAG
      };

      await engine.initialize(config);

      set({
        engine,
        isInitialized: true,
        isReady: true,
        error: null,
      });

      console.log('QVAC engine initialized successfully');
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize engine',
      });
      console.error('Failed to initialize QVAC engine:', error);
    }
  },

  shutdown: async () => {
    const { engine } = get();
    if (engine) {
      await engine.shutdown();
      set({
        engine: null,
        isInitialized: false,
        isReady: false,
      });
    }
  },
}));
