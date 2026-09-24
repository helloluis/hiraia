/**
 * The OTA relay, offline: a fake R2 origin, a throwaway RSA key, no network.
 *
 *   cd packages/web && ../../node_modules/.bin/tsx --test src/app/api/updates/manifest/relay.test.ts
 */
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';

import {
  CHANNEL_TTL_MS,
  MAX_RUNTIMES,
  PROTOCOL_HEADERS,
  Relay,
  UPSTREAM_BUDGET_PER_MINUTE,
  chooseRelease,
  parseChannel,
  rolloutBucket,
} from './relay';

const RT = 'bc46088521c8be59290c8d1836e279376924a4e3';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const D1 = '33333333-3333-4333-8333-333333333333';
const PHONE = '6f1d0c2e-5b7a-4c1e-9d3f-2a8b4c6d8e0f';
const ORIGIN = 'https://r2.test';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const manifestBytes = (id: string, runtimeVersion = RT) =>
  Buffer.from(JSON.stringify({ id, createdAt: '2026-09-24T00:00:00.000Z', runtimeVersion, launchAsset: {}, assets: [], metadata: {}, extra: {} }));
const directiveBytes = () =>
  Buffer.from(JSON.stringify({ type: 'rollBackToEmbedded', parameters: { commitTime: '2026-09-24T00:00:00.000Z' } }));
const signatureOf = (body: Buffer) => sign('sha256', body, privateKey).toString('base64');

function channel(overrides: Record<string, unknown> = {}) {
  return {
    format: 1,
    runtimeVersion: RT,
    canary: { clients: [], release: null },
    production: { release: { kind: 'update', id: U1 }, rollout: 100, fallback: null },
    history: [],
    ...overrides,
  };
}

/** A fake public R2 origin: key → body. Counts reads so the cache can be observed. */
function origin(objects: Record<string, string | Buffer>) {
  const reads: string[] = [];
  let down = false;
  const fetchImpl = (async (input: string | URL | Request) => {
    const key = String(input).slice(ORIGIN.length + 1);
    reads.push(key);
    if (down) throw new Error('connect ECONNREFUSED');
    const body = objects[key];
    if (body === undefined) return new Response('missing', { status: 404 });
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, reads, objects, setDown: (value: boolean) => (down = value) };
}

function publish(objects: Record<string, string | Buffer>, id = U1, body = manifestBytes(id)) {
  objects[`ota/android/${RT}/updates/${id}/manifest.json`] = body;
  objects[`ota/android/${RT}/updates/${id}/manifest.json.sig`] = signatureOf(body);
  return body;
}

function relay(r2: ReturnType<typeof origin>, clock = { t: 1_000_000 }, logs: string[] = []) {
  return new Relay({ origin: ORIGIN, publicKey, fetch: r2.fetchImpl, now: () => clock.t, log: (l) => logs.push(l) });
}

function request(extra: Record<string, string> = {}) {
  return new Headers({
    'expo-protocol-version': '1',
    'expo-platform': 'android',
    'expo-runtime-version': RT,
    'eas-client-id': PHONE,
    ...extra,
  });
}

/** The single part of a relay answer (the relay never sends more than one). */
async function onlyPart(res: Response) {
  const all = await parts(res);
  assert.equal(all.length, 1, 'exactly one part');
  return all[0]!;
}

function assertProtocolHeaders(res: Response) {
  for (const [k, v] of Object.entries(PROTOCOL_HEADERS)) assert.equal(res.headers.get(k), v, k);
}

/** Minimal multipart/mixed reader: the parts OkHttp's MultipartReader would see. */
async function parts(res: Response) {
  const type = res.headers.get('content-type') ?? '';
  const boundary = /^multipart\/mixed; boundary=(.+)$/.exec(type)?.[1];
  assert.ok(boundary, `multipart content-type, got ${type}`);
  const raw = Buffer.from(await res.arrayBuffer());
  const text = raw.toString('latin1');
  assert.ok(text.startsWith(`--${boundary}\r\n`));
  assert.ok(text.endsWith(`\r\n--${boundary}--\r\n`));
  const inner = text.slice(`--${boundary}\r\n`.length, -`\r\n--${boundary}--\r\n`.length);
  return inner.split(`\r\n--${boundary}\r\n`).map((chunk) => {
    const split = chunk.indexOf('\r\n\r\n');
    const headers = Object.fromEntries(
      chunk
        .slice(0, split)
        .split('\r\n')
        .map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]),
    );
    return { headers, body: Buffer.from(chunk.slice(split + 4), 'latin1') };
  });
}

