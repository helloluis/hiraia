/**
 * THE SEMANTIC PREFETCHER — every phone that can run LaBSE search ends up with it.
 *
 * The LaBSE embedder + fact vectors (~506 MB, REMOTE_ASSETS.embedder/.vectors) used to be
 * fetched ONLY by LocalEngine.initSemantic, i.e. only when something loaded the engine (the
 * feed's search field, onboarding's language pick), and only ONCE per process: a failure there
 * is swallowed by design (keyword search is a working product), so a phone that was offline
 * or busy at that moment stayed keyword-only until the app was killed — and a donated JP1
 * (3.67 GiB, no tutor LLM) that left the warehouse without the files never asked again.
 *
 * This module owns "the files are on the phone" independently of profiles and of the engine:
 *
 *   • WHEN it tries: at launch (after a short delay, so the launch's own disk work goes
 *     first), on every return to the foreground, whenever the device gains a network after
 *     having none (net/connectivity — the warehouse LAN with the mirror counts too), when
 *     an engine finishes loading without semantic search, when the search field is focused
 *     on such an engine (cardStore.warmModel — throttled), and on a backoff timer while
 *     anything is missing (1 min, doubling to 10 min).
 *   • HOW it downloads: through ensureRemoteAsset only, so the LAN mirror, byte-exact
 *     resume, the size+MD5 gate and the "AI downloads" pause switch (modelDownloadControl)
 *     all apply exactly as they do for the engine. ensureRemoteAsset runs ONE transfer per
 *     file and a second caller JOINS it (its `inFlight` map, registered before its first
 *     await), so the engine and this module can never download the same file twice at once;
 *     the two files are fetched one after the other here, never in parallel.
 *   • WHERE it refuses: never on a phone that cannot hold LaBSE at all ('unsupported' —
 *     a fixed property, so the verdict ends this module's work for the process); 'storage'
 *     and an unreadable memory snapshot wait for the next attempt. RAM pressure does NOT
 *     refuse a download (memoryPolicy.semanticDownloadBlock); it only defers the load.
 *   • WHAT then: with both files on disk and an engine loaded keyword-only, it asks
 *     engineStore.retrySemantic() to attach search to that engine — no reload of the
 *     generator, serialized with language switches on the store's load queue. A refusal
 *     there (RAM pressure right now) goes back on the backoff timer.
 *
 * A COMPLETE file with the wrong MD5 (the downloader's `fatal` IntegrityError) is not retried
 * on the ordinary schedule: repeating the identical request returns the identical bytes, so it
 * would re-spend ~384 MB every ten minutes to fail again. It waits FATAL_RETRY_MS (a server-side
 * fix is the only thing that can change the answer) or the next launch.
 */
import { AppState } from 'react-native';
import { EMBEDDER, REMOTE_ASSETS } from '../config/model';
import { subscribeInternetRestored } from '../net/connectivity';
import { useEngineStore } from '../store/engineStore';
import { readMemory, semanticAssetsMissing } from './memory';
import { semanticDownloadBlock } from './memoryPolicy';
import { ensureRemoteAsset, type AssetDownloadStatus } from './modelDownload';

/** First retry after a failed attempt; doubles per consecutive failure up to MAX_RETRY_MS. */
export const FIRST_RETRY_MS = 60_000;
export const MAX_RETRY_MS = 10 * 60_000;
/** After an integrity failure (wrong bytes, complete file): see the header. */
export const FATAL_RETRY_MS = 6 * 60 * 60_000;
/** Search-field focus is a hint, not a schedule: at most one attempt per this long from it. */
export const NUDGE_MIN_MS = 30_000;
/** Let the launch's own work (card database, title screen, first paint) go first. */
const LAUNCH_DELAY_MS = 3_000;

export type SemanticPrefetchStatus = {
  /** What refuses the download on this phone, as of the last attempt. */
  block: 'unsupported' | 'storage' | null;
  /** The last download failed and another is scheduled (backoff, foreground, network back). */
  waiting: boolean;
  /** The last download COMPLETED with the wrong bytes: parked (FATAL_RETRY_MS), not waiting on
   *  any connection, so the sidebar must not say it is. */
  failed: boolean;
};

