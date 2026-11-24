/**
 * Reading and writing an uploaded PowerPoint file OUTSIDE the web server's own thread.
 *
 * The file comes from a stranger. However carefully the reader is bounded (upload-file.ts gives every job a budget),
 * a file nobody thought of must not be able to hold the site's one thread for seconds or take its memory. So each
 * job runs in a worker thread of its own, started for that job and gone after it, with:
 *   - a time limit: past it the worker is stopped, wherever it is;
 *   - a memory limit of its own: past it the worker dies and the web server does not;
 *   - one job at a time for the whole server, and a short queue: more than that is told to come back;
 *   - the one place is shared out between accounts: an account can have one job being done and one waiting, and
 *     when the place is free it goes to the waiting account that has had the least of it lately. One account, or
 *     a few, cannot keep everybody else at "come back".
 * A job that is stopped is "this file is more than is read here", never a crash and never a fallback to reading
 * the file on the server's own thread: there is no such code path.
 */
import { Worker } from 'node:worker_threads';
import type { ApplyReport, DeckEdits, DeckInspection } from '@hiraia/tala-core/pptx';
import { UploadRefused, type UploadJob, type UploadJobResult } from './upload-file';

/**
 * A job that did not finish, for a reason that is not about what the file is:
 * `busy` (too many jobs waiting), `time` or `memory` (stopped at a limit), `fault` (the worker itself failed).
 */
export class UploadWorkError extends Error {
  readonly kind: 'busy' | 'time' | 'memory' | 'fault';
  /** For the server log only; never text from the file. */
  readonly detail: string;
  constructor(kind: 'busy' | 'time' | 'memory' | 'fault', detail = '') {
    super(`upload job: ${kind}`);
    this.name = 'UploadWorkError';
    this.kind = kind;
    this.detail = detail;
  }
}

/**
 * The file a job works on: its bytes, or a way to fetch them. A way to fetch them is called only when the job's
 * turn has come, so that jobs waiting their turn hold no file in memory; what it throws ends the job as it is.
 * For `write` and `take`, bytes that were fetched this way are HANDED to the worker, not copied: whoever fetched
 * them must not use them afterwards. (`read` gives the worker a copy.)
 */
export type UploadBytes = Uint8Array | (() => Uint8Array);

/**
 * Every job may say whose it is (`who`: an account's id, never anything of the file). Jobs with no owner named are
 * taken as one owner without a share of their own (tests, tools).
 */
export interface UploadWork {
  /** What the file holds. Throws UploadRefused (not a deck this version takes) or UploadWorkError. */
  read(file: UploadBytes, sha256?: string, who?: string): Promise<DeckInspection>;
  /**
   * The same for a file that is about to be stored. Its bytes are handed to the worker and come back with the
   * reading, so the file is in memory once and nowhere twice. The worker takes the checksum before it reads and
   * again afterwards; only a file that is still the one announced comes back.
   */
  take(file: () => Uint8Array, sha256: string, who?: string): Promise<{ inspection: DeckInspection; file: Uint8Array }>;
  /**
   * The file with the edits written in. Throws UploadRefused or UploadWorkError. `sha256`: what the file has to be
   * (it was put back together from stored pieces); a file that is not is refused as `checksum_mismatch`.
   */
  write(file: UploadBytes, edits: DeckEdits, sha256?: string, who?: string): Promise<{ pptx: Uint8Array; report: ApplyReport }>;
  /** Whether a worker can start and load the reader at all. Resolves to null when it can, else to why not. */
  check(): Promise<string | null>;
}

export interface UploadWorkOptions {
  /** How long reading a file may take, and writing one out, in milliseconds. */
  readMs?: number;
  writeMs?: number;
  /** The worker's own heap, in MiB (its file and its results are outside this and bounded by the job's budget). */
  heapMb?: number;
  /** Jobs that may wait for their turn. */
  waiting?: number;
  /** How long a job may wait for its turn. */
  waitMs?: number;
  /** Jobs one account may have here at once, being done or waiting. */
  perAccount?: number;
}

