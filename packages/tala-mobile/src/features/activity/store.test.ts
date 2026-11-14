/** Ports of Tala 0.4.4's TalaStorageTest cases (branch tala-0.4.x) onto the activity store. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityStore, type ActivityStore } from './store';
import { memoryDatabase } from './testDb';
import type { InnerBatch, WireEvent } from './protocol';
import { rosterCards, dayBounds, isoDay } from './learning';
import { sha256Sync } from './nodeCrypto';

const ENROLLMENT = '0f8fad5b-d9cb-469f-a165-70867728950e';
const PHONE = 'installation-123456789';
const ANA = 'student-profile-111111111';
const BEN = 'student-profile-222222222';
let clock = 1_760_000_000_000;

async function fixture(): Promise<{ store: ActivityStore; classId: string }> {
  const store = await createActivityStore(memoryDatabase(), {
    now: () => clock,
    randomInt: (() => {
      let i = 0;
      return (bound: number) => (i += 7) % bound;
    })(),
  });
  const cls = await store.ensureClass({
    classId: 'planning-class-1',
    name: 'Pilot class',
    teacherName: 'Jannie',
    schoolName: 'Calapacuan Elementary School',
    gradeLevel: '6',
    schoolYear: '2026–2027',
    enrollmentId: ENROLLMENT,
  });
  return { store, classId: cls.classId };
}

const cardView = (id: string, profileId: string | null, at = clock): WireEvent => ({
  id,
  name: 'card_viewed',
  occurred_at: at,
  props: profileId
    ? { profile_kind: 'student', profile_id: profileId, card_id: 'ffct-00001' }
    : { profile_kind: 'guest' },
});

function sync(
  installationId: string,
  profiles: [string, string][],
  events: WireEvent[] = [],
  left: unknown[] = []
): InnerBatch {
  return {
    schema: 1,
    class_id: ENROLLMENT,
    installation_id: installationId,
    challenge: 'c',
    profiles: profiles.map(([id, name]) => ({ id, name })),
    events,
    ...(left.length ? { left_profiles: left } : {}),
  };
}

test('class identity: a fresh enrollment id is a v4 UUID and never changes; adopting one is possible', async () => {
  const store = await createActivityStore(memoryDatabase());
  const a = await store.ensureClass({ classId: 'c1', name: 'A' });
  assert.match(
    a.enrollmentId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  const again = await store.ensureClass({ classId: 'c1', name: 'A renamed' });
  assert.equal(again.enrollmentId, a.enrollmentId);
  assert.equal(again.name, 'A renamed');
  await assert.rejects(store.ensureClass({ classId: 'c2', name: 'B', enrollmentId: 'not-a-uuid' }));
  const adopted = await store.ensureClass({ classId: 'c3', name: 'C', enrollmentId: ENROLLMENT });
  assert.equal((await store.classByEnrollment(ENROLLMENT))?.classId, adopted.classId);
  await assert.rejects(store.ingest('unknown', sync(PHONE, []), false));
});

test('an intro does not mark synced, retries do not double count, and a changed resend is rejected', async () => {
  const { store, classId } = await fixture();
  const eventId = 'card-event-123456789';
  await store.ingest(ENROLLMENT, sync(PHONE, [[ANA, 'Student One']]), false);
  let [row] = await store.students(classId);
  assert.equal(row!.lastSync, 0);
  assert.ok(row!.lastSeen > 0);
  const batch = sync(PHONE, [[ANA, 'Student One']], [cardView(eventId, ANA)]);
  assert.deepEqual((await store.ingest(ENROLLMENT, batch, true)).accepted, [eventId]);
  assert.deepEqual((await store.ingest(ENROLLMENT, batch, true)).accepted, [eventId]);
  [row] = await store.students(classId);
  assert.equal(row!.cards, 1);
  assert.equal(row!.events, 1);
  assert.ok(row!.lastSync > 0);
  batch.events[0]!.name = 'unknown_event';
  const rejected = await store.ingest(ENROLLMENT, batch, true);
  assert.deepEqual(rejected.rejected, [eventId]);
  [row] = await store.students(classId);
  assert.equal(row!.cards, 1);
  assert.equal(row!.lastRejected, 1);
  // An empty batch is acknowledged and leaves the last-batch counts alone.
  assert.deepEqual(await store.ingest(ENROLLMENT, sync(PHONE, [[ANA, 'Student One']]), true), {
    accepted: [],
    rejected: [],
  });
  [row] = await store.students(classId);
  assert.equal(row!.lastRejected, 1);
});

test('event validation: bad ids fail the message; bad names, times, props and profiles are rejected one by one', async () => {
  const { store } = await fixture();
  await assert.rejects(
    store.ingest(ENROLLMENT, sync(PHONE, [], [{ ...cardView('short', ANA) }]), true)
  );
  await assert.rejects(store.ingest(ENROLLMENT, sync(PHONE, [['bad id', 'Ana']]), false));
  await assert.rejects(store.ingest(ENROLLMENT, sync(PHONE, [[ANA, '']]), false));
  await assert.rejects(store.ingest(ENROLLMENT, sync(PHONE, [[ANA, 'x'.repeat(41)]]), false));
  const result = await store.ingest(
    ENROLLMENT,
    sync(
      PHONE,
      [[ANA, 'Ana']],
      [
        cardView('ok-event-1234567890', ANA),
        { ...cardView('old-event-123456789', ANA), occurred_at: 1_000_000 },
        {
          ...cardView('bad-props-123456789', ANA),
          props: { profile_kind: 'student', profile_id: ANA, big: 'x'.repeat(1600) },
        },
        {
          ...cardView('bad-profile-12345678', ANA),
          props: { profile_kind: 'student', profile_id: 'nope' },
        },
        {
          ...cardView('no-props-1234567890', ANA),
          props: undefined as unknown as Record<string, unknown>,
        },
      ]
    ),
    true
  );
  assert.deepEqual(result.accepted, ['ok-event-1234567890']);
  assert.deepEqual(result.rejected, [
    'old-event-123456789',
    'bad-props-123456789',
    'bad-profile-12345678',
    'no-props-1234567890',
  ]);
});

test('guest phones keep distinct aliases and their events across the placeholder → named-Guest handshake', async () => {
  const { store, classId } = await fixture();
  await store.ingest(ENROLLMENT, sync(PHONE, []), false);
  let [first] = await store.students(classId);
  assert.ok(first!.name.startsWith('Guest-'));
  assert.equal(first!.profileId, 'guest');
  assert.equal(first!.lastSync, 0);
  assert.ok(first!.lastSeen > 0);
  const avatarBefore = (await rosterCards([first!], async (b) => sha256Sync(b)))[0]!;
  assert.deepEqual(
    (
      await store.ingest(
        ENROLLMENT,
        sync(PHONE, [], [cardView('guest-card-123456789', null)]),
        true
      )
    ).accepted,
    ['guest-card-123456789']
  );
  [first] = await store.students(classId);
  assert.equal(first!.cards, 1);
  await store.ingest(ENROLLMENT, sync(PHONE, []), false);
  assert.equal((await store.students(classId))[0]!.name, first!.name);
  // The 0.4.24 phone now names its Guest: same tile, same alias, same events, same avatar.
  await store.ingest(ENROLLMENT, sync(PHONE, [['guest-profile-123456789', 'Guest']]), false);
  const students = await store.students(classId);
  assert.equal(students.length, 1);
  assert.equal(students[0]!.name, first!.name);
  assert.equal(students[0]!.profileId, 'guest-profile-123456789');
  assert.equal(students[0]!.cards, 1);
  const avatarAfter = (await rosterCards(students, async (b) => sha256Sync(b)))[0]!;
  assert.equal(avatarAfter.animalIndex, avatarBefore.animalIndex);
  assert.equal(avatarAfter.colorIndex, avatarBefore.colorIndex);
  // A second phone's Guest gets a different alias.
  await store.ingest(
    ENROLLMENT,
    sync('installation-987654321', [['guest-profile-987654321', 'Guest']]),
    false
  );
  const guests = await store.students(classId);
  assert.equal(guests.length, 2);
  assert.equal(new Set(guests.map((g) => g.name)).size, 2);
});

test('left profiles hide only that student until the phone lists them again; a retried leave keeps the first date', async () => {
  const { store, classId } = await fixture();
  await store.ingest(
    ENROLLMENT,
    sync(PHONE, [
      [ANA, 'Ana'],
      [BEN, 'Ben'],
    ]),
    false
  );
  await store.ingest(
    ENROLLMENT,
    sync(
      PHONE,
      [
        [ANA, 'Ana'],
        [BEN, 'Ben'],
      ],
      [cardView('ana-card-123456789', ANA), cardView('ben-card-123456789', BEN)]
    ),
    true
  );
  const today = clock - 60_000;
  assert.equal(await store.eventCountSince(classId, today), 2);
  clock += 1000;
  const result = await store.ingest(
    ENROLLMENT,
    sync(PHONE, [[BEN, 'Ben']], [], [ANA, 'not an id!', 42, BEN]),
    true
  );
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(
    (await store.students(classId)).map((s) => s.name),
    ['Ben']
  );
  assert.equal(await store.eventCountSince(classId, today), 1);
  const everyone = await store.students(classId, true);
  const leftAt = everyone.find((s) => s.profileId === ANA)!.leftAt;
  assert.ok(leftAt > 0);
  assert.equal(everyone.find((s) => s.profileId === BEN)!.leftAt, 0);
  assert.equal(everyone.find((s) => s.profileId === ANA)!.cards, 1);
  clock += 1000;
  await store.ingest(ENROLLMENT, sync(PHONE, [[BEN, 'Ben']], [], [ANA]), true);
  assert.equal(
    (await store.students(classId, true)).find((s) => s.profileId === ANA)!.leftAt,
    leftAt
  );
  // Listing Ana again is rejoining.
  await store.ingest(
    ENROLLMENT,
    sync(PHONE, [
      [ANA, 'Ana'],
      [BEN, 'Ben'],
    ]),
    false
  );
  assert.deepEqual(
    (await store.students(classId)).map((s) => s.name),
    ['Ana', 'Ben']
  );
  assert.ok((await store.students(classId)).every((s) => s.leftAt === 0));
  assert.equal(await store.eventCountSince(classId, today), 2);
});

test('a phone that only says its profiles left gets no Guest tile; an older empty intro still does', async () => {
  const { store, classId } = await fixture();
  await store.ingest(ENROLLMENT, sync('installation-111111111', [], [], [ANA]), false);
  await store.ingest(ENROLLMENT, sync('installation-111111111', [], [], [ANA]), true);
  assert.equal((await store.students(classId, true)).length, 0);
  await store.ingest(ENROLLMENT, sync('installation-222222222', []), false);
  assert.ok((await store.students(classId))[0]!.name.startsWith('Guest-'));
  const phone = 'installation-333333333';
  await store.ingest(ENROLLMENT, sync(phone, [[ANA, 'Ana']]), false);
  await store.ingest(ENROLLMENT, sync(phone, [], [], [ANA]), false);
  assert.equal((await store.students(classId)).length, 1);
  assert.deepEqual(
    (await store.students(classId, true))
      .filter((s) => s.installationId === phone)
      .map((s) => s.name),
    ['Ana']
  );
  // The Guest leaves under the phone's installation id, taking an old 'guest' placeholder with it.
  const old = 'installation-444444444';
  await store.ingest(
    ENROLLMENT,
    sync(old, [[BEN, 'Ben']], [cardView('g-card-44444444444', null)]),
    true
  );
  assert.ok(
    (await store.students(classId)).some((s) => s.installationId === old && s.profileId === 'guest')
  );
  await store.ingest(ENROLLMENT, sync(old, [[BEN, 'Ben']], [], [old]), true);
  assert.deepEqual(
    (await store.students(classId)).filter((s) => s.installationId === old).map((s) => s.name),
    ['Ben']
  );
});

test('a removed student stays removed and later activity is acknowledged but dropped', async () => {
  const { store, classId } = await fixture();
  const both: [string, string][] = [
    [ANA, 'Ana'],
    [BEN, 'Ben'],
  ];
  await store.ingest(
    ENROLLMENT,
    sync(PHONE, both, [
      cardView('ana-card-111111111', ANA),
      cardView('ana-card-222222222', ANA),
      cardView('ben-card-111111111', BEN),
    ]),
    true
  );
  await store.removeStudent((await store.students(classId)).find((s) => s.profileId === ANA)!);
  assert.deepEqual(
    (await store.students(classId, true)).map((s) => s.name),
    ['Ben']
  );
  assert.equal(await store.eventCount(classId), 1);
  const later = await store.ingest(
    ENROLLMENT,
    sync(PHONE, both, [
      cardView('ana-card-111111111', ANA),
      cardView('ana-card-333333333', ANA),
      cardView('ben-card-222222222', BEN),
    ]),
    true
  );
  assert.deepEqual(later.accepted, [
    'ana-card-111111111',
    'ana-card-333333333',
    'ben-card-222222222',
  ]);
  assert.deepEqual(later.rejected, []);
  await store.ingest(ENROLLMENT, sync(PHONE, both), false);
  await store.ingest(ENROLLMENT, sync(PHONE, [[BEN, 'Ben']], [], [ANA]), true);
  await store.ingest(ENROLLMENT, sync(PHONE, both), false);
  assert.deepEqual(
    (await store.students(classId, true)).map((s) => s.name),
    ['Ben']
  );
  assert.equal(await store.eventCount(classId), 2);
  assert.deepEqual((await store.storedEvents(classId)).map((e) => e.eventId).sort(), [
    'ben-card-111111111',
    'ben-card-222222222',
  ]);
});

test('a removed Guest placeholder does not block the Guest who later joins by name', async () => {
  const { store, classId } = await fixture();
  const phone = 'installation-987654321';
  const onPhone = async () =>
    (await store.students(classId, true)).filter((s) => s.installationId === phone);
  await store.ingest(
    ENROLLMENT,
    sync(phone, [[BEN, 'Ben']], [cardView('guest-card-111111111', null)]),
    true
  );
  const placeholder = (await store.students(classId)).find((s) => s.profileId === 'guest')!;
  assert.ok(placeholder.name.startsWith('Guest-'));
  await store.removeStudent(placeholder);
  const stray = await store.ingest(
    ENROLLMENT,
    sync(phone, [[BEN, 'Ben']], [cardView('guest-card-222222222', null)]),
    true
  );
  assert.deepEqual(stray.accepted, ['guest-card-222222222']);
  assert.deepEqual(
    (await onPhone()).map((s) => s.name),
    ['Ben']
  );
  // The phone's Guest joins by name: a new tile under a new alias, with its own events.
  await store.ingest(
    ENROLLMENT,
    sync(
      phone,
      [
        [BEN, 'Ben'],
        [phone, 'Guest'],
      ],
      [cardView('guest-card-333333333', phone)]
    ),
    true
  );
  const guest = (await onPhone()).find((s) => s.profileId === phone)!;
  assert.ok(guest.name.startsWith('Guest-') && guest.name !== placeholder.name);
  assert.equal(guest.cards, 1);
  assert.equal(await store.eventCount(classId), 1);
});

test('events with no known owner create a Recovered student; failures and quiz totals count', async () => {
  const { store, classId } = await fixture();
  const result = await store.ingest(
    ENROLLMENT,
    sync(
      PHONE,
      [],
      [
        {
          id: 'quiz-event-1234567890',
          name: 'quiz_graded',
          occurred_at: clock,
          props: {
            profile_kind: 'student',
            profile_id: ANA,
            correct: true,
            question_id: 'storm-g4',
          },
        },
        {
          id: 'quiz-event-0987654321',
          name: 'quiz_graded',
          occurred_at: clock,
          props: { profile_kind: 'student', profile_id: ANA, correct: false },
        },
        {
          id: 'fail-event-1234567890',
          name: 'download_failed',
          occurred_at: clock,
          props: { profile_kind: 'student', profile_id: ANA },
        },
      ]
    ),
    true
  );
  assert.equal(result.accepted.length, 3);
  const [ana] = await store.students(classId);
  assert.equal(ana!.name, 'Recovered student');
  assert.equal(ana!.quizzes, 2);
  assert.equal(ana!.correct, 1);
  assert.equal(ana!.failures, 1);
  assert.equal(ana!.events, 3);
  const learning = await store.learningEvents(ana!);
  assert.deepEqual(
    learning.map((e) => [e.name, e.correct, e.questionId]),
    [
      ['quiz_graded', true, 'storm-g4'],
      ['quiz_graded', false, ''],
    ]
  );
});

test('learning days page backwards through active days in the local zone', async () => {
  const { store, classId } = await fixture();
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime();
  await store.ingest(
    ENROLLMENT,
    sync(
      PHONE,
      [[ANA, 'Ana']],
      [
        cardView('e1-xxxxxxxxxxxxxxxx', ANA, at(2026, 9, 24, 9)),
        cardView('e2-xxxxxxxxxxxxxxxx', ANA, at(2026, 9, 24, 15)),
        cardView('e3-xxxxxxxxxxxxxxxx', ANA, at(2026, 9, 22, 8)),
        cardView('e4-xxxxxxxxxxxxxxxx', ANA, at(2026, 9, 10, 8)),
      ]
    ),
    true
  );
  const [ana] = await store.students(classId);
  const calendar = { isoDay, dayBounds };
  const page = await store.learningDays(ana!, Number.MAX_SAFE_INTEGER, 2, calendar);
  assert.deepEqual(
    page.map((d) => [d.date, d.events.length]),
    [
      ['2026-09-24', 2],
      ['2026-09-22', 1],
    ]
  );
  const older = await store.learningDays(ana!, dayBounds(page[1]!.date).start, 5, calendar);
  assert.deepEqual(
    older.map((d) => d.date),
    ['2026-09-10']
  );
  assert.equal(await store.latestLearningBefore(ana!, dayBounds('2026-09-10').start), null);
});

test('avatars are saved on first sight and survive renames; roster links are explicit and cleared on removal', async () => {
  const { store, classId } = await fixture();
  await store.ingest(ENROLLMENT, sync(PHONE, [[ANA, 'Luis']]), false);
  const saved = await store.avatars(classId, [
    { installationId: PHONE, profileId: ANA, animalIndex: 3, colorIndex: 4 },
  ]);
  assert.deepEqual(saved.get(`${PHONE}:${ANA}`), { animalIndex: 3, colorIndex: 4 });
  const again = await store.avatars(classId, [
    { installationId: PHONE, profileId: ANA, animalIndex: 9, colorIndex: 1 },
  ]);
  assert.deepEqual(again.get(`${PHONE}:${ANA}`), { animalIndex: 3, colorIndex: 4 });
  const [luis] = await store.students(classId);
  assert.equal(luis!.rosterStudentId, null);
  await store.linkRosterStudent(luis!, 'roster-row-1');
  assert.equal((await store.students(classId))[0]!.rosterStudentId, 'roster-row-1');
  await store.removeStudent(luis!);
  assert.equal((await store.students(classId, true)).length, 0);
  await store.deleteClass(classId);
  assert.equal(await store.classById(classId), null);
  assert.equal(await store.eventCount(classId), 0);
});
