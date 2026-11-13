/**
 * The integration gate: one teacher's whole journey through every server module, on the REAL module
 * registry, with only the model faked. A second teacher finds, copies and builds on the first one's
 * lesson. Then the first teacher deletes their account, and every module must have let go of them
 * while leaving the second teacher's work alone.
 *
 * Each step is labelled with the module it exercises: a failure reads `[community] post …: <why>`.
 * Devices are the real client sync engine (@hiraia/tala-core/sync) over the real typed client.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_TEMPLATES, parseRecordData, plan as planHelpers, sync as syncEngine } from '@hiraia/tala-core';
import type { GenerationJob, Plan, PlanSection, SyncEngine } from '@hiraia/tala-core';
import type { LlmRequest } from '../kernel/types';
import { modules as registry } from '../modules';
import { createFakeLlm, createTestServer } from './index';
import type { TestServer, TestUser } from './index';

const NOW = '2026-11-16T00:00:00.000Z';
const DLP = BUILTIN_TEMPLATES.find((t) => t.id === 'tpl.dlp.v1')!;

/** Run one step; on failure say which module it belongs to. */
async function step<T>(module: string, what: string, run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const wrapped = new Error(`[${module}] ${what}: ${err instanceof Error ? err.message : String(err)}`);
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
}

/**
 * The scripted "model" for lesson generation. It reads the request the generation module built (fixed
 * time slots, the objective references it may cite, the parts wanted) and fills every part, the way the
 * real model is asked to. Nothing here is hard-wired to one template.
 */
function scriptedLesson(request: LlmRequest<unknown>): unknown {
  const asked = JSON.parse(request.vars.input ?? '{}') as {
    groups: Array<{ grade: string; objectives: Array<{ ref: string }> }>;
    schedule: Array<{ slot: number }>;
    sections: Array<{ key: string; format: string }>;
    profile?: { materials?: string[] };
  };
  // Materials may only name what the class profile says is available (PRD §9.3).
  const available = asked.profile?.materials?.length ? asked.profile.materials : [];
  const refs = asked.groups.flatMap((g) => g.objectives.map((o) => o.ref));
  return {
    title: 'Mga Bahagi ng Halaman',
    sections: asked.sections.map((s) => {
      switch (s.format) {
        case 'list':
          return s.key === 'objectives' ? { key: s.key, items: ['Nailalarawan ang gamit ng bawat bahagi'], targets: refs } : { key: s.key, items: available };
        case 'procedure':
          return { key: s.key, steps: asked.schedule.map((slot) => ({ slot: slot.slot, title: `Hakbang ${slot.slot}`, text: 'Pagmasdan ang halaman at pag-usapan ang nakikita.' })) };
        case 'text':
          return s.key === 'assessment' ? { key: s.key, text: 'Iguhit ang halaman at lagyan ng pangalan ang bawat bahagi.', targets: refs } : { key: s.key, text: 'Ang halaman ay may ugat, tangkay at dahon.' };
        default:
          throw new Error(`scriptedLesson: no script for a "${s.format}" part`);
      }
    }),
  };
}

function device(t: TestServer, user: TestUser, name: string) {
  let n = 0;
  const newId = () => `${name}-${String(++n).padStart(8, '0')}`;
  const engine: SyncEngine = syncEngine.createSyncEngine({
    store: syncEngine.createMemoryStore(),
    transport: t.client(user.token).syncTransport,
    deviceId: `device-${name}`,
    now: () => t.clock.now(),
    newId,
  });
  return { engine, newId };
}

/** Sync and insist that nothing was refused, parked as a conflict, or turned into a lock copy. */
async function cleanSync(engine: SyncEngine): Promise<void> {
  const report = await engine.sync();
  assert.deepEqual(
    { ok: report.ok, error: report.error, conflicts: report.conflicts, rejected: report.rejected, lockCopies: report.lockCopies.length },
    { ok: true, error: null, conflicts: 0, rejected: 0, lockCopies: 0 },
    'sync did not go through cleanly',
  );
}

