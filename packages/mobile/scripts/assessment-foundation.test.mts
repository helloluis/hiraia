import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createAssessmentController } from '../src/assessment/controller';
import { ballBoxGeometry, isAssessmentDiagram } from '../src/assessment/diagram';
import { FORTNIGHT_MS, itemEligible, resultFor, selectAssessment } from '../src/assessment/selection';
import { assessmentStorageKey, decodeAssessmentData, emptyAssessmentData } from '../src/assessment/storage';
import type { AssessmentContext, AssessmentExposure, AssessmentRegistry, AssessmentResult, AssessmentSession, BankItem } from '../src/assessment/types';

const registry = JSON.parse(readFileSync(new URL('../src/assessment/bank.generated.json', import.meta.url), 'utf8')) as AssessmentRegistry;
const blueprint = registry.blueprints.find(b => b.student_grade === 3)!;
const initialTime = '2026-09-29T01:00:00.000Z';
const context: AssessmentContext = { profileId: 'grade3-foundation-profile', grade: 3, language: 'en' };
function select(history: AssessmentResult[] = [], exposures: AssessmentExposure[] = [], now = initialTime, seed = 'foundation', ctx = context, bank = registry) {
  const result = selectAssessment(bank, ctx, { history, exposures }, now, seed, 'local_evaluation');
  assert.ok(result.ok, result.ok ? '' : result.reason);
  return result.session;
}
function finish(session: AssessmentSession, history: AssessmentResult[], at: string, support = false) {
  return resultFor({ ...session, answers: session.items.map((item, n) => ({ itemId: item.id,
    optionId: n % 3 ? item.correctOptionId : item.options.find(o => o.id !== item.correctOptionId)!.id,
    answeredAt: at, supportUsed: support && n === 0 ? 'read_aloud' : 'none' })) }, at, history);
}
function exposure(item: BankItem, language: 'en' | 'tl' | 'bis', now: string): AssessmentExposure {
  const link = item.teachingLinks.find(link => !!link.hashes[language])!;
  assert.ok(link);
  return { cardId: link.cardId, familyId: item.familyId, language, presentedTextSha256: link.hashes[language], at: now, knowledgePresented: true };
}
function invariants(session: AssessmentSession, history: AssessmentResult[]) {
  assert.equal(session.items.length, 12);
  assert.equal(new Set(session.items.map(i => i.id)).size, 12);
  assert.equal(new Set(session.items.map(i => i.familyId)).size, 12);
  const facts = session.items.flatMap(i => i.sourceFactIds);
  assert.equal(new Set(facts).size, facts.length);
  assert.equal(session.items.filter(i => i.role === 'benchmark').length, 6);
  const recent = new Set(history.slice(-3).flatMap(r => r.session.items.map(i => i.id)));
  assert.ok(session.items.filter(i => recent.has(i.id)).length <= 2);
  assert.ok(!history.some(r => r.session.items.every(i => session.items.some(next => next.id === i.id))));
  assert.equal(session.curriculumMatch, 'unverified');
  assert.equal(session.comparisonLabel, 'Hiraia-only');
  assert.ok(session.items.every(i => !i.productionReady));
}

test('Grade 3 baseline admits only its explicit earlier-learning catalogue with 3 items per domain', () => {
  assert.ok(blueprint);
  assert.equal(blueprint.material_grade, 0);
  assert.equal(blueprint.curriculum_cohort_verified, false);
  assert.equal(blueprint.foundation_item_ids?.length, 72);
  const session = select();
  invariants(session, []);
  assert.equal(session.items.filter(i => i.role === 'readiness').length, 6);
  assert.ok(session.items.every(i => blueprint.foundation_item_ids!.includes(i.id)));
  for (const domain of ['MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE'])
    assert.equal(session.items.filter(i => i.domain === domain).length, 3);
  assert.equal(session.items.filter(i => i.diagram).length, 1);
});

