import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import type { LeaveTombstone, ScopedBinding } from '../src/tala/queue.ts';
import {
  HINTED_ENDPOINT_PREFIX,
  accepted,
  buildGroups,
  burstDone,
  candidates,
  classHint,
  endpointHints,
  groupSynced,
  leavesFor,
  lost,
  manualUnreachable,
  newBurst,
  nextManualEndpoint,
  nextMisses,
  regroup,
  rejected,
  seen,
  type Group,
} from '../src/tala/sessionCore.ts';

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());
const INSTALL = 'installation_0123456789';
const ANA = 'profile-ana-0123456789';
const BEN = 'profile-ben-0123456789';
const CARA = 'profile-cara-012345678';
const X = { class_id: '0f8fad5b-d9cb-469f-a165-70867728950e', public_key: 'key-x' };
const Y = { class_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', public_key: 'key-y' };
const Z = { class_id: 'b3e1f6a2-1c2d-4e5f-8a9b-0c1d2e3f4a5b', public_key: 'key-z' };
const HINTS: Record<string, string> = {};
for (const c of [X, Y, Z]) HINTS[c.class_id] = await classHint(c.class_id, sha256);
const profiles = [
  { id: ANA, name: 'Ana' },
  { id: BEN, name: 'Ben' },
  { id: CARA, name: 'Cara' },
];

function bound(scope: string, c: typeof X, last_sync = 0): ScopedBinding {
  return { scope, ...c, class_name: '', bound_at: 1, last_sync, dropped: 0 };
}
function left(wire_id: string, c: typeof X): LeaveTombstone {
  return { ...c, wire_id, left_at: 1 };
}
function groups(
  bindings: ScopedBinding[],
  leaves: LeaveTombstone[] = [],
  activeScope = ANA
): Group[] {
  return buildGroups({
    bindings,
    leaves,
    hint: (id) => HINTS[id]!,
    activeScope,
    installationId: INSTALL,
    profiles,
  });
}
const hinted = (...classes: (typeof X)[]) =>
  HINTED_ENDPOINT_PREFIX + classes.map((c) => HINTS[c.class_id]).join(',');

test('class hints match the shared test vectors', async () => {
  assert.equal(await classHint('0f8fad5b-d9cb-469f-a165-70867728950e', sha256), 'WlOusN1s');
  assert.equal(await classHint('7c9e6679-7425-40de-944b-e07fc1f90ae7', sha256), 'x3ejyN5T');
});

test('endpoint names: hinted, several hints, legacy and absent', () => {
  assert.deepEqual(endpointHints('Hiraia Tala 2 WlOusN1s'), ['WlOusN1s']);
  assert.deepEqual(endpointHints('Hiraia Tala 2 WlOusN1s,x3ejyN5T'), ['WlOusN1s', 'x3ejyN5T']);
  assert.equal(endpointHints('Hiraia Tala'), null);
  assert.equal(endpointHints(''), null);
  assert.equal(endpointHints(undefined), null);
  assert.deepEqual(endpointHints('Hiraia Tala 2 '), []);
});

test('classmates on one phone share a group that lists only them; the Guest travels as the installation', () => {
  const g = groups([bound(ANA, X), bound(BEN, Y, 50), bound('guest', X), bound(CARA, Y, 90)]);
  assert.equal(g.length, 2);
  const [x, y] = g;
  assert.deepEqual(x!.scopes, [ANA, 'guest'], 'the student on screen comes first');
  assert.deepEqual(x!.profiles, [
    { id: ANA, name: 'Ana' },
    { id: INSTALL, name: 'Guest' },
  ]);
  assert.equal(x!.hint, 'WlOusN1s');
  assert.equal(x!.active, true);
  assert.deepEqual(
    y!.profiles.map((p) => p.name),
    ['Ben', 'Cara']
  );
  assert.equal(y!.lastSync, 90);
});

test('a bound scope without a nameable profile is left out rather than sent nameless', () => {
  const g = groups([bound('profile-gone-0123456789', X), bound(BEN, Y)]);
  assert.deepEqual(
    g.map((group) => group.class_id),
    [Y.class_id]
  );
  assert.ok(
    g.every((group) => group.profiles.length === group.scopes.length && group.profiles.length)
  );
});

test('tombstones ride with their class, or make a leave-only group ordered last', () => {
  const g = groups([bound(ANA, X), bound(BEN, X)], [left(CARA, X), left(INSTALL, Z)]);
  assert.deepEqual(
    g.map((group) => [group.class_id, group.scopes.length, group.leaves]),
    [
      [X.class_id, 2, [CARA]],
      [Z.class_id, 0, [INSTALL]],
    ]
  );
});

test('hinted teacher: connect only for a matching class, ignore others entirely', () => {
  const burst = newBurst(groups([bound(ANA, X), bound(BEN, Y)], [left(CARA, Z)]));
  seen(burst, 'other', HINTED_ENDPOINT_PREFIX + 'AAAAAAAA');
  assert.deepEqual(candidates(burst, 'other'), []);
  seen(burst, 'ty', hinted(Y));
  assert.deepEqual(
    candidates(burst, 'ty').map((g) => g.class_id),
    [Y.class_id]
  );
  seen(burst, 'tz', hinted(Z));
  assert.deepEqual(
    candidates(burst, 'tz').map((g) => g.class_id),
    [Z.class_id],
    'a leave-only class'
  );
  seen(burst, 'both', hinted(Z, X));
  assert.deepEqual(
    candidates(burst, 'both').map((g) => g.class_id),
    [X.class_id, Z.class_id],
    'students before leaves'
  );
});

test('legacy teacher: classes are tried one connection at a time, on screen first, then most recent', () => {
  const burst = newBurst(
    groups([bound(BEN, Y, 10), bound(CARA, Z, 99), bound(ANA, X)], [left(INSTALL, X)], ANA)
  );
  seen(burst, 'old', 'Hiraia Tala');
  assert.deepEqual(
    candidates(burst, 'old').map((g) => g.class_id),
    [X.class_id, Z.class_id, Y.class_id]
  );
  assert.equal(rejected(burst, 'old', candidates(burst, 'old')[0]!.key)?.class_id, Z.class_id);
  assert.equal(rejected(burst, 'old', candidates(burst, 'old')[0]!.key)?.class_id, Y.class_id);
  assert.equal(rejected(burst, 'old', candidates(burst, 'old')[0]!.key), undefined);
});

test('legacy teacher is never offered a class that only owes a leave', () => {
  const burst = newBurst(groups([bound(ANA, X)], [left(BEN, Y)]));
  seen(burst, 'old');
  assert.deepEqual(
    candidates(burst, 'old').map((g) => g.class_id),
    [X.class_id]
  );
});

test('once a class gets ready on a teacher, that teacher gets nothing else this burst', () => {
  const burst = newBurst(groups([bound(ANA, X), bound(BEN, Y)]));
  seen(burst, 'old', 'Hiraia Tala');
  accepted(burst, 'old');
  assert.deepEqual(candidates(burst, 'old'), []);
  assert.equal(rejected(burst, 'old', burst.groups[0]!.key), undefined, 'no retry after ready');
  // Another teacher in range can still take the class that remains.
  seen(burst, 'second', 'Hiraia Tala');
  groupSynced(burst, burst.groups[0]!.key);
  assert.deepEqual(
    candidates(burst, 'second').map((g) => g.class_id),
    [Y.class_id]
  );
});

test('a burst is done when every class with students synced; leave-only classes never hold it open', () => {
  const burst = newBurst(groups([bound(ANA, X), bound(BEN, Y)], [left(CARA, Z)]));
  const [x, y, z] = burst.groups;
  assert.equal(burstDone(burst, []), false);
  groupSynced(burst, x!.key);
  assert.equal(burstDone(burst, []), false);
  groupSynced(burst, y!.key);
  assert.equal(burstDone(burst, [z!.key]), false, 'a leave already on the wire may finish');
  assert.equal(burstDone(burst, []), true);
});

test('backoff: a burst that only met another class’s teacher is a miss; any synced class resets it', () => {
  const burst = newBurst(groups([bound(ANA, X)]));
  seen(burst, 'other', hinted(Y));
  seen(burst, 'old', 'Hiraia Tala');
  rejected(burst, 'old', burst.groups[0]!.key);
  assert.equal(nextMisses(2, burst), 3);
  groupSynced(burst, burst.groups[0]!.key);
  assert.equal(nextMisses(2, burst), 0);
});

test('backoff: reaching ready with the class’s own teacher is not a miss, even if the burst ran out first', () => {
  // A long history can outlast one 90 s burst; the teacher is right there.
  const burst = newBurst(groups([bound(ANA, X)]));
  seen(burst, 'mine', hinted(X));
  accepted(burst, 'mine');
  assert.equal(burst.synced.size, 0);
  assert.equal(nextMisses(2, burst), 0);
});

test('leave tombstones go only to a hinted teacher of that class', () => {
  const burst = newBurst(groups([bound(ANA, X)], [left(BEN, X)]));
  const x = burst.groups[0]!;
  seen(burst, 'old', 'Hiraia Tala');
  seen(burst, 'unnamed');
  seen(burst, 'new', hinted(X));
  seen(burst, 'multi', hinted(Y, X));
  assert.deepEqual(leavesFor(burst, 'old', x), []);
  assert.deepEqual(leavesFor(burst, 'unnamed', x), []);
  assert.deepEqual(leavesFor(burst, 'new', x), [BEN]);
  assert.deepEqual(leavesFor(burst, 'multi', x), [BEN]);
});

test('a class that gains a student mid-burst owes a fresh sync; one that did not stays done', () => {
  const burst = newBurst(groups([bound(ANA, X), bound(BEN, Y)]));
  for (const g of burst.groups) groupSynced(burst, g.key);
  regroup(burst, groups([bound(ANA, X), bound(BEN, Y), bound('guest', X)]));
  assert.deepEqual(
    burst.groups.filter((g) => !burst.synced.has(g.key)).map((g) => g.class_id),
    [X.class_id]
  );
});

test('a lost teacher is offered nothing, and is not asked for a typed code, until found again', () => {
  const burst = newBurst(groups([bound(BEN, Y)]));
  seen(burst, 'gone', 'Hiraia Tala');
  seen(burst, 'here', hinted(Z));
  lost(burst, 'gone');
  assert.deepEqual(candidates(burst, 'gone'), []);
  assert.equal(nextManualEndpoint(burst), 'here');
  seen(burst, 'gone', 'Hiraia Tala');
  assert.deepEqual(
    candidates(burst, 'gone').map((g) => g.class_id),
    [Y.class_id]
  );
  assert.equal(nextManualEndpoint(burst), 'gone');
});

test('a typed code gives up on a teacher it cannot reach twice, unless another teacher held the radio', () => {
  const burst = newBurst([]);
  seen(burst, 'far', hinted(Y));
  assert.equal(manualUnreachable(burst, 'far', true), false, 'contention is not an answer');
  assert.equal(manualUnreachable(burst, 'far', true), false);
  assert.equal(manualUnreachable(burst, 'far', false), false, 'the first real failure is retried');
  assert.equal(manualUnreachable(burst, 'far', false), true);
});

test('a typed code is tried on one teacher at a time, in discovery order', () => {
  const burst = newBurst([]);
  seen(burst, 'first', 'Hiraia Tala');
  seen(burst, 'second', hinted(Y));
  assert.equal(nextManualEndpoint(burst), 'first');
  burst.manualTried.add('first');
  assert.equal(nextManualEndpoint(burst), 'second');
  burst.manualTried.add('second');
  assert.equal(nextManualEndpoint(burst), undefined);
});
