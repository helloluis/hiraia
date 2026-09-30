import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sha256 } from '../src/assessment/hash';
import { createAssessmentController } from '../src/assessment/controller';
import {
  decodeAssessmentData,
  emptyAssessmentData,
  assessmentStorageKey,
} from '../src/assessment/storage';
import {
  FORTNIGHT_MS,
  isRecentExposure,
  itemEligible,
  resultFor,
  selectAssessment,
  validTime,
} from '../src/assessment/selection';
import type {
  AdmissionMode,
  AssessmentContext,
  AssessmentExposure,
  AssessmentRegistry,
  AssessmentResult,
  AssessmentSession,
  BankItem,
} from '../src/assessment/types';

const registry = JSON.parse(
  readFileSync(
    new URL('../src/assessment/bank.generated.json', import.meta.url),
    'utf8'
  )
) as AssessmentRegistry;
const pool = JSON.parse(
  readFileSync(new URL('../../../rag/pipeline/cardsPool.app.json', import.meta.url), 'utf8')
).cards as { id: string; fact: Record<string, string> }[];
const cardMap = new Map(pool.map((c) => [c.id, c]));
const NOW = '2026-09-28T10:00:00.000Z';
const context = (grade = 4, language: 'en' | 'tl' | 'bis' = 'tl'): AssessmentContext => ({
  profileId: 'student-abcdefghijklmnop',
  grade,
  language,
});
function selected(
  grade = 4,
  history: AssessmentResult[] = [],
  exposures: AssessmentExposure[] = [],
  seed = 'test',
  language: 'en' | 'tl' | 'bis' = 'tl'
) {
  const result = selectAssessment(
    registry,
    context(grade, language),
    { history, exposures },
    NOW,
    seed,
    'local_evaluation'
  );
  assert.ok(result.ok, result.ok ? '' : result.reason);
  return result.session;
}
function complete(session: AssessmentSession, history: AssessmentResult[] = []) {
  return resultFor(
    {
      ...session,
      answers: session.items.map((i) => ({
        itemId: i.id,
        optionId: i.correctOptionId,
        answeredAt: NOW,
      })),
    },
    NOW,
    history
  );
}
function exposure(
  item: BankItem,
  at = NOW,
  language: 'en' | 'tl' | 'bis' = 'tl'
): AssessmentExposure {
  const link = item.teachingLinks.find((l) => l.hashes[language]);
  assert.ok(link);
  return {
    cardId: link.cardId,
    familyId: item.familyId,
    language,
    presentedTextSha256: link.hashes[language],
    at,
    knowledgePresented: true,
  };
}
function harness(mode: AdmissionMode = 'local_evaluation', shared = new Map<string, string>(), testRegistry = registry) {
  let date = NOW,
    failSave = false,
    failLoad = false,
    counter = 0,
    elapsed = Date.parse(NOW);
  const storage = {
    async load(profileId: string, mode: AdmissionMode) {
      if (failLoad) throw Error('read failed');
      return shared.get(assessmentStorageKey(profileId, mode)) ?? null;
    },
    async save(profileId: string, serialized: string, mode: AdmissionMode) {
      if (failSave) throw Error('write failed');
      shared.set(assessmentStorageKey(profileId, mode), serialized);
    },
  };
  const create = () =>
    createAssessmentController({
      registry: testRegistry,
      mode,
      storage,
      now: () => date,
      monotonic: () => elapsed,
      seed: () => `run-${counter++}`,
    });
  return {
    shared,
    create,
    storage,
    setFailSave: (v: boolean) => {
      failSave = v;
    },
    setFailLoad: (v: boolean) => {
      failLoad = v;
    },
    setDate: (v: string, advanceMonotonic = true) => {
      if (advanceMonotonic) elapsed += Date.parse(v) - Date.parse(date);
      date = v;
    },
  };
}
async function answerAll(controller: ReturnType<ReturnType<typeof harness>['create']>) {
  while (controller.getSnapshot().activeSession) {
    const session = controller.getSnapshot().activeSession!,
      item = session.items[session.answers.length]!;
    await controller.answer({
      sessionId: session.id,
      itemId: item.id,
      optionId: item.correctOptionId,
    });
    assert.equal(controller.getSnapshot().error, '');
  }
}

