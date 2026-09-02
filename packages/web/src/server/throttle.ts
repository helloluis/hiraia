/**
 * In-process throttling for the public demo's model routes.
 *
 * WHAT IS BEING PROTECTED. hiraia.org, the chat demo, the card feed's ask box and the
 * embedder all run on ONE box (45.76.180.229: pm2 hiraia-web, hiraia-llm, hiraia-embed).
 * llama-server has a fixed, small number of generation slots, and a card generation holds one
 * for seconds. There are no accounts on the demo by design, so there is nothing to
 * authenticate — which means an unauthenticated loop of requests can occupy every slot and
 * take the marketing site down with it. Two independent limits, because they fail differently:
 *
 *   TOKEN BUCKET, per caller — stops one visitor (or one script) from asking over and over.
 *     Refills continuously, so a real child typing questions never notices it; `burst` is what
 *     a curious visitor can spend at once and `perMinute` the rate they get it back at.
 *   SEMAPHORE, process-wide — stops many callers from oversubscribing the model at once. This
 *     is the one that actually protects llama-server's slots, and no per-IP rule can do it.
 *
 * Both are model-FREE early returns: a throttled visitor gets a valid card (the honest gap
 * shape) rather than an error, which is also what they get when the model is down.
 *
 * IN-PROCESS ON PURPOSE. One Next server serves this site, so a shared store would add a
 * dependency and a failure mode to buy nothing. If the web ever runs multiple instances this
 * has to move to something they share — the semaphore especially, which is per-process.
 */

interface Bucket {
  tokens: number;
  updated: number;
}

export interface TokenBucketOptions {
  /** Requests a caller may make back-to-back from full. */
  burst: number;
  /** Sustained rate the bucket refills at. */
  perMinute: number;
  /** Idle buckets older than this are swept, so the map cannot grow without bound. */
  idleMs?: number;
}

export class TokenBucket {
  private readonly buckets = new Map<string, Bucket>();
  private readonly burst: number;
  private readonly perMs: number;
  private readonly idleMs: number;
  private lastSweep = 0;

  constructor({ burst, perMinute, idleMs = 10 * 60_000 }: TokenBucketOptions) {
    this.burst = burst;
    this.perMs = perMinute / 60_000;
    this.idleMs = idleMs;
  }

  /** Spend one token for `key`. False = throttled. */
  take(key: string, now: number = Date.now()): boolean {
    this.sweep(now);
    const b = this.buckets.get(key);
    if (!b) {
      this.buckets.set(key, { tokens: this.burst - 1, updated: now });
      return true;
    }
    b.tokens = Math.min(this.burst, b.tokens + (now - b.updated) * this.perMs);
    b.updated = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private sweep(now: number) {
    // A full bucket carries no state worth keeping, so a caller who stopped asking is dropped
    // once they would have refilled anyway. Swept at most once a minute.
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) {
      if (now - b.updated > this.idleMs) this.buckets.delete(k);
    }
  }
}

/** Process-wide ceiling on how many calls may be inside `run` at once. */
export class Semaphore {
  private inFlight = 0;
  constructor(private readonly limit: number) {}

  /** Runs `fn` if there is room, else returns null WITHOUT waiting — a queue here would just
   *  convert a busy model into a slow page, and the caller already has a good answer to give. */
  async tryRun<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.inFlight >= this.limit) return null;
    this.inFlight += 1;
    try {
      return await fn();
    } finally {
      this.inFlight -= 1;
    }
  }
}

/**
 * Best-effort caller identity. `x-forwarded-for` is set by the nginx in front of the Next
 * server; it is spoofable in principle, but this is a courtesy limit protecting a shared box,
 * not an access control. Everything unidentifiable shares one bucket, which is the safe way
 * round: a caller who hides gets the strictest treatment, not the loosest.
 */
export function callerKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim();
  return ip || 'unknown';
}
