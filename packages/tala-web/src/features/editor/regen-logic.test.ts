import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TalaApiError, type GenerationJob } from '@hiraia/tala-core/contracts';
import { parseResources, regenBlocker, regenErrorKey, usableResult } from './regen-logic';

const profile = (materials: string[], textbooks: string[] = []) => ({
  profile: { materials, textbooks, electricity: null, projector: null, printing: null, outdoorSpace: null, notes: '' },
});
const job = (status: GenerationJob['status'], items: string[] | null): GenerationJob => ({
  id: 'j1',
  status,
  kind: 'section',
  planId: 'p1',
  createdAt: '2026-11-27T03:33:04.437Z',
  finishedAt: null,
  result:
    items === null
      ? null
      : { title: 'T', sections: [{ key: 'materials', content: { type: 'list', items } }] as never, provider: 'deepseek', model: 'm', warnings: [] },
  failure: null,
});

test('Materials needs the class resources first; other parts need nothing (the 27 Nov silent failure)', () => {
  assert.equal(regenBlocker('materials', profile([])), 'no_class_resources');
  assert.equal(regenBlocker('materials', null), 'no_class_resources');
  assert.equal(regenBlocker('materials', profile(['  '])), 'no_class_resources');
  assert.equal(regenBlocker('materials', profile([], ['Science 4 Learner’s Material'])), null);
  assert.equal(regenBlocker('materials', profile(['chalkboard'])), null);
  assert.equal(regenBlocker('procedure', profile([])), null);
});

test('typed materials are stored like the Class page stores them', () => {
  assert.deepEqual(parseResources(' chalkboard, manila paper\ncrayons,, Chalkboard , '), ['chalkboard', 'manila paper', 'crayons']);
  assert.deepEqual(parseResources(''), []);
  assert.equal(parseResources(Array.from({ length: 80 }, (_, i) => `item ${i}`).join(',')).length, 60);
});

test('an empty or blank answer is never applied; a real one is', () => {
  assert.equal(usableResult(job('done', []), 'materials'), false);
  assert.equal(usableResult(job('done', [' ', '']), 'materials'), false);
  assert.equal(usableResult(job('done', null), 'materials'), false);
  assert.equal(usableResult(job('failed', ['chalkboard']), 'materials'), false);
  assert.equal(usableResult(job('done', ['chalkboard']), 'procedure'), false, 'the wrong part is not a result');
  assert.equal(usableResult(job('done', ['chalkboard', 'crayons']), 'materials'), true);
});

test('the server prerequisite answer maps to its own message', () => {
  assert.equal(regenErrorKey(new TalaApiError('invalid_input', 'x', 400, { reason: 'no_class_resources' })), 'gen.materials.needResources');
  assert.equal(regenErrorKey(new TalaApiError('invalid_input', 'x', 400, { reason: 'other' })), null);
  assert.equal(regenErrorKey(new Error('x')), null);
});