test('foundation membership cannot be inferred from numeric grade, calendar, topic or exposure alone', () => {
  const item = registry.items.find(i => blueprint.foundation_item_ids!.includes(i.id))!;
  assert.ok(itemEligible(item, context, [], initialTime, 'local_evaluation', blueprint));
  assert.equal(itemEligible(item, context, [], initialTime, 'local_evaluation'), false);
  assert.equal(itemEligible({ ...item, id: 'unreviewed-foundation' }, context, [], initialTime, 'local_evaluation', blueprint), false);
  assert.equal(itemEligible({ ...item, scope: {} }, context, [], initialTime, 'local_evaluation', blueprint), false);
  assert.equal(itemEligible(item, { ...context, grade: 4, teacherCoveredTargets: [item.targetId] }, [], initialTime, 'local_evaluation', blueprint), false);
  assert.equal(itemEligible({ ...item, status: 'hold' }, context, [], initialTime, 'local_evaluation', blueprint), false);
  const current = registry.items.find(i => i.grade === 3 && i.teachingLinks.some(l => l.hashes.en))!;
  assert.equal(itemEligible(current, context, [], initialTime, 'local_evaluation', blueprint), false);
  const event = exposure(current, 'en', initialTime);
  assert.equal(itemEligible(current, context, [event], initialTime, 'local_evaluation', blueprint), true);
  assert.equal(itemEligible(current, context, [{ ...event, presentedTextSha256: '0'.repeat(64) }], initialTime, 'local_evaluation', blueprint), false);
  assert.equal(selectAssessment(registry, context, { history: [], exposures: [] }, initialTime, 'production', 'production').ok, false);
});

for (const language of ['en', 'tl', 'bis'] as const) {
  for (const historyKind of ['empty', 'sparse', 'rich'] as const) {
    test(`Grade 3 ${language} sustains 8 follow-ups with ${historyKind} recent history, four seeds`, () => {
      const seenFamilies = new Set<string>();
      const distinct = registry.items.filter(i => {
        if (i.grade !== 3 || !i.teachingLinks.some(l => l.hashes[language]) || seenFamilies.has(i.familyId)) return false;
        seenFamilies.add(i.familyId); return true;
      });
      const teaching = historyKind === 'empty' ? [] : historyKind === 'sparse' ? distinct.slice(0, 2) : distinct;
      for (let seed = 0; seed < 4; seed++) {
        const ctx = { ...context, profileId: `foundation-${language}-${historyKind}-${seed}`, language };
        const history: AssessmentResult[] = [];
        const first = select([], [], initialTime, `first-${seed}`, ctx);
        history.push(finish(first, [], initialTime));
        for (let n = 1; n <= 8; n++) {
          const now = new Date(Date.parse(initialTime) + n * FORTNIGHT_MS).toISOString();
          const seenAt = new Date(Date.parse(now) - 86400000).toISOString();
          const events = teaching.map(i => exposure(i, language, seenAt));
          const session = select(history, events, now, `${seed}-${n}`, ctx);
          invariants(session, history);
          assert.equal(session.items.filter(i => i.role === 'recent').length, historyKind === 'empty' ? 0 : historyKind === 'sparse' ? 2 : 6);
          for (const question of session.items) {
            const item = registry.items.find(i => i.id === question.id)!;
            assert.equal(question.stem, item.content.stem[language]);
            if (question.role === 'readiness') assert.ok(blueprint.foundation_item_ids!.includes(item.id));
          }
          const result = finish(session, history, now);
          assert.equal(result.score.correct, 8);
          assert.ok(result.comparison);
          history.push(result);
        }
      }
    });
  }
}

test('a language/content change starts a balanced new baseline and preserves old results', () => {
  const first = finish(select(), [], initialTime);
  const before = JSON.stringify(first);
  const changed = select([first], [], initialTime, 'new-language', { ...context, language: 'tl' });
  assert.equal(changed.kind, 'baseline');
  assert.equal(changed.items.filter(i => i.role === 'recent').length, 0);
  for (const domain of Object.keys(blueprint.baseline_domain_counts))
    assert.equal(changed.items.filter(i => i.domain === domain).length, 3);
  assert.equal(finish(changed, [first], initialTime).comparison, null);
  const nextBank = structuredClone(registry);
  nextBank.blueprints.find(b => b.student_grade === 3)!.revision += '-review-change';
  const revised = select([first], [], initialTime, 'new-content', context, nextBank);
  assert.equal(revised.kind, 'baseline');
  assert.equal(finish(revised, [first], initialTime).comparison, null);
  assert.equal(JSON.stringify(first), before);
  const following = select([first], [], initialTime, 'support-change');
  assert.equal(finish(following, [first], initialTime, true).comparison, null);
});

