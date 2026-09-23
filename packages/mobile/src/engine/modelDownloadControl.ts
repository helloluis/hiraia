import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'hiraia.model-downloads.enabled.v1';
let state = {ready: false, enabled: true};
let initialized: Promise<void> | null = null;
const listeners = new Set<() => void>();
export const modelDownloadPreference = () => state;
export function subscribeModelDownloadPreference(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function update(enabled: boolean) {
  state = {ready: true, enabled};
  for (const fn of listeners) fn();
}
export function initializeModelDownloadPreference(): Promise<void> {
  return initialized ??= AsyncStorage.getItem(KEY).then(value => update(value !== 'false'))
    .catch(error => { initialized = null; throw error; });
}
export async function setModelDownloadsEnabled(enabled: boolean): Promise<void> {
  await initializeModelDownloadPreference();
  const previous = state.enabled;
  update(enabled); // Stop native transfers immediately, before persistence yields.
  try { await AsyncStorage.setItem(KEY, String(enabled)); }
  catch (error) { update(previous); throw error; }
}
function waitForResume(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!signal?.aborted && !state.enabled) return;
      stop(); signal?.removeEventListener('abort', check);
      if (signal?.aborted) reject(new Error('model download aborted')); else resolve();
    };
    const stop = subscribeModelDownloadPreference(check);
    signal?.addEventListener('abort', check);
    check();
  });
}

/** Hold the caller's one transfer slot while paused; resume its verified .part. */
export async function withModelDownloadControl<T>(
  work: (signal: AbortSignal) => Promise<T>, onPause: () => void, signal?: AbortSignal,
): Promise<T> {
  await initializeModelDownloadPreference();
  while (true) {
    if (!state.enabled) onPause();
    await waitForResume(signal);
    const attempt = new AbortController();
    let manuallyPaused = false;
    const abort = () => attempt.abort();
    const stop = subscribeModelDownloadPreference(() => {
      if (!state.enabled) { manuallyPaused = true; onPause(); abort(); }
    });
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    try { return await work(attempt.signal); }
    catch (error) {
      // Manual pauses are not failures or retries. Integrity failures still fail
      // closed even if the user happened to pause during verification.
      if (!manuallyPaused || signal?.aborted || (error as {fatal?: boolean})?.fatal) throw error;
    } finally { stop(); signal?.removeEventListener('abort', abort); }
  }
}
