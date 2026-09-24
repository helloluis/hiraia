import assert from 'node:assert/strict';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  b64urlDecode,
  b64urlEncode,
  manualAad,
  manualProof,
  manualResponseKey,
  manualSecret,
} from '../src/tala/manual.ts';
import { applyAck, sanitizeEvent, sanitizeProfile, TEACHER_EVENTS } from '../src/tala/protocol.ts';
import { parseTeacherQr, QrError, sameBinding } from '../src/tala/qr.ts';
import {
  TeacherQueue,
  type ClassKey,
  type LeaveTombstone,
  type ScopedBinding,
  type TeacherStore,
} from '../src/tala/queue.ts';
import type { TeacherEvent } from '../src/tala/protocol.ts';
import { GUEST_SCOPE, eventScope, wireId } from '../src/tala/scope.ts';
import { HINTED_ENDPOINT_PREFIX, classHint } from '../src/tala/sessionCore.ts';

function rsaQr(classId = randomUUID(), class_name?: unknown) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const public_key = der.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payload: Record<string, unknown> = { v: 1, kind: 'hiraia-tala', class_id: classId, public_key };
  if (class_name !== undefined) payload.class_name = class_name;
  return { text: JSON.stringify(payload), classId, public_key };
}

/** In-memory double of the per-student store; tools/pilot-telemetry tests the real SQLite one. */
function memoryStore(installationId = 'installation-12345678'): TeacherStore & {
  queued: { scope: string; event: TeacherEvent }[];
  /** What the 0.4.23 migration keeps of the phone-wide class. */
  upgradedFrom(c: ClassKey): void;
} {
  const bound = new Map<string, ScopedBinding>();
  const queued: { scope: string; event: TeacherEvent }[] = [];
  const sent = new Set<string>();
  let tombstones: LeaveTombstone[] = [];
  let legacy: ClassKey | undefined;
  const dropScope = (scope: string) => {
    for (let i = queued.length - 1; i >= 0; i--)
      if (queued[i]!.scope === scope) queued.splice(i, 1);
  };
  return {
    queued,
    async bindings() {
      return [...bound.values()];
    },
    async binding(scope) {
      return bound.get(scope) ?? null;
    },
    async bind(scope, next) {
      const prev = bound.get(scope);
      if (prev?.class_id !== next.class_id || prev?.public_key !== next.public_key) {
        dropScope(scope);
        bound.set(scope, {
          scope,
          class_id: next.class_id,
          public_key: next.public_key,
          class_name: next.class_name ?? '',
          bound_at: next.bound_at,
          last_sync: 0,
          dropped: 0,
        });
      } else prev.bound_at = next.bound_at;
      const wire = wireId(scope, installationId);
      tombstones = tombstones.filter((t) => t.class_id !== next.class_id || t.wire_id !== wire);
    },
    async unbind(scope) {
      const prev = bound.get(scope);
      dropScope(scope);
      bound.delete(scope);
      if (prev)
        tombstones.push({
          class_id: prev.class_id,
          public_key: prev.public_key,
          wire_id: wireId(scope, installationId),
          left_at: Date.now(),
        });
    },
    async leaves() {
      return tombstones;
    },
    async clearLeaves(classId, wireIds) {
      tombstones = tombstones.filter((t) => t.class_id !== classId || !wireIds.includes(t.wire_id));
    },
    async setClassName(expected, name) {
      for (const b of bound.values())
        if (b.class_id === expected.class_id && b.public_key === expected.public_key)
          b.class_name = name;
    },
    async teacherAppend(rows) {
      for (const event of rows) {
        const scope = eventScope(event.props);
        const b = bound.get(scope);
        if (b && !sent.has(`${b.class_id} ${event.id}`)) queued.push({ scope, event });
      }
    },
    async teacherList(expected, scopes, limit) {
      const live = scopes.filter(
        (s) =>
          bound.get(s)?.class_id === expected.class_id &&
          bound.get(s)?.public_key === expected.public_key
      );
      return queued
        .filter((q) => live.includes(q.scope))
        .slice(0, limit)
        .map((q) => q.event);
    },
    async teacherAcknowledge(ids, expected, lost = []) {
      for (const id of ids) sent.add(`${expected.class_id} ${id}`);
      for (let i = queued.length - 1; i >= 0; i--) {
        const b = bound.get(queued[i]!.scope);
        if (!ids.includes(queued[i]!.event.id) || b?.class_id !== expected.class_id) continue;
        if (lost.includes(queued[i]!.event.id)) b.dropped += 1;
        queued.splice(i, 1);
      }
    },
    async setLastSync(scopes, time) {
      for (const s of scopes) {
        const b = bound.get(s);
        if (b) b.last_sync = time;
      }
    },
    async rejoinNotice() {
      return 0;
    },
    upgradedFrom(c) {
      legacy = c;
    },
    async settleLegacyClass(profileIds) {
      if (!legacy) return;
      for (const scope of new Set([...profileIds, GUEST_SCOPE]))
        if (bound.get(scope)?.class_id !== legacy.class_id)
          tombstones.push({ ...legacy, wire_id: wireId(scope, installationId), left_at: 1 });
      legacy = undefined;
    },
  };
}

