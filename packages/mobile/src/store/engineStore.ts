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
  /** Model warm-up progress 0–100, driven into the LoaderOverlay. */
  loadingProgress: number;
  /** Whether the onboarding carousel is showing. True on first launch (no saved
   *  language) and whenever Settings → "show tutorial" re-triggers it. */
  onboardingActive: boolean;
  setOnboardingActive: (active: boolean) => void;
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
  onboardingActive: false,

  setOnboardingActive: (active: boolean) => set({ onboardingActive: active }),

  bootstrap: async () => {
    let saved: Language | null = null;
    try {
      saved = (await getSetting('language')) as Language | null;
    } catch (e) {
      console.warn('[engineStore] reading saved language failed:', e);
    }
    // First launch (no saved language) → show the onboarding carousel; its slide-1
    // pick calls changeLanguage() which starts the model download in the background.
    set({ language: saved, bootstrapped: true, onboardingActive: !saved });
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

      // Progress is NOT a single linear signal. loadModel's onProgress reports the
      // DOWNLOAD percentage — meaningful only on a genuine first-run download; when the
      // GGUF is already cached it jumps straight to 100 instantly. The slow, unobservable
      // work (loading ~2GB into RAM + the warm-up prefill) emits no granular signal.
      //
      // The loader's wake→stretch→walk-off is two ~10s videos (~20s total) and must
      // OVERLAP the final load — start the wake at ~85% while loading still finishes —
      // not play as dead time after the model is ready. So we drive the bar on a time
      // ESTIMATE: ease 0→84 (under the 85% wake gate) during load, then at
      // EXPECTED_TOTAL_MS − ANIM_MS cross 85 to start the wake and climb toward ~99
      // across the animation window (crossing the 95% exit gate right as the wake video
      // ends). The estimate only tunes how well the animation overlaps the tail —
      // correctness is guaranteed by gating the loader's final dismiss on isReady (see
      // LoaderOverlay). If the model is ready EARLY, the snap-to-100 below starts the
      // wake immediately; if LATE, the loader holds on the last exit frame until ready.
      const EXPECTED_TOTAL_MS = 48000; // ~cached load + warm-up prefill on the target device
      const ANIM_MS = 20000; // wake (~10s) + exit (~10s)
      const WAKE_AT_MS = Math.max(0, EXPECTED_TOTAL_MS - ANIM_MS);
      const LOAD_CEIL = 84; // stay under the 85% wake gate during the load phase
      const startedAt = Date.now();
      let sawRealDownload = false;
      let downloadFloor = 0;
      let ready = false;
      const ramp = setInterval(() => {
        if (ready) return;
        const elapsed = Date.now() - startedAt;
        let pct: number;
        if (elapsed < WAKE_AT_MS) {
          const eased = LOAD_CEIL * (1 - Math.exp(-elapsed / (WAKE_AT_MS / 2.2)));
          pct = Math.min(LOAD_CEIL, Math.max(eased, downloadFloor));
        } else {
          const into = Math.min(ANIM_MS, elapsed - WAKE_AT_MS);
          // 85 → 96 over the ~10s wake video (crosses the 95 exit gate as it ends),
          // then 96 → 99 over the ~10s exit video. Never hits 100 on the timer alone.
          pct = into < 10000 ? 85 + (into / 10000) * 11 : 96 + ((into - 10000) / 10000) * 3;
        }
        set({ loadingProgress: Math.round(pct) });
      }, 200);

      try {
        await engine.initialize(buildConfig(language), (p) => {
          // A value strictly inside the endpoints proves a genuine download is streaming;
          // a lone 100 means "already cached" and must not move the bar.
          if (p > 1 && p < 99) sawRealDownload = true;
          if (sawRealDownload) downloadFloor = Math.min(55, Math.round((p / 100) * 55));
        });
      } finally {
        ready = true;
        clearInterval(ramp);
      }

      // Model is genuinely ready: drive to 100 so the loader can finish wake→exit and
      // dismiss. If the animation hasn't started yet (model beat the estimate), this is
      // what triggers the wake.
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
