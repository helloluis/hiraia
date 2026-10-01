import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ingest, openTelemetry, validEvent, type Event } from '../../packages/web/src/lib/telemetry/store.ts';
import { assessmentReport } from '../../packages/mobile/src/assessment/reporting.ts';
import { resultFor, selectAssessment } from '../../packages/mobile/src/assessment/selection.ts';
import { emptyAssessmentData } from '../../packages/mobile/src/assessment/storage.ts';
import registry from '../../packages/mobile/src/assessment/bank.generated.json' with { type: 'json' };
import type { AssessmentRegistry } from '../../packages/mobile/src/assessment/types.ts';

const ID = `ha-${'a'.repeat(24)}`;
const PHONE = 'installation_0123456789';
const fixture = (): Event => ({
  id: `assessment_completed-${ID}`, name: 'assessment_completed', session_id: ID,
  occurred_at: Date.parse('2026-09-28T10:00:00.000Z'), props: {
    assessment_id: ID, assessment_kind: 'followup', assessment_mode: 'local_evaluation',
    assessment_blueprint: 'g4-baseline', assessment_segment: 'a'.repeat(64), assessment_bank: 'b'.repeat(64),
    assessment_blueprint_revision: 'c'.repeat(64), assessment_correct: 8, assessment_total: 12,
    benchmark_correct: 4, benchmark_total: 6, recent_correct: 3, recent_total: 4,
    readiness_correct: 1, readiness_total: 2, assessment_repeats: 1,
    assessment_curriculum: 'unverified', assessment_clock: 'device_time_unverified', assessment_support: 'none',
    assessment_targets: JSON.stringify(Array.from({ length: 12 }, (_, n) => [`g3-idea-${n}`, n < 8 ? 1 : 0, 1])),
    grade: 4, language: 'tagalog', profile_kind: 'student', profile_id: 'profile_0123456789',
    app_version: '0.4.26', build: '26', android: '34', abi: 'arm64-v8a', ram_gb: 6,
  },
});

test('real student serializer matches the collector for all eight grade baselines and three languages', () => {
  for (let grade = 3; grade <= 10; grade++) for (const language of ['en', 'tl', 'bis'] as const) {
    const profileId = 'profile_0123456789';
    const now = '2026-09-28T10:00:00.000Z';
    const selected = selectAssessment(registry as unknown as AssessmentRegistry,
      { profileId, grade, language }, emptyAssessmentData(profileId), now, `server-${grade}-${language}`, 'local_evaluation');
    if (!selected.ok) throw new Error(selected.reason);
    const session = selected.session;
    session.answers = session.items.map((item) => ({ itemId: item.itemId, optionId: item.correctOptionId, answeredAt: now }));
    const result = resultFor(session, now, []);
    result.reporting = { consentEpoch: 'test-consent-epoch' };
    const event = assessmentReport(result, { app_version: '0.4.26', student_name: 'MUST_NOT_LEAVE_DEVICE', answer: 'PRIVATE' });
    assert.ok(event);
    assert.equal(validEvent(event), true, `${grade}/${language}: ${JSON.stringify(event)}`);
    assert.equal(event.occurred_at, Date.parse(now));
    assert.ok(Buffer.byteLength(JSON.stringify(event)) <= 4096);
    assert.equal('student_name' in event.props, false);
    assert.equal('answer' in event.props, false);
  }
});

test('only the frozen summary vocabulary is admitted and all required fields are checked', () => {
  assert.equal(validEvent(fixture()), true);
  for (const key of ['student_name', 'name', 'answer', 'question', 'explanation', 'email', 'card_id', 'latitude']) {
    const event = fixture(); event.props[key] = 'private';
    assert.equal(validEvent(event), false, key);
  }
  for (const key of Object.keys(fixture().props).filter((key) => !['app_version', 'build', 'android', 'abi', 'ram_gb'].includes(key))) {
    const event = fixture(); delete event.props[key];
    assert.equal(validEvent(event), false, key);
  }
  const guest = fixture(); guest.props.profile_kind = 'guest'; delete guest.props.profile_id;
  assert.equal(validEvent(guest), true);
});

