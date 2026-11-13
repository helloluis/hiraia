import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ClientConfig } from '@hiraia/tala-core';
import { createTestServer, tokenFromMail } from '../../testing';
import { hashToken } from './accounts';
import { checkPasswordPolicy, createPasswordHasher, DEFAULT_ARGON2_COST, isCommonPassword, TEST_ARGON2_COST } from './passwords';
import { delayAfter, FREE_FAILURES } from './rate-limit';

const GOOD_PASSWORD = 'kalabaw-bituin-ilog-27';

test('sign-up returns a session that works as a bearer token and as a cookie', async () => {
  const t = createTestServer();
  const res = await t.call('auth.register', { body: { email: 'Maria.Santos@Example.test', password: GOOD_PASSWORD, displayName: '  Maria   Santos ' } });
  assert.equal(res.ok, true);
  assert.equal(res.data!.user.email, 'Maria.Santos@Example.test');
  assert.equal(res.data!.user.displayName, 'Maria Santos');
  assert.equal(res.data!.user.emailVerified, false);
  assert.equal(res.data!.user.hasPassword, true);
  assert.equal(res.data!.user.hasGoogle, false);

  const cookie = res.headers.get('set-cookie')!;
  assert.match(cookie, /^tala_session=[A-Za-z0-9_-]{43}; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax$/);
  // 90 days, sliding: comfortably more than the 30 offline days OFF-5 asks for.
  assert.equal(new Date(res.data!.expiresAt).getTime() - t.clock.now().getTime(), 90 * 86_400_000);

  const viaBearer = await t.call('auth.me', { token: res.data!.token });
  const viaCookie = await t.call('auth.me', { cookie: `tala_session=${res.data!.token}` });
  assert.equal(viaBearer.data!.user.id, res.data!.user.id);
  assert.equal(viaCookie.data!.user.id, res.data!.user.id);

  // A malformed Authorization header does not quietly fall back to the cookie.
  const confused = await t.call('auth.me', { cookie: `tala_session=${res.data!.token}`, headers: { authorization: 'Bearer' } });
  assert.equal(confused.status, 401);
  const unknown = await t.call('auth.me', { token: 'A'.repeat(43) });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.error?.details, { reason: 'unknown' });
  t.close();
});

