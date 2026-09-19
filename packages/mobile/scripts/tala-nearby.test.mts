import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { applyAck, sanitizeEvent, sanitizeProfile, TEACHER_EVENTS } from '../src/tala/protocol.ts';
import { parseTeacherQr, QrError, sameBinding } from '../src/tala/qr.ts';
import { TeacherQueue, type Binding, type TeacherStore } from '../src/tala/queue.ts';
import type { TeacherEvent } from '../src/tala/protocol.ts';

function rsaQr(classId = randomUUID()) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const public_key = der.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return {
    text: JSON.stringify({ v: 1, kind: 'hiraia-tala', class_id: classId, public_key }),
    classId,
    public_key,
  };
}

function memoryStore(): TeacherStore & { events: TeacherEvent[] } {
  let bound: Binding | null = null;
  const events: TeacherEvent[] = [];
  let dropped = 0;
  let lastSync = 0;
  let status = '';
  return {
    events,
    async binding() {
      return bound;
    },
    async bind(next) {
      bound = next;
    },
    async unbind() {
      bound = null;
      events.length = 0;
    },
    async teacherAppend(rows) {
      if (!bound) return;
      events.push(...rows);
    },
    async teacherList(limit) {
      return events.slice(0, limit);
    },
    async teacherAcknowledge(ids) {
      const drop = new Set(ids);
      for (let i = events.length - 1; i >= 0; i--) if (drop.has(events[i]!.id)) events.splice(i, 1);
    },
    async markLost(n) {
      dropped += n;
    },
    async lost() {
      return dropped;
    },
    async lastSync() {
      return lastSync;
    },
    async setLastSync(t) {
      lastSync = t;
    },
    async status() {
      return status;
    },
    async setStatus(v) {
      status = v;
    },
  };
}

test('validates a Tala QR and rejects junk', () => {
  const qr = rsaQr();
  const parsed = parseTeacherQr(qr.text);
  assert.equal(parsed.class_id, qr.classId);
  assert.equal(parsed.public_key, qr.public_key);
  assert.throws(() => parseTeacherQr('https://example.com'), QrError);
  assert.throws(() => parseTeacherQr('{"v":2,"kind":"hiraia-tala"}'), QrError);
  assert.throws(
    () => parseTeacherQr(JSON.stringify({ v: 1, kind: 'hiraia-tala', class_id: 'nope', public_key: qr.public_key })),
    QrError
  );
  assert.throws(
    () =>
      parseTeacherQr(
        JSON.stringify({ v: 1, kind: 'hiraia-tala', class_id: qr.classId, public_key: 'not_base64_!!' })
      ),
    QrError
  );
});

test('same teacher QR is idempotent; different teacher is a rebind', () => {
  const a = rsaQr();
  const b = rsaQr();
  const pa = parseTeacherQr(a.text);
  assert.equal(sameBinding(pa, parseTeacherQr(a.text)), true);
  assert.equal(sameBinding(pa, parseTeacherQr(b.text)), false);
});

test('ACK validation deletes accepted and rejected, retries the rest', () => {
  const challenge = 'abc';
  const sent = ['event-id-1234567890', 'event-id-abcdefghij', 'event-id-klmnopqrst'];
  const ok = applyAck(
    sent,
    { challenge, accepted: ['event-id-1234567890'], rejected: ['event-id-abcdefghij'] },
    challenge
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.deepEqual(ok.done.sort(), ['event-id-1234567890', 'event-id-abcdefghij'].sort());
    assert.deepEqual(ok.retry, ['event-id-klmnopqrst']);
    assert.deepEqual(ok.lost, ['event-id-abcdefghij']);
  }
  assert.equal(applyAck(sent, { challenge: 'nope', accepted: [], rejected: [] }, challenge).ok, false);
  assert.equal(
    applyAck(sent, { challenge, accepted: ['unknown-id-1234567890'], rejected: [] }, challenge).ok,
    false
  );
});

test('empty check-in ACK is valid', () => {
  const r = applyAck([], { challenge: 'c', accepted: [], rejected: [] }, 'c');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.done, []);
    assert.deepEqual(r.retry, []);
  }
});

test('teacher queue is independent of mothership ACK and clears on unbind', async () => {
  const store = memoryStore();
  const q = new TeacherQueue(store, () => 1_700_000_000_000, () => 'new-id-1234567890ab');
  const event: TeacherEvent = {
    id: 'card-viewed-12345678',
    name: 'card_viewed',
    occurred_at: 1_700_000_000_000,
    session_id: 'session-id-12345678',
    props: { profile_kind: 'student', profile_id: 'student-profile-1234' },
  };
  await q.enqueue([event]);
  assert.equal((await q.pending(10)).length, 0);
  await q.bind({ class_id: randomUUID(), public_key: 'k', bound_at: 1 });
  await q.enqueue([event]);
  assert.equal((await q.pending(10)).length, 1);
  await q.ack(['card-viewed-12345678'], []);
  assert.equal((await q.pending(10)).length, 0);
  await q.bind({ class_id: randomUUID(), public_key: 'k2', bound_at: 2 });
  assert.equal((await q.pending(10)).length, 0);
});

