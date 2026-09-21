import { readMemory, MemoryBlockedError } from '../engine/memory';
import { memoryBlock, type MemoryBlock } from '../engine/memoryPolicy';
import { needsProfileOnboarding } from '../profiles';
import { setTelemetryPersona } from '../telemetry';
import { create } from 'zustand';

import type { TutorEngine, TutorConfig, Language, GradeLevel } from '@hiraia/shared';

import { DEFAULT_GRADE, toGradeLevel } from '../config/grades';
import { LANGUAGE_OPTIONS, DEFAULT_LANGUAGE } from '../config/languages';
import { ACTIVE_MODEL } from '../config/model';
import { getSetting, setSetting } from '../db/repo';
import { LocalEngine } from '../engine/LocalEngine';

import type { EngineProgressEvent } from '../engine/LocalEngine';

export type LoadingPhase = 'idle' | 'downloading' | 'warming' | 'ready';

/**
 * Which stage of the real load pipeline the readiness bar is reflecting. The search
 * field's status messages are keyed on THIS, so they can only ever describe work that
 * is genuinely in flight (see EngineProgressEvent in LocalEngine for the stage feed).
 *
 *   idle      — no load running (the field is the tap-to-wake invitation)
 *   connect   — load requested, no byte seen yet
 *   download  — the ~1.27 GB base GGUF streaming in (real pct)
 *   verify    — MD5 of the whole file (~15 s on device, no pct exists)
 *   load      — loadModel reading the verified GGUF into RAM (real pct)
 *   cpu-retry — GPU load died, restarting on CPU: the bar HOLDS, the message says
 *               "taking longer" (sticky until ready — the CPU path stays the slow truth)
 *   warm      — prime(): the one throwaway completion ("waking up Hiraia" is literal)
 *   semantic  — LaBSE and vectors download/load first; lexical search remains interactive
 *   done      — everything green
 */
export type ReadyStage =
  | 'idle'
  | 'connect'
  | 'download'
  | 'verify'
  | 'load'
  | 'cpu-retry'
  | 'warm'
  | 'semantic'
  | 'done';

