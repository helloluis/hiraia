import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createTestServer } from '../../testing';
import type { TestServer } from '../../testing';
import { createCommunityModule, recheckPending, staffRestore, staffTakedown } from './index';
import type { CommunityDeps } from './service';
import { allowAll, createFakeLlm, fid, okVerdict, postBody, put, seedPlan, seedTeacher, unavailable } from './testing';
import type { FakeLlm } from './testing';
import type { RecordStore } from '../../kernel/types';

interface World {
  t: TestServer;
  store: RecordStore;
  llm: FakeLlm;
  deps(): CommunityDeps;
}

function world(opts: { llm?: FakeLlm; config?: Parameters<typeof createTestServer>[0] extends infer O ? O extends { config?: infer C } ? C : never : never } = {}): World {
  const llm = opts.llm ?? createFakeLlm();
  const t = createTestServer({ modules: [createCommunityModule({ recheckIntervalMs: 0 })], services: { llm }, config: opts.config, quiet: !process.env.DEBUG_G });
  return {
    t,
    store: t.services.records,
    llm,
    deps: () => ({ db: t.db, services: t.services, config: t.config, now: t.clock.now, newId: () => fid('id'), log: { info() {}, warn() {}, error() {} } }),
  };
}

async function teacherWithPlan(w: World, grades = ['4'], opts: Parameters<typeof seedPlan>[4] = {}, setupOpts: Parameters<typeof seedTeacher>[2] = {}) {
  const user = await w.t.registerUser();
  const setup = seedTeacher(w.store, user.id, { grades, ...setupOpts });
  const planId = seedPlan(w.store, user.id, setup, grades, opts);
  return { user, setup, planId };
}

const allText = (x: unknown) => JSON.stringify(x);

/* ---------------- posting ---------------- */

test('a locked plan posts, is visible at once, stripped, tagged and licensed', async () => {
  const w = world();
  const { user, planId } = await teacherWithPlan(w);
  const other = await w.t.registerUser();
  const res = await w.t.ok('community.post', { body: postBody(planId, { region: 'Bicol' }), token: user.token });
  assert.equal(res.moderation.decision, 'allow');
  assert.equal(res.artifact.status, 'visible');
  assert.equal(res.artifact.license, 'CC-BY-NC-4.0');
  assert.equal(res.artifact.authorSchool, null);
  assert.deepEqual(res.artifact.provenance, { aiDrafted: false, adapted: false });
  assert.deepEqual(res.artifact.tags.grades, ['4']);
  assert.equal(res.artifact.tags.termIndex, 3, 'quarter derived from the placement date');
  assert.equal(res.artifact.tags.templateKind, 'dlp');
  assert.equal(res.artifact.tags.region, 'Bicol');
  assert.deepEqual(res.artifact.tags.competencyIds, ['S4-COMP-1']);
  assert.equal(w.llm.calls.length, 1);
  assert.equal(w.llm.calls[0]!.feature, 'community.moderate');
  assert.equal(w.llm.calls[0]!.promptId, 'moderation/moderate');

  const detail = await w.t.ok('community.get', { params: { artifactId: res.artifact.id }, token: other.token });
  const text = allText(detail.version);
  assert.ok(!detail.version.sections.some((s) => s.key === 'reflection'), 'reflection is never posted');
  assert.ok(!text.includes('Malinao'), 'school name stripped');
  assert.ok(!text.includes('Sampaguita'), 'section (class) name stripped');
  assert.ok(!text.includes('November 16, 2026'), 'the plan\'s own date stripped');
  assert.ok(!text.includes('MARIA C. SANTOS') && !text.includes('JUAN DELA CRUZ') && !text.includes('Prepared by'), 'signature blocks stripped');
  assert.ok(text.includes('Manila Paper') && text.includes('Label the parts of a plant.'), 'lesson content kept');
  assert.ok(!text.includes(w.store.list(user.id, 'class')[0]!.id), 'no local ids');
  assert.equal(detail.mine, false);

  const page = await w.t.ok('community.search', { query: {}, token: other.token });
  assert.deepEqual(page.items.map((i) => i.id), [res.artifact.id]);
  w.t.close();
});

test('school name is shown only when the author opts in', async () => {
  const w = world();
  const { user, planId } = await teacherWithPlan(w);
  const res = await w.t.ok('community.post', { body: postBody(planId, { showSchool: true }), token: user.token });
  assert.equal(res.artifact.authorSchool, 'Malinao Elementary School');
  const detail = await w.t.ok('community.get', { params: { artifactId: res.artifact.id }, token: user.token });
  assert.ok(allText(detail.version).includes('Malinao Elementary School'));
  w.t.close();
});

test('posting needs a locked plan of your own, not from a sample class, and a confirmed email', async () => {
  const w = world();
  const { user, setup } = await teacherWithPlan(w);
  const draft = seedPlan(w.store, user.id, setup, ['4'], { state: 'draft' });
  let r = await w.t.call('community.post', { body: postBody(draft), token: user.token });
  assert.equal(r.error?.code, 'conflict');

  const other = await w.t.registerUser();
  const othersPlan = seedPlan(w.store, other.id, seedTeacher(w.store, other.id), ['4']);
  r = await w.t.call('community.post', { body: postBody(othersPlan), token: user.token });
  assert.equal(r.error?.code, 'not_found', "another teacher's plan is invisible");

  const sampleSetup = seedTeacher(w.store, user.id, { isSample: true });
  const samplePlan = seedPlan(w.store, user.id, sampleSetup, ['4']);
  r = await w.t.call('community.post', { body: postBody(samplePlan), token: user.token });
  assert.equal(r.error?.code, 'forbidden');

  const unverified = await w.t.registerUser({ verified: false });
  const p2 = seedPlan(w.store, unverified.id, seedTeacher(w.store, unverified.id), ['4']);
  r = await w.t.call('community.post', { body: postBody(p2), token: unverified.token });
  assert.equal(r.error?.code, 'forbidden');
  assert.match(r.error!.message, /confirm your email/);
  w.t.close();
});

