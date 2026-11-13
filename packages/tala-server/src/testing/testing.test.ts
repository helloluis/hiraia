import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TalaApiError } from '@hiraia/tala-core';
import { z } from 'zod';
import { createFakeLlm, createTestClock, createTestServer, DEFAULT_TEST_TIME } from './index';

test('the clock only moves when told to', () => {
  const clock = createTestClock();
  assert.equal(clock.now().toISOString(), DEFAULT_TEST_TIME);
  clock.advance({ days: 1, hours: 2, minutes: 3, seconds: 4, ms: 5 });
  assert.equal(clock.now().toISOString(), '2026-11-17T02:03:04.005Z');
  clock.advance(-5);
  clock.set('2027-06-14T00:00:00.000Z');
  assert.equal(clock.now().toISOString(), '2027-06-14T00:00:00.000Z');
  assert.throws(() => clock.set('not a date'));
});

test('registerUser, ok() and the typed client', async () => {
  const t = createTestServer({ now: '2027-06-14T00:00:00.000Z' });
  const verified = await t.registerUser();
  const unverified = await t.registerUser({ verified: false, email: 'later@example.test' });
  assert.equal(verified.user.emailVerified, true);
  assert.equal(unverified.user.emailVerified, false);
  assert.notEqual(verified.id, unverified.id);
  assert.equal((await t.ok('auth.me', { cookie: verified.cookie })).user.id, verified.id);

  // ok() throws a readable error instead of returning a failure.
  await assert.rejects(t.ok('auth.me'), /auth\.me failed: 401 unauthenticated/);

  // The real client: typed results on success, TalaApiError on failure.
  const client = t.client(verified.token);
  assert.equal((await client.call('auth.me')).user.email, verified.email);
  await assert.rejects(
    t.client(null).call('auth.me'),
    (err: unknown) =>
      err instanceof TalaApiError && err.code === 'unauthenticated' && err.status === 401
  );

  assert.equal(t.clock.now().toISOString(), '2027-06-14T00:00:00.000Z');
  assert.equal(t.mailToken('later@example.test', 'verify_email')!.length, 43);
  assert.deepEqual(t.errors, []);
  t.close();
});

test('each test server is its own world', async () => {
  const a = createTestServer();
  const b = createTestServer();
  await a.registerUser({ email: 'same@example.test' });
  assert.equal(
    (
      await b.call('auth.register', {
        body: {
          email: 'same@example.test',
          password: 'kalabaw-bituin-ilog-27',
          displayName: 'Same',
        },
      })
    ).ok,
    true
  );
  a.close();
  b.close();
});

test('createFakeLlm behaves like the gateway where a caller can tell', async () => {
  const schema = z.object({ names: z.array(z.string()) });
  const llm = createFakeLlm({
    answers: { 'roster.names': { names: ['Ana Reyes'] } },
    routes: { 'roster.columns': 'rules', 'lesson.generate': 'off' },
  });
  const request = {
    feature: 'roster.names' as const,
    promptId: 'roster/names',
    vars: { rows: 'REYES, ANA' },
    schema,
    userId: 'user-0001',
  };

  const good = await llm.complete(request);
  assert.equal(good.ok, true);
  assert.deepEqual(good.ok && good.data, { names: ['Ana Reyes'] });
  assert.deepEqual(llm.calls, [
    {
      feature: 'roster.names',
      promptId: 'roster/names',
      version: undefined,
      vars: { rows: 'REYES, ANA' },
      userId: 'user-0001',
      route: 'cloud',
    },
  ]);

  assert.deepEqual(await llm.complete({ ...request, feature: 'roster.columns' }), {
    ok: false,
    reason: 'rules_only',
    message: 'This feature is set to work without AI.',
  });
  assert.equal(
    ((await llm.complete({ ...request, feature: 'lesson.generate' })) as { reason: string }).reason,
    'disabled'
  );
  assert.equal(
    ((await llm.complete({ ...request, feature: 'plan.import' })) as { reason: string }).reason,
    'providers_unavailable'
  );
  assert.equal(llm.calls.length, 2, 'declined routes never reach a model');

  llm.answer('roster.names', { names: 'not a list' });
  assert.equal(((await llm.complete(request)) as { reason: string }).reason, 'invalid_output');
  llm.answer('roster.names', { names: ['Ana Reyes', 'Invented Person'] });
  const checked = await llm.complete({
    ...request,
    check: (v) => (v.names.length > 1 ? ['A name is not in the source.'] : []),
  });
  assert.deepEqual(checked, {
    ok: false,
    reason: 'invalid_output',
    message: 'A name is not in the source.',
  });
  llm.answer('*', () => {
    throw new Error('provider down');
  });
  assert.equal(
    ((await llm.complete({ ...request, feature: 'plan.import' })) as { reason: string }).reason,
    'providers_unavailable'
  );

  // Through a test server, in place of the real gateway.
  const t = createTestServer({ services: { llm } });
  assert.equal(t.services.llm.routeFor('roster.columns'), 'rules');
  assert.equal((await t.ok('config.get')).rosterLlmRoute, 'cloud');
  t.close();
});
