import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecordData } from '@hiraia/tala-core';
import type { EntityName, Mutation, MutationResult, Plan, PlanSection, RecordData } from '@hiraia/tala-core';
import { createTestServer } from '../../testing';
import type { TestServer } from '../../testing';
import { COALESCE_MS } from './revisions';

let counter = 0;
const mid = () => `mutation-p-${String(++counter).padStart(6, '0')}`;
const upsert = <E extends EntityName>(entity: E, data: RecordData<E>, baseRev = 0): Mutation => ({ mutationId: mid(), entity, id: data.id, op: 'upsert', baseRev, data });
const del = (entity: EntityName, id: string, baseRev: number): Mutation => ({ mutationId: mid(), entity, id, op: 'delete', baseRev });

async function push(t: TestServer, token: string, mutations: Mutation[]): Promise<MutationResult[]> {
  return (await t.ok('sync.push', { token, body: { deviceId: 'device-0001', mutations } })).results as MutationResult[];
}

const LOCK = { lockedAt: '2026-11-16T00:00:00.000Z', lockedBy: '', revisionCode: 'K7Q2M9A', revision: null };
const draft = (extra: Record<string, unknown> = {}) =>
  parseRecordData('plan', { id: 'plan-0001', templateId: 'tpl.dlp.v1', language: 'fil', grades: ['4'], durationMinutes: 50, title: 'Mga Halaman', ...extra });
const text = (id: string, key: string, value: string) =>
  parseRecordData('plan_section', { id, planId: 'plan-0001', key, content: { type: 'text', blocks: value ? [{ t: 'p', spans: [{ text: value }] }] : [] } });
const list = (id: string, key: string, items: string[]) => parseRecordData('plan_section', { id, planId: 'plan-0001', key, content: { type: 'list', items } });
const procedure = (body: string) =>
  parseRecordData('plan_section', {
    id: 'sec-procedure', planId: 'plan-0001', key: 'procedure',
    content: { type: 'procedure', steps: [{ id: 'step-0001', title: 'Panimula', minutes: 10, body: body ? [{ t: 'p', spans: [{ text: body }] }] : [] }] },
  });

/** A complete DLP: every required part has something in it. */
const completeSections = (): PlanSection[] => [
  list('sec-objectives', 'objectives', ['Natutukoy ang mga bahagi ng halaman']),
  list('sec-materials', 'materials', ['Tunay na halaman', 'Papel']),
  procedure('Ipakita ang halaman at itanong kung ano ang napapansin.'),
  text('sec-assessment', 'assessment', 'Iguhit at lagyan ng pangalan ang mga bahagi.'),
  text('sec-reflection', 'reflection', ''),
];

async function seedDraft(t: TestServer, token: string, plan: Plan = draft()) {
  const results = await push(t, token, [upsert('plan', plan), ...completeSections().map((s) => upsert('plan_section', s))]);
  assert.ok(results.every((r) => r.status === 'applied'));
}