test('picture questions freeze scene data and reject missing, foreign or malformed saved scenes', () => {
  const session = select();
  const question = session.items.find(i => i.diagram)!;
  assert.ok(question.diagramRequired);
  const source = registry.items.find(i => i.id === question.id)!;
  assert.notEqual(question.diagram, source.content.diagram);
  const data = { ...emptyAssessmentData(context.profileId), activeSession: session };
  const restored = decodeAssessmentData(JSON.stringify(data), context.profileId);
  assert.deepEqual(restored.activeSession?.items, session.items);
  for (const broken of [null, {}, { kind: 'remote', url: 'https://invalid.test/answer.png' }, { kind: 'ball_box', relation: 'unknown' }]) {
    const edited = structuredClone(data);
    (edited.activeSession.items.find(i => i.diagram) as any).diagram = broken;
    assert.throws(() => decodeAssessmentData(JSON.stringify(edited), context.profileId), /kept for recovery/);
  }
  const missing = structuredClone(data);
  delete missing.activeSession.items.find(i => i.diagram)!.diagram;
  assert.throws(() => decodeAssessmentData(JSON.stringify(missing), context.profileId), /kept for recovery/);
});

test('diagram geometry distinguishes contact, gap, enclosure and reversed vertical observations', () => {
  const on = ballBoxGeometry('on'), above = ballBoxGeometry('above'), below = ballBoxGeometry('below'), inside = ballBoxGeometry('inside');
  assert.equal(on.ball.y + on.ball.r, on.box.y);
  assert.ok(above.ball.y + above.ball.r < above.box.y - 20);
  assert.ok(below.ball.y - below.ball.r > below.box.y + below.box.height + 20);
  assert.ok(inside.ball.x - inside.ball.r > inside.box.x && inside.ball.x + inside.ball.r < inside.box.x + inside.box.width);
  assert.ok(inside.ball.y - inside.ball.r > inside.box.y && inside.ball.y + inside.ball.r < inside.box.y + inside.box.height);
  assert.ok(inside.frontWallTop! > inside.ball.y && inside.frontWallTop! < inside.ball.y + inside.ball.r,
    'front wall hides the bottom of the ball, distinguishing inside from sitting on the rim');
  assert.equal(isAssessmentDiagram({ kind: 'ball_box', relation: 'on', answer: 'o1' }), false);
});

test('fresh Grade 3 profiles each get an offer; save failure, process restart and fortnight due retain the exam', async () => {
  const disk = new Map<string, string>();
  let now = initialTime, elapsed = 0, failSave = false;
  const make = () => createAssessmentController({ registry, mode: 'local_evaluation', now: () => now, monotonic: () => elapsed, seed: () => `flow-${elapsed}`,
    storage: { async load(id, mode) { return disk.get(assessmentStorageKey(id, mode)) ?? null; }, async save(id, value, mode) { if (failSave) throw Error('test write failure'); disk.set(assessmentStorageKey(id, mode), value); } } });
  let controller = make();
  await controller.hydrate(context);
  assert.equal(controller.getSnapshot().needsBaseline, true);
  assert.equal(controller.getSnapshot().eligible, true);
  await controller.begin(context);
  const session = controller.getSnapshot().activeSession!;
  const first = session.items[0]!;
  failSave = true;
  await controller.answer({ sessionId: session.id, itemId: first.id, optionId: first.correctOptionId });
  assert.equal(controller.getSnapshot().activeSession!.answers.length, 0);
  assert.match(controller.getSnapshot().error, /write failure/);
  failSave = false;
  await controller.retry();
  assert.equal(controller.getSnapshot().activeSession!.answers.length, 1);
  controller = make();
  await controller.hydrate(context);
  assert.deepEqual(controller.getSnapshot().activeSession!.items, session.items);
  assert.equal(controller.getSnapshot().activeSession!.answers.length, 1);
  for (const item of session.items.slice(1))
    await controller.answer({ sessionId: session.id, itemId: item.id, optionId: item.correctOptionId });
  assert.equal(controller.getSnapshot().results!.score.correct, 12);
  await controller.dismissResults();
  assert.equal(controller.getSnapshot().needsBaseline, false);
  assert.equal(controller.getSnapshot().due, false);
  now = new Date(Date.parse(initialTime) + FORTNIGHT_MS).toISOString(); elapsed = FORTNIGHT_MS;
  await controller.hydrate(context);
  assert.equal(controller.getSnapshot().due, true);
  await controller.hydrate({ ...context, profileId: 'second-grade3-profile' });
  assert.equal(controller.getSnapshot().history.length, 0);
  assert.equal(controller.getSnapshot().needsBaseline, true);
  assert.equal(controller.getSnapshot().eligible, true);
});
