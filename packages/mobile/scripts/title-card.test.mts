import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterTitleCard, freshReview, observeCard, reviewDue } from '../src/reviews/logic';
const question = (id: string): any => ({ f: id, q: { en: 'Question' }, o: [{ en: 'A' }, { en: 'B' }, { en: 'C' }], a: 0 });
test('title preserves viewed history and counters; quiz follows five ordinary cards', () => {
  const prior = { ...freshReview(5), turns: 3, nextSingleTurn: 5 };
  let state = afterTitleCard(prior);
  assert.equal(state.turns, 3);
  assert.equal(state.seen, prior.seen);
  assert.equal(state.history, prior.history);
  assert.equal(state.nextSingleTurn, 8);
  for (let n = 1; n <= 5; n++) {
    state = observeCard(state, { id: String(n), factId: String(n), concept: String(n), topic: 'matter', subcategories: [] }, 'Matter', false, question, 0, () => String(n));
    assert.equal(reviewDue(state), n === 5);
  }
});
test('an introduction preserves queued quizzes and defers them instead of dropping them', () => {
  const before = { ...freshReview(5), turns: 10, queue: [{ kind: 'single' }] as any };
  const after = afterTitleCard(before);
  assert.equal(after.queue, before.queue);
  assert.equal(after.notBeforeTurn, 15);
  assert.equal(reviewDue(after), false);
});