test('DOC-1: a plan cannot be locked while a required part is empty or it has no competency', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ displayName: 'Gng. Reyes' });
  const klass = parseRecordData('class', { id: 'class-0001', schoolYearId: 'sy-2026-27', name: 'Baitang 4 - Sampaguita', gradeGroups: [{ id: 'gg-000001', grade: '4' }] });
  const placed = { placements: [{ classId: 'class-0001', assignmentId: null, dates: ['2026-11-18'] }] };
  await push(t, u.token, [upsert('class', klass), upsert('plan', draft(placed)), ...completeSections().filter((s) => s.key !== 'assessment').map((s) => upsert('plan_section', s))]);

  // Assessment is required by the DLP template and is missing.
  const [missing] = await push(t, u.token, [upsert('plan', draft({ ...placed, state: 'locked', lock: LOCK, competencies: { 'gg-000001': ['matatag.science.g4.t2.003'] } }), 1)]);
  assert.equal(missing!.status, 'invalid');
  assert.match(missing!.message!, /cannot be locked yet.*Assessment/);
  assert.equal((missing!.record!.data as Plan).state, 'draft', 'the server copy stays a draft');

  // Present but empty is the same as missing.
  await push(t, u.token, [upsert('plan_section', text('sec-assessment', 'assessment', '   '))]);
  assert.equal((await push(t, u.token, [upsert('plan', draft({ ...placed, state: 'locked', lock: LOCK, competencies: { 'gg-000001': ['c1'] } }), 1)]))[0]!.status, 'invalid');

  // Complete, but the class follows the preloaded curriculum and no competency is tagged.
  await push(t, u.token, [upsert('plan_section', text('sec-assessment', 'assessment', 'Maikling pagsusulit.'), 1)]);
  const [untagged] = await push(t, u.token, [upsert('plan', draft({ ...placed, state: 'locked', lock: LOCK }), 1)]);
  assert.equal(untagged!.status, 'invalid');
  assert.match(untagged!.message!, /competency/);

  // With a competency it locks. For a class with no preloaded curriculum (CUR-10) the tag is not asked for.
  const [locked] = await push(t, u.token, [upsert('plan', draft({ ...placed, state: 'locked', lock: LOCK, competencies: { 'gg-000001': ['matatag.science.g4.t2.003'] } }), 1)]);
  assert.equal(locked!.status, 'applied');
  const ownCurriculum = parseRecordData('class', { ...klass, id: 'class-0002', curriculum: 'none' });
  const other = draft({ id: 'plan-0002', placements: [{ classId: 'class-0002', assignmentId: null, dates: ['2026-11-18'] }] });
  await push(t, u.token, [upsert('class', ownCurriculum), upsert('plan', other), ...completeSections().map((s) => upsert('plan_section', { ...s, id: `${s.id}-2`, planId: 'plan-0002' }))]);
  assert.equal((await push(t, u.token, [upsert('plan', { ...other, state: 'locked', lock: LOCK }, 1)]))[0]!.status, 'applied');

  // A lock with no lock details is not a lock.
  assert.equal((await push(t, u.token, [upsert('plan', draft({ id: 'plan-0003', state: 'locked' }))]))[0]!.status, 'invalid');
  t.close();
});