interface EngineState {
  memoryNotice: MemoryBlock | null;
  launchMemoryBlock: MemoryBlock | null;
  dismissMemoryNotice: () => void;
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
   *  honest copy: 'downloading' = the one-time ~1.27 GB base-model fetch (first
   *  run only); 'warming' = load-into-RAM + the warm-up prefill (every cold
   *  start); 'ready' = done; 'idle' = not loading. (Coarse legacy view — the
   *  search field's readiness UI reads `readiness`/`readyStage` instead.) */
  loadingPhase: LoadingPhase;
  /**
   * THE composed readiness number, 0–1, across the weighted stages above. The search
   * field's opacity, the bar's width, the bar's colour and the status-message pool are
   * all views of this ONE number. Monotonic within a load (a CPU-fallback retry holds
   * it, never rewinds it); resets only when a new load begins or a load fails.
   */
  readiness: number;
  /** The stage tag matching `readiness` — drives the truthful status messages. */
  readyStage: ReadyStage;
  /** Whether the onboarding carousel is showing. True on first launch (no saved
   *  language) and whenever Settings → "show tutorial" re-triggers it. */
  onboardingActive: boolean;
  setOnboardingActive: (active: boolean) => void;
  /** Read the saved language and, if present, load the engine for it. */
  bootstrap: () => Promise<void>;
  /** Persist + (re)load the engine for a language. Used by the first-launch
   *  picker and the Settings selector. Reloads the engine (one model serves every
   *  language — no adapter swap — but the RAG scope + prompts re-key on it). */
  changeLanguage: (language: Language) => Promise<void>;
  /** Persist + apply a grade. Cheap — no model reload (grade only pitches the
   *  card prompt); a ready engine just takes the config write in place. */
  changeGrade: (grade: GradeLevel) => Promise<void>;
  shutdown: () => Promise<void>;
}

function buildConfig(language: Language, gradeLevel: GradeLevel): TutorConfig {
  return {
    // Scopes RAG + the card prompts. The shipping Hiraia-2B is a FULL-PARAMETER
    // SFT (loraRemote empty by design): all three languages live in one set of
    // weights and no adapter is fetched. For a future adapter-ful model the old
    // contract still holds — a declared adapter that cannot be fetched and
    // verified makes LocalEngine throw, surfacing as `error` below.
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
 *   • Both fetch the same files. Every language loads the SAME base GGUF (one model, no
 *     per-language adapters), so two racing loads resolve to the IDENTICAL `.part` path,
 *     and two append-mode writers on one file interleave into bytes that fail the MD5
 *     gate — up to ~1 GB of a prepaid balance spent to end with no tutor.
 *     (`ensureRemoteAsset` now refuses to run two transfers of one file, which contains
 *     that damage; the second engine is still pointless work.)
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
let loadingEngine: LocalEngine | null = null;
/**
 * Which load "owns" the readiness state. The LaBSE semantic band keeps reporting in
 * the BACKGROUND after a load completes — and a language switch can start a NEW load
 * while the old engine's semantic init is still emitting. Without this token a stale
 * event could bump the fresh load's bar. Bumped at the start of every load.
 */
let loadSeq = 0;

/**
 * Load (or reload) the engine for `language`. Called ONLY from the queue in
 * `changeLanguage`, and assumes no other load is running.
 */
async function loadEngineFor(language: Language): Promise<void> {
  const set = useEngineStore.setState;
  const get = useEngineStore.getState;
  const prev = get().engine;
  const seq = ++loadSeq;
  setTelemetryPersona(language, get().grade);
  set({ language, engine: null, memoryNotice: null, isReady: false, error: null,
    loadingProgress: 0, loadingPhase: 'downloading', readiness: 0, readyStage: 'semantic' });
  const engine = new LocalEngine();
  loadingEngine = engine;
  let shown = 0;
  const progress = (stage: ReadyStage, value: number) => {
    if (seq !== loadSeq) return;
    shown = Math.max(shown, value);
    set({ readiness: shown, loadingProgress: Math.round(shown * 100), readyStage: stage,
      loadingPhase: stage === 'download' || stage === 'semantic' ? 'downloading' : 'warming' });
  };
  const onEvent = (ev: EngineProgressEvent) => {
    if (seq !== loadSeq) return;
    switch (ev.stage) {
      case 'semantic': progress('semantic', ev.pct / 200); break;
      case 'retrieval-ready':
        // Publish retrieval while the optional LLM downloads/loads. isReady is kept false
        // until initialization ends so the serialized language/load guard stays authoritative.
        set({ engine });
        break;
      case 'download': progress('download', 0.5 + ev.pct * 0.003); break;
      case 'verify': progress('verify', 0.8); break;
      case 'load': progress('load', 0.8 + ev.pct * 0.001); break;
      case 'cpu-retry': progress('cpu-retry', shown); break;
    }
  };
  try {
    await setSetting('language', language);
    await prev?.shutdown();
    await engine.initialize(buildConfig(language, get().grade), undefined, onEvent);
    progress('warm', 0.95);
    await engine.prime(get().grade); // No-op without the LLM; LaBSE is already warm.
    set({ engine, isReady: true, readiness: 1, readyStage: 'done',
      loadingProgress: 100, loadingPhase: 'ready' });
    console.log(`QVAC ready (${language}): semantic=${engine.isSemanticReady()} generation=${engine.canGenerate()}`);
  } catch (error) {
    await engine.shutdown();
    set({ engine: null, memoryNotice: error instanceof MemoryBlockedError ? error.reason : null,
      error: error instanceof Error ? error.message : 'Failed to initialize engine',
      isReady: false, loadingProgress: 0, loadingPhase: 'idle', readiness: 0, readyStage: 'idle' });
    console.error('Failed to initialize QVAC engine; card search remains available:', error);
  } finally {
    if (loadingEngine === engine) loadingEngine = null;
  }
}

export const useEngineStore = create<EngineState>((set, get) => ({
  memoryNotice: null,
  launchMemoryBlock: null,
  dismissMemoryNotice: () => set({ memoryNotice: null }),
  engine: null,
  isReady: false,
  error: null,
  language: null,
  grade: DEFAULT_GRADE,
  bootstrapped: false,
  loadingProgress: 0,
  loadingPhase: 'idle',
  readiness: 0,
  readyStage: 'idle',
  onboardingActive: false,

  setOnboardingActive: (active: boolean) => set({ onboardingActive: active }),

  bootstrap: async () => {
    // Every process launch; this does not start downloads or show an unsolicited dialog.
    set({ launchMemoryBlock: memoryBlock(await readMemory()) });
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
    setTelemetryPersona(saved, grade);

    // First launch (no saved language) → show the onboarding carousel; its slide-1
    // pick calls changeLanguage() which starts the model download in the background.
    //
    // NO EAGER WARM-UP. A returning user used to start the model load right here, behind
    // the sleeping-cat LoaderOverlay. That overlay is gone (the feed is zero-model, so
    // covering the app for ~98s of warm-up was dead air) — but removing the COVER without
    // removing the LOAD just hid the cost: the load still ran at boot and still contended
    // for the JS thread, so swipes stalled for seconds while the app looked idle and
    // usable. Loading ~1.3 GB on four budget cores is not "background" on this device.
    //
    // The engine is now loaded only when something actually needs it:
    //   - the feed's search field, on tap (cardStore.warmModel)
    //   - onboarding slide-1, where picking a language IS the request to set up
    // A reward card that comes due before the engine is ready falls back to its
    // deterministic template, which is the existing contract.
    set({ language: saved, grade, bootstrapped: true, onboardingActive: !saved || needsProfileOnboarding() });
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
    if (requestedLanguage !== language) loadingEngine?.cancelInitialization();
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
    setTelemetryPersona(get().language, grade);
    if (!changed) return;
    // Unlike a language change this needs NO model reload — the grade never touches the
    // weights — and, since the deleted chat surface took the grade-bearing system prompt
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
    // Finish any allocation before unloading; no orphaned semantic/background writer.
    requestedLanguage = null;
    loadingEngine?.cancelInitialization();
    const queued = loadQueue.then(async () => {
      ++loadSeq;
      const engine = get().engine;
      set({ engine: null, isReady: false });
      await engine?.shutdown();
      set({ loadingPhase: 'idle', readyStage: 'idle', readiness: 0, loadingProgress: 0 });
    });
    loadQueue = queued.catch(() => {});
    return queued;
  },
}));
