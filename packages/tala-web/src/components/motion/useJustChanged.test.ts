import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOutsideChange } from './useJustChanged';

test('the first sight of a value is not a change', () => {
  assert.equal(isOutsideChange(null, 'a', null), false);
});

test('the same value again is not a change (a saved record that equals the draft on screen)', () => {
  assert.equal(isOutsideChange('a', 'a', null), false);
  assert.equal(isOutsideChange('a', 'a', 'a'), false);
});

test('the teacher’s own edit coming back is not a change from outside', () => {
  assert.equal(isOutsideChange('a', 'ab', 'ab'), false);
});

test('a value replaced by something she did not type is a change from outside', () => {
  assert.equal(isOutsideChange('a', 'rewritten', null), true);
  // She typed "ab" earlier; an AI rewrite then replaces it.
  assert.equal(isOutsideChange('ab', 'rewritten', 'ab'), true);
});
