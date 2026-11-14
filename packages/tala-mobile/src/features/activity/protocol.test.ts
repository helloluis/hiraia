import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  b64urlDecode,
  b64urlEncode,
  checkInner,
  classHint,
  displayClassName,
  endpointNameFor,
  formatManualCode,
  generatedClassName,
  normalizeManualCode,
  parseOuter,
  qrPayload,
  replyBody,
  challengeMessage,
  isOuterEnvelope,
  isManualEnroll,
  MAX_INNER,
} from './protocol';
import { sha256Sync } from './nodeCrypto';

const sha = async (b: Uint8Array) => sha256Sync(b);

test('class hints match the vectors shared with the student app and Tala 0.4.4', async () => {
  assert.equal(await classHint('0f8fad5b-d9cb-469f-a165-70867728950e', sha), 'WlOusN1s');
  assert.equal(await classHint('7c9e6679-7425-40de-944b-e07fc1f90ae7', sha), 'x3ejyN5T');
  const name = endpointNameFor(await classHint('0f8fad5b-d9cb-469f-a165-70867728950e', sha));
  assert.equal(name, 'Hiraia Tala 2 WlOusN1s');
  assert.ok(new TextEncoder().encode(name).length <= 32);
});

test('base64url round-trips without padding and accepts padded input', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = b64urlEncode(bytes);
  assert.ok(!encoded.includes('=') && !encoded.includes('+') && !encoded.includes('/'));
  assert.deepEqual([...b64urlDecode(encoded)], [...bytes]);
  assert.deepEqual([...b64urlDecode(encoded + '==')], [...bytes]);
  assert.throws(() => b64urlDecode('not base64 !!'));
});

test('generated class names are stable, English, and never blank; typed names win and are capped', async () => {
  const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const generated = await generatedClassName(id, sha);
  assert.equal(generated, await generatedClassName(id, sha));
  assert.match(generated, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.equal(await displayClassName(id, '   ', sha), generated);
  assert.equal(await displayClassName(id, null, sha), generated);
  const long = 'Grade 6 Perseverance with a class name far longer than a phone shows';
  assert.equal(await displayClassName(id, long, sha), long.slice(0, 48));
  assert.equal(await displayClassName(id, '  Section A  ', sha), 'Section A');
});

test('the QR payload has the 0.4.4 keys in order, and the manual code normalises like the student', () => {
  const payload = qrPayload('0f8fad5b-d9cb-469f-a165-70867728950e', 'Blue Tarsier', 'AAAA');
  assert.equal(
    payload,
    '{"v":1,"kind":"hiraia-tala","class_id":"0f8fad5b-d9cb-469f-a165-70867728950e","class_name":"Blue Tarsier","public_key":"AAAA"}'
  );
  assert.equal(normalizeManualCode('abcd-efgh-jkmn'), 'ABCDEFGHJKMN');
  assert.equal(normalizeManualCode('ABCD EFGH JKM2'), 'ABCDEFGHJKM2');
  assert.equal(normalizeManualCode('ABCD-EFGH-JKM0'), null); // 0 is not in the alphabet
  assert.equal(normalizeManualCode('ABCD-EFGH-JKMNP'), null);
  assert.equal(formatManualCode('ABCDEFGHJKMN'), 'ABCD-EFGH-JKMN');
});

test('outer envelopes and manual requests are recognised; junk is not', () => {
  assert.equal(parseOuter('nope'), null);
  assert.equal(parseOuter('[]'), null);
  assert.equal(parseOuter('{"v":2,"type":"intro"}'), null);
  const outer = parseOuter(
    '{"v":1,"type":"intro","wrapped_key":"a","nonce":"b","ciphertext":"c"}'
  )!;
  assert.ok(isOuterEnvelope(outer));
  assert.ok(!isManualEnroll(outer));
  const manual = parseOuter('{"v":1,"type":"manual_enroll","client_nonce":"a","proof":"b"}')!;
  assert.ok(isManualEnroll(manual));
  assert.ok(!isOuterEnvelope(manual));
  assert.equal(challengeMessage('abc'), '{"v":1,"type":"challenge","challenge":"abc"}');
});

test('checkInner enforces schema, challenge, class, installation id, counts and event ids', () => {
  const expected = { classId: 'class-uuid', challenge: 'chal' };
  const good = {
    schema: 1,
    class_id: 'class-uuid',
    installation_id: 'installation-12345678',
    challenge: 'chal',
    profiles: [{ id: 'student-profile-1234', name: 'Ana' }],
    events: [{ id: 'event-id-1234567890', name: 'card_viewed', occurred_at: 1, props: {} }],
  };
  const check = (patch: Record<string, unknown>) =>
    checkInner(JSON.stringify({ ...good, ...patch }), expected);
  assert.equal(check({}).ok, true);
  assert.deepEqual(check({ schema: 2 }), { ok: false, reason: 'schema' });
  assert.deepEqual(check({ challenge: 'other' }), { ok: false, reason: 'challenge' });
  assert.deepEqual(check({ class_id: 'x' }), { ok: false, reason: 'class' });
  assert.deepEqual(check({ installation_id: 'short' }), { ok: false, reason: 'installation' });
  assert.deepEqual(check({ events: 'x' }), { ok: false, reason: 'events' });
  assert.deepEqual(check({ events: Array(51).fill(good.events[0]) }), {
    ok: false,
    reason: 'count',
  });
  assert.deepEqual(check({ profiles: Array(51).fill(good.profiles[0]) }), {
    ok: false,
    reason: 'count',
  });
  assert.deepEqual(check({ left_profiles: Array(51).fill('x') }), { ok: false, reason: 'count' });
  assert.deepEqual(check({ events: [{ id: 'bad' }] }), { ok: false, reason: 'event-id' });
  assert.deepEqual(check({ profiles: [{ id: 1 }] }), { ok: false, reason: 'profile-shape' });
  assert.equal(checkInner('x'.repeat(MAX_INNER + 1), expected).ok, false);
  assert.equal(checkInner('{', expected).ok, false);
  // profiles and left_profiles are optional; invalid left entries are kept for ingest to skip.
  const minimal = checkInner(
    JSON.stringify({ ...good, profiles: undefined, left_profiles: ['x', 42] }),
    expected
  );
  assert.ok(
    minimal.ok && minimal.batch.profiles?.length === 0 && minimal.batch.left_profiles?.length === 2
  );
});

test('reply bodies carry the challenge, both lists, the class name and the 0.4.4 caps', () => {
  const body = JSON.parse(replyBody('c', ['a'], ['b'], 'x'.repeat(60)));
  assert.deepEqual(Object.keys(body), ['challenge', 'accepted', 'rejected', 'class_name', 'caps']);
  assert.deepEqual(body, {
    challenge: 'c',
    accepted: ['a'],
    rejected: ['b'],
    class_name: 'x'.repeat(48),
    caps: ['left_profiles'],
  });
});
