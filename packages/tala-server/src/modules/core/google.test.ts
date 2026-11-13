/**
 * Google sign-in and account linking (PRD §13.3). No real Google: keys are generated here and served by a
 * fake key fetcher, and ID tokens are signed locally. No client secret is involved anywhere.
 */
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { test } from 'node:test';
import { parseRecordData } from '@hiraia/tala-core';
import type { RouteName } from '@hiraia/tala-core';
import type { ExtendedModule } from '../../kernel/auth';
import { createTestServer } from '../../testing';
import type { TestServer, TestServerOptions } from '../../testing';
import { createGoogleVerifier } from './google';
import type { GoogleKeySet } from './google';

const CLIENT_ID = 'tala-test-client.apps.googleusercontent.example';
const GOOD_PASSWORD = 'kalabaw-bituin-ilog-27';

interface TestKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  jwk: GoogleKeySet['keys'][number];
}

function makeKey(kid: string): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    publicKey,
    jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' },
  };
}

const KEY_A = makeKey('key-a');
const KEY_B = makeKey('key-b');
const STRANGER = makeKey('key-a'); // same key id, not Google's key

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function signToken(
  key: TestKey,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {}
): string {
  const head = part({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const body = part(claims);
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url')}`;
}

/** A stand-in for Google: which keys it publishes, whether it is reachable, and how often it was asked. */
function fakeGoogle(now: () => Date) {
  const google = {
    keys: [KEY_A.jwk],
    down: false,
    fetches: 0,
    maxAgeSeconds: 3600,
    fetchKeys: async (): Promise<GoogleKeySet> => {
      google.fetches++;
      if (google.down) throw new Error('unreachable');
      return { keys: google.keys, maxAgeSeconds: google.maxAgeSeconds };
    },
    /** A valid ID token for a Google account, with anything overridden. */
    token(
      who: { sub: string; email: string; name?: string },
      overrides: Record<string, unknown> = {},
      key: TestKey = KEY_A,
      header: Record<string, unknown> = {}
    ): string {
      const seconds = Math.floor(now().getTime() / 1000);
      return signToken(
        key,
        {
          iss: 'https://accounts.google.com',
          aud: CLIENT_ID,
          azp: CLIENT_ID,
          sub: who.sub,
          email: who.email,
          email_verified: true,
          name: who.name ?? 'Google Name',
          iat: seconds,
          exp: seconds + 3600,
          ...overrides,
        },
        header
      );
    },
  };
  return google;
}

const MARIA = {
  sub: '110000000000000000001',
  email: 'maria.santos@gmail.test',
  name: 'Maria Santos',
};
const JOSE = { sub: '110000000000000000002', email: 'jose.rizal@gmail.test', name: 'Jose Rizal' };

function server(options: TestServerOptions = {}) {
  let google!: ReturnType<typeof fakeGoogle>;
  // The fake needs the server's clock, and the server needs the fake's fetcher.
  const holder = { now: () => new Date('2026-11-16T00:00:00.000Z') };
  google = fakeGoogle(() => holder.now());
  const t = createTestServer({
    ...options,
    config: { ...options.config, features: { googleSignIn: true, ...options.config?.features } },
    core: { google: { clientIds: [CLIENT_ID], fetchKeys: google.fetchKeys }, ...options.core },
  });
  holder.now = () => t.clock.now();
  return { t, google };
}

type LinkRoute = Extract<
  RouteName,
  | 'auth.googleLink'
  | 'auth.googleLinkRequest'
  | 'auth.googleLinkConfirm'
  | 'auth.googleConnect'
  | 'auth.googleDisconnect'
  | 'auth.removePassword'
  | 'account.merge'
>;

/**
 * Call a linking route by its contract name. The body is loosely typed on purpose: several tests send
 * bodies the contract refuses, to see them refused.
 */
async function post(
  t: TestServer,
  route: LinkRoute,
  body: unknown,
  extras: { token?: string; ip?: string } = {}
) {
  const res = await t.call(route, { body: body as never, ...extras });
  const json = (res.ok ? res.data : { error: res.error }) as Record<string, unknown> & {
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
  return {
    status: res.status,
    json,
    reason: json.error?.details?.reason,
    cookie: res.headers.get('set-cookie'),
  };
}

const identityRows = (t: TestServer) =>
  t.db
    .prepare('SELECT provider, subject, user_id, email FROM core_identities ORDER BY subject')
    .all() as Array<{ provider: string; subject: string; user_id: string; email: string }>;

/* ============================== the token itself ============================== */

test('ID token: signature, issuer, audience, expiry and a confirmed email are all required', async () => {
  let at = new Date('2026-11-16T00:00:00.000Z');
  const google = fakeGoogle(() => at);
  const verifier = createGoogleVerifier({
    clientIds: [CLIENT_ID],
    fetchKeys: google.fetchKeys,
    now: () => at,
  });
  const problem = async (token: string) => {
    const result = await verifier.verify(token);
    return result.ok ? 'ok' : result.problem;
  };

  const good = await verifier.verify(google.token(MARIA));
  assert.deepEqual(good, {
    ok: true,
    identity: { subject: MARIA.sub, email: MARIA.email, name: 'Maria Santos' },
  });
  assert.equal(
    await problem(google.token(MARIA, { iss: 'accounts.google.com' })),
    'ok',
    'Google uses both issuer spellings'
  );

  assert.equal(
    await problem(google.token(MARIA, { iss: 'https://accounts.example.com' })),
    'wrong_issuer'
  );
  assert.equal(
    await problem(google.token(MARIA, { aud: 'someone-elses-app.apps.googleusercontent.example' })),
    'wrong_audience',
    'a token issued for another app'
  );
  assert.equal(
    await problem(google.token(MARIA, { aud: [CLIENT_ID, 'other'], azp: 'other' })),
    'wrong_audience'
  );
  assert.equal(
    await problem(google.token(MARIA, { exp: Math.floor(at.getTime() / 1000) - 120 })),
    'expired'
  );
  assert.equal(
    await problem(google.token(MARIA, { exp: Math.floor(at.getTime() / 1000) - 30 })),
    'ok',
    'a minute of clock difference is tolerated'
  );
  assert.equal(
    await problem(google.token(MARIA, { iat: Math.floor(at.getTime() / 1000) + 600 })),
    'not_yet_valid'
  );
  assert.equal(await problem(google.token(MARIA, { email_verified: false })), 'email_not_verified');
  assert.equal(await problem(google.token(MARIA, { sub: undefined })), 'missing_claims');
  assert.equal(await problem(google.token(MARIA, { email: undefined })), 'missing_claims');
  assert.equal(await problem(google.token(MARIA, { exp: undefined })), 'missing_claims');

  // Forged tokens.
  const [head, body, signature] = google.token(MARIA).split('.') as [string, string, string];
  const tampered = part({
    ...JSON.parse(Buffer.from(body, 'base64url').toString()),
    email: 'attacker@gmail.test',
  });
  assert.equal(
    await problem(`${head}.${tampered}.${signature}`),
    'bad_signature',
    'a changed claim breaks the signature'
  );
  assert.equal(
    await problem(google.token(MARIA, {}, STRANGER)),
    'bad_signature',
    'right key id, wrong key'
  );
  assert.equal(
    await problem(`${part({ alg: 'none', kid: 'key-a' })}.${body}.AAAA`),
    'unsupported_algorithm'
  );
  assert.equal(await problem(`${part({ alg: 'none', kid: 'key-a' })}.${body}.`), 'malformed');
  // The classic confusion: an HMAC "signed" with the public key as its secret.
  const hsHead = part({ alg: 'HS256', kid: 'key-a', typ: 'JWT' });
  const hmac = createHmac('sha256', KEY_A.publicKey.export({ type: 'spki', format: 'pem' }))
    .update(`${hsHead}.${body}`)
    .digest('base64url');
  assert.equal(await problem(`${hsHead}.${body}.${hmac}`), 'unsupported_algorithm');
  for (const junk of [
    '',
    'not-a-token',
    'a.b',
    'a.b.c.d',
    `${head}.!!!.${signature}`,
    `${part('just a string')}.${body}.${signature}`,
  ])
    assert.equal(await problem(junk), 'malformed', JSON.stringify(junk));

  // No client id configured: nothing is ever accepted.
  const unconfigured = createGoogleVerifier({
    clientIds: [],
    fetchKeys: google.fetchKeys,
    now: () => at,
  });
  assert.deepEqual(await unconfigured.verify(google.token(MARIA)), {
    ok: false,
    problem: 'wrong_audience',
  });
  at = new Date(at.getTime() + 1);
});

test('Google’s keys are cached, refetched when they rotate, and never hammered', async () => {
  let at = new Date('2026-11-16T00:00:00.000Z');
  const advance = (seconds: number) => {
    at = new Date(at.getTime() + seconds * 1000);
  };
  const google = fakeGoogle(() => at);
  const verifier = createGoogleVerifier({
    clientIds: [CLIENT_ID],
    fetchKeys: google.fetchKeys,
    now: () => at,
  });
  const ok = async (token: string) => (await verifier.verify(token)).ok;
  const problem = async (token: string) => {
    const r = await verifier.verify(token);
    return r.ok ? 'ok' : r.problem;
  };

  assert.equal(await ok(google.token(MARIA)), true);
  assert.equal(await ok(google.token(JOSE)), true);
  assert.equal(google.fetches, 1, 'one fetch serves many sign-ins');

  // Junk key ids right after a fetch do not cause more fetches.
  for (let i = 0; i < 5; i++)
    assert.equal(await problem(google.token(MARIA, {}, makeKeyLike('junk-' + i))), 'unknown_key');
  assert.equal(google.fetches, 1);

  // Google rotates: a new key id appears. After the cool-down it is fetched once and accepted.
  google.keys = [KEY_A.jwk, KEY_B.jwk];
  advance(61);
  assert.equal(await ok(google.token(MARIA, {}, KEY_B)), true);
  assert.equal(google.fetches, 2);

  // The cache lifetime Google gave has passed: refresh on next use.
  advance(3601);
  assert.equal(await ok(google.token(MARIA)), true);
  assert.equal(google.fetches, 3);

  // Google unreachable when the cache is stale: keys we already hold are still Google's keys.
  advance(3601);
  google.down = true;
  assert.equal(await ok(google.token(MARIA)), true);
  const afterFailure = google.fetches;
  assert.equal(await ok(google.token(JOSE, {}, KEY_B)), true);
  assert.equal(
    google.fetches,
    afterFailure,
    'no second attempt during the cool-down after a failed fetch'
  );
  assert.equal(
    await problem(google.token(MARIA, {}, makeKeyLike('never-seen'))),
    'keys_unavailable'
  );

  // A server that has never reached Google cannot verify anything.
  const cold = createGoogleVerifier({
    clientIds: [CLIENT_ID],
    fetchKeys: google.fetchKeys,
    now: () => at,
  });
  assert.deepEqual(await cold.verify(google.token(MARIA)), {
    ok: false,
    problem: 'keys_unavailable',
  });
});

/** A key object with another key id, reusing an existing key pair (generating RSA keys is slow). */
function makeKeyLike(kid: string): TestKey {
  return { ...KEY_B, kid, jwk: { ...KEY_B.jwk, kid } };
}

/* ============================== signing in ============================== */

test('switched off by default; switched on without a client id it says so; neither reaches Google', async () => {
  const off = createTestServer();
  const res = await off.call('auth.google', { body: { idToken: 'x.y.z' } });
  assert.equal(res.status, 501);
  off.close();

  const { t, google } = server({
    core: { google: { clientIds: [], fetchKeys: async () => ({ keys: [], maxAgeSeconds: 60 }) } },
  });
  const unconfigured = await t.call('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.equal(unconfigured.status, 503);
  assert.deepEqual(unconfigured.error?.details, { reason: 'google_not_configured' });
  assert.ok(
    t.logs.some(
      (l) =>
        l.event === 'google_sign_in_not_configured' &&
        l.fields.variable === 'GOOGLE_OAUTH_CLIENT_ID'
    )
  );
  t.close();
});

test('AUTH-10: a first Google sign-in creates an account with a confirmed email; the next one signs in to it', async () => {
  const { t, google } = server();
  const first = await t.call('auth.google', {
    body: { idToken: google.token(MARIA), deviceLabel: 'Phone' },
  });
  assert.equal(first.ok, true, first.error?.message);
  const user = first.data!.user;
  assert.deepEqual(
    [user.email, user.displayName, user.emailVerified, user.hasGoogle, user.hasPassword],
    [MARIA.email, 'Maria Santos', true, true, false]
  );
  assert.match(first.headers.get('set-cookie')!, /^tala_session=[A-Za-z0-9_-]{43}; /);
  assert.equal(t.outbox().length, 0, 'no verification mail: Google already confirmed the address');
  assert.equal(
    t.services.records.get(user.id, 'profile', 'profile')?.data.displayName,
    'Maria Santos'
  );
  assert.deepEqual(identityRows(t), [
    { provider: 'google', subject: MARIA.sub, user_id: user.id, email: MARIA.email },
  ]);

  const again = await t.ok('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.equal(again.user.id, user.id);
  assert.equal((t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n, 1);

  // The account is keyed by Google's subject, not the address: a changed Google email still lands here.
  const renamed = await t.ok('auth.google', {
    body: { idToken: google.token({ ...MARIA, email: 'maria.new@gmail.test' }) },
  });
  assert.equal(renamed.user.id, user.id);
  assert.equal(renamed.user.email, MARIA.email, 'the Tala account keeps its own email');

  // There is no password to sign in or change with; the reset link is how a first password is set (case 6).
  assert.equal(
    (await t.call('auth.login', { body: { email: MARIA.email, password: GOOD_PASSWORD } })).status,
    401
  );
  assert.deepEqual(
    (
      await t.call('auth.changePassword', {
        token: first.data!.token,
        body: { currentPassword: '', newPassword: GOOD_PASSWORD },
      })
    ).error?.details,
    { reason: 'no_password' }
  );
  await t.ok('auth.requestReset', { body: { email: MARIA.email } });
  await t.ok('auth.reset', {
    body: { token: t.mailToken(MARIA.email, 'password_reset')!, password: GOOD_PASSWORD },
  });
  const withPassword = await t.ok('auth.login', {
    body: { email: MARIA.email, password: GOOD_PASSWORD },
  });
  assert.deepEqual([withPassword.user.hasPassword, withPassword.user.hasGoogle], [true, true]);
  assert.equal(
    (await t.ok('auth.google', { body: { idToken: google.token(MARIA) } })).user.id,
    user.id
  );
  t.close();
});

test('a refused token signs nobody in, and neither the token nor the email reaches the logs', async () => {
  const { t, google } = server({ config: { abuse: { loginPerIpPerMinute: 4 } } });
  const wrongApp = google.token(MARIA, { aud: 'another-app' });
  const refused = await t.call('auth.google', { body: { idToken: wrongApp }, ip: '203.0.113.1' });
  assert.equal(refused.status, 401);
  assert.deepEqual(refused.error?.details, { reason: 'google_token_invalid' });
  assert.equal(
    (
      await t.call('auth.google', {
        body: { idToken: google.token(MARIA, { email_verified: false }) },
        ip: '203.0.113.1',
      })
    ).status,
    403
  );
  assert.equal(
    (
      await t.call('auth.google', {
        body: { idToken: google.token(MARIA, {}, STRANGER) },
        ip: '203.0.113.1',
      })
    ).status,
    401
  );
  assert.equal((t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n, 0);

  const good = google.token(MARIA);
  assert.equal(
    (await t.call('auth.google', { body: { idToken: good }, ip: '203.0.113.1' })).ok,
    true
  );
  // Per-address limit, like password sign-in.
  assert.equal(
    (await t.call('auth.google', { body: { idToken: good }, ip: '203.0.113.1' })).status,
    429
  );
  assert.equal(
    (await t.call('auth.google', { body: { idToken: good }, ip: '203.0.113.2' })).ok,
    true
  );

  const logs = JSON.stringify(t.logs);
  assert.ok(
    t.logs.some((l) => l.event === 'google_token_refused' && l.fields.problem === 'wrong_audience')
  );
  for (const secret of [
    wrongApp,
    good,
    good.split('.')[2]!,
    MARIA.email,
    'Maria Santos',
    MARIA.sub,
  ])
    assert.ok(!logs.includes(secret), `logs contain ${secret.slice(0, 12)}…`);
  t.close();
});

test('Google unreachable: the answer says so and points back to email and password', async () => {
  const { t, google } = server();
  google.down = true;
  const res = await t.call('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.equal(res.status, 503);
  assert.deepEqual(res.error?.details, { reason: 'google_unreachable' });
  assert.match(res.error!.message, /email and password/);
  t.close();
});

/* ============================== the seven cases of §13.3 ============================== */

test('case 1: same confirmed email → never linked on Google’s word alone; the Tala password connects it', async () => {
  const { t, google } = server();
  const maria = await t.registerUser({ email: MARIA.email, password: GOOD_PASSWORD });

  const refused = await t.call('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.error?.details, {
    reason: 'link_required',
    methods: ['password', 'email_link'],
  });
  assert.equal(refused.headers.get('set-cookie'), null);
  assert.deepEqual(identityRows(t), []);

  const wrong = await post(t, 'auth.googleLink', {
    idToken: google.token(MARIA),
    password: 'not-the-password-1',
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.reason, 'invalid_credentials');
  assert.deepEqual(identityRows(t), []);

  const linked = await post(t, 'auth.googleLink', {
    idToken: google.token(MARIA),
    password: GOOD_PASSWORD,
    deviceLabel: 'Tablet',
  });
  assert.equal(linked.status, 200);
  assert.match(linked.cookie!, /^tala_session=/);
  const user = linked.json.user as { id: string; hasGoogle: boolean; hasPassword: boolean };
  assert.deepEqual([user.id, user.hasGoogle, user.hasPassword], [maria.id, true, true]);

  // Both ways in work afterwards (cases 1 and 6), and the session from before the link is untouched (case 7).
  assert.equal(
    (await t.ok('auth.google', { body: { idToken: google.token(MARIA) } })).user.id,
    maria.id
  );
  assert.equal(
    (await t.ok('auth.login', { body: { email: MARIA.email, password: GOOD_PASSWORD } })).user.id,
    maria.id
  );
  assert.equal((await t.ok('auth.me', { token: maria.token })).user.hasGoogle, true);
  // A repeated tap on "connect" is harmless.
  assert.equal(
    (
      await post(t, 'auth.googleLink', {
        idToken: google.token(MARIA),
        password: 'anything-at-all-1',
      })
    ).status,
    200
  );
  assert.equal(identityRows(t).length, 1);
  t.close();
});

test('case 1 without the password: an emailed link connects the Google account that asked, once, within 30 minutes', async () => {
  const { t, google } = server();
  const maria = await t.registerUser({
    email: MARIA.email,
    password: GOOD_PASSWORD,
    uiLanguage: 'en',
  });

  // Asking always answers ok; only a confirmed Tala account with that address gets mail.
  assert.deepEqual(
    (await post(t, 'auth.googleLinkRequest', { idToken: google.token(JOSE) })).json,
    { ok: true }
  );
  assert.equal(t.outbox().filter((m) => m.template === 'link_google').length, 0);
  assert.deepEqual(
    (await post(t, 'auth.googleLinkRequest', { idToken: google.token(MARIA) })).json,
    { ok: true }
  );
  const mail = t.outbox().find((m) => m.template === 'link_google')!;
  assert.equal(mail.to, MARIA.email);
  assert.equal(mail.lang, 'en');
  assert.match(mail.vars.link!, /^http:\/\/tala\.test\/link-google#token=[A-Za-z0-9_-]{43}$/);
  assert.match(mail.body, new RegExp(MARIA.email.replace('.', '\\.')));
  const token = t.mailToken(MARIA.email, 'link_google')!;

  assert.equal((await post(t, 'auth.googleLinkConfirm', { token: 'C'.repeat(43) })).status, 400);
  const confirmed = await post(t, 'auth.googleLinkConfirm', { token });
  assert.deepEqual(confirmed.json, { ok: true });
  assert.deepEqual(identityRows(t), [
    { provider: 'google', subject: MARIA.sub, user_id: maria.id, email: MARIA.email },
  ]);
  assert.equal(
    (await post(t, 'auth.googleLinkConfirm', { token })).reason,
    'link_invalid_or_expired',
    'single use'
  );
  assert.equal(
    (await t.ok('auth.google', { body: { idToken: google.token(MARIA) } })).user.id,
    maria.id
  );

  // Expiry, and a cap on how many of these mails an account can be sent.
  const jose = await t.registerUser({ email: JOSE.email, password: GOOD_PASSWORD });
  await post(t, 'auth.googleLinkRequest', { idToken: google.token(JOSE) });
  const late = t.mailToken(JOSE.email, 'link_google')!;
  t.clock.advance({ minutes: 31 });
  assert.equal((await post(t, 'auth.googleLinkConfirm', { token: late })).status, 400);
  t.clock.advance({ hours: 2 });
  for (let i = 0; i < 5; i++)
    await post(t, 'auth.googleLinkRequest', { idToken: google.token(JOSE) });
  assert.equal(
    t.outbox().filter((m) => m.template === 'link_google' && m.to === JOSE.email).length,
    1 + 3
  );
  assert.equal((await t.ok('auth.me', { token: jose.token })).user.hasGoogle, false);
  t.close();
});

test('case 2: an unconfirmed Tala account is never linked, so a squatter cannot inherit someone’s Google sign-in', async () => {
  const { t, google } = server();
  // An attacker signs up with the victim's address and their own password. They cannot confirm the email.
  const squatter = await t.registerUser({
    email: MARIA.email,
    password: 'attackers-own-password-9',
    verified: false,
  });

  // The real owner arrives with Google. Nothing is linked, whatever is tried.
  const refused = await t.call('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.equal(refused.status, 409);
  assert.deepEqual(refused.error?.details, { reason: 'verify_email_first' });
  assert.equal(
    (
      await post(t, 'auth.googleLink', {
        idToken: google.token(MARIA),
        password: 'attackers-own-password-9',
      })
    ).reason,
    'verify_email_first',
    'not even with the right password'
  );
  await post(t, 'auth.googleLinkRequest', { idToken: google.token(MARIA) });
  assert.equal(t.outbox().filter((m) => m.template === 'link_google').length, 0);
  // The squatter, signed in, cannot attach a Google account of their own either.
  assert.equal(
    (
      await post(
        t,
        'auth.googleConnect',
        { idToken: google.token(JOSE), password: 'attackers-own-password-9' },
        { token: squatter.token }
      )
    ).reason,
    'verify_email_first'
  );
  assert.deepEqual(identityRows(t), []);

  // The owner proves the mailbox with "Forgot password": the squatter is signed out and the email is confirmed.
  await t.ok('auth.requestReset', { body: { email: MARIA.email } });
  await t.ok('auth.reset', {
    body: { token: t.mailToken(MARIA.email, 'password_reset')!, password: GOOD_PASSWORD },
  });
  assert.equal((await t.call('auth.me', { token: squatter.token })).status, 401);
  assert.deepEqual(
    (await t.call('auth.google', { body: { idToken: google.token(MARIA) } })).error?.details,
    { reason: 'link_required', methods: ['password', 'email_link'] }
  );
  assert.equal(
    (await post(t, 'auth.googleLink', { idToken: google.token(MARIA), password: GOOD_PASSWORD }))
      .status,
    200
  );
  t.close();
});

test('case 3: from Settings, a Google account with a different email is connected after the password; one identity, one account', async () => {
  const { t, google } = server();
  const teacher = await t.registerUser({ email: 'teacher@deped.example', password: GOOD_PASSWORD });
  const other = await t.registerUser({ email: 'other@deped.example', password: GOOD_PASSWORD });

  assert.equal(
    (await post(t, 'auth.googleConnect', { idToken: google.token(MARIA), password: GOOD_PASSWORD }))
      .status,
    401,
    'needs a signed-in teacher'
  );
  const wrong = await post(
    t,
    'auth.googleConnect',
    { idToken: google.token(MARIA), password: 'not-the-password-1' },
    { token: teacher.token }
  );
  assert.equal(wrong.status, 403);
  assert.equal(wrong.reason, 'wrong_password');

  const connected = await post(
    t,
    'auth.googleConnect',
    { idToken: google.token(MARIA), password: GOOD_PASSWORD },
    { token: teacher.token }
  );
  assert.equal(connected.status, 200);
  assert.equal((connected.json.user as { hasGoogle: boolean }).hasGoogle, true);
  // The Google account's own address plays no part: it signs in to the account it was connected to.
  const viaGoogle = await t.ok('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.deepEqual(
    [viaGoogle.user.id, viaGoogle.user.email],
    [teacher.id, 'teacher@deped.example']
  );
  assert.equal(
    (
      await post(
        t,
        'auth.googleConnect',
        { idToken: google.token(MARIA), password: GOOD_PASSWORD },
        { token: teacher.token }
      )
    ).status,
    200,
    'connecting the same one again changes nothing'
  );

  // That Google identity cannot also belong to another Tala account…
  const taken = await post(
    t,
    'auth.googleConnect',
    { idToken: google.token(MARIA), password: GOOD_PASSWORD },
    { token: other.token }
  );
  assert.equal(taken.status, 409);
  assert.equal(taken.reason, 'google_in_use');
  // …and an account holds one Google identity.
  assert.equal(
    (
      await post(
        t,
        'auth.googleConnect',
        { idToken: google.token(JOSE), password: GOOD_PASSWORD },
        { token: teacher.token }
      )
    ).reason,
    'google_already_linked'
  );
  assert.equal(identityRows(t).length, 1);
  t.close();
});

test('case 5: either method can be removed, never the last one', async () => {
  const { t, google } = server();
  const teacher = await t.registerUser({ email: MARIA.email, password: GOOD_PASSWORD });

  // Password only: it cannot be removed, and there is no Google link to remove.
  assert.equal(
    (
      await post(
        t,
        'auth.removePassword',
        { currentPassword: GOOD_PASSWORD },
        { token: teacher.token }
      )
    ).reason,
    'last_sign_in_method'
  );
  assert.equal(
    (await post(t, 'auth.googleDisconnect', { password: GOOD_PASSWORD }, { token: teacher.token }))
      .status,
    200
  );

  await post(t, 'auth.googleLink', { idToken: google.token(MARIA), password: GOOD_PASSWORD });

  // Both: Google can be disconnected (with the password)…
  assert.equal(
    (
      await post(
        t,
        'auth.googleDisconnect',
        { password: 'not-the-password-1' },
        { token: teacher.token }
      )
    ).reason,
    'wrong_password'
  );
  const disconnected = await post(
    t,
    'auth.googleDisconnect',
    { password: GOOD_PASSWORD },
    { token: teacher.token }
  );
  assert.deepEqual(
    [
      (disconnected.json.user as { hasGoogle: boolean }).hasGoogle,
      (disconnected.json.user as { hasPassword: boolean }).hasPassword,
    ],
    [false, true]
  );
  // …after which Google no longer opens the account by itself.
  assert.deepEqual(
    (await t.call('auth.google', { body: { idToken: google.token(MARIA) } })).error?.details,
    { reason: 'link_required', methods: ['password', 'email_link'] }
  );

  // …or the password can be removed (with the password), leaving Google.
  await post(t, 'auth.googleLink', { idToken: google.token(MARIA), password: GOOD_PASSWORD });
  assert.equal(
    (
      await post(
        t,
        'auth.removePassword',
        { currentPassword: 'not-the-password-1' },
        { token: teacher.token }
      )
    ).reason,
    'wrong_password'
  );
  const removed = await post(
    t,
    'auth.removePassword',
    { currentPassword: GOOD_PASSWORD },
    { token: teacher.token }
  );
  assert.deepEqual(
    [
      (removed.json.user as { hasGoogle: boolean }).hasGoogle,
      (removed.json.user as { hasPassword: boolean }).hasPassword,
    ],
    [true, false]
  );
  assert.equal((await t.call('auth.me', { token: teacher.token })).ok, true, 'still signed in');
  assert.equal(
    (await t.call('auth.login', { body: { email: MARIA.email, password: GOOD_PASSWORD } })).status,
    401
  );
  assert.equal(
    (await t.ok('auth.google', { body: { idToken: google.token(MARIA) } })).user.id,
    teacher.id
  );

  // Google is now the last method: it stays.
  const last = await post(t, 'auth.googleDisconnect', { password: '' }, { token: teacher.token });
  assert.equal(last.status, 403);
  assert.equal(last.reason, 'last_sign_in_method');
  assert.equal(identityRows(t).length, 1);
  t.close();
});

test('case 4: two accounts of one teacher are joined; records move, the other account goes, its devices are told why', async () => {
  const { t, google } = server();
  const main = await t.registerUser({
    email: 'main@example.test',
    password: GOOD_PASSWORD,
    displayName: 'Gng. Santos',
  });
  const old = await t.registerUser({
    email: 'old@example.test',
    password: 'lumang-password-na-ito-3',
    displayName: 'Maria (old)',
  });
  const push = (token: string, mutations: unknown[]) =>
    t.ok('sync.push', { token, body: { deviceId: 'device-0001', mutations: mutations as never } });
  const upsert = (entity: string, data: { id: string }, n: number) => ({
    mutationId: `mutation-merge-${n}`,
    entity,
    id: data.id,
    op: 'upsert',
    baseRev: 0,
    data,
  });
  const plan = parseRecordData('plan', {
    id: 'plan-old-0001',
    templateId: 'tpl.dlp.v1',
    language: 'fil',
    grades: ['4'],
    durationMinutes: 50,
    title: 'Lumang aralin',
  });
  await push(old.token, [
    upsert('plan', plan, 1),
    upsert(
      'plan_section',
      parseRecordData('plan_section', {
        id: 'sec-old-0001',
        planId: plan.id,
        key: 'content',
        content: {
          type: 'text',
          blocks: [{ t: 'p', spans: [{ text: 'Mula sa lumang account' }] }],
        },
      }),
      2
    ),
    upsert(
      'day_note',
      parseRecordData('day_note', {
        id: 'note-old-0001',
        classId: 'class-0001',
        date: '2026-11-16',
        text: 'tala',
      }),
      3
    ),
    upsert(
      'day_note',
      parseRecordData('day_note', {
        id: 'note-old-0002',
        classId: 'class-0001',
        date: '2026-11-17',
        text: 'buburahin',
      }),
      4
    ),
  ]);
  await push(old.token, [
    {
      mutationId: 'mutation-merge-5',
      entity: 'day_note',
      id: 'note-old-0002',
      op: 'delete',
      baseRev: 1,
    },
  ]);
  await push(main.token, [
    upsert(
      'day_note',
      parseRecordData('day_note', {
        id: 'note-main-0001',
        classId: 'class-0009',
        date: '2026-11-16',
        text: 'sa pangunahing account',
      }),
      6
    ),
  ]);
  const cursor = (await t.ok('sync.pull', { token: main.token })).cursor;

  // Control of the other account has to be shown.
  assert.equal(
    (
      await post(
        t,
        'account.merge',
        { confirm: 'MERGE', currentPassword: GOOD_PASSWORD },
        { token: main.token }
      )
    ).status,
    400
  );
  assert.equal(
    (
      await post(
        t,
        'account.merge',
        { confirm: 'YES', email: 'old@example.test', password: 'lumang-password-na-ito-3' },
        { token: main.token }
      )
    ).status,
    400
  );
  const unproven = await post(
    t,
    'account.merge',
    {
      confirm: 'MERGE',
      currentPassword: GOOD_PASSWORD,
      email: 'old@example.test',
      password: 'not-the-password-1',
    },
    { token: main.token }
  );
  assert.equal(unproven.status, 403);
  assert.equal(unproven.reason, 'other_account_not_proven');
  assert.equal(
    (
      await post(
        t,
        'account.merge',
        {
          confirm: 'MERGE',
          currentPassword: GOOD_PASSWORD,
          email: 'nobody@example.test',
          password: 'whatever-it-is-12',
        },
        { token: main.token }
      )
    ).reason,
    'other_account_not_proven'
  );
  assert.equal(
    (
      await post(
        t,
        'account.merge',
        {
          confirm: 'MERGE',
          currentPassword: GOOD_PASSWORD,
          email: 'main@example.test',
          password: GOOD_PASSWORD,
        },
        { token: main.token }
      )
    ).reason,
    'same_account'
  );
  assert.equal((await t.call('auth.me', { token: old.token })).ok, true);

  // …and so does control of the signed-in account: a borrowed, signed-in phone is not enough.
  const borrowed = await post(
    t,
    'account.merge',
    { confirm: 'MERGE', email: 'old@example.test', password: 'lumang-password-na-ito-3' },
    { token: main.token }
  );
  assert.equal(borrowed.status, 403);
  assert.equal(borrowed.reason, 'wrong_password');
  assert.equal((await t.call('auth.me', { token: old.token })).ok, true);

  const merged = await post(
    t,
    'account.merge',
    {
      confirm: 'MERGE',
      currentPassword: GOOD_PASSWORD,
      email: 'old@example.test',
      password: 'lumang-password-na-ito-3',
    },
    { token: main.token }
  );
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
  assert.equal(
    merged.json.movedRecords,
    3,
    'the plan, its part and the live note; not the deleted note, not the second profile'
  );
  assert.equal((merged.json.user as { id: string }).id, main.id);

  // The surviving account's devices receive the moved records on their next pull.
  const pulled = await t.ok('sync.pull', { token: main.token, query: { cursor } });
  assert.deepEqual(pulled.records.map((r) => r.id).sort(), [
    'note-old-0001',
    'plan-old-0001',
    'sec-old-0001',
  ]);
  assert.equal(
    t.services.records.get(main.id, 'profile', 'profile')?.data.displayName,
    'Gng. Santos',
    'her own profile stays'
  );
  assert.equal(
    (await t.ok('plans.revisions', { token: main.token, params: { planId: plan.id } })).revisions
      .length,
    1,
    'plan history came along'
  );

  // The other account is gone; its device is told it was joined (not deleted), and the address is free again.
  const gone = await t.call('sync.pull', { token: old.token });
  assert.equal(gone.status, 401);
  assert.deepEqual(gone.error?.details, { reason: 'account_merged' });
  assert.equal(
    (
      await t.call('auth.login', {
        body: { email: 'old@example.test', password: 'lumang-password-na-ito-3' },
      })
    ).status,
    401
  );
  assert.ok(!JSON.stringify(t.db.prepare('SELECT * FROM core_records').all()).includes(old.id));

  // A Google-only account is proven with Google, and its Google link moves to the account that has none.
  const googleOnly = await t.ok('auth.google', { body: { idToken: google.token(JOSE) } });
  await push(googleOnly.token, [
    upsert(
      'day_note',
      parseRecordData('day_note', {
        id: 'note-g-0001',
        classId: 'class-0001',
        date: '2026-11-16',
        text: 'mula sa Google account',
      }),
      7
    ),
  ]);
  const second = await post(
    t,
    'account.merge',
    { confirm: 'MERGE', currentPassword: GOOD_PASSWORD, idToken: google.token(JOSE) },
    { token: main.token }
  );
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal((second.json.user as { hasGoogle: boolean }).hasGoogle, true);
  assert.equal(
    (await t.ok('auth.google', { body: { idToken: google.token(JOSE) } })).user.id,
    main.id
  );
  assert.equal((t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n, 1);
  t.close();
});

test('a merge waits for every module that keeps per-teacher rows, and is all-or-nothing', async () => {
  const calls: string[] = [];
  let fail = false;
  const mover: ExtendedModule = {
    name: 'mover',
    migrations: [
      {
        id: 'mover:001_init',
        sql: 'CREATE TABLE mover_posts (id TEXT PRIMARY KEY, author_id TEXT NOT NULL) STRICT;',
      },
    ],
    handlers: {},
    onAccountDeleted: (deps, userId) =>
      void deps.db.prepare('DELETE FROM mover_posts WHERE author_id = ?').run(userId),
    onAccountMerged: (deps, from, to) => {
      deps.db.prepare('UPDATE mover_posts SET author_id = ? WHERE author_id = ?').run(to, from);
      calls.push(`${from}->${to}`);
      if (fail) throw new Error('module could not move its rows');
    },
  };
  const keeper: ExtendedModule = {
    name: 'keeper',
    migrations: [],
    handlers: {},
    onAccountDeleted: () => {},
  };

  // A module with rows it cannot hand over: no merge, rather than orphaning or deleting them.
  const blocked = server({ modules: [mover, keeper] });
  const a = await blocked.t.registerUser({ email: 'a@example.test', password: GOOD_PASSWORD });
  await blocked.t.registerUser({ email: 'b@example.test', password: GOOD_PASSWORD });
  const refused = await post(
    blocked.t,
    'account.merge',
    {
      confirm: 'MERGE',
      currentPassword: GOOD_PASSWORD,
      email: 'b@example.test',
      password: GOOD_PASSWORD,
    },
    { token: a.token }
  );
  assert.equal(refused.status, 503);
  assert.deepEqual(refused.json.error?.details, {
    reason: 'merge_not_available',
    modules: ['keeper'],
  });
  assert.equal(
    (blocked.t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n,
    2
  );
  blocked.t.close();

  const { t } = server({ modules: [mover], quiet: true });
  const main = await t.registerUser({ email: 'a@example.test', password: GOOD_PASSWORD });
  const other = await t.registerUser({ email: 'b@example.test', password: GOOD_PASSWORD });
  t.db.prepare('INSERT INTO mover_posts (id, author_id) VALUES (?, ?)').run('post-1', other.id);
  t.services.records.put(
    other.id,
    'day_note',
    parseRecordData('day_note', {
      id: 'note-b-0001',
      classId: 'class-0001',
      date: '2026-11-16',
      text: 'x',
    })
  );

  fail = true;
  assert.equal(
    (
      await post(
        t,
        'account.merge',
        {
          confirm: 'MERGE',
          currentPassword: GOOD_PASSWORD,
          email: 'b@example.test',
          password: GOOD_PASSWORD,
        },
        { token: main.token }
      )
    ).status,
    500
  );
  assert.equal((await t.call('auth.me', { token: other.token })).ok, true, 'nothing was merged');
  assert.equal(
    (t.db.prepare('SELECT author_id FROM mover_posts').get() as { author_id: string }).author_id,
    other.id
  );
  assert.ok(t.services.records.get(other.id, 'day_note', 'note-b-0001'));

  fail = false;
  assert.equal(
    (
      await post(
        t,
        'account.merge',
        {
          confirm: 'MERGE',
          currentPassword: GOOD_PASSWORD,
          email: 'b@example.test',
          password: GOOD_PASSWORD,
        },
        { token: main.token }
      )
    ).status,
    200
  );
  assert.equal(
    (t.db.prepare('SELECT author_id FROM mover_posts').get() as { author_id: string }).author_id,
    main.id
  );
  assert.deepEqual(calls, [`${other.id}->${main.id}`, `${other.id}->${main.id}`]);
  t.close();
});

test('a Google-only account can still be deleted, and its Google identity is then free again', async () => {
  const { t, google } = server();
  const first = await t.ok('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.equal(
    (await t.call('account.delete', { token: first.token, body: { confirm: 'DELETE' } })).ok,
    true
  );
  assert.deepEqual(identityRows(t), []);
  const again = await t.ok('auth.google', { body: { idToken: google.token(MARIA) } });
  assert.notEqual(again.user.id, first.user.id);
  t.close();
});

test('with Google sign-in switched off, every route that needs Google says so plainly and Google is never contacted', async () => {
  const { t, google } = server({ config: { features: { googleSignIn: false } } });
  const teacher = await t.registerUser({ email: MARIA.email, password: GOOD_PASSWORD });
  const other = await t.registerUser({ email: JOSE.email, password: GOOD_PASSWORD });
  const idToken = google.token(MARIA);
  const usersBefore = (t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number })
    .n;

  const notAvailable = async (
    res: {
      status: number;
      json: { error?: { code: string; message: string; details?: Record<string, unknown> } };
      cookie: string | null;
    },
    what: string
  ) => {
    assert.equal(res.status, 501, what);
    assert.equal(res.json.error?.code, 'not_implemented', what);
    assert.deepEqual(res.json.error?.details, { reason: 'google_sign_in_not_available' }, what);
    assert.match(
      res.json.error!.message,
      /email and password/,
      `${what}: the message points to what still works`
    );
    assert.equal(res.cookie, null, what);
  };

  const signIn = await t.call('auth.google', { body: { idToken } });
  await notAvailable(
    {
      status: signIn.status,
      json: { error: (signIn.error ?? undefined) as never },
      cookie: signIn.headers.get('set-cookie'),
    },
    'auth.google'
  );
  await notAvailable(
    await post(t, 'auth.googleLink', { idToken, password: GOOD_PASSWORD }),
    'auth.googleLink'
  );
  await notAvailable(
    await post(t, 'auth.googleLinkRequest', { idToken }),
    'auth.googleLinkRequest'
  );
  await notAvailable(
    await post(t, 'auth.googleLinkConfirm', { token: 'C'.repeat(43) }),
    'auth.googleLinkConfirm'
  );
  await notAvailable(
    await post(
      t,
      'auth.googleConnect',
      { idToken, password: GOOD_PASSWORD },
      { token: teacher.token }
    ),
    'auth.googleConnect'
  );
  // Joining accounts by a Google proof needs Google too.
  await notAvailable(
    await post(
      t,
      'account.merge',
      { confirm: 'MERGE', currentPassword: GOOD_PASSWORD, idToken: google.token(JOSE) },
      { token: teacher.token }
    ),
    'account.merge by Google'
  );

  // Removing the password must not be possible while Google is off: an account left with only its Google
  // link could not be opened at all. (Here a link exists from a time when Google sign-in was on.)
  t.db
    .prepare(
      'INSERT INTO core_identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run('google', MARIA.sub, teacher.id, MARIA.email, t.clock.now().toISOString());
  await notAvailable(
    await post(
      t,
      'auth.removePassword',
      { currentPassword: GOOD_PASSWORD },
      { token: teacher.token }
    ),
    'auth.removePassword'
  );
  assert.equal(
    (await t.ok('auth.login', { body: { email: MARIA.email, password: GOOD_PASSWORD } })).user
      .hasPassword,
    true
  );

  // Disconnecting only ever takes a way in away from an account that keeps its password, so it stays possible.
  const disconnected = await post(
    t,
    'auth.googleDisconnect',
    { password: GOOD_PASSWORD },
    { token: teacher.token }
  );
  assert.equal(disconnected.status, 200);
  assert.equal((disconnected.json.user as { hasGoogle: boolean }).hasGoogle, false);

  // Routes that need a signed-in teacher still ask for one first.
  for (const route of [
    'auth.googleConnect',
    'auth.googleDisconnect',
    'auth.removePassword',
    'account.merge',
  ] as const) {
    assert.equal(
      (
        await post(t, route, {
          idToken,
          password: GOOD_PASSWORD,
          currentPassword: GOOD_PASSWORD,
          confirm: 'MERGE',
        })
      ).status,
      401,
      route
    );
  }

  // Nothing was created, linked or signed in, and nothing was sent to Google or by mail.
  assert.equal(
    (t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n,
    usersBefore
  );
  assert.deepEqual(identityRows(t), []);
  assert.equal(google.fetches, 0, 'Google’s key endpoint was never called');
  assert.equal(t.outbox().filter((m) => m.template === 'link_google').length, 0);
  assert.equal((await t.call('auth.me', { token: other.token })).ok, true);
  assert.deepEqual(t.errors, []);
  t.close();
});

test('on the real module registry, merging waits for exactly the modules that cannot hand their rows over yet', async () => {
  const { modules: registry } = await import('../index');
  type Hooks = {
    name: string;
    onAccountDeleted?: unknown;
    onAccountMerged?: unknown;
    kernel?: { onAccountDeleted?: unknown; onAccountMerged?: unknown };
  };
  const expected = (registry as Hooks[])
    .filter(
      (m) =>
        m.name !== 'core' &&
        (m.onAccountDeleted ?? m.kernel?.onAccountDeleted) &&
        !(m.onAccountMerged ?? m.kernel?.onAccountMerged)
    )
    .map((m) => m.name);
  const { t } = server({ modules: registry.filter((m) => m.name !== 'core') });
  const main = await t.registerUser({ email: 'a@example.test', password: GOOD_PASSWORD });
  await t.registerUser({ email: 'b@example.test', password: GOOD_PASSWORD });
  const res = await post(
    t,
    'account.merge',
    {
      confirm: 'MERGE',
      currentPassword: GOOD_PASSWORD,
      email: 'b@example.test',
      password: GOOD_PASSWORD,
    },
    { token: main.token }
  );
  if (expected.length === 0) {
    assert.equal(res.status, 200, 'every module can hand its rows over, so the merge goes through');
  } else {
    // As modules gain onAccountMerged this list shrinks by itself; when it is empty the branch above applies.
    assert.equal(res.status, 503);
    assert.deepEqual(res.json.error?.details, { reason: 'merge_not_available', modules: expected });
    assert.equal(
      (t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n,
      2,
      'nothing was merged'
    );
  }
  t.close();
});
