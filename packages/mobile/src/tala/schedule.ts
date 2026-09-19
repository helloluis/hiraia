/** Quiet cadence: brief Nearby looks, then radios off. No student tap required. */
export const REST_MS = 15 * 60 * 1000;
export const BURST_MS = 90 * 1000;
export const FIRST_BURST_MS = 3 * 60 * 1000;

export function dueForSearch(lastSync: number, now: number, interval = REST_MS): boolean {
  if (!lastSync) return true;
  return now - lastSync >= interval;
}

export function restDelay(lastSync: number, now: number, interval = REST_MS): number {
  if (!lastSync) return 0;
  return Math.max(0, interval - (now - lastSync));
}

/** 12–18 minutes so 35 phones do not wake in lockstep. */
export function jitteredRest(interval = REST_MS): number {
  return Math.round(interval * (0.8 + Math.random() * 0.4));
}
