const { test } = require('node:test');
const assert = require('node:assert/strict');
const { installProductionGuard } = require('./production-guard.cjs');
function guard(native = true) {
  let before;
  installProductionGuard({ session: { fromPartition: () => ({ webRequest: {
    onBeforeRequest: (_filter, fn) => { before = fn; }, onCompleted: () => {},
  } }) } }, { base: 'https://tala.hiraia.org', native, email: 'synthetic@example.com', displayName: 'Synthetic test' });
  const state = global.__productionCheck;
  const send = (pathname, body, method = 'POST') => {
    let result;
    before({ url: pathname.startsWith('https:') ? pathname : 'https://tala.hiraia.org' + pathname,
      method, uploadData: body === undefined ? [] : [{ bytes: Buffer.from(JSON.stringify(body)) }] }, r => { result = !r.cancel; });
    return result;
  };
  return { state, send };
}
test('production guard permits only the named cohort and new lesson; uploads and unrelated writes fail closed', () => {
  const { state, send } = guard();
  assert.equal(send('/api/v1/auth/register', { email: 'someone@example.com', displayName: 'Synthetic test' }), false);
  assert.equal(send('/api/v1/auth/register', { email: 'synthetic@example.com', displayName: 'Synthetic test' }), true);
  assert.equal(send('/api/v1/auth/register', { email: 'synthetic@example.com', displayName: 'Synthetic test' }), false);
  assert.equal(state.registrations, 1);
  assert.equal(send('https://other.example/api', {}, 'GET'), false);
  for (const p of ['/api/v1/deck-uploads', '/api/v1/classes', '/api/v1/account/profile']) assert.equal(send(p, {}), false);
  assert.equal(send('/api/v1/sync/push', { mutations: [] }), false);
  state.planId = 'new-plan'; state.sectionIds = ['new-section'];
  const own = { op: 'upsert', entity: 'plan_section', id: 'new-section', data: { id: 'new-section', planId: 'new-plan' } };
  assert.equal(send('/api/v1/sync/push', { mutations: [own] }), true);
  assert.equal(send('/api/v1/sync/push', { mutations: [own, { ...own, id: 'existing-section' }] }), false);
  assert.equal(send('/api/v1/sync/push', { mutations: [{ ...own, op: 'delete' }] }), false);
  assert.equal(send('/api/v1/sync/push', { mutations: [{ ...own, data: { ...own.data, planId: 'existing-plan' } }] }), false);
  assert.equal(send('/api/v1/auth/login', { email: 'synthetic@example.com' }, 'DELETE'), false);
  assert.equal(send('/api/v1/generation/jobs', null), false);
});
test('one AI call per kind; no retry; cleanup stays available at the write cap and only once', () => {
  const { state, send } = guard(); state.planId = 'new-plan';
  const section = { kind: 'section', sectionKey: 'content', planId: 'new-plan' };
  assert.equal(send('/api/v1/generation/jobs', { ...section, kind: 'full' }), false);
  assert.equal(send('/api/v1/generation/jobs', section), true);
  assert.equal(send('/api/v1/generation/jobs', section), false);
  assert.equal(send('/api/v1/plans/new-plan/presentation/ai', { scope: 'new' }), true);
  assert.equal(send('/api/v1/plans/new-plan/presentation/ai', { scope: 'new' }), false);
  assert.equal(send('/api/v1/plans/new-plan/presentation/ai/job/apply', {}), false);
  state.slideJobId = 'job';
  assert.equal(send('/api/v1/plans/new-plan/presentation/ai/job/apply', {}), true);
  state.writes = 31; state.finishing = true;
  assert.equal(send('/api/v1/auth/login', { email: 'synthetic@example.com' }), false);
  assert.equal(send('/api/v1/account/delete', { confirm: 'DELETE', password: 'not-a-real-password' }), true);
  assert.equal(state.writes, 32);
  assert.equal(send('/api/v1/account/delete', { confirm: 'DELETE', password: 'not-a-real-password' }), false);
});
test('retained owner account cannot be registered, deleted or used for slide generation', () => {
  const { state, send } = guard(false); state.planId = 'new-plan';
  assert.equal(send('/api/v1/auth/register', { email: 'synthetic@example.com', displayName: 'Synthetic test' }), false);
  assert.equal(send('/api/v1/plans/new-plan/presentation/ai', { scope: 'new' }), false);
  assert.equal(send('/api/v1/account/delete', { confirm: 'DELETE', password: 'not-a-real-password' }), false);
  state.finishing = true;
  assert.equal(send('/api/v1/account/delete', { confirm: 'DELETE', password: 'not-a-real-password' }), false);
  assert.equal(send('/api/v1/auth/logout'), true);
});
