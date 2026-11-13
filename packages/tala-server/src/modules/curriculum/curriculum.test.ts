import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API, CalendarPreset, CurriculumIndex, CurriculumPack } from '@hiraia/tala-core';
import { createCurriculumModule, loadCurriculumData } from './index';
import type { BaseDeps, Ctx } from '../../kernel/types';

test('all source packs validate, carry pages and preserve distinct versions without fixture leakage', () => {
  const data = loadCurriculumData();
  CurriculumIndex.parse(data.index);
  assert.equal(data.packs.size, 8);
  assert.equal([...data.packs.values()].reduce((n, p) => n + p.competencyCount, 0), 322);
  for (const p of data.packs.values()) {
    CurriculumPack.parse(p);
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
test('module handlers validate responses and use only aggregate checkTallies', async () => {
  const module = createCurriculumModule();
  module.services!({} as BaseDeps);
  let called = false;
  const ctx = { user: { id: 'teacher1' }, services: { records: { checkTallies(version: string, ids: string[]) { called = true; assert.equal(version, 'science-bow-2026'); assert.equal(ids.length, 33); return { confirmed: { [ids[0]!]: 3 }, corrected: {} }; } } } } as unknown as Ctx;
  const index = await module.handlers['curriculum.index']!(ctx, { params: {}, query: undefined, body: undefined });
  API['curriculum.index'].response.parse(index);
  const params = { packId: 'science-bow-2026:4:science' };
  const pack = await module.handlers['curriculum.pack']!(ctx, { params, query: undefined, body: undefined });
  API['curriculum.pack'].response.parse(pack);
  const summary = await module.handlers['curriculum.checkSummary']!(ctx, { params, query: undefined, body: undefined });
  API['curriculum.checkSummary'].response.parse(summary); assert.equal(called, true);
  assert.throws(() => module.handlers['curriculum.pack']!(ctx, { params: { packId: 'missing' }, query: undefined, body: undefined }), /not been loaded/);
  assert.throws(() => module.handlers['curriculum.checkSummary']!({ ...ctx, user: null }, { params, query: undefined, body: undefined }), /sign in/);
});
test('malformed pack fails startup validation', () => {
  const directory = mkdtempSync(join(tmpdir(), 'tala-curriculum-'));
  try { mkdirSync(join(directory, 'packs')); mkdirSync(join(directory, 'calendars')); writeFileSync(join(directory, 'packs', 'bad.json'), '{}'); assert.throws(() => loadCurriculumData(directory)); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
