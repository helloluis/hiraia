import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { AppState, Platform } from 'react-native';
import { newId, Outbox, type Event, type Props } from './core';
import { openRepository, type TelemetryRepository } from './repository';

// Override at build time for staging. No secret is shipped in the APK.
const ENDPOINT = process.env.EXPO_PUBLIC_TELEMETRY_URL || 'https://hiraia.org/api/telemetry/batch';
const clean = (value: unknown) =>
  String(value ?? 'unknown')
    .replace(/[^a-zA-Z0-9_.:-]/g, '_')
    .slice(0, 100) || 'unknown';
const context: Props = {
  app_version: clean(Constants.expoConfig?.version),
  build: clean(
    process.env.EXPO_PUBLIC_BUILD_ID ||
      Constants.expoConfig?.android?.versionCode ||
      'pilot-telemetry-v1'
  ),
  android: clean(Platform.Version),
  abi: clean(Device.supportedCpuArchitectures?.[0]),
  ram_gb: Device.totalMemory ? Math.ceil(Device.totalMemory / 1073741824) : 0,
};
let sessionId = newId();
let sessionEvent = event('session_started');
let repository: Promise<TelemetryRepository> | undefined;
let activeRequest: AbortController | undefined;
let enabled = true;
function getRepository(): Promise<TelemetryRepository> {
  if (!repository)
    repository = openRepository(sessionEvent).catch((error) => {
      repository = undefined;
      throw error;
    });
  return repository;
}
function event(name: string, props: Props = {}, id = newId()): Event {
  return {
    id,
    name,
    occurred_at: Date.now(),
    session_id: sessionId,
    props: { ...context, ...props },
  };
}
function retryAfter(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.max(0, seconds * 1000)
    : Math.max(0, Date.parse(value) - Date.now()) || 0;
}
const queue = new Outbox(getRepository, async (body) => {
  if (!enabled || AppState.currentState !== 'active' || !ENDPOINT.startsWith('https://'))
    return { ok: false };
  const controller = new AbortController();
  activeRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!response.ok)
      return { ok: false, retryAfterMs: retryAfter(response.headers.get('retry-after')) };
    const data = await response.json();
    return { ok: true, acknowledged: data.acknowledged, rejected: data.rejected };
  } finally {
    clearTimeout(timeout);
    if (activeRequest === controller) activeRequest = undefined;
  }
});
export function track(name: string, props: Props = {}, id?: string): void {
  if (enabled) queue.enqueue([event(name, props, id)]);
}
export function trackMany(items: { name: string; props: Props; id?: string }[]): void {
  if (enabled && items.length) queue.enqueue(items.map((i) => event(i.name, i.props, i.id)));
}
export { newId };
export function errorCategory(error: unknown): string {
  // Classify locally. Never transmit exception text, paths, URLs, queries or answers.
  const text = error instanceof Error ? error.message.toLowerCase() : '';
  if (/abort|cancel/.test(text)) return 'cancelled';
  if (/md5|hash|integrity|digest|size mismatch/.test(text)) return 'integrity';
  if (/enospc|space|disk|permission/.test(text)) return 'storage';
  if (/http|status/.test(text)) return 'http';
  if (/network|fetch|socket|timeout|timed out|connection|stall/.test(text)) return 'network';
  return 'runtime';
}
let mounted = 0;
export function startTelemetry(): () => void {
  if (mounted++)
    return () => {
      mounted--;
    };
  let backgroundAt = 0;
  const flush = () => {
    if (enabled && AppState.currentState === 'active') void queue.flush();
  };
  // Initialization records first_open and this process's session atomically.
  void getRepository()
    .then(async (repo) => {
      enabled = await repo.isEnabled();
      flush();
    })
    .catch(() => {});
  const timer = setInterval(flush, 30000);
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      if (backgroundAt && Date.now() - backgroundAt >= 30 * 60000) {
        sessionId = newId();
        sessionEvent = event('session_started');
        if (enabled) queue.enqueue([sessionEvent]);
      }
      backgroundAt = 0;
      flush();
    } else if (!backgroundAt) {
      backgroundAt = Date.now();
      activeRequest?.abort();
    }
  });
  return () => {
    mounted--;
    clearInterval(timer);
    sub.remove();
    activeRequest?.abort();
  };
}

/** Disabling clears unsent data and stops future collection, including after restart. */
export async function telemetryEnabled(): Promise<boolean> {
  return (await getRepository()).isEnabled();
}
export async function setTelemetryEnabled(value: boolean): Promise<void> {
  enabled = false;
  activeRequest?.abort();
  await queue.drainWrites();
  const repo = await getRepository();
  await repo.setEnabled(value);
  enabled = value;
  if (value) {
    sessionId = newId();
    track('session_started');
    void queue.flush();
  }
}