test('locking records who, when and the exact revision, and that revision stays reproducible', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ displayName: 'Gng. Reyes' });
  await seedDraft(t, u.token, draft({ aiDraft: true, aiAssisted: true }));
  t.clock.advance({ hours: 1 });

  const [locked] = await push(t, u.token, [upsert('plan', draft({ aiDraft: true, aiAssisted: true, state: 'locked', lock: LOCK }), 1)]);
  assert.equal(locked!.status, 'applied');
  const plan = locked!.record!.data as Plan;
  assert.equal(plan.state, 'locked');
  assert.equal(plan.lock!.lockedBy, 'Gng. Reyes', 'who');
  assert.equal(plan.lock!.lockedAt, LOCK.lockedAt, 'when, as the device recorded it');
  assert.equal(plan.lock!.revisionCode, 'K7Q2M9A');
  assert.equal(plan.lock!.revision, 2, 'the exact server revision');
  assert.equal(plan.aiDraft, false, 'a locked plan is the teacher’s checked work');
  assert.equal(plan.aiAssisted, true, 'provenance is kept');

  const listed = await t.ok('plans.revisions', { token: u.token, params: { planId: 'plan-0001' } });
  assert.deepEqual(listed.revisions.map((r) => [r.revision, r.reason, r.locked]), [
    [2, 'lock', true],
    [1, 'save', false],
  ]);
  assert.equal(listed.revisions[0]!.createdAt, t.clock.now().toISOString());

  // A lock time far in the future (a wrong device clock) is replaced by the server's.
  await seedDraftAs(t, u.token, 'plan-0002');
  const [future] = await push(t, u.token, [upsert('plan', draft({ id: 'plan-0002', state: 'locked', lock: { ...LOCK, lockedAt: '2031-01-01T00:00:00.000Z' } }), 1)]);
  assert.equal((future!.record!.data as Plan).lock!.lockedAt, t.clock.now().toISOString());

  // The locked revision can be read back exactly, with its sections.
  const revision = await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '2' } });
  assert.deepEqual(revision.meta, listed.revisions[0]);
  assert.equal((revision.plan.data as Plan).lock!.revision, 2);
  assert.equal(revision.sections.length, 5);
  assert.equal((await t.call('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '99' } })).status, 404);
  assert.equal((await t.call('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: 'latest' } })).status, 404);
  t.close();
});

async function seedDraftAs(t: TestServer, token: string, planId: string) {
  await push(t, token, [upsert('plan', draft({ id: planId })), ...completeSections().map((s) => upsert('plan_section', { ...s, id: `${s.id}-${planId}`, planId }))]);
}

test('DOC-2: a locked plan keeps its content; dates, the submitted note and its unit may still change', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  await seedDraft(t, u.token);
  const [locked] = await push(t, u.token, [upsert('plan', draft({ state: 'locked', lock: LOCK }), 1)]);
  const stored = locked!.record!.data as Plan;
  const rev = locked!.record!.rev;

  // The device has not yet seen the server's lock.revision and still sends null: that is not a change.
  const offlineCopy = { ...stored, lock: { ...stored.lock!, revision: null } };

  for (const change of [{ title: 'Ibang pamagat' }, { durationMinutes: 40 }, { competencies: { 'gg-000001': ['x'] } }, { customObjectives: ['bago'] }, { templateId: 'tpl.dll.v1' }, { language: 'en' as const }]) {
    const [refused] = await push(t, u.token, [upsert('plan', { ...offlineCopy, ...change }, rev)]);
    assert.equal(refused!.status, 'locked', JSON.stringify(change));
    assert.equal((refused!.record!.data as Plan).title, 'Mga Halaman');
  }
  // A different lock (locked independently on another device) does not replace this one.
  assert.equal((await push(t, u.token, [upsert('plan', { ...offlineCopy, lock: { ...LOCK, revisionCode: 'OTHER01' } }, rev)]))[0]!.status, 'locked');
  // A locked plan cannot be deleted (DOC-2).
  assert.equal((await push(t, u.token, [del('plan', 'plan-0001', rev)]))[0]!.status, 'locked');

  // The pacing engine moves it to another day; the teacher notes that it was submitted (DOC-5); it joins a unit.
  const [moved] = await push(t, u.token, [
    upsert('plan', { ...offlineCopy, placements: [{ classId: 'class-0001', assignmentId: null, dates: ['2026-11-20'] }], submitted: { date: '2026-11-17', note: 'Kay Gng. Cruz' }, unitId: 'unit-0001' }, rev),
  ]);
  assert.equal(moved!.status, 'applied');
  const after = moved!.record!.data as Plan;
  assert.equal(after.state, 'locked');
  assert.equal(after.lock!.revision, stored.lock!.revision, 'the lock still points at the same revision');
  assert.equal(after.submitted!.note, 'Kay Gng. Cruz');

  // Archiving a locked plan keeps it locked: it is hidden from the timeline, not reopened.
  const [archived] = await push(t, u.token, [upsert('plan', { ...after, state: 'archived' }, moved!.record!.rev)]);
  assert.equal(archived!.status, 'applied');
  assert.equal((archived!.record!.data as Plan).lock!.revisionCode, 'K7Q2M9A');
  assert.equal((await push(t, u.token, [upsert('plan_section', text('sec-assessment', 'assessment', 'edited while archived'), 1)]))[0]!.status, 'locked');
  assert.equal((await push(t, u.token, [upsert('plan', { ...(archived!.record!.data as Plan), title: 'changed while archived' }, archived!.record!.rev)]))[0]!.status, 'locked');
  assert.equal((await push(t, u.token, [upsert('plan', { ...(archived!.record!.data as Plan), state: 'locked' }, archived!.record!.rev)]))[0]!.status, 'applied');
  t.close();
});

test('DOC-3 and DOC-6: unlocking makes a new draft revision; the locked one, with its submitted note, stays', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  await seedDraft(t, u.token);
  const [locked] = await push(t, u.token, [upsert('plan', draft({ state: 'locked', lock: LOCK }), 1)]);
  const lockedPlan = locked!.record!.data as Plan;
  const [submitted] = await push(t, u.token, [upsert('plan', { ...lockedPlan, submitted: { date: '2026-11-17', note: 'Kay Gng. Cruz' } }, locked!.record!.rev)]);
  t.clock.advance({ days: 2 });

  // The device unlocks: state back to draft. Whatever it sends for lock and submitted, the draft has neither.
  const [unlocked] = await push(t, u.token, [upsert('plan', { ...(submitted!.record!.data as Plan), state: 'draft' }, submitted!.record!.rev)]);
  assert.equal(unlocked!.status, 'applied');
  const reopened = unlocked!.record!.data as Plan;
  assert.deepEqual([reopened.state, reopened.lock, reopened.submitted], ['draft', null, null]);

  // Now it can be edited again.
  t.clock.advance({ hours: 1 });
  assert.equal((await push(t, u.token, [upsert('plan_section', text('sec-assessment', 'assessment', 'Bagong pagtataya pagkatapos buksan.'), 1)]))[0]!.status, 'applied');

  const revisions = (await t.ok('plans.revisions', { token: u.token, params: { planId: 'plan-0001' } })).revisions;
  assert.deepEqual(revisions.map((r) => [r.revision, r.reason, r.locked]), [
    [5, 'save', false],
    [4, 'unlock', false],
    [3, 'save', true],
    [2, 'lock', true],
    [1, 'save', false],
  ]);

  // The locked revision is still exactly what was locked, so its PDF can be made again.
  const lockRevision = await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '2' } });
  assert.equal((lockRevision.plan.data as Plan).state, 'locked');
  const assessment = lockRevision.sections.find((s) => (s.data as PlanSection).key === 'assessment')!.data as PlanSection;
  assert.deepEqual(assessment.content, text('sec-assessment', 'assessment', 'Iguhit at lagyan ng pangalan ang mga bahagi.').content);
  // The submitted note lives on the locked side of the history, not on the new draft.
  const whileLocked = await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '3' } });
  assert.equal((whileLocked.plan.data as Plan).submitted!.note, 'Kay Gng. Cruz');
  const afterUnlock = await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '4' } });
  assert.equal((afterUnlock.plan.data as Plan).submitted, null);

  // Locking again gives a new lock revision; the old one remains.
  const [relocked] = await push(t, u.token, [upsert('plan', { ...reopened, state: 'locked', lock: { ...LOCK, revisionCode: 'SECOND1' } }, unlocked!.record!.rev)]);
  assert.equal((relocked!.record!.data as Plan).lock!.revision, 6);
  assert.equal((await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '2' } })).meta.reason, 'lock');
  t.close();
});