let status: SemanticPrefetchStatus = { block: null, waiting: false, failed: false };
const listeners = new Set<() => void>();
export const semanticPrefetchStatus = (): SemanticPrefetchStatus => status;
export function subscribeSemanticPrefetch(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function update(patch: Partial<SemanticPrefetchStatus>): void {
  const next = { ...status, ...patch };
  if (next.block === status.block && next.waiting === status.waiting && next.failed === status.failed) return;
  status = next;
  for (const fn of listeners) fn();
}

let running: Promise<void> | null = null;
/** A trigger arrived while an attempt was running: run once more when it ends. */
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let delay = FIRST_RETRY_MS;
let parkedUntil = 0;
let lastNudge = -Infinity;
let starts = 0;
let stopListening: (() => void) | null = null;

/** Same `fatal` PROPERTY contract as modelDownload's IntegrityError (not instanceof). */
const isFatal = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { fatal?: unknown }).fatal === true;

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Timers exist only while started; a stopped prefetcher schedules nothing. */
function schedule(ms: number): void {
  clearTimer();
  if (starts) timer = setTimeout(() => { timer = null; void runSemanticPrefetch('timer'); }, ms);
}

/** A failed attempt: try again after the current backoff step. `waiting` is what the sidebar
 *  says: only a failed DOWNLOAD is one; a deferral that never touched the network is not. */
function retryLater(waiting = true): void {
  update({ waiting, failed: false });
  schedule(delay);
  delay = Math.min(delay * 2, MAX_RETRY_MS);
}

async function attempt(reason: string): Promise<void> {
  clearTimer();
  if (status.block === 'unsupported') return;
  // Background: Android pauses timers there anyway; the foreground listener picks it up.
  if (AppState.currentState === 'background') return;
  if (Date.now() < parkedUntil) return schedule(parkedUntil - Date.now());
  const missing = semanticAssetsMissing();
  const block = semanticDownloadBlock(await readMemory(), missing);
  if (block === 'unsupported') {
    console.log('[semanticPrefetch] this phone cannot hold LaBSE — never downloading it');
    return update({ block, waiting: false });
  }
  update({ block: block === 'storage' ? 'storage' : null });
  if (block) {
    console.log(`[semanticPrefetch] download deferred (${block}); retrying in ${Math.round(delay / 1000)}s`);
    // 'storage' is reported through `block`; an unreadable snapshot ('unknown') downloaded
    // nothing, so the row keeps saying what is on disk rather than blaming the connection.
    return retryLater(false);
  }
  if (missing) {
    console.log(`[semanticPrefetch] fetching LaBSE search files (${reason})`);
    try {
      // One after the other: the pair is useless until both land, and two parallel
      // transfers would only split one phone's link. Each call joins an engine transfer
      // of the same file if one is already running.
      await ensureRemoteAsset(EMBEDDER.remote);
      await ensureRemoteAsset(REMOTE_ASSETS.vectors);
    } catch (e) {
      if (isFatal(e)) {
        parkedUntil = Date.now() + FATAL_RETRY_MS;
        console.warn('[semanticPrefetch] served bytes fail the pinned MD5; parking the retry', e);
        update({ waiting: false, failed: true });
        return schedule(FATAL_RETRY_MS);
      }
      console.warn(`[semanticPrefetch] download failed; retrying in ${Math.round(delay / 1000)}s`, e);
      return retryLater();
    }
    delay = FIRST_RETRY_MS; // The files landed: a later refusal below starts a fresh backoff.
  }
  update({ waiting: false, failed: false });
  // Both files are on disk. An engine that came up keyword-only gets search attached now.
  const es = useEngineStore.getState();
  if (!es.isReady || !es.engine || es.engine.isSemanticReady?.() !== false || (await es.retrySemantic())) {
    delay = FIRST_RETRY_MS;
    return;
  }
  // Refused with the files present: RAM pressure (or a transient load failure). Later,
  // backing off like a failed download does.
  console.log(`[semanticPrefetch] search not attached yet; retrying in ${Math.round(delay / 1000)}s`);
  retryLater(false);
}

