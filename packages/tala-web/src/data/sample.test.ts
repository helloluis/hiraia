import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore, createSyncEngine } from '@hiraia/tala-core/sync';
import {
  blankSchoolYear,
  createSampleClass,
  removeSampleClasses,
  sampleCompetenciesFor,
} from './sample';

let n = 0;
const newId = () => `${(++n).toString(36)}-${'x'.repeat(4)}`;
const offline = {
  push: () =>
    Promise.reject(Object.assign(new Error('offline'), { code: 'network', retryable: true })),
  pull: () =>
    Promise.reject(Object.assign(new Error('offline'), { code: 'network', retryable: true })),
};

test('one tap adds the shared Grade 2 + Grade 4 sample bundle in one batch, and one tap removes all of it', async () => {
  const engine = createSyncEngine({
    store: createMemoryStore(),
    transport: offline as never,
    deviceId: 'd',
    now: () => new Date(),
    newId,
  });
  const year = blankSchoolYear(newId(), '2026-11-13', newId);
  await engine.put('school_year', year);
  const { classId } = await createSampleClass({
    engine,
    today: '2026-11-13',
    lang: 'fil',
    preset: null,
    existingYear: year,
    newId,
  });
  const cls = (await engine.get('class', classId))!.data;
  assert.equal(cls.isSample, true);
  assert.deepEqual(
    cls.gradeGroups.map((g) => g.grade),
    ['2', '4']
  );
  assert.ok((await engine.list('plan')).length >= 3, 'three example plans');
  assert.ok(
    (await engine.list('plan')).some((p) => p.data.state === 'locked'),
    'one locked'
  );
  assert.equal((await engine.list('student')).length, 6);
  assert.ok((await engine.list('pacing_track')).length >= 2);
  const comps = sampleCompetenciesFor(
    [cls],
    year.terms.map((t) => t.index)
  );
  assert.ok(
    comps.length > 0 && comps.every((c) => c.id.startsWith('fixture-demo-v1.')),
    'fixture competencies for pacing'
  );
  const removed = await removeSampleClasses(engine);
  assert.equal(removed, 1);
  for (const e of [
    'class',
    'assignment',
    'pacing_track',
    'student',
    'plan',
    'plan_section',
  ] as const)
    assert.equal((await engine.list(e)).length, 0, `${e} cleared`);
  assert.equal((await engine.list('school_year')).length, 1, 'the school year is not sample data');
});
