import type { SyncEngine, SyncReport } from '@hiraia/tala-core/contracts';
import { retryDelay } from './ladder';
export function syncWindow(now: Date, light: boolean) {
  const date = (offset: number) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  return {
    windowFrom: date(light ? -((now.getUTCDay() + 6) % 7) : -28),
    windowTo: date(light ? 6 - ((now.getUTCDay() + 6) % 7) : 56),
  };
}
/** Single flight, cancellable scheduling, no wake lock. Durable engine outbox resumes after process death. */
export function createScheduler(
  engine: SyncEngine,
  options: {
    online(): boolean;
    light(): boolean;
    changed(ok: boolean, elapsedMs: number, report: SyncReport): void;
    delay?: typeof retryDelay;
  }
) {
  let timer: ReturnType<typeof setTimeout> | undefined,
    running = false,
    stopped = false,
    attempts = 0;
  async function run() {
    timer = undefined;
    if (running || stopped || !options.online()) return;
    running = true;
    const start = Date.now();
    try {
      const report = await engine.sync(syncWindow(new Date(), options.light()));
      options.changed(report.ok, Date.now() - start, report);
      attempts = report.ok ? 0 : attempts + 1;
      if (!report.ok && report.error !== 'unauthenticated' && !stopped)
        timer = setTimeout(
          run,
          attempts < 5 ? (options.delay ?? retryDelay)(attempts - 1) : 60_000
        );
    } finally {
      running = false;
    }
  }
  return {
    start() {
      stopped = false;
      if (timer) clearTimeout(timer);
      void run();
    },
    kick() {
      if (!timer && !running && !stopped) timer = setTimeout(run, 1000);
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
