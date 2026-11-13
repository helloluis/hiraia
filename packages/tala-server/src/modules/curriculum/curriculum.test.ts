import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalendarPreset, CurriculumIndex, CurriculumPack, CompetencyCheck, LIMITS } from '@hiraia/tala-core';
import { createCurriculumModule, loadCurriculumData } from './index';
import { createTestServer } from '@hiraia/tala-server/testing';

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
test('check summaries aggregate real synced checks by verified teacher and exclude withdrawals', async () => {
  const t = createTestServer({ modules: [createCurriculumModule()] });
  try {
    const params = { packId: 'science-bow-2026:4:science' };
    const anonymous = await t.call('curriculum.checkSummary', { params });
    assert.equal(anonymous.status, 401);
    const first = await t.registerUser();
    const second = await t.registerUser();
    const unverified = await t.registerUser({ verified: false });
    const pack = await t.ok('curriculum.pack', { params });
    const confirmedId = pack.competencies[0]!.id, correctedId = pack.competencies[1]!.id;
    const check = (id: string, competencyId: string, status: 'confirmed' | 'corrected', curriculumVersion = pack.curriculumVersion) => CompetencyCheck.parse({
      id, competencyId, status, curriculumVersion,
      correction: status === 'corrected' ? { text: 'Private teacher correction fixture' } : null,
      note: 'Private teacher note fixture',
    });
    async function push(token: string, checks: CompetencyCheck[]) {
      const result = await t.ok('sync.push', { token, body: { deviceId: 'curriculum-test', mutations: checks.map(data => ({ mutationId: `create-${data.id}`, entity: 'competency_check' as const, id: data.id, op: 'upsert' as const, baseRev: 0, data })) } });
      assert.ok(result.results.every(r => r.status === 'applied'));
    }
    await push(first.token, [check('confirm-a', confirmedId, 'confirmed'), check('duplicate-a', confirmedId, 'confirmed'), check('correct-a', correctedId, 'corrected'), check('wrong-version', correctedId, 'confirmed', 'another-version'), check('outside-pack', 'unknown-competency', 'confirmed')]);
    await push(second.token, [check('confirm-b', confirmedId, 'confirmed'), check('correct-b', correctedId, 'corrected')]);
    await push(unverified.token, [check('unverified', confirmedId, 'confirmed')]);
    const summary = await t.ok('curriculum.checkSummary', { params, token: first.token });
    assert.deepEqual(summary, { packId: params.packId, confirmedBy: { [confirmedId]: 2 }, correctedBy: { [correctedId]: 2 } });
    assert.deepEqual(await t.ok('curriculum.checkSummary', { params, token: second.token }), summary);
    const deleted = await t.ok('sync.push', { token: second.token, body: { deviceId: 'curriculum-test', mutations: [{ mutationId: 'withdraw-b', entity: 'competency_check', id: 'confirm-b', op: 'delete', baseRev: 1 }] } });
    assert.equal(deleted.results[0]!.status, 'applied');
    assert.equal(t.services.records.get(second.id, 'competency_check', 'confirm-b'), null);
    assert.deepEqual(await t.ok('curriculum.checkSummary', { params, token: first.token }), { packId: params.packId, confirmedBy: { [confirmedId]: 1 }, correctedBy: { [correctedId]: 2 } });
    const missing = await t.call('curriculum.checkSummary', { params: { packId: 'missing' }, token: first.token });
    assert.equal(missing.status, 404);
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