test('https origins get a Secure, __Host- prefixed cookie', async () => {
  const t = createTestServer({ config: { publicOrigin: 'https://tala.hiraia.org', session: { cookieName: '__Host-tala_session' } } });
  const res = await t.call('auth.register', { body: { email: 'a@example.test', password: GOOD_PASSWORD, displayName: 'A' } });
  assert.match(res.headers.get('set-cookie')!, /^__Host-tala_session=[A-Za-z0-9_-]{43}; Max-Age=\d+; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
  t.close();
});

test('one account per email, whatever the capitals', async () => {
  const t = createTestServer();
  await t.registerUser({ email: 'maria@example.test' });
  const again = await t.call('auth.register', { body: { email: ' MARIA@example.test'.trim(), password: GOOD_PASSWORD, displayName: 'Another Maria' } });
  assert.equal(again.status, 409);
  assert.equal(again.error?.code, 'conflict');
  assert.deepEqual(again.error?.details, { reason: 'email_taken' });
  assert.equal((t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n, 1);
  t.close();
});

test('password policy: length, common passwords, the account’s own details, trivial patterns; no composition rules', async () => {
  assert.equal(checkPasswordPolicy('short-one'), 'too_short');
  assert.equal(checkPasswordPolicy('password123'), 'too_common');
  assert.equal(checkPasswordPolicy('PASSWORD123'), 'too_common');
  assert.equal(checkPasswordPolicy('qwertyuiop'), 'too_common');
  assert.equal(checkPasswordPolicy('aaaaaaaaaaaa'), 'too_simple');
  assert.equal(checkPasswordPolicy('abcdefghijkl'), 'too_simple');
  assert.equal(checkPasswordPolicy('teacherlonglocal', { email: 'TeacherLongLocal@example.test' }), 'matches_account');
  assert.equal(checkPasswordPolicy('maria santos', { displayName: 'Maria Santos' }), 'matches_account');
  // Long, all lower case, no digits or symbols: fine. Composition is not required.
  assert.equal(checkPasswordPolicy('tatlong bibe nakita ko'), null);
  assert.equal(isCommonPassword('Iloveyou12'), true);

  const t = createTestServer();
  const common = await t.call('auth.register', { body: { email: 'b@example.test', password: 'password123', displayName: 'B' } });
  assert.equal(common.status, 400);
  assert.deepEqual(common.error?.details, { reason: 'password_too_common' });
  const short = await t.call('auth.register', { body: { email: 'b@example.test', password: 'too-short', displayName: 'B' } });
  assert.equal(short.status, 400);
  assert.equal((short.error?.details as { issues: Array<{ path: string }> }).issues[0]?.path, 'body.password');
  const blankName = await t.call('auth.register', { body: { email: 'b@example.test', password: GOOD_PASSWORD, displayName: '   ' } });
  assert.deepEqual(blankName.error?.details, { reason: 'display_name_empty' });
  assert.equal((t.db.prepare('SELECT count(*) AS n FROM core_users').get() as { n: number }).n, 0);
  t.close();
});

test('passwords are stored as Argon2id hashes; tokens only as SHA-256', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ password: GOOD_PASSWORD });
  const row = t.db.prepare('SELECT password_hash FROM core_users WHERE id = ?').get(u.id) as { password_hash: string };
  assert.match(row.password_hash, /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
  const session = t.db.prepare('SELECT token_hash FROM core_sessions WHERE user_id = ?').get(u.id) as { token_hash: string };
  assert.equal(session.token_hash, hashToken(u.token));

  // Nothing in the database holds the token or the password themselves.
  const tables = (t.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>).map((r) => r.name);
  const dump = tables.filter((n) => n !== 'core_mail_outbox').map((n) => JSON.stringify(t.db.prepare(`SELECT * FROM ${n}`).all())).join('\n');
  assert.ok(!dump.includes(u.token));
  assert.ok(!dump.includes(GOOD_PASSWORD));

  // The production cost is OWASP's Argon2id baseline; a hash made with a weaker cost is upgraded at sign-in.
  assert.deepEqual(DEFAULT_ARGON2_COST, { memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  const strong = createPasswordHasher(DEFAULT_ARGON2_COST);
  const weakHash = await createPasswordHasher(TEST_ARGON2_COST).hash(GOOD_PASSWORD);
  assert.equal(strong.needsRehash(weakHash), true);
  assert.equal(strong.needsRehash(await strong.hash(GOOD_PASSWORD)), false);
  assert.equal(await strong.verify('not-a-hash', GOOD_PASSWORD), false);
  t.close();
});

test('sign-in: a wrong password and an unknown email are indistinguishable', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ email: 'known@example.test', password: GOOD_PASSWORD });
  const wrongPassword = await t.call('auth.login', { body: { email: 'known@example.test', password: 'not-the-password-1' } });
  const unknownEmail = await t.call('auth.login', { body: { email: 'nobody@example.test', password: 'not-the-password-1' } });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.deepEqual(wrongPassword.error, unknownEmail.error);
  assert.deepEqual(wrongPassword.error?.details, { reason: 'invalid_credentials' });
  assert.equal(wrongPassword.headers.get('set-cookie'), null);

  const good = await t.call('auth.login', { body: { email: 'KNOWN@example.test', password: GOOD_PASSWORD, deviceLabel: 'School laptop' } });
  assert.equal(good.ok, true);
  assert.equal(good.data!.user.id, u.id);
  assert.notEqual(good.data!.token, u.token);
  t.close();
});