export function uploadWorkers(options: UploadWorkOptions = {}): UploadWork {
  const readMs = options.readMs ?? 10_000;
  const writeMs = options.writeMs ?? 20_000;
  const heapMb = options.heapMb ?? 192;
  const maxWaiting = options.waiting ?? 8;
  const waitMs = options.waitMs ?? 15_000;
  const perAccount = options.perAccount ?? 2;
  let running = false;
  const queue: Array<{ who: string; since: number; go: () => void }> = [];
  /** Jobs each account has here now (being done or waiting), and the time its jobs took in the last minute. */
  const here = new Map<string, number>();
  const spent = new Map<string, Array<{ at: number; ms: number }>>();
  const leave = (who: string) => {
    const n = (here.get(who) ?? 1) - 1;
    if (n > 0) here.set(who, n);
    else here.delete(who);
  };
  const lately = (who: string, now: number): number => {
    const recent = (spent.get(who) ?? []).filter((s) => now - s.at < 60_000);
    if (recent.length) spent.set(who, recent);
    else spent.delete(who);
    return recent.reduce((sum, s) => sum + s.ms, 0);
  };

  /**
   * One job at a time. A job waits its turn for a while; a long queue is turned away at once, and so is an account
   * that already has its share of jobs here. The free place goes to the waiting account that has used the least
   * of it in the last minute (who has waited longest, among equals).
   */
  async function turn<T>(who: string, job: () => Promise<T>): Promise<T> {
    if (who !== '' && (here.get(who) ?? 0) >= perAccount) throw new UploadWorkError('busy');
    if (running) {
      if (queue.length >= maxWaiting) throw new UploadWorkError('busy');
      here.set(who, (here.get(who) ?? 0) + 1);
      try {
        // Woken by the job before it, which hands its turn over directly (`running` stays true in between).
        await new Promise<void>((resolve, reject) => {
          const mine = {
            who,
            since: Date.now(),
            go: () => {
              clearTimeout(timer);
              resolve();
            },
          };
          const timer = setTimeout(() => {
            const at = queue.indexOf(mine);
            if (at >= 0) queue.splice(at, 1);
            reject(new UploadWorkError('busy'));
          }, waitMs);
          queue.push(mine);
        });
      } catch (err) {
        leave(who);
        throw err;
      }
    } else {
      running = true;
      here.set(who, (here.get(who) ?? 0) + 1);
    }
    const started = Date.now();
    try {
      return await job();
    } finally {
      const now = Date.now();
      leave(who);
      // Only the last minute is kept, for this account and (now and then) for all of them: nothing here grows with
      // the number of jobs a server has done or of accounts it has seen.
      spent.set(who, [...(spent.get(who) ?? []).filter((s) => now - s.at < 60_000), { at: now, ms: now - started }]);
      if (spent.size > 256) for (const other of [...spent.keys()]) lately(other, now);
      let next = -1;
      let least = Infinity;
      queue.forEach((w, i) => {
        const used = lately(w.who, now);
        if (used < least) {
          least = used;
          next = i;
        }
      });
      if (next >= 0) queue.splice(next, 1)[0]!.go();
      else running = false;
    }
  }

  function run(job: UploadJob, timeoutMs: number, handOver = false): Promise<UploadJobResult> {
    return new Promise((resolve, reject) => {
      // Keep the Node worker as a file, rather than a webpack worker entry chunk (as the class-list reader does).
      const workerUrl = new URL('./upload-worker.mjs', import.meta.url);
      const start = (hand: boolean) =>
        new Worker(workerUrl, {
          workerData: job,
          // Handed over, the file's memory moves to the worker instead of being copied for it.
          ...(hand && 'bytes' in job ? { transferList: [job.bytes.buffer as ArrayBuffer] } : {}),
          execArgv: [],
          env: {},
          resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
          stdout: true,
          stderr: true,
        });
      let worker: Worker;
      try {
        try {
          worker = start(handOver);
        } catch (err) {
          // Memory that cannot be handed over (it depends on where the bytes came from) is copied after all.
          if (!handOver || (err as Error).name !== 'DataCloneError') throw err;
          worker = start(false);
        }
      } catch (err) {
        return reject(new UploadWorkError('fault', String((err as { code?: unknown }).code ?? 'could not start')));
      }
      // Nothing a worker prints is forwarded: it could hold words of a slide.
      worker.stdout.resume();
      worker.stderr.resume();
      let done = false;
      const finish = (err: UploadWorkError | null, result?: UploadJobResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        // The job is over only when its worker has gone and given its memory back: "one job at a time" has to
        // mean one worker alive at a time, or under steady load two jobs' memory would add up.
        const settle = () => (err ? reject(err) : resolve(result!));
        void worker.terminate().then(settle, settle);
      };
      const timer = setTimeout(() => finish(new UploadWorkError('time')), timeoutMs);
      worker.once('message', (message: UploadJobResult | { ok: false; fault: string }) => {
        if (!message.ok && 'fault' in message) finish(new UploadWorkError('fault', message.fault));
        else finish(null, message as UploadJobResult);
      });
      worker.once('error', (err: NodeJS.ErrnoException) => finish(new UploadWorkError(err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'memory' : 'fault', String(err.code ?? err.name ?? 'error').slice(0, 80))));
      worker.once('exit', () => finish(new UploadWorkError('fault', 'ended without an answer')));
    });
  }

  const refused = (result: UploadJobResult): never => {
    throw new UploadRefused((result as { reason: UploadRefused['reason'] }).reason);
  };
  /**
   * The bytes as the worker is given them: exactly the file and nothing around it. (Handing bytes to a worker
   * copies the whole block of memory they are a view of.)
   */
  const bytesOf = (file: UploadBytes): { bytes: Uint8Array; ours: boolean } => {
    const bytes = typeof file === 'function' ? file() : file;
    if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return { bytes, ours: typeof file === 'function' };
    return { bytes: bytes.slice(), ours: true };
  };

  return {
    read: (file, sha256, who = '') =>
      turn(who, async () => {
        const result = await run({ kind: 'read', bytes: bytesOf(file).bytes, sha256 }, readMs);
        return result.ok && result.kind === 'read' ? result.inspection : refused(result);
      }),
    take: (file, sha256, who = '') =>
      turn(who, async () => {
        const result = await run({ kind: 'read', bytes: bytesOf(file).bytes, sha256 }, readMs, true);
        if (!result.ok || result.kind !== 'read') return refused(result);
        if (result.sha256 !== sha256) throw new UploadWorkError('fault', 'the file was not the same after it was read');
        return { inspection: result.inspection, file: result.bytes };
      }),
    write: (file, edits, sha256, who = '') =>
      turn(who, async () => {
        const { bytes, ours } = bytesOf(file);
        const result = await run({ kind: 'write', bytes, edits, sha256 }, writeMs, ours);
        return result.ok && result.kind === 'write' ? { pptx: result.pptx, report: result.report } : refused(result);
      }),
    check: () =>
      turn('', async () => {
        try {
          const result = await run({ kind: 'ping' }, readMs);
          return result.ok ? null : 'unexpected answer';
        } catch (err) {
          return err instanceof UploadWorkError ? `${err.kind}${err.detail ? ` (${err.detail})` : ''}` : 'error';
        }
      }),
  };
}