test('posting again from a newer locked revision adds a version; the same revision is idempotent', async () => {
  const w = world();
  const { user, setup, planId } = await teacherWithPlan(w);
  const first = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  const again = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(again.artifact.currentVersionId, first.artifact.currentVersionId, 'offline retry does not duplicate');
  assert.equal(w.llm.calls.length, 1, 'no second model call for a retry');

  seedPlan(w.store, user.id, setup, ['4'], { planId, revisionCode: 'DEF456', title: 'Parts of a Plant v2' });
  const second = await w.t.ok('community.post', { body: postBody(planId, { title: 'Parts of a Plant (revised)', artifactId: first.artifact.id }), token: user.token });
  assert.equal(second.artifact.id, first.artifact.id);
  assert.equal(second.artifact.versionNumber, 2);
  assert.equal(second.artifact.title, 'Parts of a Plant (revised)');
  assert.notEqual(second.artifact.currentVersionId, first.artifact.currentVersionId);

  // The older version stays reachable for copying.
  const reader = await w.t.registerUser();
  const old = await w.t.ok('community.copy', { params: { artifactId: first.artifact.id }, body: { versionId: first.artifact.currentVersionId }, token: reader.token });
  assert.equal(old.plan.lineage?.versionId, first.artifact.currentVersionId);
  assert.equal(old.plan.title, 'Parts of a Plant');

  // A version cannot be added to another teacher's artifact.
  const other = await w.t.registerUser();
  const otherPlan = seedPlan(w.store, other.id, seedTeacher(w.store, other.id), ['4']);
  const r = await w.t.call('community.post', { body: postBody(otherPlan, { artifactId: first.artifact.id }), token: other.token });
  assert.equal(r.error?.code, 'not_found');
  w.t.close();
});

/* ---------------- moderation: loose vs strict ---------------- */

test('loose: a mediocre lesson passes; unclear non-personal-data reasons are dropped', async () => {
  const w = world();
  // The model grumbles that this is not much of a lesson, but is not sure: unsure means allow.
  w.llm.script = () => okVerdict({ decision: 'return', reasons: [{ category: 'not_a_lesson', clear: false, message: 'Very short.', sectionKey: null, excerpt: null }] });
  const { user, planId } = await teacherWithPlan(w, ['4'], { contentText: ['plants r green. teach it. idk', 'Ask Jose Rizal and Andres Bonifacio trivia.'] });
  const res = await w.t.ok('community.post', { body: postBody(planId, { title: 'plants', summary: '' }), token: user.token });
  assert.equal(res.moderation.decision, 'allow');
  assert.equal(res.artifact.status, 'visible');
  w.t.close();
});

test('strict: a lesson with a class list is returned with section and excerpt, without a model call, and nothing is stored', async () => {
  const w = world();
  const { user, setup, planId } = await teacherWithPlan(w, ['4'], {
    contentText: ['Group 1: Juan Santos, Maria Reyes, Ana Cruz', 'Group 2: Mark Garcia, Paolo Mendoza, Kristine Torres'],
  });
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.moderation.decision, 'return');
  assert.equal(res.artifact.status, 'returned');
  const reason = res.moderation.reasons[0]!;
  assert.equal(reason.category, 'student_personal_data');
  assert.equal(reason.sectionKey, 'content');
  assert.match(reason.excerpt ?? '', /Juan Santos/);
  assert.equal(w.llm.calls.length, 0, 'strict rule finding needs no model');
  assert.equal((w.t.db.prepare('SELECT COUNT(*) n FROM community_artifacts').get() as { n: number }).n, 0);
  assert.equal((w.t.db.prepare('SELECT COUNT(*) n FROM community_versions').get() as { n: number }).n, 0);
  const log = w.t.db.prepare('SELECT * FROM community_moderation_log').all() as Array<Record<string, unknown>>;
  assert.equal(log.length, 1);
  assert.equal(log[0]!['decision'], 'return');
  assert.equal(log[0]!['provider'], 'rules');
  assert.equal(log[0]!['guideline_version'], 1);
  assert.ok(!allText(log).includes('Juan'), 'no content in the decision log');
  assert.ok(!allText(w.t.logs).includes('Juan'), 'no content in server logs');

  // Unlimited re-posting, no penalty: fix the plan and post again.
  seedPlan(w.store, user.id, setup, ['4'], { planId, revisionCode: 'FIXED1' });
  const again = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(again.moderation.decision, 'allow');
  assert.equal(again.artifact.status, 'visible');
  w.t.close();
});

test('strict: a learner from the teacher\'s own roster is found by name', async () => {
  const w = world();
  const { user, planId } = await teacherWithPlan(w, ['4'], { contentText: ['Ask Rhea Villanueva to lead the song.'] }, { students: [{ givenName: 'Rhea', familyName: 'Villanueva' }] });
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.moderation.decision, 'return');
  assert.equal(res.moderation.reasons[0]!.sectionKey, 'content');
  assert.equal(w.llm.calls.length, 0);
  w.t.close();
});

test('the model can return a post; its excerpt is kept only if it is really in the lesson', async () => {
  const w = world();
  w.llm.script = () =>
    okVerdict({
      decision: 'return',
      reasons: [
        { category: 'student_personal_data', clear: true, message: 'Remove the note about a named child.', sectionKey: 'objectives', excerpt: 'Carlo has asthma' },
        { category: 'unsuitable', clear: true, message: 'Remove this.', sectionKey: 'nonsense', excerpt: 'text that is not there' },
      ],
    });
  const { user, planId } = await teacherWithPlan(w, ['4'], { contentText: ['Remember: Carlo has asthma, keep him indoors.'] });
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.moderation.decision, 'return');
  assert.deepEqual(
    res.moderation.reasons.map((r) => [r.category, r.sectionKey, r.excerpt]),
    [
      ['student_personal_data', 'content', 'Carlo has asthma'],
      ['unsuitable', null, null],
    ],
  );
  const log = w.t.db.prepare('SELECT provider, model, prompt_version, categories FROM community_moderation_log').get() as Record<string, unknown>;
  assert.deepEqual(log, { provider: 'deepseek', model: 'fake-flash', prompt_version: 1, categories: 'student_personal_data,unsuitable' });
  w.t.close();
});