test('204 (with the protocol headers) when nothing is published for the runtime', async () => {
  const res = await relay(origin({})).handle(request());
  assert.equal(res.status, 204);
  assertProtocolHeaders(res);
  assert.equal(await res.text(), '');
});

test('serves the exact signed manifest bytes as a one-part multipart response', async () => {
  const r2 = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel()) });
  const body = publish(r2.objects);
  const res = await relay(r2).handle(request());
  assert.equal(res.status, 200);
  assertProtocolHeaders(res);
  const part = await onlyPart(res);
  assert.equal(part.headers['content-disposition'], 'form-data; name="manifest"');
  assert.equal(part.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(part.headers['expo-signature'], `sig="${signatureOf(body)}", keyid="main"`);
  assert.ok(part.body.equals(body), 'body is byte-identical to what was signed');
});

test('204 when the phone already runs the chosen update', async () => {
  const r2 = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel()) });
  publish(r2.objects);
  const res = await relay(r2).handle(request({ 'expo-current-update-id': U1.toUpperCase() }));
  assert.equal(res.status, 204);
  assertProtocolHeaders(res);
});

test('a rollBackToEmbedded directive is served as a signed "directive" part', async () => {
  const r2 = origin({
    [`ota/android/${RT}/channel.json`]: JSON.stringify(
      channel({ production: { release: { kind: 'rollBackToEmbedded', id: D1 }, rollout: 100, fallback: null } }),
    ),
  });
  const body = directiveBytes();
  r2.objects[`ota/android/${RT}/directives/${D1}/directive.json`] = body;
  r2.objects[`ota/android/${RT}/directives/${D1}/directive.json.sig`] = signatureOf(body);
  const part = await onlyPart(await relay(r2).handle(request({ 'expo-current-update-id': U1 })));
  assert.equal(part.headers['content-disposition'], 'form-data; name="directive"');
  assert.ok(part.body.equals(body));
});

test('rollout buckets are deterministic, spread, and only ever grow with the percentage', () => {
  const clients = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  const buckets = clients.map((c) => rolloutBucket(U1, c));
  assert.deepEqual(buckets, clients.map((c) => rolloutBucket(U1, c)), 'same input, same bucket');
  assert.equal(rolloutBucket(U1, PHONE), rolloutBucket(U1, PHONE.toUpperCase()), 'case-insensitive');
  const under10 = buckets.filter((b) => b < 10).length;
  assert.ok(under10 > 140 && under10 < 260, `~10% under 10, got ${under10}/2000`);
  const cohort = (pct: number, release: string) =>
    new Set(clients.filter((c) => chooseRelease(parseChannel(channel({ production: { release: { kind: 'update', id: release }, rollout: pct, fallback: null } }), RT)!, c)?.release.id === release));
  const at10 = cohort(10, U1);
  const at50 = cohort(50, U1);
  for (const c of at10) assert.ok(at50.has(c), 'raising the rollout keeps everyone already in');
  assert.notDeepEqual([...cohort(10, U2)].sort(), [...at10].sort(), 'the next release starts with a fresh cohort');
});