const ANA = 'student-profile-1234';
const BEN = 'student-profile-5678';
const cardFor = (id: string, profile_id?: string): TeacherEvent => ({
  id,
  name: 'card_viewed',
  occurred_at: 1_700_000_000_000,
  session_id: 'session-id-12345678',
  props: profile_id ? { profile_kind: 'student', profile_id } : { profile_kind: 'guest' },
});

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

test('teacher queue is independent of mothership ACK and resets when the student changes class', async () => {
  const store = memoryStore();
  const q = new TeacherQueue(store, () => 1_700_000_000_000);
  const event = cardFor('card-viewed-12345678', ANA);
  const first = { class_id: randomUUID(), public_key: 'k', bound_at: 1 };
  await q.enqueue([event]);
  assert.equal((await q.pending(first, [ANA], 10)).length, 0);
  await q.bind(ANA, first);
  await q.enqueue([event]);
  assert.equal((await q.pending(first, [ANA], 10)).length, 1);
  await q.ack(['card-viewed-12345678'], [], first);
  assert.equal((await q.pending(first, [ANA], 10)).length, 0);
  const second = { class_id: randomUUID(), public_key: 'k2', bound_at: 2 };
  await q.bind(ANA, second);
  assert.equal((await q.pending(second, [ANA], 10)).length, 0);
});

test('leaving clears only that student’s unsent events and leaves a tombstone', async () => {
  const store = memoryStore();
  const q = new TeacherQueue(store, Date.now);
  const binding = { class_id: randomUUID(), public_key: 'k', bound_at: 1 };
  await q.bind(ANA, binding);
  await q.bind(BEN, binding);
  await q.enqueue([cardFor('quiz-graded-ana-1234', ANA), cardFor('quiz-graded-ben-1234', BEN)]);
  await q.unbind(ANA);
  assert.equal(await q.binding(ANA), null);
  assert.deepEqual(
    (await q.pending(binding, [ANA, BEN], 10)).map((e) => e.id),
    ['quiz-graded-ben-1234']
  );
  assert.deepEqual(
    (await q.leaves()).map((t) => [t.class_id, t.wire_id]),
    [[binding.class_id, ANA]]
  );
});