test('rules-only routes allow without a model call; low hints alone never return', async () => {
  const w = world();
  w.llm.route = 'rules';
  const { user, planId } = await teacherWithPlan(w, ['4'], { contentText: ['Write 136512345678 in words.'] });
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.moderation.decision, 'allow');
  assert.equal(w.llm.calls.length, 0);
  w.t.close();
});

test('model unavailable → pending, invisible to others; a background recheck makes it visible', async () => {
  const w = world({ llm: createFakeLlm(unavailable) });
  const { user, planId } = await teacherWithPlan(w);
  const other = await w.t.registerUser();
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.moderation.decision, 'pending');
  assert.equal(res.artifact.status, 'pending_check');
  assert.equal((await w.t.ok('community.search', { query: {}, token: other.token })).items.length, 0);
  assert.equal((await w.t.call('community.get', { params: { artifactId: res.artifact.id }, token: other.token })).error?.code, 'not_found');
  assert.equal((await w.t.ok('community.search', { query: { mine: true }, token: user.token })).items[0]?.status, 'pending_check');

  // Still down: stays pending.
  assert.deepEqual(await recheckPending(w.deps()), { versions: 0, reports: 0 });
  w.llm.script = allowAll;
  assert.deepEqual(await recheckPending(w.deps()), { versions: 1, reports: 0 });
  const page = await w.t.ok('community.search', { query: {}, token: other.token });
  assert.equal(page.items[0]?.id, res.artifact.id);
  assert.equal(page.items[0]?.status, 'visible');
  const decisions = (w.t.db.prepare('SELECT trigger, decision, provider FROM community_moderation_log ORDER BY created_at, rowid').all() as Array<Record<string, unknown>>).map((r) => `${r['trigger']}:${r['decision']}:${r['provider']}`);
  assert.deepEqual(decisions, ['post:pending:none', 'recheck:allow:deepseek']);
  w.t.close();
});

test('a pending post that the recheck returns goes back to its author', async () => {
  const w = world({ llm: createFakeLlm(unavailable) });
  const { user, planId } = await teacherWithPlan(w);
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  w.llm.script = () => okVerdict({ decision: 'return', reasons: [{ category: 'not_a_lesson', clear: true, message: 'This is an advert.', sectionKey: null, excerpt: null }] });
  await recheckPending(w.deps());
  const mine = await w.t.ok('community.get', { params: { artifactId: res.artifact.id }, token: user.token });
  assert.equal(mine.status, 'returned');
  w.t.close();
});

/* ---------------- isolation ---------------- */

test('isolation: others see only visible artifacts; only the author removes; mine is per viewer', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const b = await w.t.registerUser();
  const posted = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  assert.equal((await w.t.ok('community.search', { query: {}, token: a.user.token })).items[0]!.mine, true);
  assert.equal((await w.t.ok('community.search', { query: {}, token: b.token })).items[0]!.mine, false);
  assert.equal((await w.t.ok('community.search', { query: { mine: true }, token: b.token })).items.length, 0);
  assert.equal((await w.t.call('community.remove', { params: { artifactId: posted.artifact.id }, token: b.token })).error?.code, 'forbidden');
  assert.equal((await w.t.call('community.search', { query: {} })).error?.code, 'unauthenticated', 'browsing needs sign-in');
  w.t.close();
});

/* ---------------- lineage and removal ---------------- */

test('lineage chain: copy, adapt, post; removing a source keeps the credit and shows it unavailable', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId, { displayName: 'Teacher A' }), token: a.user.token });

  // B copies A's lesson, locks the copy and posts it as a modification.
  const b = await w.t.registerUser();
  const bSetup = seedTeacher(w.store, b.id);
  const copy = await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: { gradeGroupIds: bSetup.groupIds }, token: b.token });
  assert.equal(copy.plan.state, 'draft');
  assert.deepEqual(copy.plan.lineage, { artifactId: src.artifact.id, versionId: src.artifact.currentVersionId, title: 'Parts of a Plant', authorDisplayName: 'Teacher A' });
  const bPlan = seedPlan(w.store, b.id, bSetup, ['4'], { lineage: copy.plan.lineage, sectionOrigin: 'copied', title: 'Plants, adapted' });
  const derived = await w.t.ok('community.post', { body: postBody(bPlan, { title: 'Plants, adapted', displayName: 'Teacher B' }), token: b.token });
  assert.equal(derived.artifact.provenance.adapted, true);
  assert.deepEqual(derived.artifact.lineage, { artifactId: src.artifact.id, versionId: src.artifact.currentVersionId, title: 'Parts of a Plant', authorDisplayName: 'Teacher A', available: true });

  // C adapts B's: the chain is C → B → A.
  const c = await w.t.registerUser();
  const cSetup = seedTeacher(w.store, c.id);
  const copy2 = await w.t.ok('community.copy', { params: { artifactId: derived.artifact.id }, body: {}, token: c.token });
  const cPlan = seedPlan(w.store, c.id, cSetup, ['4'], { lineage: copy2.plan.lineage });
  const derived2 = await w.t.ok('community.post', { body: postBody(cPlan, { title: 'Plants, adapted again' }), token: c.token });
  assert.equal(derived2.artifact.lineage?.artifactId, derived.artifact.id);
  const chain = w.t.db.prepare('SELECT artifact_id, source_artifact_id FROM community_lineage').all();
  assert.deepEqual(chain, [
    { artifact_id: derived.artifact.id, source_artifact_id: src.artifact.id },
    { artifact_id: derived2.artifact.id, source_artifact_id: derived.artifact.id },
  ]);

  // A removes the source.
  await w.t.ok('community.remove', { params: { artifactId: src.artifact.id }, token: a.user.token });
  const seen = (await w.t.ok('community.search', { query: {}, token: c.token })).items.map((i) => i.id).sort();
  assert.deepEqual(seen, [derived.artifact.id, derived2.artifact.id].sort(), 'removed source is out of search');
  assert.equal((await w.t.ok('community.search', { query: { mine: true }, token: a.user.token })).items.length, 0, 'and off the author\'s list');
  assert.equal((await w.t.call('community.get', { params: { artifactId: src.artifact.id }, token: b.token })).error?.code, 'not_found');
  assert.equal((await w.t.call('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: c.token })).error?.code, 'not_found');
  const derivedNow = await w.t.ok('community.get', { params: { artifactId: derived.artifact.id }, token: c.token });
  assert.deepEqual(derivedNow.lineage, { artifactId: src.artifact.id, versionId: src.artifact.currentVersionId, title: 'Parts of a Plant', authorDisplayName: 'Teacher A', available: false });
  // Existing copies are records on the copiers' devices: nothing on the server touches them; B's post still copies.
  await w.t.ok('community.copy', { params: { artifactId: derived.artifact.id }, body: {}, token: a.user.token });
  w.t.close();
});

test('copy count counts distinct teachers, never the author', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const b = await w.t.registerUser();
  const c = await w.t.registerUser();
  await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: b.token });
  await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: b.token });
  await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: a.user.token });
  await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: c.token });
  assert.equal((await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token })).copyCount, 2);
  w.t.close();
});

