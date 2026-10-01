import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validAssessmentEvent, utf8Bytes } from '../src/tala/assessmentProtocol';
import { sanitizeEvent } from '../src/tala/protocol';
import { TeacherQueue, type TeacherStore } from '../src/tala/queue';

const fixtures = JSON.parse(
  readFileSync(
    new URL('../../tala/android/app/src/test/resources/assessment-wire-v1.json', import.meta.url),
    'utf8'
  )
).events;
test('actual student summaries satisfy strict teacher validation across all grade/language baselines', () => {
  assert.equal(fixtures.length, 21);
  for (const event of fixtures) {
    assert.ok(validAssessmentEvent(event));
    assert.deepEqual(sanitizeEvent(event), event);
    assert.equal(utf8Bytes(JSON.stringify(event)), Buffer.byteLength(JSON.stringify(event)));
  }
});
test('privacy, denominators, target identity and noncanonical attempt IDs fail closed', () => {
  const mutations = [
    (e: any) => (e.props.name = 'Private name'),
    (e: any) => (e.props.benchmark_total = 5),
    (e: any) => (e.props.assessment_correct = 7),
    (e: any) => (e.props.assessment_repeats = 3),
    (e: any) => (e.id = 'noncanonical_event_12345'),
    (e: any) => (e.props.assessment_targets = '[["g4-same",4,6],["g4-same",4,6]]'),
    (e: any) => (e.props.assessment_previous_at = 1),
    (e: any) => (e.props.profile_kind = 'guest'),
  ];
  for (const mutate of mutations) {
    const event = structuredClone(fixtures[0]);
    mutate(event);
    assert.equal(validAssessmentEvent(event), false);
    assert.equal(sanitizeEvent(event), null);
  }
});
test('teacher capability is opt-in and unsupported summaries are retained rather than acknowledged', async () => {
  const calls: unknown[][] = [];
  const ordinary = {
    id: 'ordinary_event_12345678',
    name: 'card_viewed',
    occurred_at: 1760000000000,
    session_id: 'session_123456789012',
    props: {},
  };
  const store = {
    async teacherList(...args: unknown[]) {
      calls.push(args);
      return [fixtures[0], ordinary];
    },
  } as unknown as TeacherStore;
  const queue = new TeacherQueue(store),
    key = { class_id: 'class', public_key: 'key' };
  assert.deepEqual(await queue.pending(key, ['scope'], 50), [ordinary]);
  assert.equal(calls[0]![3], false);
  assert.deepEqual(await queue.pending(key, ['scope'], 50, true), [fixtures[0], ordinary]);
  assert.equal(calls[1]![3], true);
});