test('each event joins its own student’s queue; unbound students send nothing', async () => {
  const store = memoryStore();
  const q = new TeacherQueue(store, Date.now);
  const x = { class_id: randomUUID(), public_key: 'kx', bound_at: 1 };
  const y = { class_id: randomUUID(), public_key: 'ky', bound_at: 1 };
  await q.bind(ANA, x);
  await q.bind('guest', y);
  await q.enqueue([
    cardFor('card-viewed-ana-1234', ANA),
    cardFor('card-viewed-ben-1234', BEN),
    cardFor('card-viewed-guest-123'),
  ]);
  assert.deepEqual(
    (await q.pending(x, [ANA], 10)).map((e) => e.id),
    ['card-viewed-ana-1234']
  );
  assert.deepEqual(
    (await q.pending(y, ['guest'], 10)).map((e) => e.id),
    ['card-viewed-guest-123']
  );
  assert.equal(store.queued.length, 2, 'Ben is in no class');
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
  const q = new TeacherQueue(store, Date.now);
  const classId = randomUUID();
  await q.bind(ANA, { class_id: classId, public_key: 'k', bound_at: 1 });
  await q.enqueue([cardFor('card-viewed-keep-me-1', ANA)]);
  await q.bind(ANA, { class_id: classId, public_key: 'k', bound_at: 2 });
  assert.equal((await q.pending({ class_id: classId, public_key: 'k' }, [ANA], 10)).length, 1);
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

// class_name is advisory and was added after the first teacher builds shipped, so the
// student must accept a QR with it, without it, and with rubbish in it.
test('class QR without class_name still parses (older teacher build)', () => {
  const qr = rsaQr();
  const parsed = parseTeacherQr(qr.text);
  assert.equal(parsed.class_id, qr.classId);
  assert.equal(parsed.class_name, undefined);
});

test('class_name is trimmed, collapsed and capped at 48', () => {
  assert.equal(parseTeacherQr(rsaQr(undefined, '  Grade 5 -   Mabini  ').text).class_name,
    'Grade 5 - Mabini');
  assert.equal(parseTeacherQr(rsaQr(undefined, 'x'.repeat(200)).text).class_name!.length, 48);
});

test('a hostile or non-string class_name never rejects a valid QR', () => {
  const ctl = `A${String.fromCharCode(0)}${String.fromCharCode(31)}B`;
  assert.equal(parseTeacherQr(rsaQr(undefined, ctl).text).class_name, 'A B');
  assert.equal(parseTeacherQr(rsaQr(undefined, 42).text).class_name, undefined);
  assert.equal(parseTeacherQr(rsaQr(undefined, '   ').text).class_name, undefined);
});

test('renaming a class does not make it a different binding', () => {
  const qr = rsaQr(undefined, 'Grade 5 - Mabini');
  const parsed = parseTeacherQr(qr.text);
  assert.equal(sameBinding(parsed, { class_id: qr.classId, public_key: qr.public_key }), true);
});

// ---- nearby.ts in a simulated classroom ----------------------------------------------------
// The real nearby.ts (sessions, typed codes, retries, bursts) runs on a virtual clock against
// simulated Talas. Nearby is modelled as one teacher connection at a time; each Tala reads only
// intros sealed for its own class key, checks a typed code with the real HMAC scheme, and drops
// a phone it refuses. Only react-native, the native module and the profile store are stand-ins.

const mockDir = mkdtempSync(path.join(tmpdir(), 'tala-classroom-'));
process.on('exit', () => rmSync(mockDir, { recursive: true, force: true }));
const mockSources: Record<string, string> = {
  'react-native': `exports.AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
exports.PermissionsAndroid = {
  PERMISSIONS: { ACCESS_FINE_LOCATION: 'location', BLUETOOTH_SCAN: 'scan',
    BLUETOOTH_CONNECT: 'connect', BLUETOOTH_ADVERTISE: 'advertise', NEARBY_WIFI_DEVICES: 'wifi' },
  RESULTS: { GRANTED: 'granted' },
  requestMultiple: async (list) => Object.fromEntries(list.map((p) => [p, 'granted'])),
};
exports.Platform = { OS: 'android', Version: 34 };`,
  'hiraia-tala': `exports.talaNative = () => globalThis.__classroom.native;
exports.subscribeTala = (fn) => globalThis.__classroom.subscribe(fn);`,
  profiles: `exports.profileScope = () => globalThis.__classroom.profiles.activeId;
exports.profileSnapshot = () => globalThis.__classroom.profiles;`,
};
const mockUrls: Record<string, string> = {};
for (const [name, source] of Object.entries(mockSources)) {
  const file = path.join(mockDir, `${name}.cjs`);
  writeFileSync(file, source);
  mockUrls[name] = pathToFileURL(file).href;
}
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react-native' || specifier === 'hiraia-tala')
      return { url: mockUrls[specifier]!, shortCircuit: true };
    if (specifier === '../profiles' && context.parentURL?.includes('/src/tala/'))
      return { url: mockUrls.profiles!, shortCircuit: true };
    return next(specifier, context);
  },
});

const nodeCrypto = {
  sha256: (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest()),
  hmacSha256: (key: Uint8Array, message: Uint8Array) =>
    new Uint8Array(createHmac('sha256', key).update(message).digest()),
};
const hintedName = async (classId: string) =>
  HINTED_ENDPOINT_PREFIX + (await classHint(classId, nodeCrypto.sha256));
const b64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64url');

type SimTeacher = {
  id: string;
  /** "Hiraia Tala" is Tala 0.4.3; "Hiraia Tala 2 <hint>" is 0.4.4, which also sends caps. */
  name: string;
  /** The class key this Tala holds: it can read only intros sealed for it. */
  key: string;
  /** When discovery reports it, in ms after the radios go on. */
  foundAt: number;
  /** The typed code its screen shows, and the class QR a correct code releases. */
  code?: string;
  qr?: string;
  /** Out of range: every connection request fails. */
  unreachable?: boolean;
  replyMs?: number;
};
type Timer = { at: number; fn: (...args: unknown[]) => void; args: unknown[] };