/* ---------------- copy remapping for 1–4 grade groups ---------------- */

for (const n of [1, 2, 3, 4]) {
  test(`copy remaps ${n} grade group(s) onto the copier's groups with fresh ids`, async () => {
    const w = world();
    const grades = ['2', '3', '4', '5'].slice(0, n);
    const a = await teacherWithPlan(w, grades);
    const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
    assert.deepEqual(src.artifact.tags.multigrade, n > 1 ? grades : null);
    const detail = await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token });
    const placeholders = detail.version.gradeGroups.map((g) => g.id);
    assert.equal(placeholders.length, n);
    assert.ok(placeholders.every((id) => !a.setup.groupIds.includes(id)), 'the author\'s local group ids are not published');

    const b = await w.t.registerUser();
    const mine = seedTeacher(w.store, b.id, { grades }).groupIds;
    const copy = await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: { gradeGroupIds: mine }, token: b.token });
    assert.deepEqual(copy.plan.gradeGroupIds, mine);
    assert.deepEqual(copy.plan.grades, grades);
    assert.deepEqual(Object.keys(copy.plan.competencies).sort(), [...mine].sort());
    assert.notEqual(copy.plan.id, a.planId);
    for (const s of copy.sections) {
      assert.equal(s.planId, copy.plan.id);
      assert.equal(s.origin, 'copied');
      if (s.content.type === 'pergroup') assert.deepEqual(Object.keys(s.content.groups).sort(), [...mine].sort());
      if (s.content.type === 'multigrade') {
        const blk = s.content.blocks[0]!;
        assert.deepEqual(Object.keys(blk.groups).sort(), [...mine].sort());
        assert.equal(blk.teacherWith, mine[0]);
        assert.deepEqual(blk.pairedGroupIds, mine.slice(1, 2));
        assert.ok(!detail.version.sections.some((vs) => vs.content.type === 'multigrade' && vs.content.blocks[0]!.id === blk.id), 'fresh block id');
      }
    }
    const ids = [copy.plan.id, ...copy.sections.map((s) => s.id)];
    assert.equal(new Set(ids).size, ids.length);

    // Without ids, fresh ones are made; with the wrong number, a plain error.
    const fresh = await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: b.token });
    assert.equal(fresh.plan.gradeGroupIds.length, n);
    assert.ok(fresh.plan.gradeGroupIds.every((id) => !placeholders.includes(id) && !mine.includes(id)));
    const wrong = await w.t.call('community.copy', { params: { artifactId: src.artifact.id }, body: { gradeGroupIds: [...mine, 'extra-group-1'].slice(0, n === 4 ? 3 : n + 1) }, token: b.token });
    assert.equal(wrong.error?.code, 'invalid_input');
    w.t.close();
  });
}

/* ---------------- reports ---------------- */

test('a personal-data report hides the artifact while the check runs and restores it when nothing is found', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const reporter = await w.t.registerUser();
  const viewer = await w.t.registerUser();

  let statusDuringCheck: string | undefined;
  let reportVar: string | undefined;
  w.llm.script = async (req) => {
    statusDuringCheck = (w.t.db.prepare('SELECT status FROM community_artifacts WHERE id = ?').get(src.artifact.id) as { status: string }).status;
    reportVar = req.vars['report'];
    return okVerdict({ decision: 'allow', reasons: [] });
  };
  await w.t.ok('community.report', { params: { artifactId: src.artifact.id }, body: { reason: 'personal_data', note: 'I think these are real kids' }, token: reporter.token });
  assert.equal(statusDuringCheck, 'hidden');
  assert.match(reportVar ?? '', /personal_data/);
  assert.match(reportVar ?? '', /real kids/);
  assert.equal((await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: viewer.token })).status, 'visible');
  // Nothing the reporter wrote is shown.
  assert.ok(!allText(await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token })).includes('real kids'));
  w.t.close();
});