test('sessions are listed per device and can be ended one at a time or all at once', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ email: 'm@example.test', password: GOOD_PASSWORD, deviceLabel: 'Phone' });
  t.clock.advance({ minutes: 5 });
  const laptop = await t.ok('auth.login', { body: { email: 'm@example.test', password: GOOD_PASSWORD, deviceLabel: 'School laptop' } });
  const browser = await t.ok('auth.login', { body: { email: 'm@example.test', password: GOOD_PASSWORD }, headers: { 'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) Mobile Safari/537.36' } });

  const list = await t.ok('auth.sessions', { token: laptop.token });
  assert.deepEqual(list.sessions.map((s) => [s.deviceLabel, s.current]).sort(), [
    ['Android phone', false],
    ['Phone', false],
    ['School laptop', true],
  ]);

  const other = await t.registerUser();
  const phoneSession = list.sessions.find((s) => s.deviceLabel === 'Phone')!;
  // Another teacher cannot end it, and cannot tell that it exists.
  const foreign = await t.call('auth.revokeSession', { params: { sessionId: phoneSession.id }, token: other.token });
  const missing = await t.call('auth.revokeSession', { params: { sessionId: 'no-such-session' }, token: other.token });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.error, missing.error);
  assert.equal((await t.call('auth.me', { token: u.token })).ok, true);

  assert.equal((await t.call('auth.revokeSession', { params: { sessionId: phoneSession.id }, token: laptop.token })).ok, true);
  const revoked = await t.call('auth.me', { token: u.token });
  assert.equal(revoked.status, 401);
  assert.deepEqual(revoked.error?.details, { reason: 'revoked' });

  const out = await t.call('auth.logout', { cookie: `tala_session=${browser.token}` });
  assert.match(out.headers.get('set-cookie')!, /^tala_session=; Max-Age=0; /);
  assert.equal((await t.call('auth.me', { token: browser.token })).status, 401);
  assert.equal((await t.call('auth.me', { token: laptop.token })).ok, true);

  await t.ok('auth.logoutAll', { token: laptop.token });
  assert.equal((await t.call('auth.me', { token: laptop.token })).status, 401);
  assert.equal((await t.ok('auth.sessions', { token: other.token })).sessions.length, 1);
  t.close();
});

test('a session survives 30 days offline, slides when used, and ends after long disuse', async () => {
  const t = createTestServer();
  const u = await t.registerUser();
  t.clock.advance({ days: 31 });
  assert.equal((await t.call('auth.me', { token: u.token })).ok, true, 'still signed in after a month offline (OFF-5)');
  t.clock.advance({ days: 80 });
  assert.equal((await t.call('auth.me', { token: u.token })).ok, true, 'using it on day 31 moved the expiry');
  t.clock.advance({ days: 91 });
  const expired = await t.call('auth.me', { token: u.token });
  assert.equal(expired.status, 401);
  assert.deepEqual(expired.error?.details, { reason: 'expired' });
  t.close();
});

test('email verification: single-use link, 48 hours, newest link wins, token travels in the URL fragment', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ email: 'v@example.test', verified: false, uiLanguage: 'en' });
  assert.equal(u.user.emailVerified, false);
  const mail = t.outbox()[0]!;
  assert.equal(mail.to, 'v@example.test');
  assert.equal(mail.template, 'verify_email');
  assert.equal(mail.lang, 'en');
  assert.match(mail.vars.link!, /^http:\/\/tala\.test\/verify-email#token=[A-Za-z0-9_-]{43}$/);
  const firstToken = tokenFromMail(mail)!;

  // Asking again sends a new link and retires the old one.
  await t.ok('auth.sendVerification', { token: u.token });
  const secondToken = t.mailToken('v@example.test', 'verify_email')!;
  assert.notEqual(secondToken, firstToken);
  const stale = await t.call('auth.verifyEmail', { body: { token: firstToken } });
  assert.equal(stale.status, 400);
  assert.deepEqual(stale.error?.details, { reason: 'link_invalid_or_expired' });

  assert.equal((await t.call('auth.verifyEmail', { body: { token: secondToken } })).ok, true);
  assert.equal((await t.ok('auth.me', { token: u.token })).user.emailVerified, true);
  const reused = await t.call('auth.verifyEmail', { body: { token: secondToken } });
  assert.deepEqual(reused.error, stale.error);
  const garbage = await t.call('auth.verifyEmail', { body: { token: 'B'.repeat(43) } });
  assert.deepEqual(garbage.error, stale.error);

  // Already verified: nothing more is sent.
  const before = t.outbox().length;
  await t.ok('auth.sendVerification', { token: u.token });
  assert.equal(t.outbox().length, before);

  const late = await t.registerUser({ email: 'late@example.test', verified: false });
  t.clock.advance({ hours: 49 });
  assert.equal((await t.call('auth.verifyEmail', { body: { token: t.mailToken('late@example.test', 'verify_email')! } })).status, 400);
  assert.equal((await t.ok('auth.me', { token: late.token })).user.emailVerified, false);

  // No more than five verification mails an hour.
  for (let i = 0; i < 5; i++) assert.equal((await t.call('auth.sendVerification', { token: late.token })).ok, true);
  assert.equal((await t.call('auth.sendVerification', { token: late.token })).status, 429);
  t.close();
});