class Classroom {
  now = 0;
  log: string[] = [];
  /** Every intro and batch a Tala could read. */
  received: { teacher: string; type: string; profiles: string[]; left: string[] }[] = [];
  /** Delays of the automatic next looks (10 minutes or more). */
  retries: number[] = [];
  private timers = new Map<number, Timer>();
  private seq = 0;
  private listener?: (e: Record<string, string>) => void;
  private discovering = false;
  private generation = 0;
  private connected: string | null = null;
  private challenges = new Map<string, string>();

  constructor(private teachers: SimTeacher[]) {}

  setTimeout = (fn: (...args: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + Math.max(0, Number(ms) || 0), fn, args });
    if (ms >= 10 * 60_000) this.retries.push(ms);
    return id;
  };
  clearTimeout = (id?: number) => {
    if (id !== undefined) this.timers.delete(id);
  };

  /** Run the clock forward, letting every promise chain settle between timers. */
  async advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      await settle();
      let next: [number, Timer] | undefined;
      for (const entry of this.timers)
        if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      next[1].fn(...next[1].args);
    }
    this.now = end;
    await settle();
  }

  subscribe(fn: (e: Record<string, string>) => void) {
    this.listener = fn;
    return () => {
      if (this.listener === fn) this.listener = undefined;
    };
  }

  lose(endpointId: string) {
    this.emit({ kind: 'lost', endpointId });
  }

  /** Nearby finds a teacher it had lost again. */
  find(endpointId: string) {
    const t = this.teacher(endpointId);
    if (this.discovering && t) this.emit({ kind: 'found', endpointId, name: t.name });
  }

  private emit(e: Record<string, string>) {
    this.listener?.(e);
  }

  private teacher(id: string) {
    return this.teachers.find((t) => t.id === id);
  }

  private refuse(t: SimTeacher, why: string) {
    this.log.push(`${t.id} ${why}`);
    this.connected = null;
    this.setTimeout(
      () => this.emit({ kind: 'connection', endpointId: t.id, status: 'disconnected' }),
      5
    );
    return true;
  }

  private reply(t: SimTeacher, message: object, ms = 5) {
    const challenge = this.challenges.get(t.id);
    this.setTimeout(() => {
      if (this.connected !== t.id || this.challenges.get(t.id) !== challenge) return;
      this.emit({ kind: 'bytes', endpointId: t.id, json: JSON.stringify(message) });
    }, ms);
  }

  native = {
    playServicesOk: () => true,
    connectivityStatus: () => ({
      bluetoothSupported: true,
      bluetoothOn: true,
      wifiSupported: true,
      wifiOn: true,
    }),
    requestBluetoothEnable: () => false,
    openWifiSettings: () => false,
    randomBytes: async (n: number) => b64(randomBytes(n)),
    sha256: async (input: string) =>
      createHash('sha256').update(Buffer.from(input, 'base64url')).digest('base64url'),
    hmacSha256: async (key: string, message: string) =>
      createHmac('sha256', Buffer.from(key, 'base64url'))
        .update(Buffer.from(message, 'base64url'))
        .digest('base64url'),
    decryptAesGcm: async (key: string, nonce: string, aad: string, ciphertext: string) => {
      const raw = Buffer.from(ciphertext, 'base64url');
      const decipher = createDecipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'base64url'),
        Buffer.from(nonce, 'base64url')
      );
      decipher.setAAD(Buffer.from(aad, 'base64url'));
      decipher.setAuthTag(raw.subarray(raw.length - 16));
      return Buffer.concat([
        decipher.update(raw.subarray(0, raw.length - 16)),
        decipher.final(),
      ]).toString('utf8');
    },
    // Sealing is modelled, not performed: an envelope names the class key it was sealed for.
    encryptRequest: async (publicKey: string, _challenge: string, plaintext: string) => ({
      wrapped_key: publicKey,
      nonce: 'nonce',
      ciphertext: b64(plaintext),
      session_key: `session-${publicKey}`,
    }),
    decryptResponse: async (_key: string, _challenge: string, _nonce: string, text: string) =>
      Buffer.from(text, 'base64url').toString('utf8'),
    startDiscovery: async () => {
      this.discovering = true;
      const generation = ++this.generation;
      this.log.push('radios on');
      for (const t of this.teachers)
        this.setTimeout(() => {
          if (this.discovering && this.generation === generation)
            this.emit({ kind: 'found', endpointId: t.id, name: t.name });
        }, t.foundAt);
      return true;
    },
    requestConnection: async (endpointId: string) => {
      const t = this.teacher(endpointId);
      if (!this.discovering || !t) throw new Error('STATUS_ENDPOINT_UNKNOWN');
      if (t.unreachable) {
        this.log.push(`${t.id} unreachable`);
        throw new Error('STATUS_ENDPOINT_IO_ERROR');
      }
      if (this.connected && this.connected !== t.id) {
        this.log.push(`${t.id} busy`);
        throw new Error('STATUS_ALREADY_CONNECTED_TO_ENDPOINT');
      }
      this.connected = t.id;
      const challenge = `challenge-${++this.seq}`;
      this.challenges.set(t.id, challenge);
      this.log.push(`${t.id} connected`);
      this.setTimeout(() => {
        if (this.connected !== t.id || this.challenges.get(t.id) !== challenge) return;
        this.emit({ kind: 'connection', endpointId: t.id, status: 'connected' });
        this.emit({
          kind: 'bytes',
          endpointId: t.id,
          json: JSON.stringify({ v: 1, type: 'challenge', challenge }),
        });
      }, 10);
      return true;
    },
    send: async (endpointId: string, json: string) => {
      const t = this.teacher(endpointId)!;
      if (this.connected !== t.id) throw new Error('not connected');
      const msg = JSON.parse(json);
      const challenge = this.challenges.get(t.id)!;
      if (msg.type === 'manual_enroll') {
        const nonce = b64urlDecode(msg.client_nonce);
        const secret = await manualSecret(t.code ?? '', nodeCrypto);
        const proof = await manualProof(secret, challenge, nonce, nodeCrypto);
        if (!t.code || b64urlEncode(proof) !== msg.proof) return this.refuse(t, 'refused the code');
        const key = await manualResponseKey(secret, challenge, nonce, nodeCrypto);
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
        cipher.setAAD(Buffer.from(manualAad(challenge, nonce)));
        const sealed = Buffer.concat([cipher.update(t.qr!, 'utf8'), cipher.final()]);
        this.log.push(`${t.id} took the code`);
        this.reply(t, {
          v: 1,
          type: 'manual_key',
          nonce: b64(iv),
          ciphertext: b64(Buffer.concat([sealed, cipher.getAuthTag()])),
        });
        return true;
      }
      if (msg.wrapped_key !== t.key) return this.refuse(t, `could not read a ${msg.type}`);
      const inner = JSON.parse(Buffer.from(msg.ciphertext, 'base64url').toString('utf8'));
      this.received.push({
        teacher: t.id,
        type: msg.type,
        profiles: inner.profiles.map((p: { name: string }) => p.name),
        left: inner.left_profiles ?? [],
      });
      const hinted = t.name.startsWith(HINTED_ENDPOINT_PREFIX);
      const body = {
        challenge,
        accepted: inner.events.map((e: { id: string }) => e.id),
        rejected: [],
        ...(hinted ? { class_name: 'Grade 5', caps: ['left_profiles'] } : {}),
      };
      this.reply(
        t,
        {
          v: 1,
          type: msg.type === 'intro' ? 'ready' : 'ack',
          nonce: 'n',
          ciphertext: b64(JSON.stringify(body)),
        },
        t.replyMs
      );
      return true;
    },
    disconnect: async (endpointId: string) => {
      if (this.connected === endpointId) this.connected = null;
      this.log.push(`released ${endpointId}`);
    },
    stop: async () => {
      this.discovering = false;
      this.connected = null;
      this.log.push('radios off');
    },
  };
}

