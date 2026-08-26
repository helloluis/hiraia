import { create } from 'zustand';

import type { TutorEngine, TutorConfig, Language } from '@hiraia/shared';

import { LANGUAGE_OPTIONS, DEFAULT_LANGUAGE } from '../config/languages';
import { ACTIVE_MODEL } from '../config/model';
import { getSetting, setSetting } from '../db/repo';
import { LocalEngine } from '../engine/LocalEngine';
import { useChatStore } from './chatStore';

export type LoadingPhase = 'idle' | 'downloading' | 'warming' | 'ready';

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
  /** Which init phase the bar is currently reflecting, so the loader can show
   *  honest copy: 'downloading' = the one-time 3 GB base-model fetch (first run
   *  only); 'warming' = load-into-RAM + the warm-up prefill (every cold start);
   *  'ready' = done; 'idle' = not loading. */
  loadingPhase: LoadingPhase;
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
    gradeLevel: 5,
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
  loadingPhase: 'idle',
  onboardingActive: false,

  setOnboardingActive: (active: boolean) => set({ onboardingActive: active }),

  bootstrap: async () => {
    let saved: Language | null = null;
    try {
      saved = (await getSetting('language')) as Language | null;
    } catch (e) {
      console.warn('[engineStore] reading saved language failed:', e);
    }
    const rawSaved = saved;
    // A persisted choice that is now comingSoon (e.g. a beta tester who picked
    // Bisaya before the descope) falls back to the default instead of booting a
    // language the UI no longer offers. Re-persisted just below.
    const opt = saved && LANGUAGE_OPTIONS.find((o) => o.lang === saved);
    if (saved && (!opt || opt.comingSoon)) {
      console.warn(`[engineStore] saved language "${saved}" unavailable — falling back to ${DEFAULT_LANGUAGE}`);
      saved = DEFAULT_LANGUAGE;
    }
    // A fallback substitution above only changed the IN-MEMORY language. changeLanguage()
    // used to re-persist it as a side effect of the eager warm-up; with that gone, persist
    // it here or the same fallback runs again on every launch.
    if (saved && saved !== rawSaved) void setSetting('language', saved);

    // First launch (no saved language) → show the onboarding carousel; its slide-1
    // pick calls changeLanguage() which starts the model download in the background.
    //
    // NO EAGER WARM-UP. A returning user used to start the model load right here, behind
    // the sleeping-cat LoaderOverlay. That overlay is gone (the feed is zero-model, so
    // covering the app for ~98s of warm-up was dead air) — but removing the COVER without
    // removing the LOAD just hid the cost: the load still ran at boot and still contended
    // for the JS thread, so swipes stalled for seconds while the app looked idle and
    // usable. Loading ~2 GB on four budget cores is not "background" on this device.
    //
    // The engine is now loaded only when something actually needs it:
    //   - the feed's search field, on tap (cardStore.warmModel)
    //   - /chat, which kicks its own load and shows a factoid while it waits
    //   - onboarding slide-1, where picking a language IS the request to set up
    // A reward card that comes due before the engine is ready falls back to its
    // deterministic template, which is the existing contract.
    set({ language: saved, bootstrapped: true, onboardingActive: !saved });
  },

  changeLanguage: async (language: Language) => {
    if (get().engine && get().language === language && get().isReady) return; // no-op
    // Already warming for THIS language — bootstrap, the feed's warmModel, and /chat all
    // kick a load; a second concurrent LocalEngine init would double the ~2 GB in RAM.
    if (get().loadingPhase !== 'idle' && get().language === language) return;

    // ARM THE GUARD SYNCHRONOUSLY, before the first await. The two checks above are a
    // check-then-act, and the state they check used to be set AFTER `await setSetting(...)`
    // — so bootstrap() and the feed's warmModel(), which fire within ~10ms of each other at
    // launch, both slipped through the gap and each called loadModel. SDK 0.13.1 tolerated
    // the duplicate; 0.17.1 rejects it outright:
    //     MODEL_LOAD_FAILED (52200): Model with ID "…" is already registered
    // which left the engine uninitialised and the tutor dead for the whole session. There
    // must be NO await between reading loadingPhase and writing it.
    const prev = get().engine;
    set({ language, isReady: false, error: null, loadingProgress: 0, loadingPhase: 'warming' });
    try {
      // Persist AFTER arming the guard — a crash in this window just loses the preference,
      // whereas persisting first re-opened the race.
      await setSetting('language', language);
      // Re-roll the cold-start "Alam mo ba na…?" factoid in the NEW language. The composed
      // text is locked at roll time, so the one currently on screen stays Tagalog forever
      // (it lives in the TTL cache for ~1h) — clear + re-roll keeps the language consistent.
      // Best-effort, fire-and-forget; the new factoid renders the moment it's set.
      void useChatStore.getState().refreshFactoidForNewLanguage();
      if (prev) {
        try {
          await prev.shutdown();
        } catch (e) {
          console.warn('[engineStore] shutdown before reload failed:', e);
        }
      }
      const engine = new LocalEngine();

      // Progress is NOT one linear signal — init has two very differently-sized phases,
      // and only the first is observable:
      //   • DOWNLOAD (first run only): loadModel's onProgress streams 1→99 as QVAC fetches
      //     the ~3 GB base GGUF over the network — minutes, and directly observable. On a
      //     cached run there are no bytes to fetch, so onProgress jumps straight to 100.
      //   • WARM-UP tail (every cold start): loading ~2 GB into RAM + the warm-up prefill.
      //     Tens of seconds, and emits NO granular signal — only a time estimate.
      // (The LaBSE embedder downloads in the background via initSemantic() and is NOT
      //  awaited, so it's correctly excluded from this bar.)
      //
      // We therefore allocate the bar by phase rather than on one fixed clock:
      //   - while a real download streams → map the REAL bytes onto 0→DL_CEIL (honest;
      //     never races ahead of the network);
      //   - once the download finishes (or immediately, if cached) → ease the warm-up tail
      //     up toward TAIL_CEIL on the time estimate.
      // The bar never crosses the WAKE gate (97) on the timer — only the real isReady
      // snap-to-100 below does — so the cat never "wakes" while real work remains.
      // Correctness is still guaranteed by gating the loader's final dismiss on isReady
      // (LoaderOverlay holds the last exit frame if the warm-up estimate runs short).
      const EXPECTED_WARMUP_MS = 45000; // load-into-RAM + warm-up prefill on the target device
      const DL_CEIL = 90; // a streaming 3 GB download fills the bar up to here
      const WAKE_AT = 97; // matches the LoaderOverlay wake gate
      const TAIL_CEIL = WAKE_AT - 1; // 96 — approach but never reach the wake gate on the timer
      const startedAt = Date.now();
      let downloadPct = 0;
      let sawSignal = false; // received at least one progress callback from init
      let sawRealBytes = false; // observed a genuine in-progress download (1 < pct < 99)
      let downloadDone = false; // pct reached 100 — download complete OR already cached
      let tailStartedAt = 0; // set when the warm-up tail begins
      let shown = 0; // last value shown — the bar is monotonic (never ticks backwards)
      let ready = false;
      const ramp = setInterval(() => {
        if (ready) return;
        let pct: number;
        let phase: LoadingPhase;
        if (!downloadDone) {
          // Still fetching (or waiting to learn the phase). CRUCIAL: never run the warm-up
          // TIME estimate here — that's what used to race ahead of a slow 3 GB download.
          // Track real bytes once we have a signal; before the first signal, just creep so
          // the bar can't get ahead of an unknown download.
          phase = 'downloading';
          if (sawSignal) {
            pct = (downloadPct / 100) * DL_CEIL;
          } else {
            pct = Math.min(6, ((Date.now() - startedAt) / 12000) * 6); // ≤6% while connecting
          }
        } else {
          // Download complete (or cached) → NOW ease the short warm-up tail on a time
          // estimate. Cached → tail spans 0→TAIL_CEIL; after a real download → from DL_CEIL.
          phase = 'warming';
          if (tailStartedAt === 0) tailStartedAt = Date.now();
          const base = sawRealBytes ? DL_CEIL : 0;
          const span = TAIL_CEIL - base;
          const frac = Math.min(1, (Date.now() - tailStartedAt) / EXPECTED_WARMUP_MS);
          pct = base + span * (1 - (1 - frac) * (1 - frac)); // ease-out → TAIL_CEIL at expected time
        }
        shown = Math.max(shown, Math.round(pct)); // monotonic
        set({ loadingProgress: shown, loadingPhase: phase });
      }, 200);

      try {
        await engine.initialize(buildConfig(language), (p) => {
          sawSignal = true;
          downloadPct = p;
          if (p > 1 && p < 99) sawRealBytes = true; // a genuine streaming download
          if (p >= 100) downloadDone = true; // complete, or (instant 100) already cached
        });
      } finally {
        ready = true;
        clearInterval(ramp);
      }

      // Model is genuinely ready: snap to 100 so the loader crosses the 97 wake gate and
      // plays the (shortened) wake→exit, then dismisses. This is the ONLY thing that
      // crosses 97 — so the cat wakes exactly when the model is actually ready.
      set({ engine, isReady: true, loadingProgress: 100, loadingPhase: 'ready' });
      console.log(`QVAC engine ready (${language})`);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize engine',
        isReady: false,
        loadingProgress: 0,
        loadingPhase: 'idle',
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