test('a report while the model is down keeps it hidden until the background check; a confirmed report returns it', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const reporter = await w.t.registerUser();
  w.llm.script = unavailable;
  await w.t.ok('community.report', { params: { artifactId: src.artifact.id }, body: { reason: 'personal_data', note: '' }, token: reporter.token });
  assert.equal((await w.t.call('community.get', { params: { artifactId: src.artifact.id }, token: reporter.token })).error?.code, 'not_found');
  assert.equal((await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token })).status, 'hidden');

  w.llm.script = () => okVerdict({ decision: 'return', reasons: [{ category: 'student_personal_data', clear: true, message: 'Remove the names.', sectionKey: 'content', excerpt: null }] });
  assert.deepEqual(await recheckPending(w.deps()), { versions: 0, reports: 1 });
  const mine = await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token });
  assert.equal(mine.status, 'returned');
  assert.equal((await w.t.ok('community.search', { query: {}, token: reporter.token })).items.length, 0);
  // The returned version cannot be copied by others.
  assert.equal((await w.t.call('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: reporter.token })).error?.code, 'not_found');
  w.t.close();
});

test('other report reasons do not hide; accuracy reports never call the model; reports are rate limited', async () => {
  const w = world({ config: { abuse: { reportPerUserPerDay: 2 } } });
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const reporter = await w.t.registerUser();
  const calls = w.llm.calls.length;
  await w.t.ok('community.report', { params: { artifactId: src.artifact.id }, body: { reason: 'inaccurate', note: 'wrong fact' }, token: reporter.token });
  assert.equal(w.llm.calls.length, calls, 'accuracy is not moderated');
  await w.t.ok('community.report', { params: { artifactId: src.artifact.id }, body: { reason: 'spam' }, token: reporter.token });
  assert.equal(w.llm.calls.length, calls + 1);
  assert.equal((await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: reporter.token })).status, 'visible');
  const limited = await w.t.call('community.report', { params: { artifactId: src.artifact.id }, body: { reason: 'unsuitable' }, token: reporter.token });
  assert.equal(limited.error?.code, 'rate_limited');
  w.t.close();
});

test('posting is rate limited per teacher per day', async () => {
  const w = world({ config: { abuse: { postPerUserPerDay: 1 } } });
  const a = await teacherWithPlan(w);
  await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const p2 = seedPlan(w.store, a.user.id, a.setup, ['4']);
  assert.equal((await w.t.call('community.post', { body: postBody(p2), token: a.user.token })).error?.code, 'rate_limited');
  w.t.close();
});

/* ---------------- staff ---------------- */

test('staff takedown hides from everyone but the author; restore brings it back, even after a model return', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const viewer = await w.t.registerUser();
  const staff = { db: w.t.db, now: w.t.clock.now, newId: () => fid('log'), guidelineVersion: 1 };
  staffTakedown(staff, src.artifact.id);
  assert.equal((await w.t.ok('community.search', { query: {}, token: viewer.token })).items.length, 0);
  assert.equal((await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token })).status, 'hidden');
  // A report check that finds nothing does not undo a staff takedown.
  staffRestore(staff, src.artifact.id);
  assert.equal((await w.t.ok('community.search', { query: {}, token: viewer.token })).items.length, 1);
  const log = (w.t.db.prepare("SELECT decision FROM community_moderation_log WHERE trigger = 'staff' ORDER BY rowid").all() as Array<{ decision: string }>).map((r) => r.decision);
  assert.deepEqual(log, ['takedown', 'restore']);
  await w.t.ok('community.remove', { params: { artifactId: src.artifact.id }, token: a.user.token });
  assert.throws(() => staffRestore(staff, src.artifact.id), /removed/);
  w.t.close();
});

/* ---------------- feature switch ---------------- */

test('the community feature switch turns every route off with a plain message', async () => {
  const w = world({ config: { features: { community: false } } });
  const u = await w.t.registerUser();
  const r = await w.t.call('community.search', { query: {}, token: u.token });
  assert.equal(r.error?.code, 'unavailable');
  w.t.close();
});

/* ---------------- prompt files ---------------- */

test('moderate.v1 embeds guidelines.v1 verbatim and has its placeholders', () => {
  const dir = fileURLToPath(new URL('../../../prompts/moderation/', import.meta.url));
  const guidelines = readFileSync(`${dir}guidelines.v1.md`, 'utf8').trim();
  const prompt = readFileSync(`${dir}moderate.v1.md`, 'utf8');
  const embedded = prompt.split('<!-- guidelines:begin -->')[1]!.split('<!-- guidelines:end -->')[0]!.trim();
  assert.equal(embedded, guidelines);
  for (const v of ['{{lesson}}', '{{hints}}', '{{report}}']) assert.ok(prompt.includes(v), v);
});

/* ---------------- account deletion (PRIV-6) ---------------- */

test('deleting an account removes its artifacts, reports and copy records; derived lessons keep the credit', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId, { displayName: 'Teacher A' }), token: a.user.token });
  const b = await w.t.registerUser();
  const bSetup = seedTeacher(w.store, b.id);
  const copy = await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: {}, token: b.token });
  const bPlan = seedPlan(w.store, b.id, bSetup, ['4'], { lineage: copy.plan.lineage });
  const derived = await w.t.ok('community.post', { body: postBody(bPlan), token: b.token });
  await w.t.ok('community.report', { params: { artifactId: derived.artifact.id }, body: { reason: 'spam' }, token: a.user.token });

  await w.t.ok('account.delete', { body: { confirm: 'DELETE', password: a.user.password }, token: a.user.token });
  const count = (sql: string, ...p: unknown[]) => (w.t.db.prepare(sql).get(...p) as { n: number }).n;
  assert.equal(count('SELECT COUNT(*) n FROM community_artifacts WHERE author_id = ?', a.user.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM community_versions WHERE artifact_id = ?', src.artifact.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM community_reports WHERE reporter_id = ?', a.user.id), 0);
  assert.equal(count('SELECT COUNT(*) n FROM community_moderation_log WHERE author_id = ?', a.user.id), 0);
  const still = await w.t.ok('community.get', { params: { artifactId: derived.artifact.id }, token: b.token });
  assert.equal(still.lineage?.authorDisplayName, 'Teacher A');
  assert.equal(still.lineage?.available, false);
  w.t.close();
});

/* ---------------- stable error reasons for client localisation ---------------- */