async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));
}

const nearbyFile = fileURLToPath(new URL('../src/tala/nearby.ts', import.meta.url));
let classrooms = 0;
type Nearby = typeof import('../src/tala/nearby.ts');

/** A fresh nearby.ts (its state is per module) in a classroom with these teachers. */
async function inClassroom(
  setup: {
    teachers: SimTeacher[];
    profiles: { id: string; name: string }[];
    activeId: string;
    store: ReturnType<typeof memoryStore>;
  },
  play: (room: Classroom, nearby: Nearby) => Promise<void>
) {
  const room = new Classroom(setup.teachers);
  const saved = { setTimeout, clearTimeout, random: Math.random };
  (globalThis as any).__classroom = {
    native: room.native,
    subscribe: (fn: (e: Record<string, string>) => void) => room.subscribe(fn),
    profiles: {
      ready: true,
      activeId: setup.activeId,
      profiles: setup.profiles.map((p) => ({ ...p, createdAt: 1 })),
    },
  };
  delete createRequire(import.meta.url).cache[nearbyFile];
  (globalThis as any).setTimeout = room.setTimeout;
  (globalThis as any).clearTimeout = room.clearTimeout;
  // Every connection jitter is 2.5 s and every retry 12.5 minutes: runs are reproducible.
  Math.random = () => 0.5;
  try {
    const nearby: Nearby = await import(`${nearbyFile}?classroom=${++classrooms}`);
    const stop = await nearby.initTala({
      store: setup.store,
      installationId: 'installation-12345678',
      enabled: true,
    });
    await play(room, nearby);
    stop();
    await room.advance(0);
  } finally {
    globalThis.setTimeout = saved.setTimeout;
    globalThis.clearTimeout = saved.clearTimeout;
    Math.random = saved.random;
  }
}

