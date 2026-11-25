/**
 * The hostile test files (src/modules/decks/hostile-files.ts) through the upload worker ALONE: no server, no
 * database, nothing native. For trying the reader's limits with any Node, for example the very one a host runs
 * (the worker needs Node 22.18 or newer: it runs the reader's TypeScript sources as they are).
 *
 *   pnpm exec tsx scripts/decks/hostile-worker.ts
 *   /usr/bin/node node_modules/tsx/dist/cli.mjs scripts/decks/hostile-worker.ts        with a Node of your choosing
 *
 * For every file: what the worker said, how long it took, and the longest this thread (which stands in for the web
 * server's one thread) went without a turn meanwhile. Then the worker's own two limits: a job stopped at its time
 * limit, and one stopped at its memory limit. Exit code 0 only when everything came out as written beside it.
 */
import { invalidEdits, normaliseEdits } from '@hiraia/tala-core/pptx';
import { HOSTILE_FILES } from '../../src/modules/decks/hostile-files';
import { UploadRefused } from '../../src/modules/decks/upload-file';
import { UploadWorkError, uploadWorkers } from '../../src/modules/decks/upload-jobs';

const HELD_MS = 500;
let failed = 0;
const say = (ok: boolean, line: string) => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${line}`);
};
const why = (err: unknown) => (err instanceof UploadRefused ? err.reason : err instanceof UploadWorkError ? `stopped at a limit (${err.kind})` : `error: ${String(err).slice(0, 80)}`);

async function watched<T>(job: () => Promise<T>): Promise<{ value?: T; refused?: string; ms: number; held: number }> {
  let longest = 0;
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 5);
  const started = performance.now();
  try {
    return { value: await job(), ms: Math.round(performance.now() - started), held: Math.round(longest) };
  } catch (err) {
    return { refused: why(err), ms: Math.round(performance.now() - started), held: Math.round(longest) };
  } finally {
    clearInterval(timer);
  }
}

async function main() {
  console.log(`Node ${process.version}`);
  const work = uploadWorkers();
  const problem = await work.check();
  say(problem === null, `a worker starts and loads the reader${problem ? `: ${problem}` : ''}`);
  if (problem) return;

  for (const hostile of HOSTILE_FILES) {
    const file = hostile.build();
    const r = await watched(() => work.read(file));
    const outcome = r.value ? 'accepted' : r.refused!;
    say(outcome === hostile.expect && r.ms < 12_000 && r.held < HELD_MS, `${hostile.name}: ${outcome} in ${r.ms} ms (this thread held ${r.held} ms at most); expected ${hostile.expect}`);
    if (!r.value || !hostile.then) continue;
    const deck = r.value;
    const wanted = { slides: hostile.then.edits({ base: deck } as never) };
    const invalid = invalidEdits(deck, wanted);
    if (invalid) {
      say(false, `${hostile.name}, then ${hostile.then.about}: the edits are not valid (${invalid})`);
      continue;
    }
    const w = await watched(() => work.write(file, normaliseEdits(deck, wanted)));
    const written = w.value ? 'written' : 'refused';
    say(written === hostile.then.download && w.ms < 22_000 && w.held < HELD_MS, `${hostile.name}, then ${hostile.then.about}: ${w.value ? `written, ${w.value.pptx.length} bytes` : `refused (${w.refused})`} in ${w.ms} ms (held ${w.held} ms); expected ${hostile.then.download}`);
  }

  // The worker's own limits, on the heaviest file that is still read.
  const heavy = HOSTILE_FILES.find((f) => f.name === 'eight-slides-each-within-the-limits')!.build();
  const small = HOSTILE_FILES.find((f) => f.name === 'cell-spanning-4000000000-columns')!.build();
  for (const [limits, kind] of [[{ readMs: 40 }, 'time'], [{ heapMb: 40 }, 'memory']] as const) {
    const limited = uploadWorkers(limits);
    const r = await watched(() => limited.read(heavy));
    say(r.refused === `stopped at a limit (${kind})` && r.ms < 5000 && r.held < HELD_MS, `a job at its ${kind} limit (${JSON.stringify(limits)}): ${r.refused ?? 'read'} after ${r.ms} ms (held ${r.held} ms)`);
  }
  const after = await watched(() => work.read(small));
  say(Boolean(after.value), `and an ordinary job afterwards: ${after.value ? 'read' : after.refused} in ${after.ms} ms`);
}

main().then(
  () => {
    console.log(failed ? `\n${failed} FAILED` : '\nall as expected');
    process.exit(failed ? 1 : 0);
  },
  (err) => {
    console.error(err);
    process.exit(2);
  }
);