test('SHA-256 matches UTF-8 reference for source prose, Unicode and padding boundaries', () => {
  for (const value of [
    '',
    'abc',
    'é – ang bata 🌏',
    '\ud800',
    'a'.repeat(55),
    'b'.repeat(56),
    'c'.repeat(1000),
  ])
    assert.equal(sha256(value), createHash('sha256').update(value).digest('hex'));
});
test('registry preserves pending review flags and excludes every held row', () => {
  assert.notEqual(validTime(registry.authoredAt), null, 'compiled authoring date must satisfy the app clock contract');
  assert.equal(registry.authoringItemCount, registry.items.length + registry.excluded.length);
  assert.equal(registry.items.filter((item) => item.id.startsWith('ha-g')).length, 633);
  assert.equal(registry.excluded.length, 5);
  assert.equal(registry.productionEnabled, false);
  assert.ok(
    registry.items.every(
      (i) =>
        !i.productionReady && i.status === 'source_checked' && !(i.review.holds as unknown[]).length
    )
  );
});
test('all grades 3–10 get deterministic balanced 12-item evaluation baselines in three languages', () => {
  for (let grade = 3; grade <= 10; grade++)
    for (const language of ['en', 'tl', 'bis'] as const) {
      const a = selected(grade, [], [], 'same-seed', language),
        b = selected(grade, [], [], 'same-seed', language);
      assert.deepEqual(a, b);
      assert.equal(a.items.length, 12);
      assert.equal(a.items.filter((i) => i.role === 'benchmark').length, 6);
      assert.equal(a.items.filter((i) => i.role === 'readiness').length, 6);
      assert.equal(new Set(a.items.map((i) => i.familyId)).size, 12);
      assert.equal(a.curriculumMatch, 'unverified');
      assert.equal(a.clockTrust, 'device_time_unverified');
      for (const domain of ['MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE'])
        assert.equal(a.items.filter((i) => i.domain === domain).length, 3);
      const facts = a.items.flatMap((i) => i.sourceFactIds);
      assert.equal(new Set(facts).size, facts.length);
    }
});
test('all production drafts defer, with or without invented coverage', () => {
  assert.equal(
    selectAssessment(
      registry,
      context(3),
      { history: [], exposures: [] },
      NOW,
      'a',
      'production'
    ).ok,
    false
  );
  assert.equal(
    selectAssessment(registry, context(), { history: [], exposures: [] }, NOW, 'a', 'production')
      .ok,
    false
  );
  const current = registry.items.find((i) => i.grade === 4 && i.teachingLinks.length)!;
  assert.equal(itemEligible(current, context(), [], NOW, 'local_evaluation'), false);
  assert.equal(
    itemEligible(
      { ...current, status: 'hold' },
      { ...context(), teacherCoveredTargets: [current.targetId] },
      [],
      NOW,
      'local_evaluation'
    ),
    false
  );
});
test('exact body, language, knowledge link and inclusive 14-day boundary are mandatory', () => {
  const item = registry.items.find((i) => i.grade === 4 && i.teachingLinks.length)!;
  const event = exposure(item, new Date(Date.parse(NOW) - FORTNIGHT_MS).toISOString());
  assert.ok(isRecentExposure(item, [event], NOW));
  for (const change of [
    { at: new Date(Date.parse(event.at) - 1).toISOString() },
    { at: 'bad' },
    { at: '2026-09-29T00:00:00Z' },
    { familyId: 'wrong' },
    { presentedTextSha256: 'bad' },
    { knowledgePresented: false },
    { language: 'no' },
  ])
    assert.equal(
      isRecentExposure(item, [{ ...event, ...change } as AssessmentExposure], NOW),
      false
    );
  const mutated = structuredClone(item);
  mutated.teachingLinks[0]!.hashes.tl = sha256('changed body');
  assert.equal(isRecentExposure(mutated, [event], NOW), false);
});
test('sparse followups retain separate denominators; recent material never comes from date alone', () => {
  const baseline = complete(selected());
  const no = complete(selected(4, [baseline], [], 'none'), [baseline]);
  assert.equal(no.recent.total, 0);
  assert.equal(no.readiness.total, 6);
  const current = registry.items.find(
    (i) =>
      i.grade === 4 && i.teachingLinks.length && i.familyId !== baseline.session.items[0]?.familyId
  )!;
  const one = complete(
    selected(
      4,
      [baseline],
      Array.from({ length: 8 }, () => exposure(current)),
      'one'
    ),
    [baseline]
  );
  assert.equal(one.recent.total, 1);
  assert.equal(one.readiness.total, 5);
  assert.equal(one.benchmark.total, 6);
});
test('successive full forms enforce two-repeat ceiling and never replay a whole paper', () => {
  for (const grade of [4, 7, 10]) {
    const history: AssessmentResult[] = [];
    for (let n = 0; n < 5; n++) {
      const session = selected(grade, history, [], `rotation-${n}`),
        recent = new Set(history.slice(-3).flatMap((r) => r.session.items.map((i) => i.id)));
      assert.ok(session.items.filter((i) => recent.has(i.id)).length <= 2);
      assert.ok(
        history.every((r) =>
          r.session.items.some((i) => !session.items.some((next) => next.id === i.id))
        )
      );
      history.push(complete(session, history));
    }
  }
});
test('language and benchmark revision changes begin fresh balanced comparison baselines', () => {
  const base = complete(selected(5));
  const changed = selected(5, [base], [], 'language', 'bis');
  assert.equal(changed.kind, 'baseline');
  assert.notEqual(changed.comparisonKey, base.session.comparisonKey);
  assert.equal(changed.items.filter((i) => i.role === 'recent').length, 0);
  assert.equal(complete(changed, [base]).comparison, null);
  const revised = structuredClone(registry);
  revised.blueprints.find((b) => b.student_grade === 5)!.revision = 'revised';
  const result = selectAssessment(
    revised,
    context(5),
    { history: [base], exposures: [] },
    NOW,
    'revision',
    'local_evaluation'
  );
  assert.ok(result.ok);
  assert.equal(result.session.kind, 'baseline');
});
test('exhaustion and corrupt calendar values defer before starting', () => {
  const base = complete(selected());
  const small = {
    ...registry,
    items: registry.items.filter((i) => base.session.items.some((b) => b.id === i.id)),
  };
  assert.equal(
    selectAssessment(
      small,
      context(),
      { history: [base], exposures: [] },
      NOW,
      'x',
      'local_evaluation'
    ).ok,
    false
  );
  for (const date of ['2026-02-30T00:00:00Z', '2026-09-28', '2026-09-28T25:00:00Z', 'bad'])
    assert.equal(validTime(date), null);
});
test('answers are durable before advance; failed write retries and process restart resume pinned content', async () => {
  const h = harness(),
    c = h.create();
  await c.begin(context());
  const started = structuredClone(c.getSnapshot().activeSession!);
  const item = started.items[0]!;
  h.setFailSave(true);
  await c.answer({ sessionId: started.id, itemId: item.id, optionId: item.correctOptionId });
  assert.equal(c.getSnapshot().activeSession!.answers.length, 0);
  assert.match(c.getSnapshot().error, /write failed/);
  await c.hydrate(context());
  assert.match(c.getSnapshot().error, /write failed/);
  h.setFailSave(false);
  await c.retry();
  assert.equal(c.getSnapshot().activeSession!.answers.length, 1);
  const resumed = h.create();
  await resumed.hydrate({ ...context(), language: 'bis', grade: 10 });
  assert.equal(resumed.getSnapshot().activeSession!.language, 'tl');
  assert.deepEqual(resumed.getSnapshot().activeSession!.items, started.items);
  await resumed.answer({ sessionId: started.id, itemId: item.id, optionId: item.correctOptionId });
  assert.equal(resumed.getSnapshot().activeSession!.answers.length, 1);
});
test('concurrent duplicate submissions commit once and out-of-order answers are rejected', async () => {
  const h = harness(),
    c = h.create();
  await c.begin(context());
  const s = c.getSnapshot().activeSession!,
    q = s.items[0]!,
    second = s.items[1]!;
  await c.answer({ sessionId: s.id, itemId: second.id, optionId: second.correctOptionId });
  assert.equal(c.getSnapshot().activeSession!.answers.length, 0);
  await Promise.all([
    c.answer({ sessionId: s.id, itemId: q.id, optionId: q.correctOptionId }),
    c.answer({ sessionId: s.id, itemId: q.id, optionId: q.correctOptionId }),
  ]);
  assert.equal(c.getSnapshot().activeSession!.answers.length, 1);
});
test('final answer, history and results are one durable commit; replay never appends another result', async () => {
  const h = harness(),
    c = h.create();
  await c.begin(context());
  const original = c.getSnapshot().activeSession!;
  await answerAll(c);
  assert.equal(c.getSnapshot().completed, 1);
  assert.equal(c.getSnapshot().results!.score.correct, 12);
  const last = original.items[11]!;
  await c.answer({ sessionId: original.id, itemId: last.id, optionId: last.correctOptionId });
  assert.equal(c.getSnapshot().completed, 1);
  const resumed = h.create();
  await resumed.hydrate(context());
  assert.equal(resumed.getSnapshot().results!.score.total, 12);
  await resumed.dismissResults();
  const again = h.create();
  await again.hydrate(context());
  assert.equal(again.getSnapshot().results, null);
  assert.equal(again.getSnapshot().completed, 1);
});
test('profile and admission namespaces cannot leak active sessions or history', async () => {
  const h = harness(),
    c = h.create();
  await c.begin(context());
  const id = c.getSnapshot().activeSession!.id;
  await c.hydrate({ ...context(), profileId: 'student-otherabcdefghijkl' });
  assert.equal(c.getSnapshot().activeSession, null);
  assert.equal(c.getSnapshot().completed, 0);
  await c.hydrate(context());
  assert.equal(c.getSnapshot().activeSession!.id, id);
  const publicController = harness('production', h.shared).create();
  await publicController.hydrate(context());
  assert.equal(publicController.getSnapshot().activeSession, null);
  assert.equal(publicController.getSnapshot().eligible, false);
});
test('invalid persisted answer IDs, option IDs or JSON block recovery without wiping disk', async () => {
  const h = harness(),
    c = h.create();
  await c.begin(context());
  const key = assessmentStorageKey(context().profileId, 'local_evaluation'),
    raw = h.shared.get(key)!;
  for (const mutation of [
    (data: any) => {
      data.activeSession.items[0].correctOptionId = 'bogus';
    },
    (data: any) => {
      data.activeSession.answers = [{ itemId: 'wrong', optionId: 'o1', answeredAt: NOW }];
    },
    (data: any) => {
      data.profileId = 'different';
    },
  ]) {
    const data = JSON.parse(raw);
    mutation(data);
    const broken = JSON.stringify(data);
    h.shared.set(key, broken);
    const next = h.create();
    await next.hydrate(context());
    assert.equal(next.getSnapshot().loaded, false);
    assert.ok(next.getSnapshot().error);
    assert.equal(h.shared.get(key), broken);
  }
  assert.throws(() => decodeAssessmentData('{', context().profileId));
});
test('actual rendered-body exposures persist; changed text does not unlock claims; failed saves do not trap UI', async () => {
  const h = harness(),
    c = h.create();
  await c.hydrate(context());
  const item = registry.items.find(
      (i) => i.grade === 4 && i.teachingLinks.some((l) => l.hashes.tl)
    )!,
    link = item.teachingLinks.find((l) => l.hashes.tl)!;
  const body = cardMap.get(link.cardId)!.fact.tl!.trim(),
    input = { cardId: link.cardId, language: 'tl' as const, exactRenderedBody: body };
  await c.recordExposure({ ...input, exactRenderedBody: body + ' changed' });
  assert.equal(h.shared.size, 0);
  h.setFailSave(true);
  await c.recordExposure(input);
  assert.equal(c.getSnapshot().error, '');
  h.setFailSave(false);
  await c.recordExposure(input);
  const data = decodeAssessmentData(
    h.shared.get(assessmentStorageKey(context().profileId, 'local_evaluation'))!,
    context().profileId
  );
  assert.ok(data.exposures.some((e) => e.familyId === item.familyId));
});
test('queued old-profile exposure cannot enter the newly hydrated profile', async () => {
  const h = harness(),
    c = h.create();
  await c.hydrate(context());
  const item = registry.items.find((i) => i.teachingLinks.some((l) => l.hashes.tl))!,
    link = item.teachingLinks.find((l) => l.hashes.tl)!;
  const switchProfile = c.hydrate({ ...context(), profileId: 'student-otherabcdefghijkl' });
  const record = c.recordExposure({
    cardId: link.cardId,
    language: 'tl',
    exactRenderedBody: cardMap.get(link.cardId)!.fact.tl!.trim(),
  });
  await Promise.all([switchProfile, record]);
  assert.equal(h.shared.size, 0);
});
test('questionable dates cannot fabricate due progress or answers; observed real fortnight does become due', async () => {
  const h = harness(),
    c = h.create();
  await c.begin(context());
  await answerAll(c);
  await c.dismissResults();
  h.setDate(new Date(Date.parse(NOW) + FORTNIGHT_MS).toISOString());
  await c.hydrate(context());
  assert.equal(c.getSnapshot().due, true);
  await c.begin(context());
  const s = c.getSnapshot().activeSession!;
  h.setDate('2099-01-01T00:00:00Z', false);
  await c.answer({
    sessionId: s.id,
    itemId: s.items[0]!.id,
    optionId: s.items[0]!.correctOptionId,
  });
  assert.equal(c.getSnapshot().activeSession!.answers.length, 0);
  assert.ok(c.getSnapshot().error);
  const jump = harness(),
    j = jump.create();
  await j.hydrate(context());
  jump.setDate(new Date(Date.parse(NOW) + FORTNIGHT_MS).toISOString(), false);
  await j.begin(context());
  assert.equal(j.getSnapshot().activeSession, null);
  assert.match(j.getSnapshot().error, /clock changed/);
});
test('a long absence has no arbitrary expiry and restores an unfinished quiz without erasing answers', async () => {
  const h = harness(),
    c = h.create();
  await c.begin(context());
  const session = c.getSnapshot().activeSession!,
    first = session.items[0]!;
  await c.answer({ sessionId: session.id, itemId: first.id, optionId: first.correctOptionId });
  h.setDate('2028-09-28T10:00:00.000Z');
  const resumed = h.create();
  await resumed.hydrate(context());
  assert.equal(resumed.getSnapshot().activeSession!.answers.length, 1);
  const second = session.items[1]!;
  await resumed.answer({
    sessionId: session.id,
    itemId: second.id,
    optionId: second.correctOptionId,
  });
  assert.equal(resumed.getSnapshot().error, '');
  assert.equal(resumed.getSnapshot().activeSession!.answers.length, 2);
});
test('pending start can be dismissed only after successful hydration with no active quiz', async () => {
  // Simulate unavailable content explicitly; Grade 3 is now a supported route.
  const h = harness('local_evaluation', new Map(), {
      ...registry, blueprints: registry.blueprints.filter((b) => b.student_grade !== 3),
    }),
    c = h.create();
  await c.requestStart(context(3));
  assert.ok(c.getSnapshot().error);
  await c.cancelStart();
  assert.equal(c.getSnapshot().error, '');
  await c.begin(context());
  await c.dismissError();
  assert.ok(c.getSnapshot().activeSession);
  assert.ok(c.getSnapshot().error);
});