const CODE = 'ABCDEFGHJKMN';

test('a typed code waits for its teacher when a neighbour’s Tala is found first', async () => {
  const a = rsaQr(undefined, 'Grade 5 Mabini');
  const store = memoryStore();
  await inClassroom(
    {
      teachers: [
        {
          id: 'TX',
          name: await hintedName(randomUUID()),
          key: 'key-x',
          code: 'PQRSTUVWXYZ2',
          foundAt: 100,
        },
        {
          id: 'TA',
          name: await hintedName(a.classId),
          key: a.public_key,
          code: CODE,
          qr: a.text,
          foundAt: 8_000,
        },
      ],
      profiles: [{ id: ANA, name: 'Ana' }],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await nearby.enrollCode('ABCD-EFGH-JKMN', async () => true);
      await room.advance(30_000);
      assert.ok(room.log.includes('TX refused the code'), room.log.join('\n'));
      assert.ok(room.log.includes('TA took the code'), room.log.join('\n'));
      assert.equal((await store.binding(ANA))?.class_id, a.classId);
      assert.deepEqual(room.received[0], {
        teacher: 'TA',
        type: 'intro',
        profiles: ['Ana'],
        left: [],
      });
      const ui = nearby.talaSnapshot();
      assert.deepEqual([ui.state, ui.bound], ['synced', true]);
    }
  );
});

test('a typed code no teacher in range takes expires, with a message, when the burst ends', async () => {
  const store = memoryStore();
  await inClassroom(
    {
      teachers: [{ id: 'TX', name: 'Hiraia Tala', key: 'key-x', foundAt: 100 }],
      profiles: [{ id: ANA, name: 'Ana' }],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await nearby.enrollCode(CODE, async () => true);
      await room.advance(10_000);
      assert.ok(room.log.includes('TX refused the code'));
      assert.equal(nearby.talaSnapshot().state, 'searching', 'the right teacher may still turn up');
      await room.advance(90_000);
      assert.equal(room.log.at(-1), 'radios off');
      const ui = nearby.talaSnapshot();
      assert.deepEqual([ui.state, ui.detail, ui.bound], ['error', 'code', false]);
    }
  );
});

test('an unreachable teacher does not hold a typed code for the whole burst', async () => {
  const a = rsaQr();
  const store = memoryStore();
  await inClassroom(
    {
      teachers: [
        {
          id: 'TX',
          name: await hintedName(randomUUID()),
          key: 'key-x',
          unreachable: true,
          foundAt: 100,
        },
        {
          id: 'TA',
          name: await hintedName(a.classId),
          key: a.public_key,
          code: CODE,
          qr: a.text,
          foundAt: 1_000,
        },
      ],
      profiles: [{ id: ANA, name: 'Ana' }],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await nearby.enrollCode(CODE, async () => true);
      await room.advance(30_000);
      assert.equal(room.log.filter((l) => l === 'TX unreachable').length, 2, 'one retry, then on');
      assert.equal((await store.binding(ANA))?.class_id, a.classId);
      assert.equal(nearby.talaSnapshot().state, 'synced');
    }
  );
});