test('password reset: same answer for every email, single-use 30-minute link, old sessions end', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ email: 'r@example.test', password: GOOD_PASSWORD, verified: false });
  const mailsBefore = t.outbox().length;

  const known = await t.call('auth.requestReset', { body: { email: 'R@example.test' } });
  const unknown = await t.call('auth.requestReset', { body: { email: 'nobody@example.test' } });
  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.deepEqual(known.data, unknown.data);
  assert.equal(t.outbox().length, mailsBefore + 1, 'only the real account gets mail');
  const mail = t.outbox()[0]!;
  assert.equal(mail.template, 'password_reset');
  assert.match(mail.vars.link!, /^http:\/\/tala\.test\/reset-password#token=/);
  const token = tokenFromMail(mail)!;

  // A weak new password is refused without using up the link.
  const weak = await t.call('auth.reset', { body: { token, password: 'password123' } });
  assert.deepEqual(weak.error?.details, { reason: 'password_too_common' });

  const NEW_PASSWORD = 'bagong-lihim-na-salita-9';
  assert.equal((await t.call('auth.reset', { body: { token, password: NEW_PASSWORD } })).ok, true);
  assert.equal((await t.call('auth.me', { token: u.token })).status, 401, 'sessions from before the reset are ended');
  assert.equal((await t.call('auth.login', { body: { email: 'r@example.test', password: GOOD_PASSWORD } })).status, 401);
  const signedIn = await t.ok('auth.login', { body: { email: 'r@example.test', password: NEW_PASSWORD } });
  assert.equal(signedIn.user.emailVerified, true, 'the link proved who holds the mailbox');

  const reused = await t.call('auth.reset', { body: { token, password: 'isa-pang-bagong-lihim-3' } });
  assert.equal(reused.status, 400);
  assert.deepEqual(reused.error?.details, { reason: 'link_invalid_or_expired' });

  await t.ok('auth.requestReset', { body: { email: 'r@example.test' } });
  const lateToken = t.mailToken('r@example.test', 'password_reset')!;
  t.clock.advance({ minutes: 31 });
  assert.deepEqual((await t.call('auth.reset', { body: { token: lateToken, password: 'isa-pang-bagong-lihim-3' } })).error, reused.error);

  // No more than three reset mails per account per hour, and the caller cannot tell when the cap is hit.
  t.clock.advance({ hours: 2 });
  const count = () => t.outbox().filter((m) => m.template === 'password_reset').length;
  const start = count();
  for (let i = 0; i < 5; i++) assert.deepEqual((await t.call('auth.requestReset', { body: { email: 'r@example.test' } })).data, { ok: true });
  assert.equal(count(), start + 3);
  t.close();
});

test('changing a password needs the current one and signs out the other devices', async () => {
  const t = createTestServer();
  const u = await t.registerUser({ email: 'c@example.test', password: GOOD_PASSWORD });
  const other = await t.ok('auth.login', { body: { email: 'c@example.test', password: GOOD_PASSWORD } });
  const NEW_PASSWORD = 'mas-mahabang-lihim-na-12';

  const wrong = await t.call('auth.changePassword', { token: u.token, body: { currentPassword: 'not-the-password-1', newPassword: NEW_PASSWORD } });
  assert.equal(wrong.status, 403);
  assert.deepEqual(wrong.error?.details, { reason: 'wrong_password' });
  const weak = await t.call('auth.changePassword', { token: u.token, body: { currentPassword: GOOD_PASSWORD, newPassword: 'qwertyuiop' } });
  assert.deepEqual(weak.error?.details, { reason: 'password_too_common' });

  assert.equal((await t.call('auth.changePassword', { token: u.token, body: { currentPassword: GOOD_PASSWORD, newPassword: NEW_PASSWORD } })).ok, true);
  assert.equal((await t.call('auth.me', { token: u.token })).ok, true, 'this device stays signed in');
  assert.equal((await t.call('auth.me', { token: other.token })).status, 401);
  assert.equal((await t.call('auth.login', { body: { email: 'c@example.test', password: NEW_PASSWORD } })).ok, true);
  t.close();
});