test('outside the rollout: the fallback release, or 204 without one; no client id sees only 100%', async () => {
  const outside = Array.from({ length: 50 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`).find(
    (c) => rolloutBucket(U2, c) >= 10,
  )!;
  const partial = { release: { kind: 'update', id: U2 }, rollout: 10 };
  const r2 = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel({ production: { ...partial, fallback: null } })) });
  publish(r2.objects, U2);
  assert.equal((await relay(r2).handle(request({ 'eas-client-id': outside }))).status, 204);
  const noId = request();
  noId.delete('eas-client-id');
  assert.equal((await relay(r2).handle(noId)).status, 204);

  r2.objects[`ota/android/${RT}/channel.json`] = JSON.stringify(
    channel({ production: { ...partial, fallback: { kind: 'update', id: U1 } } }),
  );
  const body = publish(r2.objects, U1);
  const part = await onlyPart(await relay(r2).handle(request({ 'eas-client-id': outside })));
  assert.ok(part.body.equals(body), 'outside the rollout gets the fallback');
});

test('canary allowlist gets the canary release; everyone else follows production', async () => {
  const r2 = origin({
    [`ota/android/${RT}/channel.json`]: JSON.stringify(
      channel({ canary: { clients: [PHONE.toUpperCase()], release: { kind: 'update', id: U2 } } }),
    ),
  });
  const prod = publish(r2.objects, U1);
  const canary = publish(r2.objects, U2);
  const r = relay(r2);
  assert.ok((await onlyPart(await r.handle(request()))).body.equals(canary));
  const other = 'bbbbbbbb-0000-4000-8000-000000000001';
  assert.ok((await onlyPart(await r.handle(request({ 'eas-client-id': other })))).body.equals(prod));
});

test('bad input is a 400 that still speaks protocol 1', async () => {
  const r = relay(origin({}));
  const bads: Record<string, string>[] = [
    { 'expo-platform': 'ios' },
    { 'expo-runtime-version': '0.4.24' },
    { 'expo-runtime-version': RT.toUpperCase() },
    { 'expo-protocol-version': '0' },
  ];
  for (const bad of bads) {
    const res = await r.handle(request(bad));
    assert.equal(res.status, 400, JSON.stringify(bad));
    assertProtocolHeaders(res);
  }
  const missing = request();
  missing.delete('expo-platform');
  assert.equal((await r.handle(missing)).status, 400);
});

test('never serves a body the phones would reject', async () => {
  const r2 = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel()) });
  const body = publish(r2.objects);
  const tampered = Buffer.from(body.toString('utf8').replace('"assets":[]', '"assets":[ ]'));
  r2.objects[`ota/android/${RT}/updates/${U1}/manifest.json`] = tampered;
  const logs: string[] = [];
  const res = await relay(r2, { t: 1 }, logs).handle(request());
  assert.equal(res.status, 503);
  assertProtocolHeaders(res);
  assert.ok(logs.some((l) => l.includes('does not verify')));

  const wrongId = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel()) });
  publish(wrongId.objects, U1, manifestBytes(U2));
  assert.equal((await relay(wrongId).handle(request())).status, 503, 'manifest id must match the pointer');
});

test('channel.json is cached for the TTL and the last good copy survives an R2 outage', async () => {
  const r2 = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel()) });
  const body = publish(r2.objects);
  const clock = { t: 5_000_000 };
  const r = relay(r2, clock);
  await r.handle(request());
  await r.handle(request());
  assert.equal(r2.reads.filter((k) => k.endsWith('channel.json')).length, 1, 'one read within the TTL');
  assert.equal(r2.reads.filter((k) => k.endsWith('manifest.json')).length, 1, 'signed bodies are immutable');

  clock.t += CHANNEL_TTL_MS + 1;
  r2.setDown(true);
  const part = await onlyPart(await r.handle(request()));
  assert.ok(part.body.equals(body), 'last good channel + cached body keep serving');
  assert.equal(r2.reads.filter((k) => k.endsWith('channel.json')).length, 2, 're-read after the TTL');

  r2.setDown(false);
  r2.objects[`ota/android/${RT}/channel.json`] = '{"format": 1, "runtimeVersion": "nope"}';
  clock.t += CHANNEL_TTL_MS + 1;
  assert.equal((await r.handle(request())).status, 200, 'a malformed pointer keeps the last good one');
});

test('made-up runtimes cannot turn the route into an R2 request amplifier', async () => {
  const r2 = origin({});
  const r = relay(r2);
  for (let i = 0; i < UPSTREAM_BUDGET_PER_MINUTE + 40; i++) {
    const res = await r.handle(request({ 'expo-runtime-version': i.toString(16).padStart(40, '0') }));
    assert.equal(res.status, 204);
  }
  assert.equal(r2.reads.length, UPSTREAM_BUDGET_PER_MINUTE);
});

test('a 400-runtime spray neither starves nor evicts a real runtime: its phones still get the rollback', async () => {
  // OTA-4. A bad update U1 is live; someone sprays made-up runtimes (~136/min, over the budget)
  // for 3 minutes; mid-spray the publisher swaps channel.json to a rollBackToEmbedded directive.
  const r2 = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel()) });
  const bad = publish(r2.objects);
  const clock = { t: 7_000_000 };
  const r = relay(r2, clock);
  const onBad = request({ 'expo-current-update-id': U2 });
  assert.ok((await onlyPart(await r.handle(onBad))).body.equals(bad), 'the real runtime is warm');

  const SPRAY = 400;
  assert.ok(SPRAY > MAX_RUNTIMES + UPSTREAM_BUDGET_PER_MINUTE, 'enough to evict a whole cache');
  const directive = directiveBytes();
  for (let i = 0; i < SPRAY; i++) {
    clock.t += 440;
    const fake = (0xf000 + i).toString(16).padStart(40, 'f');
    assert.equal((await r.handle(request({ 'expo-runtime-version': fake }))).status, 204);
    if (i === SPRAY / 2) {
      r2.objects[`ota/android/${RT}/directives/${D1}/directive.json`] = directive;
      r2.objects[`ota/android/${RT}/directives/${D1}/directive.json.sig`] = signatureOf(directive);
      r2.objects[`ota/android/${RT}/channel.json`] = JSON.stringify(
        channel({ production: { release: { kind: 'rollBackToEmbedded', id: D1 }, rollout: 100, fallback: null } }),
      );
    }
  }
  const sprayReads = r2.reads.filter((k) => k.endsWith('channel.json') && !k.includes(RT)).length;
  assert.ok(sprayReads < SPRAY, `the budget was exhausted (${sprayReads} of ${SPRAY} read)`);
  assert.ok(sprayReads > MAX_RUNTIMES, `and the cache overflowed (${sprayReads} "nothing here" entries)`);
  assert.ok(sprayReads <= UPSTREAM_BUDGET_PER_MINUTE * Math.ceil((SPRAY * 440) / 60_000), 'the spray stays budgeted');

  const part = await onlyPart(await r.handle(onBad));
  assert.equal(part.headers['content-disposition'], 'form-data; name="directive"');
  assert.ok(part.body.equals(directive), 'the real runtime refreshed past the spray and serves the brake');
});

test('parseChannel rejects anything it would have to guess at', () => {
  assert.ok(parseChannel(channel(), RT));
  assert.equal(parseChannel(channel(), RT.replace('b', 'c')), null, 'another runtime');
  assert.equal(parseChannel({ ...channel(), format: 2 }, RT), null);
  assert.equal(parseChannel(channel({ production: { release: { kind: 'update', id: 'x' }, rollout: 100 } }), RT), null);
  assert.equal(parseChannel(channel({ production: { release: null, rollout: 101 } }), RT), null);
  assert.equal(parseChannel(channel({ canary: { clients: ['has space'], release: null } }), RT), null);
  assert.equal(parseChannel(channel({ production: { release: { kind: 'reload', id: U1 } } }), RT), null);
});

test('the route module wires the relay to HIRAIA_OTA_ORIGIN', async () => {
  const r2 = origin({ [`ota/android/${RT}/channel.json`]: JSON.stringify(channel()) });
  const body = publish(r2.objects);
  process.env.HIRAIA_OTA_ORIGIN = `${ORIGIN}/`;
  process.env.HIRAIA_OTA_CERTIFICATE = '/nonexistent/certificate.pem';
  const realFetch = globalThis.fetch;
  const warn = console.warn;
  const log = console.log;
  globalThis.fetch = r2.fetchImpl;
  console.warn = () => {};
  console.log = () => {};
  try {
    const { GET } = await import('./route');
    const res = await GET(new Request('https://hiraia.org/api/updates/manifest', { headers: request() }));
    assert.equal(res.status, 200);
    assert.ok((await onlyPart(res)).body.equals(body));
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
    console.log = log;
  }
});