test('a teacher Nearby loses stops holding a typed code at once', async () => {
  const a = rsaQr();
  const store = memoryStore();
  await inClassroom(
    {
      teachers: [
        {
          id: 'TX',
          name: await hintedName(randomUUID()),
          key: 'key-x',
          unreachable: true,
          foundAt: 100,
        },
        {
          id: 'TA',
          name: await hintedName(a.classId),
          key: a.public_key,
          code: CODE,
          qr: a.text,
          foundAt: 10_000,
        },
      ],
      profiles: [{ id: ANA, name: 'Ana' }],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await nearby.enrollCode(CODE, async () => true);
      await room.advance(1_500);
      room.lose('TX');
      await room.advance(30_000);
      assert.ok(!room.log.includes('TX unreachable'), 'the dropped attempt never went out');
      assert.equal((await store.binding(ANA))?.class_id, a.classId);
    }
  );
});

test('a teacher lost before the typed code reached it is asked when Nearby finds it again', async () => {
  const a = rsaQr();
  const store = memoryStore();
  await inClassroom(
    {
      teachers: [
        {
          id: 'TA',
          name: await hintedName(a.classId),
          key: a.public_key,
          code: CODE,
          qr: a.text,
          foundAt: 100,
        },
      ],
      profiles: [{ id: ANA, name: 'Ana' }],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await nearby.enrollCode(CODE, async () => true);
      // Lost during the connection jitter: the code never reached it.
      await room.advance(500);
      room.lose('TA');
      await room.advance(4_500);
      room.find('TA');
      await room.advance(30_000);
      assert.equal((await store.binding(ANA))?.class_id, a.classId);
    }
  );
});

test('a typed code keeps waiting for its teacher while a sibling’s sync holds the radio', async () => {
  const a = rsaQr();
  const B = { class_id: randomUUID(), public_key: 'key-b', bound_at: 1 };
  const store = memoryStore();
  await store.bind(BEN, B);
  await store.teacherAppend(
    Array.from({ length: 1_000 }, (_, i) => cardFor(`ben-card-${String(i).padStart(10, '0')}`, BEN))
  );
  await inClassroom(
    {
      teachers: [
        {
          id: 'TB',
          name: await hintedName(B.class_id),
          key: B.public_key,
          foundAt: 50,
          replyMs: 1_000,
        },
        {
          id: 'TA',
          name: await hintedName(a.classId),
          key: a.public_key,
          code: CODE,
          qr: a.text,
          foundAt: 6_000,
        },
      ],
      profiles: [
        { id: ANA, name: 'Ana' },
        { id: BEN, name: 'Ben' },
      ],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await nearby.enrollCode(CODE, async () => true);
      await room.advance(60_000);
      assert.ok(room.log.filter((l) => l === 'TA busy').length >= 2, room.log.join('\n'));
      assert.equal((await store.binding(ANA))?.class_id, a.classId, 'contention is not a refusal');
      assert.ok((await store.binding(BEN))!.last_sync > 0);
    }
  );
});

test('a typed code that only unreachable teachers were asked for still says it expired', async () => {
  const store = memoryStore();
  await inClassroom(
    {
      teachers: [{ id: 'TX', name: 'Hiraia Tala', key: 'key-x', unreachable: true, foundAt: 100 }],
      profiles: [{ id: ANA, name: 'Ana' }],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await nearby.enrollCode(CODE, async () => true);
      await room.advance(100_000);
      assert.ok(room.log.filter((l) => l === 'TX unreachable').length <= 2);
      const ui = nearby.talaSnapshot();
      assert.deepEqual([ui.state, ui.detail], ['error', 'code']);
    }
  );
});

test('a legacy teacher whose first class synced elsewhere meanwhile is offered its own class', async () => {
  // Ana (on screen) is in A, whose teacher runs Tala 0.4.4; Ben is in B, whose teacher still
  // runs 0.4.3 and is tried with Ana's class first. A syncs while that connection is set up.
  const A = { class_id: randomUUID(), public_key: 'key-a', bound_at: 1 };
  const B = { class_id: randomUUID(), public_key: 'key-b', bound_at: 1 };
  const store = memoryStore();
  await store.bind(ANA, A);
  await store.bind(BEN, B);
  await inClassroom(
    {
      teachers: [
        { id: 'TA', name: await hintedName(A.class_id), key: A.public_key, foundAt: 1 },
        { id: 'TB', name: 'Hiraia Tala', key: B.public_key, foundAt: 100 },
      ],
      profiles: [
        { id: ANA, name: 'Ana' },
        { id: BEN, name: 'Ben' },
      ],
      activeId: ANA,
      store,
    },
    async (room) => {
      await room.advance(10_000);
      assert.ok(!room.log.some((l) => l.startsWith('TB could not read')), room.log.join('\n'));
      assert.deepEqual(
        room.received.filter((r) => r.type === 'intro').map((r) => [r.teacher, r.profiles]),
        [
          ['TA', ['Ana']],
          ['TB', ['Ben']],
        ]
      );
      assert.ok((await store.binding(BEN))!.last_sync > 0, 'Ben’s class synced this burst');
      assert.equal(room.log.at(-1), 'radios off', 'and the burst ended early');
    }
  );
});