test('DOC-4: a lock made on one device wins over a later edit from another', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  await seedDraft(t, u.token);
  // Phone locks. Laptop, offline since rev 1, then sends an edit to a locked part and to the title.
  await push(t, u.token, [upsert('plan', draft({ state: 'locked', lock: LOCK }), 1)]);
  const [sectionEdit, titleEdit] = await push(t, u.token, [
    upsert('plan_section', text('sec-assessment', 'assessment', 'Edited on the laptop before it knew of the lock'), 1),
    upsert('plan', draft({ title: 'Laptop title' }), 1),
  ]);
  assert.equal(sectionEdit!.status, 'locked', 'the device turns this into a draft copy (conflictCopyOf)');
  // The plan record itself is first a plain conflict (its rev moved when it was locked)…
  assert.equal(titleEdit!.status, 'conflict');
  const server = titleEdit!.record!;
  // …and when the device re-applies its title onto the locked record, the lock holds.
  assert.equal((await push(t, u.token, [upsert('plan', { ...(server.data as Plan), title: 'Laptop title' }, server.rev)]))[0]!.status, 'locked');

  // The draft copy the device makes is an ordinary new plan and is accepted.
  const copy = draft({ id: 'plan-copy-01', conflictCopyOf: 'plan-0001' });
  const copied = await push(t, u.token, [upsert('plan', copy), upsert('plan_section', { ...text('sec-copy-0001', 'assessment', 'Edited on the laptop'), planId: 'plan-copy-01' })]);
  assert.deepEqual(copied.map((r) => r.status), ['applied', 'applied']);
  assert.equal(t.services.records.planSnapshot(u.id, 'plan-0001')!.plan.data.state, 'locked');
  t.close();
});

