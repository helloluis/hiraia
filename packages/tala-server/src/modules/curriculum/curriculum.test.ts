import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalendarPreset, CurriculumIndex, CurriculumPack, LIMITS } from '@hiraia/tala-core';
import { createCurriculumModule, loadCurriculumData } from './index';
import type { RecordStore } from '../../kernel/types';
import { createTestServer } from '../../testing';

test('all source packs validate, carry pages and preserve distinct versions without fixture leakage', () => {
  const data = loadCurriculumData();
  CurriculumIndex.parse(data.index);
  assert.equal(data.packs.size, 8);
  assert.equal(data.index.learningAreas.length, 1);
  assert.deepEqual(data.index.learningAreas[0]!.stages, ['elementary', 'jhs']);
  assert.equal([...data.packs.values()].reduce((n, p) => n + p.competencyCount, 0), 322);
  for (const p of data.packs.values()) {
    CurriculumPack.parse(p);
    assert.ok(Buffer.byteLength(JSON.stringify(p)) <= LIMITS.maxApiResponseBytes, `${p.packId} exceeds the API response budget`);
    for (const c of p.competencies) { assert.ok(c.source.page! > 0); assert.ok(c.source.url); assert.ok(c.contentStandard); assert.ok(c.performanceStandard); assert.equal(c.code, null); }
  }
  assert.equal(data.service.versionFor('2026-2027', '4', 'science'), 'science-bow-2026');
  assert.equal(data.service.versionFor('2027-2028', '4', 'science'), null);
  assert.equal(data.service.versionFor('2026-2027', '2', 'science'), null);
  assert.equal(data.service.versionFor('2026-2027', '2', 'mathematics'), null);
  assert.deepEqual(data.service.getCompetencies('unknown-version', ['unknown']), []);
  const first = [...data.packs.values()][0]!, id = first.competencies[0]!.id;
  const found = data.service.getCompetencies(first.curriculumVersion, [id])[0]!; found.text = 'changed';
  assert.notEqual(data.service.getCompetencies(first.curriculumVersion, [id])[0]!.text, 'changed');
});
test('demo packs require explicit opt-in and are visibly synthetic', () => {
  const data = loadCurriculumData(undefined, true);
  assert.equal(data.packs.size, 12);
  for (const p of data.packs.values()) if (p.curriculumVersion.startsWith('fixture-')) assert.ok(p.competencies.every(c => c.text.startsWith('SAMPLE DATA ONLY')));
});
test('calendar presets explicitly remain provisional with no fabricated holidays', () => {
  const data = loadCurriculumData(); assert.equal(data.presets.size, 2);
  for (const preset of data.presets.values()) { CalendarPreset.parse(preset); assert.equal(preset.provisional, true); assert.equal(preset.days.length, 0); assert.match(preset.source, /no DepEd/); }
});
test('public curriculum and calendar routes run through the real kernel', async () => {
  const t = createTestServer({ modules: [createCurriculumModule()] });
  try {
    const index = await t.ok('curriculum.index');
    assert.equal(index.packs.length, 8);
    for (const meta of index.packs) {
      const pack = await t.ok('curriculum.pack', { params: { packId: meta.packId } });
      assert.equal(pack.competencies.length, meta.competencyCount);
      assert.ok(Buffer.byteLength(JSON.stringify(pack)) <= LIMITS.maxApiResponseBytes);
    }
    const calendarIndex = await t.ok('calendar.presets');
    assert.equal(calendarIndex.presets.length, 2);
    for (const meta of calendarIndex.presets) {
      const preset = await t.ok('calendar.preset', { params: { presetId: meta.id } });
      assert.equal(preset.provisional, true);
      assert.equal(preset.terms.length, 3);
    }
    assert.equal(t.services.curriculum.versionFor('2026-2027', '4', 'science'), 'science-bow-2026');
    assert.deepEqual(t.errors, []);
  } finally { t.close(); }
});
test('check summaries require real authentication and call only aggregate checkTallies', async () => {
  let calls = 0;
  const unexpected = (): never => { throw new Error('Curriculum must not access individual teacher records.'); };
  const records: RecordStore = {
    get: unexpected, list: unexpected, put: unexpected, remove: unexpected, planSnapshot: unexpected,
    checkTallies(version, ids) {
      calls++;
      assert.equal(version, 'science-bow-2026'); assert.equal(ids.length, 33);
      return { confirmed: { [ids[0]!]: 3 }, corrected: { [ids[1]!]: 2 } };
    },
  };
  const t = createTestServer({ modules: [createCurriculumModule()], services: { records } });
  try {
    const params = { packId: 'science-bow-2026:4:science' };
    const anonymous = await t.call('curriculum.checkSummary', { params });
    assert.equal(anonymous.status, 401); assert.equal(calls, 0);
    const teacher = await t.registerUser();
    const summary = await t.ok('curriculum.checkSummary', { params, token: teacher.token });
    assert.equal(summary.packId, params.packId);
    assert.deepEqual(Object.values(summary.confirmedBy), [3]);
    assert.deepEqual(Object.values(summary.correctedBy), [2]);
    assert.equal(calls, 1);
    const missing = await t.call('curriculum.checkSummary', { params: { packId: 'missing' }, token: teacher.token });
    assert.equal(missing.status, 404); assert.equal(calls, 1);
    assert.deepEqual(t.errors, []);
  } finally { t.close(); }
});
test('missing and fixture-only packs return real HTTP 404 responses by default', async () => {
  const t = createTestServer({ modules: [createCurriculumModule()] });
  try {
    for (const packId of ['missing', 'fixture-demo-v1:2:mathematics']) {
      const result = await t.call('curriculum.pack', { params: { packId } });
      assert.equal(result.status, 404);
    }
    const missingCalendar = await t.call('calendar.preset', { params: { presetId: 'missing' } });
    assert.equal(missingCalendar.status, 404);
    assert.deepEqual(t.errors, []);
  } finally { t.close(); }
  const demo = createTestServer({ modules: [createCurriculumModule({ includeFixtures: true })] });
  try {
    const pack = await demo.ok('curriculum.pack', { params: { packId: 'fixture-demo-v1:2:mathematics' } });
    assert.ok(pack.competencies.every(c => c.text.startsWith('SAMPLE DATA')));
    assert.deepEqual(demo.errors, []);
  } finally { demo.close(); }
});
test('malformed pack fails startup validation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tala-curriculum-'));
  try { mkdirSync(join(directory, 'packs')); mkdirSync(join(directory, 'calendars')); writeFileSync(join(directory, 'packs', 'bad.json'), '{}'); assert.throws(() => loadCurriculumData(directory)); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
