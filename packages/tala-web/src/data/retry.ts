/**
 * Retry with randomised exponential backoff (RES-4): about 1, 2, 4, 8 … up to 60 s, at most five tries while
 * the teacher waits. Only errors that say they are retryable are retried; the caller's AbortSignal cancels.
 */
export interface RetryOptions {
  max?: number;
  baseMs?: number;
  capMs?: number;
  signal?: AbortSignal;
  isRetryable?: (err: unknown) => boolean;
  onRetry?: (attempt: number, delayMs: number) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class AbortedError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'AbortedError';
  }
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new AbortedError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function backoffDelay(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number = Math.random
): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt);
  // Full jitter: anything between half and the full exponential step, so devices do not retry in lockstep.
  return Math.round(exp / 2 + random() * (exp / 2));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const max = opts.max ?? 5;
  const baseMs = opts.baseMs ?? 1000;
  const capMs = opts.capMs ?? 60_000;
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable =
    opts.isRetryable ??
    ((e: unknown) =>
      !!(
        e &&
        typeof e === 'object' &&
        'retryable' in e &&
        (e as { retryable: boolean }).retryable
      ));
  let attempt = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new AbortedError();
    try {
      return await fn(attempt);
    } catch (err) {
      attempt += 1;
      if (attempt >= max || !isRetryable(err)) throw err;
      const delay = backoffDelay(attempt - 1, baseMs, capMs, opts.random);
      opts.onRetry?.(attempt, delay);
      await sleep(delay, opts.signal);
    }
  }
}
