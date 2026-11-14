/**
 * What a public deployment leans on: the liveness route, and the stop-gap for running with no mail provider.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createTestServer } from '../../testing';
import type { RenderedMail } from './mailer';
import { mailModeFor } from './state';
import { SERVER_VERSION, serverVersion } from './version';

const GOOD_PASSWORD = 'kalabaw-bituin-ilog-27';
const signUp = (email: string) => ({ email, password: GOOD_PASSWORD, displayName: 'Gng. Reyes' });
const count = (t: ReturnType<typeof createTestServer>, table: string) =>
  (t.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/* ============================== system.health ============================== */

test('system.health: answers without a session, writes nothing, says nothing about anyone', async () => {
  const t = createTestServer({ core: { buildId: 'a1b2c3d' } });
  const teacher = await t.registerUser();
  t.clock.advance({ hours: 3 });
  const session = () =>
    t.db
      .prepare('SELECT last_seen_at, expires_at FROM core_sessions WHERE user_id = ?')
      .get(teacher.id);
  const sessionBefore = session();
  const changesBefore = (t.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

  const anonymous = await t.call('system.health');
  assert.equal(anonymous.status, 200);
  assert.deepEqual(anonymous.data, {
    ok: true,
    version: `${SERVER_VERSION}+a1b2c3d`,
    environment: 'local',
    time: t.clock.now().toISOString(),
  });
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');

  // Even with a session presented, the session is not looked up (looking it up would extend it: a write).
  assert.equal((await t.call('system.health', { token: teacher.token })).status, 200);
  assert.equal((await t.call('system.health', { token: 'A'.repeat(43) })).status, 200);
  assert.deepEqual(session(), sessionBefore);
  assert.equal(
    (t.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n,
    changesBefore,
    'no row was written'
  );
  assert.ok(!JSON.stringify(anonymous.data).includes(teacher.id));
  assert.equal((await t.request('POST', '/health', { body: {} })).status, 405);
  t.close();

  // After the server has stopped, the answer is a clean "not ready", which is what a supervisor needs to see.
  assert.equal((await t.server.handle(new Request('http://tala.test/api/v1/health'))).status, 503);
});

test('the reported version follows package.json, with the deploy’s build label when it gives a sane one', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
  ) as { version: string };
  assert.equal(
    SERVER_VERSION,
    pkg.version,
    'update SERVER_VERSION when the package version changes'
  );
  assert.equal(serverVersion(undefined), SERVER_VERSION);
  assert.equal(serverVersion(''), SERVER_VERSION);
  assert.equal(serverVersion('4e9177863'), `${SERVER_VERSION}+4e9177863`);
  assert.equal(serverVersion('has spaces; rm -rf'), SERVER_VERSION);
  assert.equal(serverVersion('x'.repeat(41)), SERVER_VERSION);
});

/* ============================== mail and the auto-verify stop-gap ============================== */

test('which mail mode applies: a transport wins, then the stop-gap, then outbox (local/staging) or fail-closed (production)', () => {
  const transport = async () => {};
  assert.equal(
    mailModeFor('production', { mailTransport: transport, autoVerifyEmail: true }),
    'transport'
  );
  assert.equal(mailModeFor('production', { autoVerifyEmail: true }), 'off');
  assert.equal(mailModeFor('production', { autoVerifyEmail: false }), 'unavailable');
  assert.equal(mailModeFor('staging', { autoVerifyEmail: false }), 'outbox');
  assert.equal(mailModeFor('local', { autoVerifyEmail: false }), 'outbox');
  assert.equal(mailModeFor('local', { autoVerifyEmail: true }), 'off');

  // Left unset, the option follows TALA_AUTH_AUTO_VERIFY. Off unless it is plainly switched on.
  const saved = process.env.TALA_AUTH_AUTO_VERIFY;
  try {
    for (const [value, mode] of [
      [undefined, 'unavailable'],
      ['', 'unavailable'],
      ['0', 'unavailable'],
      ['false', 'unavailable'],
      ['1', 'off'],
      ['true', 'off'],
      [' ON ', 'off'],
    ] as const) {
      if (value === undefined) delete process.env.TALA_AUTH_AUTO_VERIFY;
      else process.env.TALA_AUTH_AUTO_VERIFY = value;
      assert.equal(mailModeFor('production', {}), mode, JSON.stringify(value));
    }
    process.env.TALA_AUTH_AUTO_VERIFY = '1';
    assert.equal(
      mailModeFor('production', { mailTransport: transport }),
      'transport',
      'ignored once mail exists'
    );
  } finally {
    if (saved === undefined) delete process.env.TALA_AUTH_AUTO_VERIFY;
    else process.env.TALA_AUTH_AUTO_VERIFY = saved;
  }
});

test('default (stop-gap off, local): sign-up is unconfirmed until the mailed link is used', async () => {
  const t = createTestServer();
  assert.equal((await t.ok('config.get')).features.emailDelivery, true);
  const res = await t.ok('auth.register', { body: signUp('a@example.test') });
  assert.equal(res.user.emailVerified, false);
  assert.equal(t.outbox().filter((m) => m.template === 'verify_email').length, 1);
  assert.ok(
    !t.logs.some((l) => l.event === 'auth_auto_verify_on' || l.event === 'mail_transport_missing')
  );
  await t.ok('auth.verifyEmail', {
    body: { token: t.mailToken('a@example.test', 'verify_email')! },
  });
  assert.deepEqual(
    t.db.prepare('SELECT email_verified, email_verified_how FROM core_users').get(),
    {
      email_verified: 1,
      email_verified_how: 'link',
    }
  );
  t.close();
});

