// Opt-in companion to production-ai.cjs. Owner mode reuses the reviewed synthetic
// lesson and links it to a NEW year/class. No profile or unrelated record writes.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTalaClient, Plan } from '../../tala-core/src/contracts/index.ts';
import { createSyncEngine, createMemoryStore } from '../../tala-core/src/sync/index.ts';
import { syntheticAiFixture } from './synthetic-ai-fixture.mts';
import resumeHelper from './owner-resume.cjs';
import digestHelper from './record-digest.cjs';

const validateOnly = process.argv[2] === '--validate-only';
const [base, file, userId, mode] = validateOnly
  ? ['https://tala.hiraia.org', undefined, undefined, 'ephemeral'] : process.argv.slice(2);
if (!validateOnly) assert.equal(process.env.TALA_DESKTOP_PRODUCTION_TEST_APPROVAL, 'rq_czqd79ie');
assert.equal(base, 'https://tala.hiraia.org');
assert.ok(mode === 'owner' || mode === 'ephemeral');
let resume: ReturnType<typeof resumeHelper.readOwnerResume> | undefined;
if (!validateOnly) {
  assert.ok(process.env.TALA_TEST_PASSWORD);
  if (mode === 'owner') {
    assert.equal(process.env.TALA_DESKTOP_OWNER_AI_CHECK, '1');
    assert.notEqual(process.env.CI, 'true');
    assert.equal(process.env.TALA_TEST_EMAIL, 'fable-release-test-20261125@example.com');
    resume = resumeHelper.readOwnerResume(process.env.TALA_DESKTOP_OWNER_RESUME_REPORT);
    assert.equal(userId, resume.accountId);
  }
  else {
    assert.match(process.env.TALA_TEST_EMAIL || '', /^desktop-native-[a-zA-Z0-9-]+-(win32|darwin)-(x64|arm64)-[a-f0-9]{12}@example\.com$/);
    assert.equal(process.env.CI, 'true');
    assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
    assert.match(process.env.TALA_RELEASE_TAG || '', /^tala-desktop-preview-production-[a-zA-Z0-9.-]+$/);
  }
}
const newId = () => randomUUID();
const fixture = syntheticAiFixture(mode);
let { plan, sections } = fixture;
let changes: Array<{ op: 'put'; entity: 'school_year' | 'class' | 'plan' | 'plan_section'; data: unknown }> = fixture.changes;
if (validateOnly) {
  // No account, endpoint call or credential is used. The real schema/engine validates
  // the exact records before a live run is even eligible to launch Electron.
  const noNetwork = async () => { throw new Error('Offline validation must never use transport'); };
  const engine = createSyncEngine({ store: createMemoryStore(), transport: { push: noNetwork, pull: noNetwork }, deviceId: newId(), now: () => new Date(), newId });
  await engine.batch(changes);
  assert.equal((await engine.status()).pending, 12);
  assert.equal(plan.placements[0]?.classId, fixture.cls.id);
  assert.deepEqual(plan.gradeGroupIds, fixture.cls.gradeGroups.map(g => g.id));
  console.log('Synthetic production seed validated offline: 12 new records; class-linked lesson');
  process.exit(0);
}
let cookie = '', writes = 0, recordWrites = 0;
const recordCap = resume ? 3 : 12;
const expected = new Map<string, { entity: string; baseRev: number; digest: string }>();
const statuses: { method: string; path: string; status: number }[] = [];
let metadata: Record<string, unknown> = { planId: resume?.planId ?? plan.id,
  sectionIds: resume?.sectionIds ?? sections.map(s => s.id), schoolYearId: fixture.year.id,
  classId: fixture.cls.id, gradeGroupId: fixture.cls.gradeGroups[0]!.id, reusedPlan: !!resume };
