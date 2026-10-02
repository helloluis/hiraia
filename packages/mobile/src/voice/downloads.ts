import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import type { Language } from '@hiraia/shared';
import { useEngineStore } from '../store/engineStore';
import { subscribeInternetRestored } from '../net/connectivity';
import { voiceForLanguage } from './catalog';
import { downloadVoice, installedVoicePath, voiceIsInstalled } from './files';

const preference = 'hiraia.voice-downloads.enabled.v1';
type Phase = 'checking' | 'unavailable' | 'ready' | 'downloading' | 'verifying' | 'paused' | 'failed';
let state: { language: Language | null; enabled: boolean; initialized: boolean; phase: Phase; percent: number } = {
  language: null, enabled: true, initialized: false, phase: 'checking', percent: 0,
};
const listeners = new Set<() => void>();
export const voiceDownloadStatus = () => state;
export function subscribeVoiceDownloads(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
export function voiceAvailable(language: Language): boolean {
  const voice = voiceForLanguage(language);
  return !!voice && voiceIsInstalled(voice);
}

let initialization: Promise<void> | null = null;
function initialize(): Promise<void> {
  return initialization ??= AsyncStorage.getItem(preference)
    .then(value => { update({ initialized: true, enabled: value !== 'false' }); })
    .catch(error => { initialization = null; update({ phase: 'failed' }); throw error; });
}
let starts = 0;
let stopListening: (() => void) | null = null;
let active: AbortController | null = null;
let running: Promise<void> | null = null;
let queued = false;
let retry: ReturnType<typeof setTimeout> | null = null;
let delay = 60_000;
const parked = new Set<string>();
function clearRetry() { if (retry) clearTimeout(retry); retry = null; }

async function attempt(signal: AbortSignal) {
  await initialize();
  const engine = useEngineStore.getState();
  if (!engine.bootstrapped || !engine.language || signal.aborted) return;
  const language = engine.language;
  const voice = voiceForLanguage(language);
  update({ language, phase: 'checking', percent: 0 });
  if (!voice) { update({ phase: 'unavailable' }); return; }
  // Disk inspection/migration also runs while downloads are paused.
  const local = await installedVoicePath(voice);
  if (signal.aborted) return;
  if (local) { delay = 60_000; update({ phase: 'ready', percent: 100 }); return; }
  if (!state.enabled) { update({ phase: 'paused' }); return; }
  if (parked.has(voice.filename)) { update({ phase: 'failed' }); return; }
  try {
    await downloadVoice(voice, (percent, phase) => {
      if (!signal.aborted) update({ percent, phase: phase === 'verify' ? 'verifying' : 'downloading' });
    }, signal);
    if (!signal.aborted) { delay = 60_000; update({ phase: 'ready', percent: 100 }); }
  } catch (error) {
    if (signal.aborted) { update({ phase: 'paused' }); return; }
    update({ phase: 'failed' });
    if ((error as { fatal?: boolean })?.fatal) parked.add(voice.filename);
    else {
      retry = setTimeout(() => { retry = null; void pump(); }, delay);
      delay = Math.min(30 * 60_000, delay * 2);
    }
  }
}

/** Serialized across rapid language/profile changes; partial bytes remain resumable. */
function pump(): Promise<void> {
  if (!starts || AppState.currentState !== 'active') return Promise.resolve();
  if (running) { queued = true; return running; }
  clearRetry();
  const controller = new AbortController();
  active = controller;
  running = attempt(controller.signal).catch(() => {
    update({ phase: 'failed' });
    if (!controller.signal.aborted && starts) retry = setTimeout(() => { retry = null; void pump(); }, delay);
  }).finally(() => {
    active = null; running = null;
    if (queued) { queued = false; void pump(); }
  });
  return running;
}

export async function setVoiceDownloadsEnabled(enabled: boolean): Promise<void> {
  await initialize();
  await AsyncStorage.setItem(preference, String(enabled));
  update({ enabled });
  active?.abort();
  clearRetry();
  if (enabled) { parked.clear(); delay = 60_000; }
  if (running) queued = true;
  else void pump();
}

export function startVoiceDownloads(): () => void {
  if (++starts === 1) {
    const stopEngine = useEngineStore.subscribe((current, previous) => {
      if (current.language !== previous.language || current.bootstrapped !== previous.bootstrapped) {
        active?.abort(); clearRetry(); delay = 60_000;
        void pump();
      }
    });
    const app = AppState.addEventListener('change', value => {
      if (value === 'active') void pump();
      else { active?.abort(); clearRetry(); }
    });
    const network = subscribeInternetRestored(() => { delay = 60_000; void pump(); });
    stopListening = () => { stopEngine(); app.remove(); network(); };
    void pump();
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    if (--starts === 0) { stopListening?.(); stopListening = null; active?.abort(); clearRetry(); }
  };
}
