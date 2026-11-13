import assert from 'node:assert/strict';
import { test } from 'node:test';
import { API, BUILTIN_TEMPLATES, CONFLICT_POLICY, ENTITY_NAMES, ROUTE_NAMES, Template, buildPath, parseRecordData } from './index';
import { CONTRAST_PAIRS, colors, contrastRatio } from '../tokens';

test('built-in templates validate', () => {
  for (const t of BUILTIN_TEMPLATES) Template.parse(t);
  assert.ok(BUILTIN_TEMPLATES.some((t) => t.kind === 'multigrade'));
});

test('every entity has a conflict policy', () => {
  for (const e of ENTITY_NAMES) assert.ok(CONFLICT_POLICY[e], e);
});

test('route table: unique method+path, valid shapes', () => {
  const seen = new Set<string>();
  for (const name of ROUTE_NAMES) {
    const r = API[name];
    const key = `${r.method} ${r.path}`;
    assert.ok(!seen.has(key), `duplicate route ${key}`);
    seen.add(key);
    assert.ok(r.path.startsWith('/'));
    if (r.method === 'GET') assert.ok(!('body' in r), `${name}: GET with body`);
  }
  assert.equal(buildPath('/plans/:planId/revisions/:revision', { planId: 'p 1', revision: '3' }), '/plans/p%201/revisions/3');
});

test('a class accepts one to four grade groups and no more (decision 13)', () => {
  const base = { id: 'class-0001', schoolYearId: 'sy-000001', name: 'Grade 2 & 4' };
  const gg = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `gg-00000${i}`, grade: String(i + 1) }));
  assert.equal(parseRecordData('class', { ...base, gradeGroups: gg(4) }).gradeGroups.length, 4);
  assert.throws(() => parseRecordData('class', { ...base, gradeGroups: gg(5) }));
  assert.throws(() => parseRecordData('class', { ...base, gradeGroups: [] }));
});

test('brand colour pairings meet WCAG AA (BRAND-5)', () => {
  for (const [fg, bg, min] of CONTRAST_PAIRS) {
    const ratio = contrastRatio(colors[fg], colors[bg]);
    assert.ok(ratio >= min, `${fg} on ${bg} = ${ratio.toFixed(2)} < ${min}`);
  }
});