test('errors carry a stable details.reason', async () => {
  const w = world();
  const { user, setup } = await teacherWithPlan(w);
  const draft = seedPlan(w.store, user.id, setup, ['4'], { state: 'draft' });
  assert.deepEqual((await w.t.call('community.post', { body: postBody(draft), token: user.token })).error?.details, { reason: 'plan_not_locked' });
  assert.deepEqual((await w.t.call('community.get', { params: { artifactId: 'missing-artifact' }, token: user.token })).error?.details, { reason: 'artifact_unavailable' });
  w.t.close();
});

/* ---------------- staff CLI ---------------- */

test('staff CLI shows, takes down and restores without printing lesson content', async () => {
  const { runStaffCommand } = await import('./staff-cli');
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const lines: string[] = [];
  assert.equal(runStaffCommand(w.t.db, ['takedown', src.artifact.id], (l) => lines.push(l)), 0);
  assert.equal((w.t.db.prepare('SELECT status FROM community_artifacts WHERE id = ?').get(src.artifact.id) as { status: string }).status, 'hidden');
  assert.equal(runStaffCommand(w.t.db, ['restore', src.artifact.id], (l) => lines.push(l)), 0);
  assert.equal(runStaffCommand(w.t.db, ['show', src.artifact.id], (l) => lines.push(l)), 0);
  assert.equal(runStaffCommand(w.t.db, ['pending'], (l) => lines.push(l)), 0);
  assert.equal(runStaffCommand(w.t.db, ['show', 'nope-0000'], (l) => lines.push(l)), 1);
  assert.equal(runStaffCommand(w.t.db, ['bogus'], (l) => lines.push(l)), 1);
  const out = lines.join('\n');
  assert.match(out, /status {6}visible/);
  assert.match(out, /staff {2}takedown/);
  assert.ok(!out.includes('Plants have roots'), 'no lesson body');
  w.t.close();
});

test('the display name is checked too', async () => {
  const w = world();
  const { user, planId } = await teacherWithPlan(w);
  const res = await w.t.ok('community.post', { body: postBody(planId, { displayName: 'Text me 09171234567' }), token: user.token });
  assert.equal(res.moderation.decision, 'return');
  assert.equal(res.moderation.reasons[0]!.sectionKey, 'displayName');
  w.t.close();
});

/* ---------------- wave 2: moderation on own summaries, versionId, custom templates, kind, size cap ---------------- */

test('the latest moderation decision is shown to the author only', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId), token: a.user.token });
  const other = await w.t.registerUser();
  assert.equal(src.artifact.moderation?.decision, 'allow');
  assert.equal((await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token })).moderation?.decision, 'allow');
  assert.equal((await w.t.ok('community.search', { query: { mine: true }, token: a.user.token })).items[0]!.moderation?.decision, 'allow');
  assert.equal((await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: other.token })).moderation, undefined);
  assert.equal((await w.t.ok('community.search', { query: {}, token: other.token })).items[0]!.moderation, undefined);

  // After a report check returns it, the author sees why.
  w.llm.script = () => okVerdict({ decision: 'return', reasons: [{ category: 'unsuitable', clear: true, message: 'Please change the joke in the motivation.', sectionKey: 'procedure', excerpt: null }] });
  await w.t.ok('community.report', { params: { artifactId: src.artifact.id }, body: { reason: 'unsuitable' }, token: other.token });
  const mine = await w.t.ok('community.get', { params: { artifactId: src.artifact.id }, token: a.user.token });
  assert.equal(mine.status, 'returned');
  assert.equal(mine.moderation?.decision, 'return');
  assert.equal(mine.moderation?.reasons[0]!.message, 'Please change the joke in the motivation.');
  w.t.close();
});

test('a returned post\'s preview carries the decision; rule reasons carry a kind', async () => {
  const w = world();
  const { user, planId } = await teacherWithPlan(w, ['4'], { contentText: ['Call me at 0917 123 4567', '1. Dela Cruz, Juan P.', '2. Santos, Maria L.', '3. Reyes, Ana', '4. Bautista, Mark', '5. Garcia, Kristine Joy'] });
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.artifact.moderation?.decision, 'return');
  assert.deepEqual(res.moderation.reasons.map((r) => r.kind).sort(), ['class_list', 'phone']);
  w.t.close();
});

test('older versions can be viewed with versionId; unreachable versions are not found', async () => {
  const w = world();
  const { user, setup, planId } = await teacherWithPlan(w);
  const v1 = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  seedPlan(w.store, user.id, setup, ['4'], { planId, revisionCode: 'V2', contentText: ['Second version text.'] });
  const v2 = await w.t.ok('community.post', { body: postBody(planId, { artifactId: v1.artifact.id }), token: user.token });
  const reader = await w.t.registerUser();
  const old = await w.t.ok('community.get', { params: { artifactId: v1.artifact.id }, query: { versionId: v1.artifact.currentVersionId }, token: reader.token });
  assert.equal(old.version.number, 1);
  assert.ok(!allText(old.version).includes('Second version text.'));
  const cur = await w.t.ok('community.get', { params: { artifactId: v1.artifact.id }, token: reader.token });
  assert.equal(cur.version.id, v2.artifact.currentVersionId);

  // A version of another artifact, or a pending one, is not reachable through this artifact.
  const b = await teacherWithPlan(w);
  const otherArt = await w.t.ok('community.post', { body: postBody(b.planId), token: b.user.token });
  const foreign = await w.t.call('community.get', { params: { artifactId: v1.artifact.id }, query: { versionId: otherArt.artifact.currentVersionId }, token: reader.token });
  assert.deepEqual(foreign.error?.details, { reason: 'version_unavailable' });
  w.llm.script = unavailable;
  seedPlan(w.store, user.id, setup, ['4'], { planId, revisionCode: 'V3' });
  const v3 = await w.t.ok('community.post', { body: postBody(planId, { artifactId: v1.artifact.id }), token: user.token });
  assert.equal(v3.moderation.decision, 'pending');
  const pendingId = (w.t.db.prepare("SELECT id FROM community_versions WHERE artifact_id = ? AND status = 'pending'").get(v1.artifact.id) as { id: string }).id;
  assert.equal((await w.t.call('community.get', { params: { artifactId: v1.artifact.id }, query: { versionId: pendingId }, token: reader.token })).error?.code, 'not_found');
  assert.equal((await w.t.ok('community.get', { params: { artifactId: v1.artifact.id }, query: { versionId: pendingId }, token: user.token })).version.number, 3, 'the author sees it');
  w.t.close();
});