/** One attempt now (or joined to the one running). Never rejects. */
export function runSemanticPrefetch(reason: string): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  const run = attempt(reason)
    .catch((e) => console.warn('[semanticPrefetch] attempt failed', e))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        void runSemanticPrefetch('queued trigger');
      }
    });
  running = run;
  return run;
}

/**
 * A hint that semantic search is wanted right now (the search field was focused on a
 * keyword-only engine). Bounded: at most one attempt per NUDGE_MIN_MS from this source.
 */
export function nudgeSemanticPrefetch(reason: string): void {
  const now = Date.now();
  if (now - lastNudge < NUDGE_MIN_MS) return;
  lastNudge = now;
  void runSemanticPrefetch(reason);
}

/** Start at app launch (root layout). Idempotent/ref-counted; returns the stop function. */
export function startSemanticPrefetch(): () => void {
  if (++starts === 1) {
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') void runSemanticPrefetch('foreground');
    });
    const net = subscribeInternetRestored(() => {
      // A new network is a fresh chance: restart the backoff and try now.
      delay = FIRST_RETRY_MS;
      void runSemanticPrefetch('internet restored');
    });
    const engine = useEngineStore.subscribe((s, prev) => {
      // An engine that finished loading keyword-only, with no attempt pending to cover it
      // (e.g. the files were already here and RAM was short at that moment).
      if (s.isReady && !prev.isReady && !s.semanticReady && !timer && !running) schedule(delay);
    });
    const launch = setTimeout(() => void runSemanticPrefetch('launch'), LAUNCH_DELAY_MS);
    stopListening = () => {
      clearTimeout(launch);
      app.remove();
      net();
      engine();
    };
  }
  return () => {
    if (starts === 0 || --starts > 0) return;
    stopListening?.();
    stopListening = null;
    clearTimer();
  };
}

/**
 * What the sidebar's search row says, from the prefetcher's verdict, the engine, the pause
 * switch and the two files' download statuses. Pure. `percent` is weighted by file size.
 */
export type SemanticRowState =
  | 'unsupported'
  | 'ready'
  | 'downloaded'
  | 'downloading'
  | 'verifying'
  | 'retrying'
  | 'paused'
  | 'waiting'
  | 'failed'
  | 'checking'
  | 'missing';

export function semanticRowState(input: {
  prefetch: SemanticPrefetchStatus;
  unsupported: boolean;
  engineSemantic: boolean;
  downloadsEnabled: boolean;
  files: { status: AssetDownloadStatus; bytes: number }[];
}): { state: SemanticRowState; percent: number } {
  const { files } = input;
  const total = files.reduce((n, f) => n + f.bytes, 0);
  const got = files.reduce(
    (n, f) => n + (f.status.phase === 'downloaded' ? f.bytes : (f.bytes * f.status.percent) / 100),
    0
  );
  const percent = total > 0 ? Math.floor((100 * got) / total) : 0;
  const any = (phase: AssetDownloadStatus['phase']) => files.some((f) => f.status.phase === phase);
  const state: SemanticRowState =
    input.unsupported || input.prefetch.block === 'unsupported'
      ? 'unsupported'
      : input.engineSemantic
        ? 'ready'
        : files.every((f) => f.status.phase === 'downloaded')
          ? 'downloaded'
          : any('downloading')
            ? 'downloading'
            : any('verifying')
              ? 'verifying'
              : !input.downloadsEnabled
                ? 'paused'
                : any('retrying')
                  ? 'retrying'
                  : input.prefetch.block === 'storage' || input.prefetch.failed
                    ? 'failed'
                    : input.prefetch.waiting || any('failed')
                      ? 'waiting'
                      : any('checking')
                        ? 'checking'
                        : 'missing';
  return { state, percent: state === 'ready' || state === 'downloaded' ? 100 : percent };
}
