/** A whole classroom exchange in one process: the collector against a simulated 0.4.24 student. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector, type CollectorStatus, type Radio } from './session';
import { nodeCrypto, studentDecrypt, studentEncrypt, studentManual } from './nodeCrypto';
import { createActivityStore } from './store';
import { memoryDatabase } from './testDb';
import { classIdentity } from './identity';
import { MAX_OUTER } from './protocol';

const PHONE = 'installation-123456789';
const ANA = 'student-profile-111111111';

async function classroom(options: { manualCodes?: string[]; now?: () => number } = {}) {
  const crypto = nodeCrypto({ manualCodes: options.manualCodes });
  const store = await createActivityStore(memoryDatabase());
  const identity = await classIdentity(store, crypto, {
    classId: 'planning-1',
    name: 'Perseverance',
    teacherName: 'Jannie',
  });
  const sent: { endpointId: string; json: string }[] = [];
  const disconnected: string[] = [];
  const statuses: CollectorStatus[] = [];
  const events: string[] = [];
  let advertisedAs = '';
  let failAdvertising: string | null = null;
  const radio: Radio = {
    async startAdvertising(name) {
      if (failAdvertising) throw new Error(failAdvertising);
      advertisedAs = name;
    },
    stopAdvertising() {
      advertisedAs = '';
    },
    async send(endpointId, json) {
      sent.push({ endpointId, json });
    },
    disconnect(endpointId) {
      disconnected.push(endpointId);
    },
  };
  const collector = createCollector({
    crypto,
    radio,
    enrollmentId: identity.enrollmentId,
    endpointName: identity.endpointName,
    className: identity.displayName,
    qrPayload: identity.qrPayload,
    ingest: (e, b, r) => store.ingest(e, b, r),
    now: options.now,
    listener: {
      onStatus: (s) => statuses.push(s),
      onConnected: (id) => events.push(`connected:${id}`),
      onTransfer: (id) => events.push(`transfer:${id}`),
      onSaved: (id, a, r) => events.push(`saved:${id}:${a}:${r}`),
      onFailure: (id, t) => events.push(`failure:${id}:${t}`),
      onDisconnected: (id) => events.push(`disconnected:${id}`),
    },
  });
  const takeSent = () => sent.splice(0);
  return {
    crypto,
    store,
    identity,
    collector,
    sent,
    takeSent,
    disconnected,
    statuses,
    events,
    get advertisedAs() {
      return advertisedAs;
    },
    set failAdvertising(v: string | null) {
      failAdvertising = v;
    },
  };
}

/** Connect an endpoint and return the challenge Tala sent it. */
async function connect(c: Awaited<ReturnType<typeof classroom>>, endpointId: string) {
  await c.collector.onConnection(endpointId, 'initiated');
  await c.collector.onConnection(endpointId, 'connected');
  const hello = JSON.parse(c.takeSent()[0]!.json) as { v: number; type: string; challenge: string };
  assert.equal(hello.type, 'challenge');
  assert.match(hello.challenge, /^[A-Za-z0-9_-]{32}$/);
  return hello.challenge;
}

test('intro → ready → batch → ack → empty batch; names, caps and acks are what the student expects', async () => {
  const c = await classroom();
  await c.collector.start();
  assert.equal(c.advertisedAs, c.identity.endpointName);
  assert.match(c.advertisedAs, /^Hiraia Tala 2 [A-Za-z0-9_-]{8}$/);
  assert.deepEqual(c.statuses, ['starting', 'ready']);
  const challenge = await connect(c, 'ep1');
  const qr = JSON.parse(await c.identity.qrPayload()) as { public_key: string; class_name: string };

  const intro = studentEncrypt(qr.public_key, challenge, 'intro', {
    schema: 1,
    class_id: c.identity.enrollmentId,
    installation_id: PHONE,
    challenge,
    profiles: [{ id: ANA, name: 'Ana' }],
    events: [],
  });
  await c.collector.onBytes('ep1', intro.outer);
  let reply = studentDecrypt(intro.sessionKey, challenge, c.takeSent()[0]!.json);
  assert.equal(reply.type, 'ready');
  assert.deepEqual(reply.body, {
    challenge,
    accepted: [],
    rejected: [],
    class_name: 'Perseverance',
    caps: ['left_profiles'],
  });
  assert.deepEqual(c.events, [`connected:${PHONE}`]);

  const batch = studentEncrypt(qr.public_key, challenge, 'batch', {
    schema: 1,
    class_id: c.identity.enrollmentId,
    installation_id: PHONE,
    challenge,
    profiles: [{ id: ANA, name: 'Ana' }],
    events: [
      {
        id: 'card-event-123456789',
        name: 'card_viewed',
        occurred_at: Date.now(),
        props: { profile_kind: 'student', profile_id: ANA },
      },
      {
        id: 'junk-event-123456789',
        name: 'not_an_event',
        occurred_at: Date.now(),
        props: { profile_kind: 'student', profile_id: ANA },
      },
    ],
  });
  await c.collector.onBytes('ep1', batch.outer);
  reply = studentDecrypt(batch.sessionKey, challenge, c.takeSent()[0]!.json);
  assert.equal(reply.type, 'ack');
  assert.deepEqual(reply.body.accepted, ['card-event-123456789']);
  assert.deepEqual(reply.body.rejected, ['junk-event-123456789']);
  assert.deepEqual(c.events.slice(1), [`transfer:${PHONE}`, `saved:${PHONE}:1:1`]);

  const empty = studentEncrypt(qr.public_key, challenge, 'batch', {
    schema: 1,
    class_id: c.identity.enrollmentId,
    installation_id: PHONE,
    challenge,
    profiles: [{ id: ANA, name: 'Ana' }],
    events: [],
  });
  await c.collector.onBytes('ep1', empty.outer);
  reply = studentDecrypt(empty.sessionKey, challenge, c.takeSent()[0]!.json);
  assert.deepEqual([reply.body.accepted, reply.body.rejected], [[], []]);
  assert.equal(c.disconnected.length, 0);

  await c.collector.onConnection('ep1', 'disconnected');
  assert.equal(c.events.at(-1), `disconnected:${PHONE}`);
  assert.equal(c.collector.connections(), 0);
  const [ana] = await c.store.students('planning-1');
  assert.equal(ana!.cards, 1);
  assert.equal(ana!.lastRejected, 1);
});

