/** The 0.4.x import, against a fixture built with TalaDatabase.kt's schema-9 DDL (branch tala-0.4.x). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActivityStore } from './store';
import { memoryDatabase } from './testDb';
import { importLegacy, inspectLegacy } from './upgrade';

const ENROLLMENT = '0f8fad5b-d9cb-469f-a165-70867728950e';

/** Exactly the tables TalaDatabase.onCreate builds at version 9 (plus the relay/issue tables we ignore). */
function legacyDatabase(version = 9) {
  const db = memoryDatabase();
  db.raw.exec(`
    PRAGMA user_version = ${version};
    CREATE TABLE school_classes (
      id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, teacher_name TEXT NOT NULL,
      school_name TEXT NOT NULL, grade_level TEXT NOT NULL, school_year TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE students (
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      name TEXT NOT NULL, first_seen INTEGER NOT NULL${version >= 9 ? ', left_at INTEGER, removed_at INTEGER' : ''},
      PRIMARY KEY (class_id, installation_id, profile_id));
    CREATE TABLE events (
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, event_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      event_name TEXT NOT NULL, correct INTEGER NOT NULL, occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
      props TEXT NOT NULL, PRIMARY KEY (class_id, installation_id, event_id));
    CREATE TABLE devices (
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, last_sync INTEGER NOT NULL,
      last_seen INTEGER NOT NULL, last_accepted INTEGER NOT NULL, last_rejected INTEGER NOT NULL,
      PRIMARY KEY (class_id, installation_id));
    CREATE TABLE student_avatars (
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      animal_index INTEGER NOT NULL, color_index INTEGER NOT NULL,
      PRIMARY KEY (class_id, installation_id, profile_id));
    CREATE TABLE class_options (kind TEXT NOT NULL, value TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (kind, value));
    CREATE TABLE issues (id TEXT PRIMARY KEY, category TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE activity_relay (class_id TEXT NOT NULL, installation_id TEXT NOT NULL, event_id TEXT NOT NULL,
      payload TEXT NOT NULL, reconstructed INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
      PRIMARY KEY(class_id,installation_id,event_id));
    CREATE TABLE relay_identity(id TEXT PRIMARY KEY);
    INSERT INTO school_classes VALUES('class-a','${ENROLLMENT}','Perseverance','Jannie','Calapacuan','6','2026–2027',1700000000000);
    INSERT INTO students VALUES('class-a','installation-123456789','student-profile-111111111','Ana',1700000001000${version >= 9 ? ',NULL,NULL' : ''});
    INSERT INTO students VALUES('class-a','installation-123456789','student-profile-222222222','Ben',1700000002000${version >= 9 ? ',1700000005000,NULL' : ''});
    INSERT INTO students VALUES('class-a','installation-123456789','student-profile-333333333','Cho',1700000003000${version >= 9 ? ',NULL,1700000006000' : ''});
    INSERT INTO students VALUES('class-a','installation-987654321','guest','Guest-Q3K7B2',1700000004000${version >= 9 ? ',NULL,NULL' : ''});
    INSERT INTO events VALUES('class-a','installation-123456789','ana-card-123456789','student-profile-111111111','card_viewed',0,1700000001500,1700000001600,'{"profile_kind":"student","profile_id":"student-profile-111111111","card_id":"ffct-00001"}');
    INSERT INTO events VALUES('class-a','installation-123456789','ben-quiz-123456789','student-profile-222222222','quiz_graded',1,1700000002500,1700000002600,'{"profile_kind":"student","profile_id":"student-profile-222222222","correct":true}');
    INSERT INTO events VALUES('class-a','installation-987654321','guest-card-12345678','guest','card_viewed',0,1700000004500,1700000004600,'{"profile_kind":"guest"}');
    INSERT INTO devices VALUES('class-a','installation-123456789',1700000002600,1700000002600,1,0);
    INSERT INTO devices VALUES('class-a','installation-987654321',1700000004600,1700000004600,1,0);
    INSERT INTO student_avatars VALUES('class-a','installation-123456789','student-profile-111111111',2,2);
    INSERT INTO relay_identity VALUES('reporter-1');
  `);
  return db;
}

