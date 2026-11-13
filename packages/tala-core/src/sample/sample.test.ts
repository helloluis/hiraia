import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SchoolYear, parseRecordData } from '../contracts/records';
import { BUILTIN_TEMPLATES } from '../contracts/content';
import { DEFAULT_PACING_PARAMS } from '../contracts/curriculum';
import { engine } from '../pacing';
import { validatePlanForLock } from '../plan';
import { buildSampleClass, buildSampleCompetencies } from './index';

const schoolYear = SchoolYear.parse({ id: 'year-sample-test', label: '2026-2027', startDate: '2026-06-01', endDate: '2027-03-31', terms: [
  { id: 'term1', index: 1, name: 'First', startDate: '2026-06-01', endDate: '2026-09-11' },
  { id: 'term2', index: 2, name: 'Second', startDate: '2026-09-14', endDate: '2026-12-18' },
  { id: 'term3', index: 3, name: 'Third', startDate: '2027-01-04', endDate: '2027-03-31' },
] });
const idFactory = () => { let n = 0; return () => `demo-${++n}`; };

test('mid-year sample is deterministic, schema-valid, labelled and linked to one fictional class', () => {
  const original = JSON.stringify(schoolYear);
  const bundle = buildSampleClass({ schoolYear, today: '2026-11-18', lang: 'en', newId: idFactory() });
  assert.deepEqual(bundle, buildSampleClass({ schoolYear, today: '2026-11-18', lang: 'en', newId: idFactory() }));
  assert.equal(JSON.stringify(schoolYear), original);
  assert.equal(bundle.classRecord.isSample, true);
  assert.deepEqual(bundle.classRecord.gradeGroups.map(g => g.grade), ['2', '4']);
  assert.equal(bundle.students.length, 6);
  assert.ok(bundle.students.every(s => s.displayName.includes('(fictional)') && s.classId === bundle.classRecord.id));
  assert.equal(new Set(bundle.records.map(r => r.data.id)).size, bundle.records.length);
  for (const record of bundle.records) {
    assert.equal(record.isSample, true); assert.ok(record.data.id.startsWith('sample:'));
    assert.deepEqual(parseRecordData(record.entity, record.data), record.data);
  }
  assert.equal(bundle.records.some(r => (r.entity as string) === 'school_year'), false);
  assert.equal(bundle.plans.length, 3); assert.equal(bundle.plans.filter(p => p.state === 'locked').length, 1);
  const locked = bundle.plans.find(p => p.state === 'locked')!;
  assert.ok(locked.lock!.lockedBy.includes('fictional'));
  assert.ok(validatePlanForLock({ ...locked, state: 'draft' }, bundle.sections, BUILTIN_TEMPLATES.find(t => t.id === locked.templateId)!, bundle.classRecord).ok);
  assert.ok(bundle.records.findIndex(r => r.entity === 'plan_section' && r.data.planId === locked.id) < bundle.records.findIndex(r => r.data.id === locked.id));
  const entries = engine.buildTimeline({ from: '2026-11-18', to: '2026-11-20', today: '2026-11-18', schoolYear, classes: [bundle.classRecord], assignments: bundle.assignments, tracks: bundle.tracks, competencies: bundle.competencies, calendarDays: [], checks: [], marks: [], plans: bundle.plans, pairingOverrides: [], defaults: DEFAULT_PACING_PARAMS });
  assert.equal(entries.length, 3);
  assert.ok(entries.every(e => Object.keys(e.byGroup).length === 2 && e.pairing?.shared));
  assert.equal(entries[0]!.planState, 'locked');
  assert.ok(entries.slice(1).every(e => e.planState === 'draft'));
  for (const track of bundle.tracks) {
    assert.ok(track.allocation?.length); assert.equal(track.startPosition!.date, '2026-11-18');
    const plan = engine.computePacing({ schoolYear, term: schoolYear.terms[1]!, assignment: bundle.assignments[0]!, track, competencies: bundle.competencies.filter(c => c.grade === bundle.classRecord.gradeGroups.find(g => g.id === track.gradeGroupId)!.grade), calendarDays: [], checks: [], marks: [], today: '2026-11-18', defaults: DEFAULT_PACING_PARAMS });
    assert.equal(plan.sessionsBehind, 0);
  }
});
test('sample handles any-day starts, weekends, term breaks and year boundaries in either language', () => {
  for (const today of ['2026-01-01', '2026-06-01', '2026-11-21', '2026-12-18', '2026-12-26', '2027-03-31', '2027-04-01']) {
    for (const lang of ['en', 'fil'] as const) {
      const bundle = buildSampleClass({ schoolYear, today, lang, newId: idFactory() });
      assert.equal(bundle.plans.length, 3); assert.equal(bundle.plans[0]!.state, 'locked');
      assert.ok(bundle.plans.every(p => p.title.includes(bundle.label)));
      assert.ok(bundle.plans.flatMap(p => p.placements.flatMap(x => x.dates)).every(date => date >= schoolYear.startDate && date <= schoolYear.endDate));
      assert.ok(bundle.tracks.every(t => t.allocation !== null));
      if (today < schoolYear.startDate) assert.equal(bundle.preview, 'upcoming');
      if (today > schoolYear.endDate) assert.equal(bundle.preview, 'completed');
    }
  }
});
test('a term with no timetable sessions still returns labelled undated examples and a locked plan', () => {
  const year = SchoolYear.parse({ ...schoolYear, startDate: '2026-11-21', endDate: '2026-11-22', terms: [{ id: 'weekend', index: 4, name: 'Fourth', startDate: '2026-11-21', endDate: '2026-11-22' }] });
  const bundle = buildSampleClass({ schoolYear: year, today: '2026-11-21', lang: 'en', newId: idFactory() });
  assert.equal(bundle.preview, 'no_sessions'); assert.equal(bundle.plans[0]!.state, 'locked');
  assert.ok(bundle.plans.every(p => p.placements[0]!.dates.length === 0));
  assert.ok(bundle.competencies.every(c => c.termIndex === 4));
  assert.throws(() => buildSampleClass({ schoolYear, today: '2026-11-18', lang: 'en', newId: () => 'duplicate' }), /unique/);
  assert.throws(() => buildSampleClass({ schoolYear, today: '2026-02-30', lang: 'en', newId: idFactory() }), /Invalid calendar date/);
});
test('offline sample competencies match the server fixture packs exactly', () => {
  for (const grade of ['2', '4'] as const) {
    const pack = JSON.parse(readFileSync(new URL(`../../../tala-server/data/fixtures/demo-g${grade}.json`, import.meta.url), 'utf8'));
    assert.deepEqual(buildSampleCompetencies(grade), pack.competencies);
  }
});