async function waitForJob(t: TestServer, token: string, jobId: string): Promise<GenerationJob> {
  for (let i = 0; i < 400; i++) {
    const job = await t.ok('generation.get', { token, params: { jobId } });
    if (job.status === 'done') return job;
    if (job.status === 'failed' || job.status === 'cancelled') throw new Error(`generation job ended as ${job.status}: ${job.failure?.reason ?? ''} ${job.failure?.message ?? ''}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('generation job did not finish in time');
}

const sectionsOfPlan = async (engine: SyncEngine, planId: string): Promise<PlanSection[]> => (await engine.list('plan_section')).map((r) => r.data).filter((s) => s.planId === planId);

/** Every table, as text, keyed by table name: for "is anything of this person left anywhere?" */
function dumpTables(t: TestServer): Map<string, string> {
  const names = (t.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map((r) => r.name);
  return new Map(names.map((name) => [name, JSON.stringify(t.db.prepare(`SELECT * FROM "${name}"`).all())]));
}

const moduleOfTable = (table: string) => table.split('_')[0]!;

test('journey: sign-up to shared lesson to account deletion, across every module', { timeout: 60_000 }, async () => {
  const llm = createFakeLlm({
    answers: { 'lesson.generate': scriptedLesson, 'community.moderate': { decision: 'allow', reasons: [] } },
    // Roster cleaning stays on rules: no learner name goes to any model in this journey.
    routes: { 'roster.names': 'rules', 'roster.columns': 'rules' },
  });
  // The registry's own modules, in registry order. Core is the same module built with cheap password hashing.
  const t = createTestServer({ modules: registry.filter((m) => m.name !== 'core'), services: { llm }, now: NOW });
  try {
    await step('kernel', 'every route in the contract has a handler', () => {
      const implemented = new Set(t.server.implemented());
      const missing = ['config.get', 'auth.register', 'sync.push', 'sync.pull', 'plans.revisions', 'curriculum.index', 'calendar.presets', 'generation.create', 'roster.import', 'community.post', 'community.search', 'print.planPdf'].filter((r) => !implemented.has(r as never));
      assert.deepEqual(missing, []);
    });

    /* ------------------------------------------------ teacher A ------------------------------------------------ */

    const liza = await step('core', 'sign up and confirm the email', () => t.registerUser({ email: 'liza.reyes@example.test', displayName: 'Gng. Liza Reyes', uiLanguage: 'fil' }));
    const phone = device(t, liza, 'liza');

    await step('core', 'the profile record is seeded and reaches the device on first sync', async () => {
      await cleanSync(phone.engine);
      const profile = await phone.engine.get('profile', 'profile');
      assert.equal(profile?.data.displayName, 'Gng. Liza Reyes');
      assert.equal(profile?.data.uiLanguage, 'fil');
    });

    const curriculum = await step('curriculum', 'find the Grade 4 Science pack and a competency in it', async () => {
      const index = await t.ok('curriculum.index');
      const meta = index.packs.find((p) => p.grade === '4' && p.learningAreaId === 'science');
      assert.ok(meta, 'no Grade 4 Science pack is served');
      const pack = await t.ok('curriculum.pack', { params: { packId: meta.packId } });
      const competency = pack.competencies[0];
      assert.ok(competency, 'the pack has no competencies');
      return { version: pack.curriculumVersion, competency, packId: meta.packId };
    });

    const calendar = await step('curriculum', 'a calendar preset for the school year', async () => {
      const { presets } = await t.ok('calendar.presets');
      const chosen = presets.find((p) => p.label.includes('2026')) ?? presets[0];
      assert.ok(chosen, 'no calendar preset is served');
      const preset = await t.ok('calendar.preset', { params: { presetId: chosen.id } });
      assert.ok(preset.terms.length >= 1);
      return preset;
    });

    const ids = { schoolYear: phone.newId(), klass: phone.newId(), group: phone.newId(), assignment: phone.newId(), plan: phone.newId() };

    const klass = await step('core', 'school year, class, teaching assignment and pacing tracks through sync', async () => {
      const schoolYear = parseRecordData('school_year', {
        id: ids.schoolYear, label: '2026-2027', schoolName: 'Mababang Paaralan ng San Roque', startDate: calendar.startDate, endDate: calendar.endDate,
        terms: calendar.terms.map((term) => ({ id: phone.newId(), index: term.index, name: term.name, startDate: term.startDate, endDate: term.endDate })),
        presetId: calendar.id, presetVersion: calendar.version, provisional: calendar.provisional,
      });
      const record = parseRecordData('class', {
        id: ids.klass, schoolYearId: ids.schoolYear, name: 'Baitang 4 - Sampaguita', curriculum: 'deped',
        gradeGroups: [{ id: ids.group, grade: '4', learnerCount: 28 }], languages: ['fil'],
        profile: { materials: ['Tunay na halaman', 'Manila paper'], electricity: false, outdoorSpace: true },
      });
      await phone.engine.put('school_year', schoolYear);
      await phone.engine.put('class', record);
      await phone.engine.put('assignment', parseRecordData('assignment', {
        id: ids.assignment, classId: ids.klass, learningAreaId: 'science', subjectName: 'Science', gradeGroupIds: [ids.group], language: 'fil',
        slots: [1, 3, 5].map((weekday) => ({ id: phone.newId(), weekday, minutes: 50 })),
      }));
      for (const term of schoolYear.terms) {
        await phone.engine.put('pacing_track', parseRecordData('pacing_track', { id: phone.newId(), classId: ids.klass, assignmentId: ids.assignment, gradeGroupId: ids.group, termId: term.id, curriculumVersion: curriculum.version }));
      }
      await cleanSync(phone.engine);
      assert.equal(t.services.records.list(liza.id, 'pacing_track').length, schoolYear.terms.length);
      assert.equal(t.services.records.get(liza.id, 'class', ids.klass)?.data.curriculum, 'deped');
      return record;
    });

    await step('core', 'a draft plan with blank parts, tagged to the competency', async () => {
      await phone.engine.put('plan', parseRecordData('plan', {
        id: ids.plan, templateId: DLP.id, language: 'fil', subjectName: 'Science', learningAreaId: 'science', grades: ['4'], gradeGroupIds: [ids.group],
        competencies: { [ids.group]: [curriculum.competency.id] }, curriculumVersion: curriculum.version, durationMinutes: 50,
        placements: [{ classId: ids.klass, assignmentId: ids.assignment, dates: ['2026-11-18'] }],
      }));
      for (const section of planHelpers.blankSections(DLP, ids.plan, [{ id: ids.group }], phone.newId)) await phone.engine.put('plan_section', section);
      await cleanSync(phone.engine);
      assert.equal(t.services.records.planSnapshot(liza.id, ids.plan)?.sections.length, DLP.sections.length);
    });

    const job = await step('generation', 'a generation job runs on the (fake) model and finishes', async () => {
      const allowanceBefore = await t.ok('generation.allowance', { token: liza.token });
      const created = await t.ok('generation.create', {
        token: liza.token,
        body: {
          kind: 'full', planId: ids.plan, templateId: DLP.id, language: 'fil', subjectName: 'Science', learningAreaId: 'science', timeBudgetMinutes: 50,
          gradeGroups: klass.gradeGroups, competencies: { [ids.group]: [curriculum.competency.id] }, curriculumVersion: curriculum.version,
          classProfile: klass.profile, guidance: 'Gamitin ang hardin ng paaralan.',
        },
      });
      const done = await waitForJob(t, liza.token, created.id);
      assert.ok(done.result && done.result.sections.length >= DLP.sections.filter((s) => s.required).length);
      assert.ok(allowanceBefore.fullRemainingToday >= 0);
      return done;
    });

    await step('llm', 'the model was given the stored competency text and counts only, never a name', () => {
      const call = llm.calls.find((c) => c.feature === 'lesson.generate');
      assert.ok(call, 'the generation module never reached the model gateway');
      assert.ok(call.vars.input?.includes(curriculum.competency.text), 'the objective text did not come from the stored curriculum record');
      assert.equal(call.userId, liza.id);
      for (const piece of ['liza.reyes@example.test', 'Liza Reyes', 'Sampaguita', 'San Roque']) assert.ok(!JSON.stringify(call.vars).includes(piece), `${piece} was sent to the model`);
    });

    await step('core', 'the generated parts are written by the device through sync, with the earlier text kept as history', async () => {
      const current = (await phone.engine.get('plan', ids.plan))!.data;
      const generated = job.result!.sections;
      const applied = planHelpers.applyGeneratedSections({ plan: current, sections: await sectionsOfPlan(phone.engine, ids.plan), generated, gen: generated[0]!.gen, newId: phone.newId });
      for (const revision of applied.revisions) await phone.engine.put('section_revision', revision);
      for (const section of applied.sections) await phone.engine.put('plan_section', section);
      await phone.engine.put('plan', { ...applied.plan, title: job.result!.title });
      await cleanSync(phone.engine);
      const stored = t.services.records.planSnapshot(liza.id, ids.plan)!;
      assert.equal(stored.plan.data.aiDraft, true);
      assert.ok(stored.sections.some((s) => s.data.origin === 'ai' && JSON.stringify(s.data.content).includes('Iguhit ang halaman')));
      assert.ok(t.services.records.list(liza.id, 'section_revision').length >= 1);
    });

    const lockRevision = await step('core', 'lock the plan: DOC-1 passes on the server and the lock gets its revision', async () => {
      const current = (await phone.engine.get('plan', ids.plan))!.data;
      const locked: Plan = planHelpers.lockPlan({ plan: current, sections: await sectionsOfPlan(phone.engine, ids.plan), template: DLP, class: { curriculum: 'deped' }, teacherName: 'Gng. Liza Reyes', at: t.clock.now().toISOString(), revision: null });
      await phone.engine.put('plan', locked);
      await cleanSync(phone.engine);
      const after = (await phone.engine.get('plan', ids.plan))!.data;
      assert.equal(after.state, 'locked');
      assert.equal(after.aiDraft, false);
      assert.equal(typeof after.lock?.revision, 'number');
      return after.lock!.revision!;
    });

    await step('core', 'revisions: the lock is listed and its exact content can be read back', async () => {
      const { revisions } = await t.ok('plans.revisions', { token: liza.token, params: { planId: ids.plan } });
      assert.ok(revisions.some((r) => r.revision === lockRevision && r.reason === 'lock' && r.locked));
      assert.ok(revisions.some((r) => r.reason === 'regenerate'), 'the AI rewrite did not get its own revision');
      const revision = await t.ok('plans.revision', { token: liza.token, params: { planId: ids.plan, revision: String(lockRevision) } });
      assert.ok(JSON.stringify(revision.sections).includes('Iguhit ang halaman'));
    });

    await step('print', 'the server can produce a PDF of the locked plan', async () => {
      const pdf = await t.call('print.planPdf', { token: liza.token, params: { planId: ids.plan }, query: { paper: 'long' } });
      assert.equal(pdf.status, 200, pdf.error?.message);
      assert.equal(Buffer.from(pdf.data as ArrayBuffer).subarray(0, 5).toString('latin1'), '%PDF-');
      assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    });

    const posted = await step('community', 'post the locked lesson; moderation allows it', async () => {
      const result = await t.ok('community.post', {
        token: liza.token,
        body: { planId: ids.plan, title: 'Mga Bahagi ng Halaman', summary: 'Aralin gamit ang hardin ng paaralan.', displayName: 'Teacher Liza', region: 'Region V', licenseAccepted: true, affirmed: true },
      });
      assert.equal(result.moderation.decision, 'allow', JSON.stringify(result.moderation.reasons));
      assert.equal(result.artifact.status, 'visible');
      assert.equal(result.artifact.license, 'CC-BY-NC-4.0');
      assert.equal(result.artifact.provenance.aiDrafted, true, 'an unedited AI draft must be labelled as one');
      assert.ok(llm.calls.some((c) => c.feature === 'community.moderate'), 'moderation never asked the model');
      return result.artifact;
    });

    const students = await step('roster', 'import a pasted class list with rules only, review it, confirm it', async () => {
      const draft = await t.ok('roster.import', {
        token: liza.token,
        body: { classId: ids.klass, filename: 'klase.txt', text: 'DELA CRUZ, Juan Miguel S.\nMacaraeg, Ana Liza\nSantos, Pedro Jr.', useAi: false },
      });
      assert.equal(draft.aiUsed, false);
      assert.equal(draft.counts.linesRead, 3);
      const confirmed = await t.ok('roster.confirm', {
        token: liza.token,
        params: { importId: draft.importId },
        body: { resolutions: draft.rows.filter((r) => r.status === 'needs_review').map((r) => ({ rowIndex: r.rowIndex, action: 'keep_original' as const })), acceptAllChanged: true, defaultGradeGroupId: ids.group },
      });
      assert.deepEqual(confirmed.pendingRows, []);
      assert.equal(confirmed.students.length, 3, 'three lines in, three learners out');
      assert.ok(!llm.calls.some((c) => c.feature.startsWith('roster.')), 'a learner name reached the model on the rules-only route');
      return confirmed.students;
    });

    await step('core', 'the confirmed learners are stored by the device through sync', async () => {
      for (const [order, s] of students.entries()) {
        const { rowIndex: _rowIndex, grade: _grade, ...fields } = s;
        await phone.engine.put('student', parseRecordData('student', { ...fields, id: phone.newId(), classId: ids.klass, order }));
      }
      await cleanSync(phone.engine);
      assert.equal(t.services.records.list(liza.id, 'student').length, 3);
    });

    /* ------------------------------------------------ teacher B ------------------------------------------------ */

    const ben = await step('core', 'a second teacher signs up', () => t.registerUser({ email: 'ben.cruz@example.test', displayName: 'G. Ben Cruz' }));
    const tablet = device(t, ben, 'ben');
    await cleanSync(tablet.engine);

    const found = await step('community', 'the second teacher finds the lesson by grade and subject', async () => {
      const page = await t.ok('community.search', { token: ben.token, query: { grade: '4', learningAreaId: 'science' } });
      const hit = page.items.find((a) => a.id === posted.id);
      assert.ok(hit, 'the posted lesson is not in the search results');
      assert.equal(hit.mine, false);
      assert.equal(hit.authorDisplayName, 'Teacher Liza');
      const detail = await t.ok('community.get', { token: ben.token, params: { artifactId: posted.id } });
      assert.ok(detail.version.sections.length > 0);
      assert.ok(!detail.version.sections.some((s) => s.key === 'reflection'), 'the reflection is private and must not be published');
      return hit;
    });

    const copyPlanId = await step('community', 'copy it: a private draft with a lineage link, stored through sync', async () => {
      const copy = await t.ok('community.copy', { token: ben.token, params: { artifactId: found.id }, body: {} });
      assert.equal(copy.plan.state, 'draft');
      assert.equal(copy.plan.lineage?.artifactId, posted.id);
      await tablet.engine.put('plan', copy.plan);
      for (const section of copy.sections) await tablet.engine.put('plan_section', section);
      await cleanSync(tablet.engine);
      const stored = t.services.records.planSnapshot(ben.id, copy.plan.id)!;
      assert.equal(stored.plan.data.lineage?.authorDisplayName, 'Teacher Liza');
      assert.equal(stored.sections.length, copy.sections.length);
      return copy.plan.id;
    });

    const derived = await step('community', 'the copy is edited, locked and posted as an adaptation with credit', async () => {
      const sections = await sectionsOfPlan(tablet.engine, copyPlanId);
      const assessment = sections.find((s) => s.key === 'assessment')!;
      await tablet.engine.put('plan_section', { ...assessment, editedByTeacher: true, content: { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Pangkatang gawain: bumuo ng modelo ng halaman.' }] }] } });
      const current = (await tablet.engine.get('plan', copyPlanId))!.data;
      const template = BUILTIN_TEMPLATES.find((x) => x.id === current.templateId)!;
      const locked = planHelpers.lockPlan({ plan: current, sections: await sectionsOfPlan(tablet.engine, copyPlanId), template, teacherName: 'G. Ben Cruz', at: t.clock.now().toISOString(), revision: null });
      await tablet.engine.put('plan', locked);
      await cleanSync(tablet.engine);
      const result = await t.ok('community.post', { token: ben.token, body: { planId: copyPlanId, title: 'Mga Bahagi ng Halaman (pangkatan)', displayName: 'Sir Ben', licenseAccepted: true, affirmed: true } });
      assert.equal(result.moderation.decision, 'allow', JSON.stringify(result.moderation.reasons));
      assert.equal(result.artifact.provenance.adapted, true);
      assert.equal(result.artifact.lineage?.artifactId, posted.id);
      assert.equal(result.artifact.lineage?.available, true);
      return result.artifact;
    });

    await step('community', 'report the original; the copy count is visible to its author', async () => {
      assert.deepEqual(await t.ok('community.report', { token: ben.token, params: { artifactId: posted.id }, body: { reason: 'inaccurate', note: 'May mali sa bahagi 2.' } }), { ok: true });
      const mine = await t.ok('community.get', { token: liza.token, params: { artifactId: posted.id } });
      assert.equal(mine.copyCount, 1);
      assert.equal(mine.mine, true);
    });

    await step('generation', 'the second teacher has a job of their own', async () => {
      const created = await t.ok('generation.create', {
        token: ben.token,
        body: { kind: 'full', templateId: DLP.id, language: 'en', subjectName: 'Science', learningAreaId: null, timeBudgetMinutes: 40, gradeGroups: [{ id: tablet.newId(), grade: '4', learnerCount: null }], competencies: {}, curriculumVersion: null, customObjectives: ['Describe the parts of a plant.'], classProfile: {} },
      });
      await waitForJob(t, ben.token, created.id);
    });

    await step('curriculum', 'a self-check by a teacher shows up in the pack summary as a count', async () => {
      await tablet.engine.put('competency_check', parseRecordData('competency_check', { id: tablet.newId(), competencyId: curriculum.competency.id, curriculumVersion: curriculum.version, status: 'confirmed' }));
      await cleanSync(tablet.engine);
      const summary = await t.ok('curriculum.checkSummary', { token: liza.token, params: { packId: curriculum.packId } });
      assert.equal(summary.confirmedBy[curriculum.competency.id], 1);
    });

    /* ------------------------------------------ teacher A deletes the account ------------------------------------------ */

    const benBefore = {
      records: (await t.ok('account.export', { token: ben.token })).records.map((r) => `${r.entity}:${r.id}:${r.rev}`).sort(),
      jobs: (t.db.prepare('SELECT count(*) AS n FROM generation_jobs WHERE owner_id = ?').get(ben.id) as { n: number }).n,
    };
    const lizaTouched = [...dumpTables(t)].filter(([, text]) => text.includes(liza.id)).map(([name]) => name);
    await step('kernel', 'before deletion, the first teacher has rows in more than one module', () => {
      const touched = new Set(lizaTouched.map(moduleOfTable));
      for (const module of ['core', 'community', 'generation']) assert.ok(touched.has(module), `expected ${module} to hold rows for the teacher before deletion (tables: ${lizaTouched.join(', ')})`);
    });

    await step('core', 'the first teacher deletes their account', async () => {
      const done = await t.call('account.delete', { token: liza.token, body: { confirm: 'DELETE', password: liza.password } });
      assert.equal(done.status, 200, done.error?.message);
      assert.deepEqual(t.errors, [], 'a module threw while cleaning up');
    });

    const after = dumpTables(t);
    for (const [table, text] of after) {
      await step(moduleOfTable(table), `nothing of the deleted teacher is left in ${table}`, () => {
        assert.ok(!text.includes(liza.id), 'rows still carry the deleted teacher’s id');
        assert.ok(!text.includes('liza.reyes@example.test'), 'rows still carry the deleted teacher’s email');
        // Private things that were never published: learners, the class, the school, her own name.
        for (const piece of ['Juan Miguel', 'Macaraeg', 'Dela Cruz', 'DELA CRUZ', 'Baitang 4 - Sampaguita', 'San Roque', 'Gng. Liza Reyes']) assert.ok(!text.includes(piece), `"${piece}" is still stored`);
      });
    }

    await step('core', 'her other sessions are told the account is gone', async () => {
      const res = await t.call('sync.pull', { token: liza.token });
      assert.equal(res.status, 401);
      assert.deepEqual(res.error?.details, { reason: 'account_deleted' });
    });

    await step('core', 'the second teacher’s records are untouched', async () => {
      assert.equal((await t.call('auth.me', { token: ben.token })).ok, true);
      const records = (await t.ok('account.export', { token: ben.token })).records.map((r) => `${r.entity}:${r.id}:${r.rev}`).sort();
      assert.deepEqual(records, benBefore.records);
      await cleanSync(tablet.engine);
    });

    await step('generation', 'the second teacher’s jobs are untouched', () => {
      assert.equal((t.db.prepare('SELECT count(*) AS n FROM generation_jobs WHERE owner_id = ?').get(ben.id) as { n: number }).n, benBefore.jobs);
    });

    await step('community', 'the second teacher’s adaptation stays, crediting a source that is no longer available', async () => {
      const mine = await t.ok('community.get', { token: ben.token, params: { artifactId: derived.id } });
      assert.equal(mine.status, 'visible');
      assert.equal(mine.lineage?.authorDisplayName, 'Teacher Liza', 'the credit line is permanent (§11.3)');
      assert.equal(mine.lineage?.available, false);
      assert.equal((await t.call('community.get', { token: ben.token, params: { artifactId: posted.id } })).status, 404);
      const page = await t.ok('community.search', { token: ben.token, query: { grade: '4' } });
      assert.deepEqual(page.items.map((a) => a.id), [derived.id]);
      // His private copy keeps its content and its credit.
      assert.equal(t.services.records.planSnapshot(ben.id, copyPlanId)?.plan.data.lineage?.authorDisplayName, 'Teacher Liza');
    });

    await step('kernel', 'no handler failed unexpectedly anywhere on the way', () => {
      assert.deepEqual(t.errors, []);
      assert.ok(!t.logs.some((l) => l.event === 'response_contract_violation'), 'a module returned something its contract does not allow');
      assert.ok(!t.logs.some((l) => l.level === 'error'), `error logged: ${t.logs.filter((l) => l.level === 'error').map((l) => l.event).join(', ')}`);
    });
  } finally {
    t.close();
  }
});