test('inspect reports the schema version and classes without importing', async () => {
  const legacy = legacyDatabase();
  const info = await inspectLegacy(legacy);
  assert.equal(info.schemaVersion, 9);
  assert.deepEqual(
    info.classes.map((c) => [c.id, c.enrollmentId, c.name]),
    [['class-a', ENROLLMENT, 'Perseverance']]
  );
  await assert.rejects(inspectLegacy(memoryDatabase()), /Not a Tala 0.4.x database/);
});

test('import keeps enrollment ids, timestamps, left/removed markers, events, device state and avatars; re-running is a no-op', async () => {
  const legacy = legacyDatabase();
  const store = await createActivityStore(memoryDatabase());
  const summary = await importLegacy(legacy, store);
  assert.deepEqual(
    { ...summary, classes: summary.classes.length },
    {
      schemaVersion: 9,
      classes: 1,
      students: 4,
      events: 3,
      devices: 2,
      avatars: 1,
      enrollmentIds: [ENROLLMENT],
    }
  );
  const cls = await store.classById('class-a');
  assert.equal(cls?.enrollmentId, ENROLLMENT);
  assert.equal(cls?.createdAt, 1700000000000);
  assert.equal(cls?.teacherName, 'Jannie');
  const inClass = await store.students('class-a');
  assert.deepEqual(
    inClass.map((s) => s.name),
    ['Ana', 'Guest-Q3K7B2']
  );
  const everyone = await store.students('class-a', true);
  assert.deepEqual(
    everyone.map((s) => [s.name, s.leftAt]),
    [
      ['Ana', 0],
      ['Ben', 1700000005000],
      ['Guest-Q3K7B2', 0],
    ]
  );
  assert.equal(everyone.find((s) => s.name === 'Ben')!.quizzes, 1);
  assert.equal(everyone.find((s) => s.name === 'Ana')!.lastSync, 1700000002600);
  assert.equal(everyone.find((s) => s.name === 'Ana')!.lastAccepted, 1);
  // Cho was removed in 0.4.x: still removed, and a resend is acknowledged but dropped.
  const later = await store.ingest(
    ENROLLMENT,
    {
      schema: 1,
      class_id: ENROLLMENT,
      installation_id: 'installation-123456789',
      challenge: 'c',
      profiles: [{ id: 'student-profile-333333333', name: 'Cho' }],
      events: [
        {
          id: 'cho-card-1234567890',
          name: 'card_viewed',
          occurred_at: 1700000007000,
          props: { profile_kind: 'student', profile_id: 'student-profile-333333333' },
        },
      ],
    },
    true
  );
  assert.deepEqual(later.accepted, ['cho-card-1234567890']);
  assert.ok(!(await store.students('class-a', true)).some((s) => s.name === 'Cho'));
  const saved = await store.avatars('class-a', []);
  assert.deepEqual(saved.get('installation-123456789:student-profile-111111111'), {
    animalIndex: 2,
    colorIndex: 2,
  });
  const again = await importLegacy(legacy, store);
  assert.equal(again.events, 3);
  assert.equal(await store.eventCount('class-a'), 3); // Cho's resend was acknowledged, not kept
  assert.equal(
    (await store.storedEvents('class-a')).find((e) => e.eventId === 'ana-card-123456789')
      ?.receivedAt,
    1700000001600
  );
});

test('a pre-0.4.4 database (schema 8, no left/removed columns) imports too, and the class id can be remapped', async () => {
  const legacy = legacyDatabase(8);
  const store = await createActivityStore(memoryDatabase());
  const summary = await importLegacy(legacy, store, { classIdFor: (c) => `planning-${c.id}` });
  assert.equal(summary.schemaVersion, 8);
  assert.equal((await store.classById('planning-class-a'))?.enrollmentId, ENROLLMENT);
  assert.equal((await store.students('planning-class-a')).length, 4);
  assert.equal(await store.eventCount('planning-class-a'), 3);
});

test('a database older than schema 3 is refused with a plain message', async () => {
  const db = memoryDatabase();
  db.raw.exec(
    `CREATE TABLE school_classes(id TEXT PRIMARY KEY, name TEXT); CREATE TABLE students(group_id TEXT, installation_id TEXT, profile_id TEXT, name TEXT, first_seen INTEGER);`
  );
  await assert.rejects(inspectLegacy(db), /older than 0.3.0/);
});
