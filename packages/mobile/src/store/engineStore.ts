import { create } from 'zustand';
import { LocalEngine } from '../engine/LocalEngine';
import { ACTIVE_MODEL } from '../config/model';
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
          modelId: ACTIVE_MODEL.key,
          modelType: 'llm',
          device: 'gpu',
          ctxSize: ACTIVE_MODEL.ctxSize,
        },
        enableVisuals: false, // Will enable when we implement image generation
        enableRag: true, // Grounded on the curated science-fact bank (RagStore)
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
