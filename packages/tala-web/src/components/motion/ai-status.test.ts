import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LONGER_AFTER_MS,
  QUEUE_SHOWN_AFTER_MS,
  SLOW_AFTER_MS,
  STILL_AFTER_MS,
  aiCaption,
  formatElapsed,
  phaseOf,
} from './ai-status';

test('the phase is the job’s own status; before the server answers it is "sending"', () => {
  assert.equal(phaseOf(null), 'sending');
  assert.equal(phaseOf(undefined), 'sending');
  assert.equal(phaseOf('queued'), 'queued');
  assert.equal(phaseOf('running'), 'running');
  // Finished states never reach the waiting component; they must not be shown as "writing".
  assert.equal(phaseOf('done'), 'sending');
});

/** A request that has been in the queue long enough for "waiting in line" to be true. */
const IN_LINE = QUEUE_SHOWN_AFTER_MS;

test('the words follow the real state first', () => {
  assert.equal(aiCaption({ phase: 'sending', elapsedMs: 0, reachable: true, queuedForMs: 0 }), 'sending');
  assert.equal(aiCaption({ phase: 'queued', elapsedMs: 3_000, reachable: true, queuedForMs: IN_LINE }), 'queued');
  assert.equal(aiCaption({ phase: 'running', elapsedMs: 3_000, reachable: true, queuedForMs: 0 }), 'running');
});

test('"waiting in line" is not said in the moment every new request spends queued: only once it has really waited', () => {
  const at = (queuedForMs: number) => aiCaption({ phase: 'queued', elapsedMs: 200 + queuedForMs, reachable: true, queuedForMs });
  // The server answers "queued" at once and starts the job a tenth of a second later when nothing is ahead of it;
  // the screen hears of that about a second later. No line is claimed in that time.
  assert.equal(at(0), 'sending');
  assert.equal(at(1_100), 'sending');
  assert.equal(at(QUEUE_SHOWN_AFTER_MS - 1), 'sending');
  // Still queued after more than one look: something is ahead of it.
  assert.equal(at(QUEUE_SHOWN_AFTER_MS), 'queued');
  assert.equal(at(30_000), 'queued');
  assert.ok(QUEUE_SHOWN_AFTER_MS > 1_000, 'longer than the first look at the job takes (one second)');
  // A clock that cannot be read claims no line either.
  assert.equal(at(Number.NaN), 'sending');
});

test('a request that has not been answered yet is never described as being written, however long it takes', () => {
  for (const ms of [0, STILL_AFTER_MS, LONGER_AFTER_MS, SLOW_AFTER_MS, 600_000])
    assert.equal(aiCaption({ phase: 'sending', elapsedMs: ms, reachable: true, queuedForMs: 0 }), 'sending');
});

test('a queued request is never described as being written', () => {
  for (const ms of [0, STILL_AFTER_MS, LONGER_AFTER_MS, SLOW_AFTER_MS - 1])
    assert.equal(aiCaption({ phase: 'queued', elapsedMs: ms, reachable: true, queuedForMs: Math.max(IN_LINE, ms) }), 'queued');
  // …and not while it has only just been queued, either.
  for (const queuedForMs of [0, 500, QUEUE_SHOWN_AFTER_MS - 1])
    assert.notEqual(aiCaption({ phase: 'queued', elapsedMs: 30_000, reachable: true, queuedForMs }), 'running');
});

test('while it is being written the words change only with the time really waited', () => {
  const at = (ms: number) => aiCaption({ phase: 'running', elapsedMs: ms, reachable: true, queuedForMs: 0 });
  assert.equal(at(STILL_AFTER_MS - 1), 'running');
  assert.equal(at(STILL_AFTER_MS), 'still');
  assert.equal(at(LONGER_AFTER_MS - 1), 'still');
  assert.equal(at(LONGER_AFTER_MS), 'longer');
  assert.equal(at(SLOW_AFTER_MS - 1), 'longer');
  assert.equal(at(SLOW_AFTER_MS), 'slow');
  assert.equal(at(10 * 60_000), 'slow');
});

test('past the stated "under a minute", queued or running, the screen says it is taking longer than usual', () => {
  assert.ok(
    SLOW_AFTER_MS > 60_000,
    'never called slow inside the minute the screen itself promises'
  );
  assert.equal(aiCaption({ phase: 'queued', elapsedMs: SLOW_AFTER_MS, reachable: true, queuedForMs: SLOW_AFTER_MS }), 'slow');
  assert.equal(aiCaption({ phase: 'running', elapsedMs: SLOW_AFTER_MS, reachable: true, queuedForMs: 0 }), 'slow');
});

test('no connection wins over everything: the screen does not claim progress it cannot see', () => {
  for (const phase of ['sending', 'queued', 'running'] as const)
    for (const ms of [0, STILL_AFTER_MS, SLOW_AFTER_MS])
      assert.equal(aiCaption({ phase, elapsedMs: ms, reachable: false, queuedForMs: ms }), 'offline');
});

test('a broken clock does not invent a long wait', () => {
  assert.equal(aiCaption({ phase: 'running', elapsedMs: Number.NaN, reachable: true, queuedForMs: 0 }), 'running');
  assert.equal(aiCaption({ phase: 'running', elapsedMs: -5_000, reachable: true, queuedForMs: 0 }), 'running');
});

test('elapsed time is minutes and seconds actually waited', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(999), '0:00');
  assert.equal(formatElapsed(7_400), '0:07');
  assert.equal(formatElapsed(59_999), '0:59');
  assert.equal(formatElapsed(60_000), '1:00');
  assert.equal(formatElapsed(83_000), '1:23');
  assert.equal(formatElapsed(-10), '0:00');
  assert.equal(formatElapsed(Number.NaN), '0:00');
});
