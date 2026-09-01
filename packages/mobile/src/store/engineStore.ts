import { create } from 'zustand';

import type { TutorEngine, TutorConfig, Language, GradeLevel } from '@hiraia/shared';

import { DEFAULT_GRADE, toGradeLevel } from '../config/grades';
import { LANGUAGE_OPTIONS, DEFAULT_LANGUAGE } from '../config/languages';
import { ACTIVE_MODEL } from '../config/model';
import { getSetting, setSetting } from '../db/repo';
import { LocalEngine } from '../engine/LocalEngine';

export type LoadingPhase = 'idle' | 'downloading' | 'warming' | 'ready';

interface EngineState {
  engine: TutorEngine | null;
  isReady: boolean;
  error: string | null;
  /** Active tutor language. null until the user picks one (first launch). */
  language: Language | null;
  /** The student's grade (3–10). Pitches the tutor's static system prompt ("grade-N
   *  students") and the feed's grounded answers, and is printed in the deck footer.
   *  Defaults to 5 (most of our kids are behind academically). Persisted in settings
   *  key 'grade'. */
  grade: GradeLevel;
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
  /** Persist + apply a grade. Cheap — no model reload (the adapter is per-language, not
   *  per-grade); a ready engine just re-primes its system-prompt KV cache in place. */
  changeGrade: (grade: GradeLevel) => Promise<void>;
  shutdown: () => Promise<void>;
}

