// Opt-in companion to production-ai.cjs. Creates exactly one labelled standalone
// lesson and its sections; never changes a class, profile or pre-existing lesson.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createTalaClient } from '../../tala-core/src/contracts/index.ts';
import { createSyncEngine, createMemoryStore } from '../../tala-core/src/sync/index.ts';
import { newPlan, defaultTemplateFor } from '../../tala-web/src/data/plans.ts';

const validateOnly = process.argv[2] === '--validate-only';
const [base, file, userId, mode] = validateOnly
  ? ['https://tala.hiraia.org', undefined, undefined, 'ephemeral'] : process.argv.slice(2);
if (!validateOnly) assert.equal(process.env.TALA_DESKTOP_PRODUCTION_TEST_APPROVAL, 'rq_czqd79ie');
assert.equal(base, 'https://tala.hiraia.org');
assert.ok(mode === 'owner' || mode === 'ephemeral');
if (!validateOnly) {
  assert.ok(process.env.TALA_TEST_PASSWORD);
  if (mode === 'owner') assert.ok(process.env.TALA_TEST_EMAIL === 'fable-release-test-20261125@example.com', 'Retained synthetic owner account required');
  else {
    assert.match(process.env.TALA_TEST_EMAIL || '', /^desktop-native-[a-zA-Z0-9-]+-(win32|darwin)-(x64|arm64)-[a-f0-9]{12}@example\.com$/);
    assert.equal(process.env.CI, 'true');
    assert.equal(process.env.GITHUB_RUN_ATTEMPT, '1');
    assert.match(process.env.TALA_RELEASE_TAG || '', /^tala-desktop-preview-production-[a-zA-Z0-9.-]+$/);
  }
}
const newId = () => randomUUID();
const { plan, sections } = newPlan({ template: defaultTemplateFor(null, null), cls: null, assignment: null,
  dates: [], language: 'en', newId, title: 'Plant observations ' + (mode === 'owner' ? '(desktop real-AI check, synthetic test)' : '(desktop native check, synthetic test)') });
plan.grades = ['4']; plan.subjectName = 'Science'; plan.learningAreaId = 'science';
plan.customObjectives = ['Describe the functions of roots, stems and leaves using a drawing of a plant.'];
for (const section of sections) {
  if (section.key === 'objectives') section.content = { type: 'list', items: [...plan.customObjectives] };
  if (section.key === 'content') section.content = { type: 'text', blocks: [{ t: 'p', spans: [{ text: 'Roots absorb water. Stems support a plant. Leaves use sunlight to make food.' }] }] };
  if (section.key === 'materials') section.content = { type: 'list', items: ['paper', 'pencils'] };
  if (section.content.type === 'procedure') for (const step of section.content.steps) {
    step.title = 'Observe and discuss';
    step.body = [{ t: 'p', spans: [{ text: 'Draw a plant and label its roots, stem and leaves. Explain what each part does.' }] }];
  }
}
const allowed = new Set([plan.id, ...sections.map(s => s.id)]);
const changes = [{ op: 'put' as const, entity: 'plan' as const, data: plan },
  ...sections.map(data => ({ op: 'put' as const, entity: 'plan_section' as const, data }))];
if (validateOnly) {
  // No account, endpoint call or credential is used. The real schema/engine validates
  // the exact records before a live run is even eligible to launch Electron.
  const noNetwork = async () => { throw new Error('Offline validation must never use transport'); };
  const engine = createSyncEngine({ store: createMemoryStore(), transport: { push: noNetwork, pull: noNetwork }, deviceId: newId(), now: () => new Date(), newId });
  await engine.batch(changes);
  assert.equal((await engine.status()).pending, changes.length);
  console.log('Synthetic production seed validated offline:', changes.length, 'new records');
  process.exit(0);
}
let cookie = '', writes = 0;
const statuses: { method: string; path: string; status: number }[] = [];
const persist = (phase: string) => writeFileSync(file!, JSON.stringify({ phase, planId: plan.id, sectionIds: sections.map(s => s.id), writes, statuses }), { mode: 0o600 });
persist('planned');
const client = createTalaClient({ baseUrl: base!, validateResponses: false, fetch: async (input, init) => {
  const request = new Request(input, { ...init, redirect: 'error' });
  const url = new URL(request.url);
  assert.equal(url.origin, base);
  assert.ok(['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/sync/push', '/api/v1/sync/pull'].includes(url.pathname));
  if (request.method !== 'GET') {
    assert.ok(++writes <= 8, 'seed write cap');
    persist('writing');
    if (url.pathname === '/api/v1/sync/push') {
      const body = await request.clone().json();
      assert.ok(body.mutations.every((m: any) => m.op === 'upsert' && m.baseRev === 0 && allowed.has(m.id) && ['plan', 'plan_section'].includes(m.entity)));
    }
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
  // The fresh store contains only these new records; its first push cannot edit an existing record.
  await engine.batch(changes);
  await engine.sync();
  assert.equal((await engine.status()).pending, 0);
} finally { await client.call('auth.logout'); }
persist('seeded');