const persist = (phase: string) => writeFileSync(file!, JSON.stringify({ ...metadata, phase, writes, recordWrites, statuses }), { mode: 0o600 });
persist('planned');
const client = createTalaClient({ baseUrl: base!, validateResponses: false, fetch: async (input, init) => {
  let request = new Request(input, { ...init, redirect: 'error' });
  const url = new URL(request.url);
  assert.equal(url.origin, base);
  assert.ok(['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/sync/push', '/api/v1/sync/pull'].includes(url.pathname));
  // Hydrate only this test plan, never the retained account's whole library.
  if (url.pathname === '/api/v1/sync/pull') {
    url.searchParams.set('planIds', String(metadata.planId));
    request = new Request(url, request);
  }
  if (request.method !== 'GET') {
    assert.ok(++writes <= 8, 'seed write cap');
    if (url.pathname === '/api/v1/sync/push') {
      const body = await request.clone().json();
      assert.ok(Array.isArray(body.mutations) && body.mutations.length > 0);
      assert.equal(new Set(body.mutations.map((m: any) => m.id)).size, body.mutations.length);
      assert.ok(recordWrites + body.mutations.length <= recordCap, 'seed record-write cap; no replay');
      assert.ok(body.mutations.every((m: any) => {
        const e = expected.get(m.id);
        return e && m.op === 'upsert' && m.entity === e.entity && m.entity !== 'profile' &&
          m.baseRev === e.baseRev && m.data?.id === m.id && digestHelper.recordDigest(m.data) === e.digest;
      }), 'Seed may write only exact reviewed fixture records');
      recordWrites += body.mutations.length;
    }
    persist('writing');
  }
  if (cookie) request.headers.set('cookie', cookie);
  const response = await fetch(request);
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0]!;
  statuses.push({ method: request.method, path: url.pathname, status: response.status });
  persist('response received');
  return response;
} });
const auth = await client.call('auth.login', { body: { email: process.env.TALA_TEST_EMAIL!, password: process.env.TALA_TEST_PASSWORD!, deviceLabel: 'bounded desktop synthetic seed' } });
assert.equal(auth.user.id, userId);
assert.equal(auth.user.email, process.env.TALA_TEST_EMAIL);
try {
  const engine = createSyncEngine({ store: createMemoryStore(), transport: client.syncTransport, deviceId: newId(), now: () => new Date(), newId });
  let planRev = 0;
  if (resume) {
    assert.equal((await engine.fetchPlans([resume.planId])).ok, true);
    const prior = await engine.get('plan', resume.planId);
    assert.ok(prior && !prior.deletedAt && prior.rev > 0);
    assert.ok(prior.data.title.endsWith('(desktop real-AI check, synthetic test)'));
    assert.equal(prior.data.state, 'draft');
    assert.equal(prior.data.placements.length, 0, 'Already-linked lesson needs a new review');
    sections = (await engine.list('plan_section')).filter(r => r.data.planId === resume.planId).map(r => r.data);
    assert.deepEqual(sections.map(s => s.id).sort(), [...resume.sectionIds].sort());
    planRev = prior.rev;
    plan = Plan.parse({ ...prior.data, placements: [{ classId: fixture.cls.id, assignmentId: null, dates: [] }],
      gradeGroupIds: fixture.cls.gradeGroups.map(g => g.id) });
    changes = [fixture.changes[0]!, fixture.changes[1]!, { op: 'put', entity: 'plan', data: plan }];
  }
  const content = sections.find(s => s.key === 'content');
  assert.ok(content);
  metadata = { ...metadata, contentSectionId: content.id,
    sectionDigests: Object.fromEntries(sections.map(s => [s.id, digestHelper.recordDigest(s)])),
    revisionContentDigest: digestHelper.recordDigest({ content: content.content, origin: content.origin, gen: content.gen }),
    appliedPlanDigest: digestHelper.recordDigest(Plan.parse({ ...plan, aiDraft: true, aiAssisted: true })) };
  for (const change of changes) expected.set((change.data as { id: string }).id, { entity: change.entity,
    baseRev: change.entity === 'plan' ? planRev : 0, digest: digestHelper.recordDigest(change.data) });
  persist('validated exact records');
  await engine.batch(changes);
  assert.equal((await engine.sync()).ok, true);
  assert.equal((await engine.status()).pending, 0);
  assert.equal(recordWrites, recordCap);
} finally { await client.call('auth.logout'); }
persist('seeded');