function buildConfig(language: Language, gradeLevel: GradeLevel): TutorConfig {
  return {
    // Selects the downloaded LoRA adapter (TL, or BIS; EN rides the TL one) and scopes RAG.
    // The adapter is REQUIRED — if it cannot be fetched and verified LocalEngine throws
    // rather than quietly running the raw base model, and that surfaces as `error` below.
    language,
    gradeLevel, // the student's grade — LocalEngine pitches its prompts at it (see warmUp)
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

/**
 * ONE ENGINE LOAD AT A TIME, AND THE LAST PICK WINS.
 *
 * `changeLanguage` is reachable from three places — onboarding slide 1, the sidebar
 * language picker and the feed's search field (cardStore.warmModel) — and its guards only
 * ever caught a second load of the SAME language. Picking a DIFFERENT
 * language while one was loading therefore passed every check and started a SECOND
 * `LocalEngine.initialize` alongside the first, with nothing cancelling either. That is not
 * merely wasteful:
 *
 *   • Both fetch the same files. English rides the TAGALOG adapter, so an English pick
 *     during a Tagalog load resolves to the IDENTICAL `.part` path, and two append-mode
 *     writers on one file interleave into bytes that fail the MD5 gate — up to ~1 GB of a
 *     prepaid balance spent to end with no tutor. (`ensureRemoteAsset` now refuses to run
 *     two transfers of one file, which contains that damage; the second engine is still
 *     pointless work.)
 *   • Whichever `loadModel` loses is rejected by SDK 0.17.1 with MODEL_LOAD_FAILED (52200)
 *     "Model with ID … is already registered", which leaves the engine uninitialised and
 *     the tutor dead for the WHOLE session.
 *
 * A promise chain fixes both: a pick that arrives mid-load WAITS instead of racing, and
 * `requestedLanguage` collapses a burst of picks down to the last one so we never spend a
 * load on a language the child has already moved on from. It also subsumes the old
 * synchronous check-then-act guard — every decision now happens inside the serialised
 * section, so there is no window at all for a concurrent caller to slip through.
 */
let loadQueue: Promise<void> = Promise.resolve();
let requestedLanguage: Language | null = null;

/**
 * Load (or reload) the engine for `language`. Called ONLY from the queue in
 * `changeLanguage`, and assumes no other load is running.
 */
async function loadEngineFor(language: Language): Promise<void> {
  const set = useEngineStore.setState;
  const get = useEngineStore.getState;

  // Claim the load. Serialised by the queue above, so there is no check-then-act race
  // left to lose — but the state still has to be armed before the first await so the
  // loader UI reflects the new language from the moment the load actually begins.
  const prev = get().engine;
  set({ language, isReady: false, error: null, loadingProgress: 0, loadingPhase: 'warming' });
  try {
    // Persist AFTER arming the guard — a crash in this window just loses the preference,
    // whereas persisting first re-opened the race.
    await setSetting('language', language);
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

    const config = buildConfig(language, get().grade);
    try {
      await engine.initialize(config, (p) => {
        sawSignal = true;
        downloadPct = p;
        if (p > 1 && p < 99) sawRealBytes = true; // a genuine streaming download
        if (p >= 100) downloadDone = true; // complete, or (instant 100) already cached
      });

      // The warm-up is EXPLICIT — initialize() does not warm up — and runs exactly ONCE, here,
      // where the loader bar can cover its cold-start tail (the ramp is cleared in the finally,
      // once the engine is genuinely warm).
      //
      // It used to have to chase the grade: the prefill was the chat system prompt, which is
      // grade-bearing, so a grade change landing mid-prime meant paying a second ~78s prefill.
      // The warm-up no longer prefills anything grade-keyed (LocalEngine.warmUp), so one call
      // with the current grade is enough — changeGrade() applies any later change straight to
      // the engine config with no generation at all.
      //
      // prime() deliberately does NOT take the shared model lock: this engine has no generation
      // of its own to race, and the module-wide lock can still be held by a stale completion
      // from the engine we just shut down — coupling readiness to that would delay isReady, or
      // strand it forever if the completion never settles.
      await engine.prime(get().grade);
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
}

export const useEngineStore = create<EngineState>((set, get) => ({
  engine: null,
  isReady: false,
  error: null,
  language: null,
  grade: DEFAULT_GRADE,
  bootstrapped: false,
  loadingProgress: 0,
  loadingPhase: 'idle',
  onboardingActive: false,

  setOnboardingActive: (active: boolean) => set({ onboardingActive: active }),

  bootstrap: async () => {
    let saved: Language | null = null;
    let grade: GradeLevel = DEFAULT_GRADE;
    try {
      saved = (await getSetting('language')) as Language | null;
      // 'grade' is a digit string ("3".."10"); anything missing/unparseable → the default.
      grade = toGradeLevel(await getSetting('grade')) ?? DEFAULT_GRADE;
    } catch (e) {
      console.warn('[engineStore] reading saved settings failed:', e);
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
    //   - onboarding slide-1, where picking a language IS the request to set up
    // A reward card that comes due before the engine is ready falls back to its
    // deterministic template, which is the existing contract.
    set({ language: saved, grade, bootstrapped: true, onboardingActive: !saved });
  },

  changeLanguage: async (language: Language) => {
    // Cheap synchronous fast path so the feed's search field does not queue anything at
    // all once the tutor is up. It is only a fast path: the same test
    // is repeated inside the queue, which is where it is authoritative.
    if (get().engine && get().language === language && get().isReady) return;
    // NOTE the guard that used to sit here — `loadingPhase !== 'idle' && language ===
    // <the one loading>` — is GONE, not moved. It only ever blocked a duplicate load of
    // the SAME language, which is exactly the case the queue below handles for free,
    // while letting a DIFFERENT language through to race the load already running.

    // Record the ask SYNCHRONOUSLY. If several picks land while a load is running, only
    // the LAST one is still what the child wants; the superseded entries drop out below
    // instead of each paying for a full model load.
    requestedLanguage = language;
    const queued = loadQueue.then(async () => {
      if (requestedLanguage !== language) return; // superseded by a later pick
      const { engine, language: current, isReady } = get();
      if (engine && current === language && isReady) return; // already loaded — no-op
      await loadEngineFor(language);
    });
    // The chain has to survive a failed load or every later pick would inherit the
    // rejection. loadEngineFor already parks the reason in `error` for the UI.
    loadQueue = queued.catch(() => {});
    return queued;
  },

  changeGrade: async (grade: GradeLevel) => {
    try {
      // Persist first so a crash mid-apply still remembers the choice.
      await setSetting('grade', String(grade));
    } catch (e) {
      console.warn('[engineStore] saving grade failed:', e);
    }
    const changed = get().grade !== grade;
    set({ grade });
    if (!changed) return;
    // Unlike a language change this needs NO model reload — the LoRA adapter is per-language,
    // not per-grade — and, since the deleted chat surface took the grade-bearing system prompt
    // with it, no re-prefill either. The grade now reaches the model only through the card
    // prompt `answerQuery` builds per query, so LocalEngine.setGrade is a config write: no
    // completion, no model lock, nothing for a rapid tap to queue behind. (It used to re-run
    // the ~78s warm-up prefill on every tap, to refresh a KV cache nothing could hit.)
    // An engine still LOADING picks the new grade up at the end of changeLanguage(); no engine
    // at all (the feed is zero-model until the search field is tapped) has nothing to do —
    // buildConfig reads the grade when the load eventually starts.
    const { engine, isReady } = get();
    if (isReady && engine instanceof LocalEngine) await engine.setGrade(grade);
  },

  shutdown: async () => {
    const { engine } = get();
    if (engine) {
      await engine.shutdown();
      set({ engine: null, isReady: false });
    }
  },
}));