test('rate limits: sign-up and sign-in per address', async () => {
  const t = createTestServer({ config: { abuse: { registerPerIpPerHour: 2, loginPerIpPerMinute: 3 } } });
  const body = (n: number) => ({ email: `limit${n}@example.test`, password: GOOD_PASSWORD, displayName: `L ${n}` });
  assert.equal((await t.call('auth.register', { body: body(1), ip: '203.0.113.5' })).ok, true);
  assert.equal((await t.call('auth.register', { body: body(2), ip: '203.0.113.5' })).ok, true);
  const third = await t.call('auth.register', { body: body(3), ip: '203.0.113.5' });
  assert.equal(third.status, 429);
  assert.equal(third.error?.code, 'rate_limited');
  assert.equal((await t.call('auth.register', { body: body(3), ip: '203.0.113.6' })).ok, true, 'another address is unaffected');
  t.clock.advance({ hours: 1, seconds: 1 });
  assert.equal((await t.call('auth.register', { body: body(4), ip: '203.0.113.5' })).ok, true, 'the window passes');

  for (let i = 0; i < 3; i++) await t.call('auth.login', { body: { email: `other${i}@example.test`, password: 'x'.repeat(12) }, ip: '203.0.113.9' });
  assert.equal((await t.call('auth.login', { body: { email: 'limit1@example.test', password: GOOD_PASSWORD }, ip: '203.0.113.9' })).status, 429);
  assert.equal((await t.call('auth.login', { body: { email: 'limit1@example.test', password: GOOD_PASSWORD }, ip: '203.0.113.10' })).ok, true);
  t.close();
});

test('repeated wrong passwords meet a growing wait, the same for real and unknown emails', async () => {
  assert.deepEqual([4, 5, 6, 7, 12].map(delayAfter), [0, 30_000, 60_000, 120_000, 900_000]);
  const t = createTestServer();
  await t.registerUser({ email: 'slow@example.test', password: GOOD_PASSWORD });
  for (const email of ['slow@example.test', 'ghost@example.test']) {
    const ip = '198.51.100.20';
    for (let i = 0; i < FREE_FAILURES; i++) {
      assert.equal((await t.call('auth.login', { body: { email, password: 'wrong-password-00' }, ip })).status, 401);
    }
    const blocked = await t.call('auth.login', { body: { email, password: GOOD_PASSWORD }, ip });
    assert.equal(blocked.status, 429, email);
    assert.deepEqual(blocked.error?.details, { reason: 'rate_limited', retryAfterSeconds: 30 });
    assert.equal(blocked.headers.get('retry-after'), '30');
  }
  // The wait is per (email, address): the teacher's own connection is not locked out by someone else's guessing.
  assert.equal((await t.call('auth.login', { body: { email: 'slow@example.test', password: GOOD_PASSWORD }, ip: '198.51.100.99' })).ok, true);

  t.clock.advance({ seconds: 31 });
  assert.equal((await t.call('auth.login', { body: { email: 'slow@example.test', password: 'wrong-password-00' }, ip: '198.51.100.20' })).status, 401);
  const longer = await t.call('auth.login', { body: { email: 'slow@example.test', password: GOOD_PASSWORD }, ip: '198.51.100.20' });
  assert.deepEqual(longer.error?.details, { reason: 'rate_limited', retryAfterSeconds: 60 });
  t.clock.advance({ seconds: 61 });
  assert.equal((await t.call('auth.login', { body: { email: 'slow@example.test', password: GOOD_PASSWORD }, ip: '198.51.100.20' })).ok, true);
  // Success clears the count.
  assert.equal((await t.call('auth.login', { body: { email: 'slow@example.test', password: 'wrong-password-00' }, ip: '198.51.100.20' })).status, 401);
  assert.equal((await t.call('auth.login', { body: { email: 'slow@example.test', password: GOOD_PASSWORD }, ip: '198.51.100.20' })).ok, true);
  t.close();
});