test('opt-out path: unbind clears unsent teacher events', async () => {
  const store = memoryStore();
  const q = new TeacherQueue(store, Date.now, () => 'new-id-1234567890ab');
  await q.bind({ class_id: randomUUID(), public_key: 'k', bound_at: 1 });
  await q.enqueue([
    {
      id: 'quiz-graded-12345678',
      name: 'quiz_graded',
      occurred_at: Date.now(),
      session_id: 'session-id-12345678',
      props: { profile_kind: 'student', profile_id: 'student-profile-1234', correct: true },
    },
  ]);
  await q.unbind();
  assert.equal(await q.binding(), null);
  assert.equal((await q.pending(10)).length, 0);
});

test('unknown event names are not queued; profiles must match Tala limits', () => {
  assert.equal(
    sanitizeEvent({
      id: 'x'.repeat(16),
      name: 'secret_typed',
      occurred_at: Date.now(),
      session_id: 's'.repeat(16),
      props: {},
    }),
    null
  );
  assert.ok(TEACHER_EVENTS.has('card_viewed'));
  assert.equal(sanitizeProfile({ id: 'short', name: 'Ana' }), null);
  assert.ok(sanitizeProfile({ id: 'student-profile-1234', name: 'Ana' }));
});

test('re-binding the same teacher keeps the outbox', async () => {
  const store = memoryStore();
  const q = new TeacherQueue(store, Date.now, () => 'new-id-1234567890ab');
  const classId = randomUUID();
  await q.bind({ class_id: classId, public_key: 'k', bound_at: 1 });
  await q.enqueue([
    {
      id: 'card-viewed-keep-me-1',
      name: 'card_viewed',
      occurred_at: Date.now(),
      session_id: 'session-id-12345678',
      props: { profile_kind: 'student', profile_id: 'student-profile-1234' },
    },
  ]);
  await q.bind({ class_id: classId, public_key: 'k', bound_at: 2 });
  assert.equal((await q.pending(10)).length, 1);
});

test('multiple profiles stay distinct on the wire', () => {
  const a = sanitizeProfile({ id: 'student-profile-aaaa', name: 'One' });
  const b = sanitizeProfile({ id: 'student-profile-bbbb', name: 'Two' });
  assert.ok(a && b && a.id !== b.id);
});

test('auto-sync schedules a 10–15 minute retry, then backs off after three missed bursts', async () => {
  const {
    dueForSearch,
    restDelay,
    retryDelay,
    RETRY_MIN_MS,
    RETRY_MAX_MS,
    BACKOFF_MS,
    MISSES_BEFORE_BACKOFF,
    REST_MS,
  } = await import('../src/tala/schedule.ts');
  const now = 1_800_000_000_000;
  assert.equal(dueForSearch(0, now), true);
  assert.equal(dueForSearch(now - REST_MS, now), true);
  assert.equal(dueForSearch(now - 60_000, now), false);
  assert.equal(restDelay(now - 60_000, now), REST_MS - 60_000);
  assert.equal(restDelay(0, now), 0);
  assert.equal(retryDelay(0, () => 0), RETRY_MIN_MS);
  assert.equal(retryDelay(0, () => 1), RETRY_MAX_MS);
  assert.equal(retryDelay(MISSES_BEFORE_BACKOFF), BACKOFF_MS);
});

test('typed class code normalizes and rejects ambiguous glyphs', async () => {
  const { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } = await import(
    'node:crypto'
  );
  const {
    normalizeCode,
    formatCode,
    MANUAL_ALPHABET,
    manualSecret,
    manualProof,
    manualResponseKey,
    manualAad,
    b64urlEncode,
    b64urlDecode,
  } = await import('../src/tala/manual.ts');
  assert.equal(normalizeCode('ab2d-efgh-jk3m'), 'AB2DEFGHJK3M');
  assert.equal(formatCode('ab2defghjk3m'), 'AB2D-EFGH-JK3M');
  assert.equal(normalizeCode('AB01-EFGH-JKLM'), null);
  assert.ok(![...'01ILO'].some((c) => MANUAL_ALPHABET.includes(c)));

  const crypto = {
    sha256: (bytes: Uint8Array) =>
      new Uint8Array(createHash('sha256').update(Buffer.from(bytes)).digest()),
    hmacSha256: (key: Uint8Array, message: Uint8Array) =>
      new Uint8Array(createHmac('sha256', Buffer.from(key)).update(Buffer.from(message)).digest()),
  };
  const code = 'AB2DEFGHJK3M';
  const challenge = 'challenge-from-tala-test-24b';
  const clientNonce = new Uint8Array(randomBytes(16));
  const secret = await manualSecret(code, crypto);
  const proof = await manualProof(secret, challenge, clientNonce, crypto);
  const key = await manualResponseKey(secret, challenge, clientNonce, crypto);
  const aad = manualAad(challenge, clientNonce);
  const qr = rsaQr();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), nonce);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(qr.text, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key), nonce);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
  const plain = Buffer.concat([
    decipher.update(encrypted.subarray(0, encrypted.length - 16)),
    decipher.final(),
  ]).toString('utf8');
  assert.equal(plain, qr.text);
  assert.equal(parseTeacherQr(plain).class_id, qr.classId);
  assert.equal(b64urlDecode(b64urlEncode(proof)).length, 32);
  assert.equal(proof.length, 32);
  assert.equal(key.length, 32);
});