test('after a typed code joins a class, a legacy teacher waiting on it gets its own class', async () => {
  const a = rsaQr();
  const B = { class_id: randomUUID(), public_key: 'key-b', bound_at: 1 };
  const store = memoryStore();
  await store.bind(BEN, B);
  await inClassroom(
    {
      teachers: [
        { id: 'TB', name: 'Hiraia Tala', key: B.public_key, foundAt: 50 },
        {
          id: 'TA',
          name: await hintedName(a.classId),
          key: a.public_key,
          code: CODE,
          qr: a.text,
          foundAt: 100,
        },
      ],
      profiles: [
        { id: ANA, name: 'Ana' },
        { id: BEN, name: 'Ben' },
      ],
      activeId: ANA,
      store,
    },
    async (room, nearby) => {
      await room.advance(1);
      // The code is typed while Ben's own sync is still waiting for its teacher.
      await nearby.enrollCode(CODE, async () => true);
      await room.advance(30_000);
      assert.equal((await store.binding(ANA))?.class_id, a.classId);
      assert.ok(!room.log.some((l) => l.startsWith('TB could not read')), room.log.join('\n'));
      assert.ok((await store.binding(BEN))!.last_sync > 0, 'Ben’s class synced too');
    }
  );
});

test('a long history that outlasts a burst does not push the phone into the 30-minute rest', async () => {
  const A = { class_id: randomUUID(), public_key: 'key-a', bound_at: 1 };
  const store = memoryStore();
  await store.bind(ANA, A);
  await store.teacherAppend(
    Array.from({ length: 5_000 }, (_, i) =>
      cardFor(`history-card-${String(i).padStart(8, '0')}`, ANA)
    )
  );
  await inClassroom(
    {
      // A busy teacher phone: three seconds per batch of 50, so ~1,400 events per 90 s burst.
      teachers: [
        {
          id: 'TA',
          name: await hintedName(A.class_id),
          key: A.public_key,
          foundAt: 1,
          replyMs: 3_000,
        },
      ],
      profiles: [{ id: ANA, name: 'Ana' }],
      activeId: ANA,
      store,
    },
    async (room) => {
      await room.advance(75 * 60_000);
      assert.equal(store.queued.length, 0, 'the whole history arrived');
      assert.ok(room.log.filter((l) => l === 'radios on').length >= 4, 'over several bursts');
      assert.ok(room.retries.length >= 4);
      assert.ok(
        room.retries.every((ms) => ms < 30 * 60_000),
        `retries ${room.retries.map((ms) => ms / 60_000).join(', ')} min`
      );
    }
  );
});

test('0.4.23 upgrade: the old class hears who left, on the first sync with its Tala 0.4.4', async () => {
  const X = { class_id: randomUUID(), public_key: 'key-x', bound_at: 1 };
  const store = memoryStore();
  store.upgradedFrom(X);
  // Ana re-joined the old class; Ben and the phone's Guest did not.
  await store.bind(ANA, X);
  await inClassroom(
    {
      teachers: [{ id: 'TX', name: await hintedName(X.class_id), key: X.public_key, foundAt: 1 }],
      profiles: [
        { id: ANA, name: 'Ana' },
        { id: BEN, name: 'Ben' },
      ],
      activeId: ANA,
      store,
    },
    async (room) => {
      await room.advance(10_000);
      const intro = room.received.find((r) => r.type === 'intro')!;
      assert.deepEqual(intro.profiles, ['Ana']);
      assert.deepEqual([...intro.left].sort(), ['installation-12345678', BEN].sort());
      assert.deepEqual(await store.leaves(), [], 'Tala 0.4.4 said it honours them');
    }
  );
});
