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
 *   semantic  — engine READY + interactive; the background LaBSE (384 MB) still landing
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

// ============================================================================
// STAGE WEIGHTS — the composed 0–1 readiness number.
// ============================================================================
// One number, four views (field opacity, bar width, bar colour, message pool).
// Cumulative band edges, weighted by FIRST-RUN wall-clock on the target device
// (SM6225, school Wi-Fi) but deliberately compressed at the ends:
//
//   0.00–0.03  base       the card DB is already open — a load can only ever be
//                         started from a browsable feed, so the bar honestly
//                         never starts at zero
//   0.03–0.55  download   1.27 GB over the network (real bytes). Minutes-to-tens-
//                         of-minutes — the dominant cost — but NOT given a
//                         proportional 90% of the bar: after the download the
//                         device still owes ~60–90 s of verify+load+warm, and a
//                         bar that sits at 9x% for a minute and a half reads as
//                         broken to a child. 52% keeps every later stage visibly
//                         moving. On a cached run the download band completes
//                         instantly (fast-forward is honest; backwards never is).
//   0.55–0.62  verify     streaming MD5 of the 1.27 GB (~15 s measured band; no
//                         pct exists → time-eased toward the edge, capped)
//   0.62–0.78  load       loadModel into RAM (real pct from QVAC)
//   0.78–0.90  warm       prime()'s throwaway completion (~45 s expected;
//                         time-eased, capped — only real readiness crosses 0.90)
//   0.90       READY      isReady snaps here; the ask box goes INTERACTIVE now
//   0.90–1.00  semantic   the background LaBSE download+load (real pct). The
//                         field is already usable on lexical retrieval — a child
//                         on a slow connection must not wait out another 384 MB
//                         for a retrieval-precision upgrade — so the bar keeps
//                         crawling to green while the box already answers.
// ============================================================================
const W_BASE = 0.03;
const W_DOWNLOAD_END = 0.55;
const W_VERIFY_END = 0.62;
const W_LOAD_END = 0.78;
const W_READY = 0.9;
/** The verify stage's time-ease horizon (measured ~15 s hash on the SM6225). */
const VERIFY_EXPECTED_MS = 20_000;

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

  // Claim the load. Serialised by the queue above, so there is no check-then-act race
  // left to lose — but the state still has to be armed before the first await so the
  // loader UI reflects the new language from the moment the load actually begins.
  const prev = get().engine;
  const seq = ++loadSeq;
  set({
    language,
    isReady: false,
    error: null,
    loadingProgress: Math.round(W_BASE * 100),
    loadingPhase: 'downloading',
    readiness: W_BASE,
    readyStage: 'connect',
  });
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

    // ------------------------------------------------------------------------
    // COMPOSED READINESS. LocalEngine reports structured stage events (download /
    // verify / load / cpu-retry / semantic); this maps them onto the weighted
    // bands documented at W_* above, into ONE monotonic 0–1 number plus a stage
    // tag. The two stages with no observable signal (verify, warm) are time-eased
    // toward their band edge and CAPPED — only real events cross a band boundary,
    // and only the real isReady snap reaches W_READY. Monotonicity is structural
    // (`shown = max(shown, target)`), which is also what makes the CPU-fallback
    // retry a HOLD instead of a rewind: the restarted load's pct climbs back up
    // underneath the bar until it catches where the bar already was.
    // ------------------------------------------------------------------------
    const EXPECTED_WARMUP_MS = 45_000; // prime()'s throwaway completion on the target device
    const startedAt = Date.now();
    let tag: ReadyStage = 'connect';
    let downloadPct = 0;
    let loadPct = 0;
    let semanticPct = 0;
    let retried = false; // the GPU→CPU fallback fired — "taking longer" is the honest copy
    let verifyAt = 0; // when the MD5 stage began
    let warmAt = 0; // when prime() began
    let shown = W_BASE; // monotonic — the bar NEVER ticks backwards
    let ready = false;

    const easeOut = (f: number) => 1 - (1 - f) * (1 - f);
    const publish = () => {
      if (seq !== loadSeq) return;
      set({
        readiness: shown,
        readyStage: tag,
        loadingProgress: Math.round(shown * 100),
        loadingPhase: tag === 'connect' || tag === 'download' ? 'downloading' : 'warming',
      });
    };

    const ramp = setInterval(() => {
      if (ready) return;
      let target = shown;
      switch (tag) {
        case 'connect':
          // No byte seen yet — creep a little so the field visibly reacts to the tap,
          // but never get ahead of an unknown download (≤ 0.06 while connecting).
          target = W_BASE + Math.min(1, (Date.now() - startedAt) / 12_000) * (0.06 - W_BASE);
          break;
        case 'download':
          target = W_BASE + ((W_DOWNLOAD_END - W_BASE) * downloadPct) / 100;
          break;
        case 'verify': {
          // Real work, no signal: ease across the verify band on the measured hash
          // time, capped a hair under the edge — only the first 'load' event crosses it.
          const f = Math.min(1, (Date.now() - verifyAt) / VERIFY_EXPECTED_MS);
          target = W_DOWNLOAD_END + (W_VERIFY_END - 0.005 - W_DOWNLOAD_END) * easeOut(f);
          break;
        }
        case 'load':
          target = W_VERIFY_END + ((W_LOAD_END - W_VERIFY_END) * loadPct) / 100;
          break;
        case 'cpu-retry':
          // While the RESTARTED LOAD runs, keep the load-band maths: it re-reports
          // pct from 0, max() holds the bar, and the tag keeps the honest message
          // up. But once prime() begins (warmAt set) this path owes the SLOWEST
          // warm-up of any device (~78 s measured on the SD685) — switch to the
          // warm band's time-ease, or the bar stands motionless at W_LOAD_END for
          // over a minute: exactly the parked-bar-reads-as-broken failure the
          // STAGE WEIGHTS block exists to avoid. The tag (and the "taking longer"
          // message) is unchanged; only the crawl resumes.
          target =
            warmAt > 0
              ? W_LOAD_END +
                (W_READY - 0.005 - W_LOAD_END) *
                  easeOut(Math.min(1, (Date.now() - warmAt) / EXPECTED_WARMUP_MS))
              : W_VERIFY_END + ((W_LOAD_END - W_VERIFY_END) * loadPct) / 100;
          break;
        case 'warm': {
          const f = Math.min(1, (Date.now() - warmAt) / EXPECTED_WARMUP_MS);
          target = W_LOAD_END + (W_READY - 0.005 - W_LOAD_END) * easeOut(f);
          break;
        }
        default:
          break;
      }
      shown = Math.max(shown, target);
      publish();
    }, 250);

    // Post-ready view of the semantic band (the ramp is gone by then).
    const applySemantic = () => {
      if (seq !== loadSeq) return;
      const cur = useEngineStore.getState();
      if (!cur.isReady) return; // pre-ready, the ramp + main bands own the bar
      const target = W_READY + ((1 - W_READY) * semanticPct) / 100;
      set({
        readiness: Math.max(cur.readiness, target),
        readyStage: semanticPct >= 100 ? 'done' : 'semantic',
      });
    };

    const onEvent = (ev: EngineProgressEvent) => {
      if (seq !== loadSeq) return; // a stale engine's background reporter — ignore
      switch (ev.stage) {
        case 'download':
          downloadPct = Math.max(downloadPct, ev.pct);
          // 'verify' can go BACK to 'download': a failed contract check (a proxy-
          // truncated body, a bad MD5 after a resume) sends the downloader back to
          // the network, and the honest message for that multi-minute stretch is
          // "downloading" — not "checking the download". verifyAt is re-armed so a
          // SECOND verify pass re-eases across its band; the bar itself still
          // cannot rewind (shown = max(shown, target)).
          if (tag === 'connect' || tag === 'verify') {
            tag = 'download';
            verifyAt = 0;
          }
          break;
        case 'verify':
          if (verifyAt === 0) verifyAt = Date.now();
          tag = 'verify';
          break;
        case 'load':
          loadPct = Math.max(loadPct, ev.pct);
          // After a CPU retry the stage stays 'cpu-retry' — the message must keep
          // saying it is taking longer, not pretend the first attempt never died.
          tag = retried ? 'cpu-retry' : 'load';
          break;
        case 'cpu-retry':
          retried = true;
          loadPct = 0; // the restarted load re-reports from 0 — max() holds the bar
          tag = 'cpu-retry';
          break;
        case 'semantic':
          semanticPct = Math.max(semanticPct, ev.pct);
          applySemantic();
          break;
      }
    };

    const config = buildConfig(language, get().grade);
    try {
      await engine.initialize(config, undefined, onEvent);

      // The warm-up is EXPLICIT — initialize() does not warm up — and runs exactly ONCE, here,
      // where the readiness bar can cover its cold-start tail (the ramp is cleared in the
      // finally, once the engine is genuinely warm).
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
      warmAt = Date.now();
      // (`retried`, not `tag`: TS cannot see the closure mutations of `tag` from here.)
      if (!retried) tag = 'warm'; // a CPU-retried load keeps its "taking longer" story warm-through
      await engine.prime(get().grade);
    } finally {
      ready = true;
      clearInterval(ramp);
    }

    // Model is genuinely ready: snap to W_READY — the ONLY thing that crosses it — and
    // open the ask box. The semantic band (LaBSE) may already be partly (or fully) done:
    // credit whatever it has banked, then let applySemantic() walk the bar to green.
    const semanticNow = W_READY + ((1 - W_READY) * semanticPct) / 100;
    set({
      engine,
      isReady: true,
      readiness: Math.max(shown, semanticNow),
      readyStage: semanticPct >= 100 ? 'done' : 'semantic',
      loadingProgress: 100,
      loadingPhase: 'ready',
    });
    console.log(`QVAC engine ready (${language})`);
  } catch (error) {
    set({
      error: error instanceof Error ? error.message : 'Failed to initialize engine',
      isReady: false,
      loadingProgress: 0,
      loadingPhase: 'idle',
      readiness: 0,
      readyStage: 'idle',
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
  readiness: 0,
  readyStage: 'idle',
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
    // usable. Loading ~1.3 GB on four budget cores is not "background" on this device.
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
    const { engine } = get();
    if (engine) {
      await engine.shutdown();
      set({ engine: null, isReady: false });
    }
  },
}));
