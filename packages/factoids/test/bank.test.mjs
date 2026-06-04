import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBank, sampleFactoid } from '../src/bank.mjs';

const mk = (id, grades = []) => ({ id, imageId: id, subject: 'biology', hook: { tl: id }, body: { tl: '.' }, grades, verified: true });
const POOL = [mk('a', [3, 4]), mk('b', [5, 6]), mk('c'), mk('d', [10])];
const seq = (xs) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

test('sampleFactoid avoids recent ids', () => {
  const f = sampleFactoid(POOL, { recentIds: ['a', 'b', 'd'], rng: seq([0]) });
  assert.equal(f.id, 'c', 'only c is not recent');
});

test('grade filter keeps grade-matching and untagged (empty grades = all)', () => {
  // grade 3: 'a' matches, 'c' is untagged (all) → pool of 2; rng 0 → first
  const f = sampleFactoid(POOL, { grade: 3, rng: seq([0]) });
  assert.ok(['a', 'c'].includes(f.id));
  // grade 7: nobody tagged 7 except untagged 'c' → must be c
  const g = sampleFactoid(POOL, { grade: 7, rng: seq([0.99]) });
  assert.equal(g.id, 'c');
});

test('history relaxes when it would exclude everything', () => {
  const f = sampleFactoid(POOL, { recentIds: ['a', 'b', 'c', 'd'], rng: seq([0]) });
  assert.ok(f, 'returns something rather than null when all are recent');
});

test('empty pool returns null', () => {
  assert.equal(sampleFactoid([], {}), null);
});

test('loadBank returns only verified factoids from the real bank', () => {
  const bank = loadBank();
  assert.ok(bank.length >= 24, `expected >=24 verified, got ${bank.length}`);
  assert.ok(bank.every((f) => f.verified === true));
  assert.ok(bank.every((f) => f.imageId && f.hook && f.body));
});