test('a custom template travels with the version, stripped and moderated; built-ins do not', async () => {
  const w = world();
  const user = await w.t.registerUser();
  const setup = seedTeacher(w.store, user.id);
  const custom = {
    id: 'tpl-custom-0001',
    kind: 'custom',
    name: { fil: 'Banghay ng Malinao Elementary School', en: 'Malinao Elementary School plan' },
    builtIn: false,
    span: 'session',
    orientation: 'portrait',
    sections: [
      { key: 'objectives', label: { fil: 'Layunin', en: 'Objectives' }, contentType: 'list', required: true },
      { key: 'content', label: { fil: 'Nilalaman', en: 'Content' }, contentType: 'text', required: false },
      { key: 'materials', label: { fil: 'Kagamitan', en: 'Materials' }, contentType: 'list', required: false },
      { key: 'procedure', label: { fil: 'Pamamaraan', en: 'Procedure' }, contentType: 'procedure', required: false },
      { key: 'assessment', label: { fil: 'Pagtataya', en: 'Assessment' }, contentType: 'text', required: false },
      { key: 'reflection', label: { fil: 'Pagninilay', en: 'Reflection' }, contentType: 'text', required: false, outsideLock: true },
    ],
  };
  put(w.store, user.id, 'template', custom);
  const planId = seedPlan(w.store, user.id, setup, ['4'], { templateId: custom.id });
  const res = await w.t.ok('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.artifact.tags.templateKind, 'custom');
  const reader = await w.t.registerUser();
  const detail = await w.t.ok('community.get', { params: { artifactId: res.artifact.id }, token: reader.token });
  assert.equal(detail.version.template?.id, custom.id);
  assert.equal(detail.version.template?.sections.length, 6);
  assert.ok(!allText(detail.version.template).includes('Malinao'), 'school name stripped from template labels too');
  const copy = await w.t.ok('community.copy', { params: { artifactId: res.artifact.id }, body: {}, token: reader.token });
  assert.equal(copy.plan.templateId, custom.id, 'the copier saves version.template under the same id');

  // Template labels are public text and are checked like the lesson.
  put(w.store, user.id, 'template', { ...custom, id: 'tpl-custom-0002', name: { fil: 'Text 09171234567', en: 'Plan' } });
  const p2 = seedPlan(w.store, user.id, setup, ['4'], { templateId: 'tpl-custom-0002' });
  const r2 = await w.t.ok('community.post', { body: postBody(p2), token: user.token });
  assert.equal(r2.moderation.decision, 'return');
  assert.equal(r2.moderation.reasons[0]!.sectionKey, 'template');

  const builtIn = await teacherWithPlan(w);
  const r3 = await w.t.ok('community.post', { body: postBody(builtIn.planId), token: builtIn.user.token });
  assert.equal((await w.t.ok('community.get', { params: { artifactId: r3.artifact.id }, token: reader.token })).version.template, undefined);
  w.t.close();
});

test('a post too big for the 100 KB response budget is refused clearly before any model call', async () => {
  const w = world();
  const paragraph = 'Plants make food from sunlight, water and air in their leaves. '.repeat(60); // ~3.8 KB
  const { user, planId } = await teacherWithPlan(w, ['4'], { contentText: Array.from({ length: 30 }, () => paragraph) });
  const res = await w.t.call('community.post', { body: postBody(planId), token: user.token });
  assert.equal(res.error?.code, 'invalid_input');
  const details = res.error?.details as { reason: string; bytes: number; limit: number };
  assert.equal(details.reason, 'too_large');
  assert.ok(details.bytes > details.limit && details.limit <= 100 * 1024);
  assert.match(res.error!.message, /too long to share/);
  assert.equal(w.llm.calls.length, 0);
  assert.equal((w.t.db.prepare('SELECT COUNT(*) n FROM community_artifacts').get() as { n: number }).n, 0);

  // A long-but-normal lesson (~40 KB) posts, and its detail stays inside the budget.
  const ok = await teacherWithPlan(w, ['4'], { contentText: Array.from({ length: 10 }, () => paragraph) });
  const posted = await w.t.ok('community.post', { body: postBody(ok.planId), token: ok.user.token });
  const detail = await w.t.call('community.get', { params: { artifactId: posted.artifact.id }, token: ok.user.token });
  assert.ok(Buffer.byteLength(JSON.stringify(detail.data)) < 100 * 1024);
  w.t.close();
});

test('a deleted author: artifacts leave search; copies others made keep the credit; derived posts show the source unavailable', async () => {
  const w = world();
  const a = await teacherWithPlan(w);
  const src = await w.t.ok('community.post', { body: postBody(a.planId, { displayName: 'Teacher A' }), token: a.user.token });
  const b = await w.t.registerUser();
  const bSetup = seedTeacher(w.store, b.id);
  const copy = await w.t.ok('community.copy', { params: { artifactId: src.artifact.id }, body: { gradeGroupIds: bSetup.groupIds }, token: b.token });
  // B's device stores the copy as its own records (here written through the real store).
  put(w.store, b.id, 'plan', copy.plan);
  for (const s of copy.sections) put(w.store, b.id, 'plan_section', s);
  const bPlan = seedPlan(w.store, b.id, bSetup, ['4'], { lineage: copy.plan.lineage });
  const derived = await w.t.ok('community.post', { body: postBody(bPlan), token: b.token });

  await w.t.ok('account.delete', { body: { confirm: 'DELETE', password: a.user.password }, token: a.user.token });
  const ids = (await w.t.ok('community.search', { query: {}, token: b.token })).items.map((i) => i.id);
  assert.deepEqual(ids, [derived.artifact.id], "the deleted author's artifact is gone from search");
  assert.equal((await w.t.call('community.get', { params: { artifactId: src.artifact.id }, token: b.token })).error?.code, 'not_found');
  const kept = w.store.get(b.id, 'plan', copy.plan.id);
  assert.deepEqual(kept?.data.lineage, { artifactId: src.artifact.id, versionId: src.artifact.currentVersionId, title: 'Parts of a Plant', authorDisplayName: 'Teacher A' }, "B's copy keeps the credit line");
  const d = await w.t.ok('community.get', { params: { artifactId: derived.artifact.id }, token: b.token });
  assert.deepEqual(d.lineage, { artifactId: src.artifact.id, versionId: src.artifact.currentVersionId, title: 'Parts of a Plant', authorDisplayName: 'Teacher A', available: false });
  w.t.close();
});

test('title and summary go through the shared publish cleaner', async () => {
  const w = world();
  const { user, planId } = await teacherWithPlan(w);
  const res = await w.t.ok('community.post', {
    body: postBody(planId, { title: 'Malinao Elementary School: plants', summary: 'Taught in Grade 4 - Sampaguita on 2026-11-16.' }),
    token: user.token,
  });
  assert.equal(res.artifact.title, '[school]: plants');
  assert.equal(res.artifact.summary, 'Taught in [section] on [date].');
  w.t.close();
});

/* ---------------- account merge (PRD §13.3 case 4) ---------------- */

test('merging accounts moves authorship, reports, copies and log rows; others untouched; idempotent', async () => {
  const w = world();
  const from = await teacherWithPlan(w);
  const to = await teacherWithPlan(w);
  const other = await teacherWithPlan(w);
  const fromArt = await w.t.ok('community.post', { body: postBody(from.planId, { displayName: 'Ana (old account)' }), token: from.user.token });
  const otherArt = await w.t.ok('community.post', { body: postBody(other.planId), token: other.user.token });
  const toArt = await w.t.ok('community.post', { body: postBody(to.planId), token: to.user.token });
  // Both accounts copied the other teacher's lesson; the old one also copied the new one's lesson.
  await w.t.ok('community.copy', { params: { artifactId: otherArt.artifact.id }, body: {}, token: from.user.token });
  await w.t.ok('community.copy', { params: { artifactId: otherArt.artifact.id }, body: {}, token: to.user.token });
  await w.t.ok('community.copy', { params: { artifactId: toArt.artifact.id }, body: {}, token: from.user.token });
  await w.t.ok('community.report', { params: { artifactId: otherArt.artifact.id }, body: { reason: 'spam' }, token: from.user.token });
  const otherCopiesFrom = await w.t.ok('community.copy', { params: { artifactId: fromArt.artifact.id }, body: {}, token: other.user.token });

  const count = (sql: string, ...p: unknown[]) => (w.t.db.prepare(sql).get(...p) as { n: number }).n;
  const before = {
    copyCounts: w.t.db.prepare('SELECT id, copy_count FROM community_artifacts ORDER BY id').all(),
    otherRows: count('SELECT COUNT(*) n FROM community_artifacts WHERE author_id = ?', other.user.id),
  };

  const mod = createCommunityModule({ recheckIntervalMs: 0 });
  const base = { db: w.t.db, config: w.t.config, now: w.t.clock.now, newId: () => fid('id'), log: { info() {}, warn() {}, error() {} } };
  w.t.db.transaction(() => mod.onAccountMerged!(base, from.user.id, to.user.id))();
  w.t.db.transaction(() => mod.onAccountMerged!(base, from.user.id, to.user.id))(); // idempotent

  for (const table of [
    ['community_artifacts', 'author_id'],
    ['community_copies', 'user_id'],
    ['community_reports', 'reporter_id'],
    ['community_moderation_log', 'author_id'],
  ] as const) {
    assert.equal(count(`SELECT COUNT(*) n FROM ${table[0]} WHERE ${table[1]} = ?`, from.user.id), 0, table[0]);
  }
  assert.equal(count('SELECT COUNT(*) n FROM community_artifacts WHERE author_id = ?', to.user.id), 2);
  assert.equal(count('SELECT COUNT(*) n FROM community_copies WHERE user_id = ? AND artifact_id = ?', to.user.id, otherArt.artifact.id), 1, 'duplicate copy record collapsed');
  assert.equal(count('SELECT COUNT(*) n FROM community_reports WHERE reporter_id = ?', to.user.id), 1);
  assert.deepEqual(w.t.db.prepare('SELECT id, copy_count FROM community_artifacts ORDER BY id').all(), before.copyCounts, 'copy counts unchanged');
  assert.equal(count('SELECT COUNT(*) n FROM community_artifacts WHERE author_id = ?', other.user.id), before.otherRows, "another teacher's rows untouched");
  assert.equal(count('SELECT COUNT(*) n FROM community_copies WHERE user_id = ?', other.user.id), 1);

  // Authorship and attribution follow the merged account: it is "mine" now, the surviving account can manage it,
  // and the credit line on other teachers' copies is unchanged.
  const mine = await w.t.ok('community.get', { params: { artifactId: fromArt.artifact.id }, token: to.user.token });
  assert.equal(mine.mine, true);
  assert.equal(mine.authorDisplayName, 'Ana (old account)');
  assert.ok((await w.t.ok('community.search', { query: { mine: true }, token: to.user.token })).items.some((i) => i.id === fromArt.artifact.id));
  assert.equal(otherCopiesFrom.plan.lineage?.artifactId, fromArt.artifact.id);
  await w.t.ok('community.remove', { params: { artifactId: fromArt.artifact.id }, token: to.user.token });
  w.t.close();
});
