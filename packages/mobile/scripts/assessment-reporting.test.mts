import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { assessmentReport, AssessmentReportQueue } from '../src/assessment/reporting';
import { createAssessmentController } from '../src/assessment/controller';
import { resultFor, selectAssessment } from '../src/assessment/selection';
import { decodeAssessmentData } from '../src/assessment/storage';
import { boundedBatch, jsonBytes, supportedAcknowledgements } from '../src/telemetry/core';
import { validAssessmentEvent } from '../src/tala/assessmentProtocol';
import type { AssessmentRegistry, AssessmentResult } from '../src/assessment/types';

const bank = JSON.parse(
  readFileSync(new URL('../src/assessment/bank.generated.json', import.meta.url), 'utf8')
) as AssessmentRegistry;
const now = '2026-09-28T10:00:00.000Z';
const profileId = 'student-1234567890123456';
const epoch = 'consent-1234567890123456';
function completed(
  grade = 5,
  language: 'en' | 'tl' | 'bis' = 'en',
  id = profileId
): AssessmentResult {
  const chosen = selectAssessment(
    bank,
    { profileId: id, grade, language },
    { history: [], exposures: [] },
    now,
    'report-test',
    'local_evaluation'
  );
  assert.ok(chosen.ok, chosen.ok ? '' : chosen.reason);
  const result = resultFor(
    {
      ...chosen.session,
      answers: chosen.session.items.map((item, index) => ({
        itemId: item.id,
        optionId:
          index % 3
            ? item.correctOptionId
            : item.options.find((o) => o.id !== item.correctOptionId)!.id,
        answeredAt: now,
      })),
    },
    now,
    []
  );
  result.reporting = { consentEpoch: epoch };
  return result;
}

test('actual trilingual baseline reports for all supported grades satisfy the receiving protocol', () => {
  for (let grade = 3; grade <= 10; grade++)
    for (const language of ['en', 'tl', 'bis'] as const) {
      const result = completed(grade, language);
      const event = assessmentReport(result, {
        app_version: '0.4.26',
        build: 'assessment-evaluation',
        ram_gb: 4,
      })!;
      assert.ok(
        validAssessmentEvent(event),
        `grade ${grade}/${language}: ${JSON.stringify(event)}`
      );
      assert.equal(event.props.assessment_correct, 8);
      assert.equal(event.occurred_at, Date.parse(now));
      assert.ok(jsonBytes(event) <= 4096);
    }
});

test('summary uses original profile, original time and stable identity, without name/content/answers', () => {
  const result = completed();
  const event = assessmentReport(result, {
    profile_id: 'wrong-student-1234567',
    name: 'PRIVATE_NAME',
    answer: 'PRIVATE_ANSWER',
  })!;
  assert.equal(event.props.profile_id, profileId);
  assert.equal(event.id, `assessment_completed-${result.session.id}`);
  const encoded = JSON.stringify(event);
  for (const forbidden of [
    'PRIVATE_NAME',
    'PRIVATE_ANSWER',
    result.session.items[0]!.stem,
    'optionId',
    'consentEpoch',
  ])
    assert.ok(!encoded.includes(forbidden));
  const guest = assessmentReport(completed(5, 'bis', 'guest'), { profile_id: profileId })!;
  assert.equal(guest.props.profile_kind, 'guest');
  assert.equal(guest.props.profile_id, undefined);
  assert.equal(guest.props.language, 'cebuano');
  assert.ok(validAssessmentEvent(guest));
});

test('older or opted-out results never enter the report queue', async () => {
  const old = completed();
  delete old.reporting;
  assert.equal(assessmentReport(old), null);
  let calls = 0;
  const queue = new AssessmentReportQueue(async () => {
    calls++;
  });
  queue.offer([old]);
  await queue.flush();
  assert.equal(calls, 0);
});

test('publication failures retry from durable history and successful staging is idempotent', async () => {
  const result = completed();
  const calls: string[] = [];
  let failed = true;
  const queue = new AssessmentReportQueue(async (r) => {
    calls.push(r.session.id);
    if (failed) throw Error('disk temporarily busy');
  });
  queue.offer([result]);
  await queue.flush();
  assert.equal(calls.length, 1);
  failed = false;
  await queue.flush();
  queue.offer([result]);
  await queue.flush();
  assert.equal(calls.length, 2);
  const replay: string[] = [];
  const restarted = new AssessmentReportQueue(async (r) => {
    replay.push(assessmentReport(r)!.id);
  });
  restarted.offer([JSON.parse(JSON.stringify(result))]);
  await restarted.flush();
  assert.deepEqual(replay, [assessmentReport(result)!.id]);
});

for (const policy of ['enabled', 'disabled', 'failed'] as const) {
  test(`completion preserves learning while reporting policy is ${policy}`, async () => {
    let raw: string | null = null;
    const controller = createAssessmentController({
      registry: bank,
      mode: 'local_evaluation',
      now: () => now,
      seed: () => policy,
      storage: {
        async load() {
          return raw;
        },
        async save(_id, value) {
          raw = value;
        },
      },
      async reportingPolicy() {
        if (policy === 'failed') throw Error('telemetry database unavailable');
        return { enabled: policy === 'enabled', epoch };
      },
    });
    await controller.begin({ profileId, grade: 5, language: 'en' });
    const session = controller.getSnapshot().activeSession!;
    for (const item of session.items)
      await controller.answer({
        sessionId: session.id,
        itemId: item.id,
        optionId: item.correctOptionId,
      });
    const result = decodeAssessmentData(raw, profileId).history[0]!;
    assert.equal(result.score.correct, 12);
    assert.equal(controller.getSnapshot().error, '');
    assert.deepEqual(result.reporting, policy === 'enabled' ? { consentEpoch: epoch } : undefined);
  });
}

test('UTF-8 batch budget includes envelope and metadata reserve, not just item count', () => {
  const prototype = assessmentReport(completed())!;
  const events = Array.from({ length: 50 }, (_, i) => ({
    ...prototype,
    id: `${prototype.id}-${i}`,
    props: { ...prototype.props, padding: '🌱'.repeat(450) },
  }));
  const selected = boundedBatch(events, 'installation-1234567890');
  assert.ok(selected.length > 1 && selected.length < 50);
  const body = {
    schema: 1,
    installation_id: 'installation-1234567890',
    events: selected,
    reporter: { app: 'hiraia', installation_id: 'installation-1234567890', version: '0.4.26' },
  };
  assert.equal(jsonBytes(body), Buffer.byteLength(JSON.stringify(body), 'utf8'));
  assert.ok(jsonBytes(body) <= 90_000);
});

test('old collector ACKs/rejections cannot discard assessments; ordinary acknowledgements still pass', () => {
  const assessment = assessmentReport(completed())!;
  const ordinary = { ...assessment, id: 'ordinary-card-event-1234567', name: 'card_viewed' };
  assert.deepEqual(
    supportedAcknowledgements([assessment, ordinary], {
      acknowledged: [ordinary.id],
      rejected: [assessment.id],
    }),
    { acknowledged: [ordinary.id], rejected: [] }
  );
  assert.deepEqual(
    supportedAcknowledgements([assessment], {
      acknowledged: [assessment.id],
      rejected: [],
    }),
    { acknowledged: [], rejected: [] }
  );
  assert.deepEqual(
    supportedAcknowledgements([assessment], {
      acknowledged: [assessment.id],
      rejected: [],
      assessment_supported: true,
    }),
    { acknowledged: [assessment.id], rejected: [] }
  );
});