test('PLAN-10: saves close together share one revision; a later save, and an AI rewrite, get their own', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  await seedDraft(t, u.token);
  const revisionsOf = async () => (await t.ok('plans.revisions', { token: u.token, params: { planId: 'plan-0001' } })).revisions.map((r) => [r.revision, r.reason]);
  assert.deepEqual(await revisionsOf(), [[1, 'save']]);

  // Typing: several saves inside the window fold into the same revision, which holds the latest text.
  let rev = 1;
  for (const words of ['Una', 'Una at ikalawa', 'Una, ikalawa at ikatlo']) {
    t.clock.advance({ minutes: 2 });
    rev = (await push(t, u.token, [upsert('plan_section', text('sec-assessment', 'assessment', words), rev)]))[0]!.record!.rev;
  }
  assert.deepEqual(await revisionsOf(), [[1, 'save']]);
  const one = await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '1' } });
  assert.match(JSON.stringify(one.sections), /Una, ikalawa at ikatlo/);

  // Past the window, the next save starts a new revision and the earlier one is left as it was.
  t.clock.advance(COALESCE_MS + 1000);
  rev = (await push(t, u.token, [upsert('plan_section', text('sec-assessment', 'assessment', 'Kinabukasan'), rev)]))[0]!.record!.rev;
  assert.deepEqual(await revisionsOf(), [[2, 'save'], [1, 'save']]);
  assert.match(JSON.stringify((await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '1' } })).sections), /Una, ikalawa at ikatlo/);

  // An AI rewrite never overwrites silently (LLM-4): it is its own revision, and the text before it is in the previous one.
  t.clock.advance({ minutes: 1 });
  const generated = parseRecordData('plan_section', {
    ...text('sec-assessment', 'assessment', 'Isinulat ng AI'), origin: 'ai',
    gen: { provider: 'deepseek', model: 'test-model', promptId: 'lesson/section', promptVersion: 1, curriculumVersion: null, at: t.clock.now().toISOString() },
  });
  rev = (await push(t, u.token, [upsert('plan_section', generated, rev)]))[0]!.record!.rev;
  assert.deepEqual(await revisionsOf(), [[3, 'regenerate'], [2, 'save'], [1, 'save']]);
  assert.match(JSON.stringify((await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '2' } })).sections), /Kinabukasan/);

  // The teacher's edit after the rewrite does not fold into the AI revision.
  t.clock.advance({ minutes: 1 });
  await push(t, u.token, [upsert('plan_section', { ...generated, content: text('x-000001', 'assessment', 'Inayos ng guro').content, editedByTeacher: true }, rev)]);
  assert.deepEqual((await revisionsOf())[0], [4, 'save']);
  assert.match(JSON.stringify((await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '3' } })).sections), /Isinulat ng AI/);

  // Changing nothing makes no revision.
  await push(t, u.token, [upsert('plan', draft(), 1)]);
  assert.equal((await revisionsOf()).length, 4);
  t.close();
});

test('sections that arrive before their plan are kept, and the first snapshot waits for the plan', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  const early = await push(t, u.token, completeSections().map((s) => upsert('plan_section', s)));
  assert.ok(early.every((r) => r.status === 'applied'));
  assert.equal((await t.ok('plans.revisions', { token: u.token, params: { planId: 'plan-0001' } })).revisions.length, 0);
  await push(t, u.token, [upsert('plan', draft())]);
  const first = await t.ok('plans.revision', { token: u.token, params: { planId: 'plan-0001', revision: '1' } });
  assert.equal(first.sections.length, 5);
  t.close();
});
