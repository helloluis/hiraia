import { create } from 'zustand';

import type { TutorEngine, TutorConfig, Language } from '@hiraia/shared';

import { ACTIVE_MODEL } from '../config/model';
import { getSetting, setSetting } from '../db/repo';
import { LocalEngine } from '../engine/LocalEngine';

interface EngineState {
  engine: TutorEngine | null;
  isReady: boolean;
  error: string | null;
  /** Active tutor language. null until the user picks one (first launch). */
  language: Language | null;
  /** True once the saved-language lookup has completed (gates the picker). */
  bootstrapped: boolean;
  loadingProgress: number;
  /** Read the saved language and, if present, load the engine for it. */
  bootstrap: () => Promise<void>;
  /** Persist + (re)load the engine for a language. Used by the first-launch
   *  picker and the Settings selector. Reloads the model (adapter swap). */
  changeLanguage: (language: Language) => Promise<void>;
  shutdown: () => Promise<void>;
}

function buildConfig(language: Language): TutorConfig {
  return {
    language, // drives the bundled LoRA adapter (TL/BIS) or base model (EN) + RAG language
    gradeLevel: 7,
    modelConfig: {
      modelId: ACTIVE_MODEL.key,
      modelType: 'llm',
      device: 'gpu',
      ctxSize: ACTIVE_MODEL.ctxSize,
    },
    enableVisuals: false,
    enableRag: true, // grounded on the curated science-fact bank (RagStore), scoped to `language`
  };
}

export const useEngineStore = create<EngineState>((set, get) => ({
  engine: null,
  isReady: false,
  error: null,
  language: null,
  bootstrapped: false,
  loadingProgress: 0,

  bootstrap: async () => {
    let saved: Language | null = null;
    try {
      saved = (await getSetting('language')) as Language | null;
    } catch (e) {
      console.warn('[engineStore] reading saved language failed:', e);
    }
    set({ language: saved, bootstrapped: true });
    // No saved language → first launch; the picker will call changeLanguage().
    if (saved) await get().changeLanguage(saved);
  },

  changeLanguage: async (language: Language) => {
    if (get().engine && get().language === language && get().isReady) return; // no-op
    try {
      // Persist first so a crash mid-reload still remembers the choice.
      await setSetting('language', language);
      const prev = get().engine;
      set({ language, isReady: false, error: null, loadingProgress: 0 });
      if (prev) {
        try {
          await prev.shutdown();
        } catch (e) {
          console.warn('[engineStore] shutdown before reload failed:', e);
        }
      }
      const engine = new LocalEngine();
      await engine.initialize(buildConfig(language), (p) => {
        set({ loadingProgress: p });
      });
      set({ engine, isReady: true, loadingProgress: 100 });
      console.log(`QVAC engine ready (${language})`);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize engine',
        isReady: false,
        loadingProgress: 0,
      });
      console.error('Failed to (re)initialize QVAC engine:', error);
    }
  },

  shutdown: async () => {
    const { engine } = get();
    if (engine) {
      await engine.shutdown();
      set({ engine: null, isReady: false });
    }
  },
}));
