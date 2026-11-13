import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from './en';
import { fil } from './fil';
import { format } from './format';

test('every English key has a Filipino string and vice versa', () => {
  const a = Object.keys(en).sort();
  const b = Object.keys(fil).sort();
  assert.deepEqual(a, b);
});

test('placeholders match between languages', () => {
  for (const k of Object.keys(en) as Array<keyof typeof en>) {
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    assert.deepEqual(vars(fil[k]), vars(en[k]), `placeholders differ for ${k}`);
  }
});

test('format interpolates and leaves unknown keys', () => {
  assert.equal(format('{n} sessions behind', { n: 3 }), '3 sessions behind');
  assert.equal(format('Hi {x}', {}), 'Hi {x}');
});