test('stop-gap on, no transport: sign-up is confirmed at once, nothing is mailed, and the server says so once at start', async () => {
  const t = createTestServer({
    config: {
      environment: 'production',
      publicOrigin: 'https://tala.hiraia.org',
      session: { cookieName: '__Host-tala_session' },
    },
    core: { autoVerifyEmail: true },
  });
  const warnings = t.logs.filter((l) => l.event === 'auth_auto_verify_on');
  assert.equal(warnings.length, 1);
  assert.deepEqual(
    [warnings[0]!.level, warnings[0]!.fields.setting],
    ['warn', 'TALA_AUTH_AUTO_VERIFY']
  );

  // The client is told plainly, so it hides "verify your email" and the reset-by-email promise.
  assert.equal((await t.ok('config.get')).features.emailDelivery, false);

  const res = await t.call('auth.register', { body: signUp('teacher@example.test') });
  assert.equal(res.status, 200, res.error?.message);
  assert.equal(res.data!.user.emailVerified, true);
  assert.deepEqual(
    t.db.prepare('SELECT email_verified, email_verified_how FROM core_users').get(),
    {
      email_verified: 1,
      email_verified_how: 'auto',
    }
  );
  // The session in ctx carries it too, which is what roster import and community posting check.
  assert.equal((await t.ok('auth.me', { token: res.data!.token })).user.emailVerified, true);

  // Verification and reset requests answer as usual and send nothing: no mail, no token, no error.
  assert.deepEqual(await t.ok('auth.sendVerification', { token: res.data!.token }), { ok: true });
  const known = await t.call('auth.requestReset', { body: { email: 'teacher@example.test' } });
  const unknown = await t.call('auth.requestReset', { body: { email: 'nobody@example.test' } });
  assert.deepEqual([known.status, known.data], [200, { ok: true }]);
  assert.deepEqual(known.data, unknown.data);
  assert.equal(count(t, 'core_mail_outbox'), 0);
  assert.equal(count(t, 'core_email_tokens'), 0);
  assert.deepEqual(t.errors, []);
  assert.ok(
    !t.logs.some((l) => l.level === 'error'),
    'nothing is logged as an error for mail that was never going to be sent'
  );

  // An account left unconfirmed from before the stop-gap is answered the same way, and stays as it was.
  t.db.prepare(`UPDATE core_users SET email_verified = 0, email_verified_how = NULL`).run();
  assert.deepEqual(await t.ok('auth.sendVerification', { token: res.data!.token }), { ok: true });
  assert.equal(count(t, 'core_email_tokens'), 0);

  // The test helper copes: there is no mail to follow.
  const helped = await t.registerUser();
  assert.equal(helped.user.emailVerified, true);
  t.close();
});

test('production with no transport and the stop-gap off: mail fails closed, and the server says what is missing', async () => {
  const t = createTestServer({
    config: {
      environment: 'production',
      publicOrigin: 'https://tala.hiraia.org',
      session: { cookieName: '__Host-tala_session' },
    },
    quiet: true,
  });
  assert.ok(t.logs.some((l) => l.event === 'mail_transport_missing' && l.level === 'warn'));
  assert.equal((await t.ok('config.get')).features.emailDelivery, false);

  const res = await t.ok('auth.register', { body: signUp('teacher@example.test') });
  assert.equal(
    res.user.emailVerified,
    false,
    'nobody is confirmed without proof unless the stop-gap is asked for'
  );
  const resend = await t.call('auth.sendVerification', { token: res.token });
  assert.equal(resend.status, 503);
  assert.deepEqual(resend.error?.details, { reason: 'mail_unavailable' });
  assert.equal(
    count(t, 'core_mail_outbox'),
    0,
    'production never writes working sign-in links to a table'
  );
  assert.deepEqual(
    (await t.call('auth.requestReset', { body: { email: 'teacher@example.test' } })).data,
    { ok: true }
  );
  t.close();
});

test('with a mail transport the stop-gap setting is ignored: mail is sent and the link is still required', async () => {
  const sent: RenderedMail[] = [];
  const t = createTestServer({
    config: {
      environment: 'production',
      publicOrigin: 'https://tala.hiraia.org',
      session: { cookieName: '__Host-tala_session' },
    },
    core: { autoVerifyEmail: true, mailTransport: async (mail) => void sent.push(mail) },
  });
  assert.ok(
    !t.logs.some((l) => l.event === 'auth_auto_verify_on' || l.event === 'mail_transport_missing')
  );
  assert.equal((await t.ok('config.get')).features.emailDelivery, true);

  const res = await t.ok('auth.register', { body: signUp('teacher@example.test') });
  assert.equal(res.user.emailVerified, false);
  assert.deepEqual(
    sent.map((m) => [m.to, m.template]),
    [['teacher@example.test', 'verify_email']]
  );
  assert.match(sent[0]!.body, /https:\/\/tala\.hiraia\.org\/verify-email#token=/);
  await t.ok('auth.requestReset', { body: { email: 'teacher@example.test' } });
  assert.equal(sent.length, 2);
  assert.equal(count(t, 'core_mail_outbox'), 0);
  t.close();
});