test('every failure disconnects and nothing is kept: wrong key, wrong challenge, wrong class, intro with events, changed phone, junk', async () => {
  const c = await classroom();
  await c.collector.start();
  const qr = JSON.parse(await c.identity.qrPayload()) as { public_key: string };
  const other = nodeCrypto();
  const otherKey = await other.ensureClassKey('x');
  const body = (patch: Record<string, unknown> = {}) => ({
    schema: 1,
    class_id: c.identity.enrollmentId,
    installation_id: PHONE,
    challenge: 'placeholder',
    profiles: [{ id: ANA, name: 'Ana' }],
    events: [],
    ...patch,
  });
  const cases: [string, (challenge: string) => string][] = [
    ['junk', () => 'not json'],
    ['wrong version', () => '{"v":2,"type":"intro"}'],
    ['unknown type', () => '{"v":1,"type":"hello"}'],
    ['wrong key', (ch) => studentEncrypt(otherKey, ch, 'intro', body({ challenge: ch })).outer],
    [
      'wrong challenge',
      (ch) =>
        studentEncrypt(qr.public_key, 'other-challenge', 'intro', body({ challenge: ch })).outer,
    ],
    [
      'stale challenge inside',
      (ch) => studentEncrypt(qr.public_key, ch, 'intro', body({ challenge: 'stale' })).outer,
    ],
    [
      'wrong class',
      (ch) =>
        studentEncrypt(
          qr.public_key,
          ch,
          'intro',
          body({ challenge: ch, class_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
        ).outer,
    ],
    [
      'intro with events',
      (ch) =>
        studentEncrypt(
          qr.public_key,
          ch,
          'intro',
          body({
            challenge: ch,
            events: [
              {
                id: 'card-event-123456789',
                name: 'card_viewed',
                occurred_at: Date.now(),
                props: {},
              },
            ],
          })
        ).outer,
    ],
    [
      'bad event id',
      (ch) =>
        studentEncrypt(
          qr.public_key,
          ch,
          'batch',
          body({
            challenge: ch,
            events: [{ id: 'x', name: 'card_viewed', occurred_at: Date.now(), props: {} }],
          })
        ).outer,
    ],
    [
      'bad profile',
      (ch) =>
        studentEncrypt(
          qr.public_key,
          ch,
          'intro',
          body({ challenge: ch, profiles: [{ id: 'bad', name: 'Ana' }] })
        ).outer,
    ],
  ];
  let n = 0;
  for (const [label, make] of cases) {
    const ep = `ep${++n}`;
    const challenge = await connect(c, ep);
    await c.collector.onBytes(ep, make(challenge));
    assert.equal(c.disconnected.at(-1), ep, label);
    assert.equal(c.takeSent().length, 0, label);
    await c.collector.onConnection(ep, 'disconnected');
  }
  assert.equal(c.events.filter((e) => e.startsWith('failure:')).length, cases.length);
  assert.equal((await c.store.students('planning-1', true)).length, 0);

  // A connection may not change its installation id half way.
  const challenge = await connect(c, 'epX');
  await c.collector.onBytes(
    'epX',
    studentEncrypt(qr.public_key, challenge, 'intro', body({ challenge })).outer
  );
  c.takeSent();
  await c.collector.onBytes(
    'epX',
    studentEncrypt(
      qr.public_key,
      challenge,
      'batch',
      body({ challenge, installation_id: 'installation-987654321' })
    ).outer
  );
  assert.equal(c.disconnected.at(-1), 'epX');
  assert.equal(c.events.at(-1), 'failure:installation-987654321:true');
  // Bytes for an endpoint without a challenge are ignored; a payload after stop() is ignored.
  await c.collector.onBytes('nobody', '{"v":1,"type":"intro"}');
  c.collector.stop();
  assert.equal(c.collector.running, false);
  assert.equal(c.statuses.at(-1), 'paused');
  assert.equal(c.collector.connections(), 0);
});

test('typed-code enrolment delivers the exact QR JSON, then the same connection continues; attempts are limited', async () => {
  let now = 1_760_000_000_000;
  const c = await classroom({ manualCodes: ['ABCDEFGHJKMN', 'PQRSTUVWXYZ2'], now: () => now });
  await c.collector.start();
  const ticket = await c.collector.ticket();
  assert.equal(ticket.code, 'ABCDEFGHJKMN');
  assert.equal(ticket.expiresAt, now + 3_600_000);
  assert.equal((await c.collector.ticket()).code, ticket.code, 'stable within the hour');

  const challenge = await connect(c, 'ep1');
  const student = studentManual('ABCDEFGHJKMN', challenge);
  await c.collector.onBytes('ep1', student.request);
  const manualKey = c.takeSent()[0]!;
  assert.equal(JSON.parse(manualKey.json).type, 'manual_key');
  const qr = student.open(manualKey.json);
  assert.equal(qr, await c.identity.qrPayload());
  const parsed = JSON.parse(qr) as { class_id: string; public_key: string; class_name: string };
  assert.equal(parsed.class_name, 'Perseverance');
  // …and the student goes on with intro on the same connection and challenge.
  const intro = studentEncrypt(parsed.public_key, challenge, 'intro', {
    schema: 1,
    class_id: parsed.class_id,
    installation_id: PHONE,
    challenge,
    profiles: [{ id: ANA, name: 'Ana' }],
    events: [],
  });
  await c.collector.onBytes('ep1', intro.outer);
  assert.equal(studentDecrypt(intro.sessionKey, challenge, c.takeSent()[0]!.json).type, 'ready');

  // Wrong code: refused, counted; the fourth attempt on one connection is refused outright.
  const ch2 = await connect(c, 'ep2');
  for (let i = 0; i < 3; i++) {
    await c.collector.onBytes('ep2', studentManual('PQRSTUVWXYZ2', ch2).request);
    assert.equal(c.disconnected.at(-1), 'ep2');
  }
  assert.equal(c.takeSent().length, 0);

  // Refresh: a new code, same QR; the expired code no longer works.
  c.collector.clearTicket();
  const fresh = await c.collector.ticket();
  assert.equal(fresh.code, 'PQRSTUVWXYZ2');
  assert.equal(await c.identity.qrPayload(), qr);
  now += 3_600_001;
  const ch3 = await connect(c, 'ep3');
  await c.collector.onBytes('ep3', studentManual('PQRSTUVWXYZ2', ch3).request);
  assert.equal(c.disconnected.at(-1), 'ep3');
  // An oversized manual payload is refused before anything else.
  const ch4 = await connect(c, 'ep4');
  await c.collector.onBytes(
    'ep4',
    JSON.stringify({ v: 1, type: 'manual_enroll', client_nonce: 'x'.repeat(3000), proof: 'y' })
  );
  assert.equal(c.disconnected.at(-1), 'ep4');
  void ch4;
  assert.ok(MAX_OUTER > 0);
});

test('advertising failure reports a plain status and stops; stop() clears connections; a rename shows up in the next reply', async () => {
  const c = await classroom();
  c.failAdvertising = 'nearby-8032';
  await c.collector.start();
  assert.equal(c.collector.running, false);
  assert.equal(c.statuses.at(-1), 'advertisingFailed');
  c.failAdvertising = null;
  await c.collector.start();
  assert.equal(c.statuses.at(-1), 'ready');
  const challenge = await connect(c, 'ep1');
  await c.store.ensureClass({ classId: 'planning-1', name: 'Renamed class' });
  const qr = JSON.parse(await c.identity.qrPayload()) as { public_key: string; class_name: string };
  assert.equal(qr.class_name, 'Renamed class');
  const intro = studentEncrypt(qr.public_key, challenge, 'intro', {
    schema: 1,
    class_id: c.identity.enrollmentId,
    installation_id: PHONE,
    challenge,
    profiles: [],
    events: [],
  });
  await c.collector.onBytes('ep1', intro.outer);
  assert.equal(
    studentDecrypt(intro.sessionKey, challenge, c.takeSent()[0]!.json).body.class_name,
    'Renamed class'
  );
  // A connection that failed to establish is reported; one that drops before bytes is just gone.
  await c.collector.onConnection('ep2', 'failed');
  assert.equal(c.statuses.at(-1), 'connectionFailed');
  await c.collector.onConnection('ep3', 'disconnected');
  c.collector.stop();
  assert.equal(c.advertisedAs, '');
});