test('a manual request starts another full exam immediately without waiting for the reminder', async () => {
  const h = harness(), c = h.create(), student = context();
  await c.requestStart(student);
  const first = c.getSnapshot().activeSession!;
  for (const item of first.items) {
    await c.answer({ sessionId: first.id, itemId: item.id, optionId: item.correctOptionId });
  }
  await c.dismissResults();
  assert.equal(c.getSnapshot().due, false, 'no fortnight has elapsed');
  await c.requestStart(student);
  const second = c.getSnapshot().activeSession!;
  assert.equal(c.getSnapshot().error, '');
  assert.ok(second);
  assert.notEqual(second.id, first.id);
  assert.equal(second.items.length, 12);
  assert.equal(c.getSnapshot().history.length, 1, 'manual start preserves the completed result');
  assert.notDeepEqual(second.items.map(i => i.id).sort(), first.items.map(i => i.id).sort());
});

test('repeated manual starts resume the same saved exam and retain its answers', async () => {
  const h = harness(), c = h.create(), student = context();
  await c.requestStart(student);
  const first = c.getSnapshot().activeSession!, item = first.items[0]!;
  await c.answer({ sessionId: first.id, itemId: item.id, optionId: item.correctOptionId });
  await Promise.all([c.requestStart(student), c.requestStart(student)]);
  assert.equal(c.getSnapshot().activeSession!.id, first.id);
  assert.equal(c.getSnapshot().activeSession!.answers.length, 1);
  const restarted = h.create();
  await restarted.requestStart(student);
  assert.equal(restarted.getSnapshot().activeSession!.id, first.id);
  assert.equal(restarted.getSnapshot().activeSession!.answers.length, 1);
});