test('Google sign-in is a later gate: the route answers not_implemented', async () => {
  const t = createTestServer();
  const res = await t.call('auth.google', { body: { idToken: 'x.y.z' } });
  assert.equal(res.status, 501);
  assert.equal(res.error?.code, 'not_implemented');
  t.close();
});

test('config.get is public and matches the contract', async () => {
  const t = createTestServer({ config: { limits: { pageSize: 10 }, minClientVersion: '1.2.3' } });
  const config = ClientConfig.parse(await t.ok('config.get'));
  assert.equal(config.environment, 'local');
  assert.equal(config.limits.pageSize, 10);
  assert.equal(config.minClientVersion, '1.2.3');
  assert.equal(config.features.googleSignIn, false);
  // No model module is loaded here, so nothing is routed anywhere.
  assert.equal(config.rosterLlmRoute, 'off');
  assert.deepEqual(config.offline, { windowWeeksBack: 4, windowWeeksAhead: 8 });
  t.close();
});

test('nothing secret or personal reaches the logs across a whole account lifecycle', async () => {
  const t = createTestServer();
  const email = 'private.person@example.test';
  const u = await t.registerUser({ email, password: GOOD_PASSWORD, displayName: 'Private Person', verified: false });
  const verifyToken = t.mailToken(email, 'verify_email')!;
  await t.ok('auth.verifyEmail', { body: { token: verifyToken } });
  await t.call('auth.login', { body: { email, password: 'wrong-password-00' } });
  const second = await t.ok('auth.login', { body: { email, password: GOOD_PASSWORD } });
  await t.ok('auth.requestReset', { body: { email } });
  const resetToken = t.mailToken(email, 'password_reset')!;
  const NEW_PASSWORD = 'ibang-lihim-na-salita-88';
  await t.ok('auth.reset', { body: { token: resetToken, password: NEW_PASSWORD } });
  const third = await t.ok('auth.login', { body: { email, password: NEW_PASSWORD } });
  await t.ok('auth.changePassword', { token: third.token, body: { currentPassword: NEW_PASSWORD, newPassword: 'pangatlong-lihim-na-77' } });
  await t.ok('auth.logout', { token: third.token });

  const text = JSON.stringify(t.logs);
  assert.ok(t.logs.length > 10);
  for (const secret of [u.token, second.token, third.token, verifyToken, resetToken, GOOD_PASSWORD, NEW_PASSWORD, 'pangatlong-lihim-na-77', email, 'Private Person', 'private.person']) {
    assert.ok(!text.includes(secret), `logs must not contain ${secret.slice(0, 6)}…`);
  }
  assert.ok(t.logs.some((l) => l.event === 'mail_queued_in_outbox'));
  assert.ok(t.logs.some((l) => l.event === 'account_created' && l.fields.userId === u.id));
  t.close();
});

test('when the client address is unknown, the shared limit is wide enough not to lock everyone out', async () => {
  const t = createTestServer({ config: { abuse: { registerPerIpPerHour: 2 } } });
  const body = (n: number) => ({ email: `shared${n}@example.test`, password: GOOD_PASSWORD, displayName: `S ${n}` });
  // No address at all (a proxy that is not configured as trusted): many more than 2 sign-ups still work…
  for (let n = 0; n < 12; n++) assert.equal((await t.call('auth.register', { body: body(n) })).ok, true, `sign-up ${n}`);
  // …while a known address is still held to the configured limit.
  assert.equal((await t.call('auth.register', { body: body(100), ip: '203.0.113.50' })).ok, true);
  assert.equal((await t.call('auth.register', { body: body(101), ip: '203.0.113.50' })).ok, true);
  assert.equal((await t.call('auth.register', { body: body(102), ip: '203.0.113.50' })).status, 429);
  t.close();
});