test('counts, comparison pairs, target aggregates and canonical IDs fail closed', () => {
  for (const [key, value] of [
    ['assessment_total', 10], ['assessment_correct', 7], ['benchmark_total', 5],
    ['recent_total', 7], ['recent_correct', 5], ['readiness_correct', -1],
    ['assessment_repeats', 3], ['grade', 11], ['language', 'bisaya'],
    ['assessment_correct', 8.5], ['benchmark_correct', true], ['assessment_segment', 'not-a-hash'],
  ] as const) {
    const event = fixture(); event.props[key] = value;
    assert.equal(validEvent(event), false, key);
  }
  const comparison = fixture();
  comparison.props.assessment_previous_at = comparison.occurred_at - 86400000;
  assert.equal(validEvent(comparison), false);
  comparison.props.assessment_benchmark_change = 2;
  assert.equal(validEvent(comparison), true);
  comparison.props.assessment_previous_at = comparison.occurred_at + 1;
  assert.equal(validEvent(comparison), false);
  for (const targets of [
    'not json', JSON.stringify([['g3-a', 8, 12], ['g3-a', 0, 1]]),
    JSON.stringify([['g3-a', 7, 12]]), JSON.stringify([['a-child-name', 8, 12]]),
    JSON.stringify([['g3-a', 8, 13]]), JSON.stringify([['g3-a', 12, 8]]),
  ]) { const event = fixture(); event.props.assessment_targets = targets; assert.equal(validEvent(event), false); }
  const aggregated = fixture(); aggregated.props.assessment_targets = JSON.stringify([['g3-a', 5, 6], ['g3-b', 3, 6]]);
  assert.equal(validEvent(aggregated), true);
  assert.equal(validEvent({ ...fixture(), id: 'different_event_0123456' }), false);
  assert.equal(validEvent({ ...fixture(), session_id: 'different_session_1234' }), false);
  assert.equal(validEvent({ ...fixture(), occurred_at: 1577836799999 }), false);
  assert.equal(validEvent({ ...fixture(), occurred_at: 1577836800000 }), true);
  const huge = fixture(); huge.props.assessment_targets = ' '.repeat(4096);
  assert.equal(validEvent(huge), false);
});

test('assessment receipts survive restart and direct/Tala retries without duplicate attempts', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'hiraia-assessment-ingest-'));
  try {
    const filename = path.join(folder, 'telemetry.db');
    let db = openTelemetry(filename);
    const event = fixture(); const body = { schema: 1, installation_id: PHONE, events: [event] };
    assert.deepEqual(ingest(db, body), { acknowledged: [event.id], rejected: [], assessment_supported: true });
    db.close(); db = openTelemetry(filename);
    assert.deepEqual(ingest(db, body), { acknowledged: [event.id], rejected: [], assessment_supported: true });
    const relayed = ingest(db, { ...body, reporter: { app: 'tala', installation_id: 'teacher_install_123456', version: '0.4.5' } });
    assert.equal(relayed.assessment_supported, true);
    assert.equal(relayed.reporter_recorded, true);
    assert.equal((db.prepare('SELECT count(*) n FROM telemetry_events').get() as { n: number }).n, 1);
    assert.equal((db.prepare('SELECT count(*) n FROM telemetry_deliveries').get() as { n: number }).n, 2);
    const changedId = { ...event, id: 'different_event_0123456' };
    assert.deepEqual(ingest(db, { ...body, events: [changedId] }), {
      acknowledged: [], rejected: [changedId.id], assessment_supported: true,
    });
    assert.equal((db.prepare('SELECT occurred_at FROM telemetry_events').get() as { occurred_at: number }).occurred_at, event.occurred_at);
    db.close();
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
