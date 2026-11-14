/** Measured once per JS process; RN's native startup marker is preferred. */
const jsEntry = performance.now();
let ready: { milliseconds: number; native: boolean } | null = null;
export function markReady() {
  if (ready) return;
  const timing = (performance as unknown as { rnStartupTiming?: { startTime?: number | null } })
    .rnStartupTiming;
  const start = timing?.startTime;
  ready = {
    milliseconds: Math.round(performance.now() - (typeof start === 'number' ? start : jsEntry)),
    native: typeof start === 'number',
  };
}
export function startupMeasurement() {
  return ready;
}
