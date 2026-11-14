/**
 * App-private storage of classroom activity, ported from Tala 0.4.4 TalaDatabase.kt (schema
 * version 9, branch tala-0.4.x) onto the `Database` surface the rest of tala-mobile uses, so the
 * same code runs on expo-sqlite (SQLCipher) and on node:sqlite in tests.
 *
 * What is deliberately NOT ported: `activity_relay`/`relay_identity` and the issue-report tables.
 * In V1.0 activity data never leaves the phone (PRD ACT-5, PRIV-10): no upload queue exists.
 *
 * Tables are prefixed `activity_` so they can share a database file with the LocalStore, or live in
 * their own encrypted file (recommended; see INTEGRATION.md). Classes here are keyed by the local
 * planning class id (`class_id`) and carry the enrollment id that is the QR's `class_id`.
 */
import {
  CLASS_UUID,
  EVENTS,
  FAILURE_EVENTS,
  ID,
  MAX_NAME,
  MAX_PROPS,
  MAX_OCCURRED_AT,
  MIN_OCCURRED_AT,
  type InnerBatch,
} from './protocol';
import type { LearningEvent } from './learning';

export interface Database {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (tx: Database) => Promise<void>): Promise<void>;
}

export type ActivityClass = {
  /** The local planning class id this collection belongs to (one class entity, PRD §1.1). */
  classId: string;
  /** The QR's `class_id`: a v4 UUID fixed for the life of the class. */
  enrollmentId: string;
  name: string;
  teacherName: string;
  schoolName: string;
  gradeLevel: string;
  schoolYear: string;
  createdAt: number;
};

export type StudentRow = {
  classId: string;
  installationId: string;
  profileId: string;
  name: string;
  cards: number;
  quizzes: number;
  correct: number;
  failures: number;
  events: number;
  lastSync: number;
  lastSeen: number;
  lastAccepted: number;
  lastRejected: number;
  /** When the learner's phone said they left this class; 0 while they are in it. */
  leftAt: number;
  /** A roster student id the teacher explicitly linked (PRD ACT-6), else null. */
  rosterStudentId: string | null;
};

export type StoredEvent = {
  installationId: string;
  profileId: string;
  eventId: string;
  name: string;
  occurredAt: number;
  receivedAt: number;
  correct: boolean;
  props: string;
};

export type IngestResult = { accepted: string[]; rejected: string[] };

const GUEST_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const ACTIVITY_SCHEMA_VERSION = 1;

/** Only this module runs these; the LocalStore's tables are untouched. */
async function migrate(db: Database): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS activity_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity_classes(
      class_id TEXT PRIMARY KEY, enrollment_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      teacher_name TEXT NOT NULL DEFAULT '', school_name TEXT NOT NULL DEFAULT '',
      grade_level TEXT NOT NULL DEFAULT '', school_year TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS activity_students(
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      name TEXT NOT NULL, first_seen INTEGER NOT NULL, left_at INTEGER, removed_at INTEGER,
      roster_student_id TEXT,
      PRIMARY KEY(class_id, installation_id, profile_id));
    CREATE TABLE IF NOT EXISTS activity_events(
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, event_id TEXT NOT NULL,
      profile_id TEXT NOT NULL, event_name TEXT NOT NULL, correct INTEGER NOT NULL,
      occurred_at INTEGER NOT NULL, received_at INTEGER NOT NULL, props TEXT NOT NULL,
      PRIMARY KEY(class_id, installation_id, event_id));
    CREATE INDEX IF NOT EXISTS activity_events_profile_time
      ON activity_events(class_id, installation_id, profile_id, occurred_at);
    CREATE TABLE IF NOT EXISTS activity_devices(
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, last_sync INTEGER NOT NULL,
      last_seen INTEGER NOT NULL, last_accepted INTEGER NOT NULL, last_rejected INTEGER NOT NULL,
      PRIMARY KEY(class_id, installation_id));
    CREATE TABLE IF NOT EXISTS activity_avatars(
      class_id TEXT NOT NULL, installation_id TEXT NOT NULL, profile_id TEXT NOT NULL,
      animal_index INTEGER NOT NULL, color_index INTEGER NOT NULL,
      PRIMARY KEY(class_id, installation_id, profile_id));
    INSERT OR IGNORE INTO activity_meta VALUES('schema', '${ACTIVITY_SCHEMA_VERSION}');
  `);
}

export type ActivityStore =
  ReturnType<typeof createActivityStore> extends Promise<infer T> ? T : never;

export async function createActivityStore(
  db: Database,
  deps: { now?: () => number; randomInt?: (bound: number) => number; newUuid?: () => string } = {}
) {
  await migrate(db);
  const now = deps.now ?? (() => Date.now());
  const randomInt = deps.randomInt ?? ((bound: number) => Math.floor(Math.random() * bound));
  const newUuid =
    deps.newUuid ??
    (() => {
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) bytes[i] = randomInt(256);
      bytes[6] = (bytes[6]! & 0x0f) | 0x40;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    });

  const classRow = (r: Record<string, unknown>): ActivityClass => ({
    classId: r.class_id as string,
    enrollmentId: r.enrollment_id as string,
    name: r.name as string,
    teacherName: r.teacher_name as string,
    schoolName: r.school_name as string,
    gradeLevel: r.grade_level as string,
    schoolYear: r.school_year as string,
    createdAt: r.created_at as number,
  });

  async function studentName(
    tx: Database,
    classId: string,
    installationId: string,
    profileId: string
  ): Promise<string | null> {
    const row = await tx.getFirstAsync<{ name: string }>(
      'SELECT name FROM activity_students WHERE class_id=? AND installation_id=? AND profile_id=?',
      classId,
      installationId,
      profileId
    );
    return row?.name ?? null;
  }

  async function removedAt(
    tx: Database,
    classId: string,
    installationId: string,
    profileId: string
  ): Promise<number | null> {
    const row = await tx.getFirstAsync<{ removed_at: number }>(
      `SELECT removed_at FROM activity_students WHERE class_id=? AND installation_id=? AND profile_id=?
       AND removed_at IS NOT NULL`,
      classId,
      installationId,
      profileId
    );
    return row?.removed_at ?? null;
  }

  async function hasStudents(tx: Database, classId: string, installationId: string) {
    return !!(await tx.getFirstAsync(
      'SELECT 1 FROM activity_students WHERE class_id=? AND installation_id=? LIMIT 1',
      classId,
      installationId
    ));
  }

  async function guestAlias(tx: Database, classId: string): Promise<string> {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += GUEST_ALPHABET[randomInt(GUEST_ALPHABET.length)];
      const candidate = `Guest-${code}`;
      const taken = await tx.getFirstAsync(
        'SELECT 1 FROM activity_students WHERE class_id=? AND name=? COLLATE NOCASE LIMIT 1',
        classId,
        candidate
      );
      if (!taken) return candidate;
    }
  }

  async function ensureGuestRow(
    tx: Database,
    classId: string,
    installationId: string,
    at: number
  ): Promise<string> {
    const existing = await tx.getFirstAsync<{ profile_id: string }>(
      `SELECT profile_id FROM activity_students WHERE class_id=? AND installation_id=?
       AND name GLOB 'Guest-*' ORDER BY first_seen, profile_id LIMIT 1`,
      classId,
      installationId
    );
    if (existing) return existing.profile_id;
    await tx.runAsync(
      'INSERT INTO activity_students(class_id,installation_id,profile_id,name,first_seen) VALUES(?,?,?,?,?)',
      classId,
      installationId,
      'guest',
      await guestAlias(tx, classId),
      at
    );
    return 'guest';
  }

  const learningEvent = (r: {
    event_name: string;
    occurred_at: number;
    correct: number;
    props: string;
  }): LearningEvent => {
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(r.props) as Record<string, unknown>;
    } catch {
      /* stored by us; unreadable props count as none */
    }
    const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return {
      name: r.event_name,
      occurredAt: r.occurred_at,
      correct: r.correct !== 0,
      cardId: text(props.card_id),
      questionId: text(props.question_id),
    };
  };

  const store = {
    db,

    // ---- classes ----

    async classes(): Promise<ActivityClass[]> {
      return (
        await db.getAllAsync<Record<string, unknown>>(
          'SELECT * FROM activity_classes ORDER BY created_at, name'
        )
      ).map(classRow);
    },

    async classById(classId: string): Promise<ActivityClass | null> {
      const r = await db.getFirstAsync<Record<string, unknown>>(
        'SELECT * FROM activity_classes WHERE class_id=?',
        classId
      );
      return r ? classRow(r) : null;
    },

    async classByEnrollment(enrollmentId: string): Promise<ActivityClass | null> {
      const r = await db.getFirstAsync<Record<string, unknown>>(
        'SELECT * FROM activity_classes WHERE enrollment_id=?',
        enrollmentId
      );
      return r ? classRow(r) : null;
    },

    /**
     * The collection identity of a planning class, created on first use with a fresh v4 UUID
     * enrollment id. Idempotent: the enrollment id never changes once made (ACT-2: students do not
     * re-join). `enrollmentId` may be supplied to adopt an existing identity (the 0.4.x import).
     */
    async ensureClass(input: {
      classId: string;
      name: string;
      teacherName?: string;
      schoolName?: string;
      gradeLevel?: string;
      schoolYear?: string;
      enrollmentId?: string;
      createdAt?: number;
    }): Promise<ActivityClass> {
      const existing = await store.classById(input.classId);
      if (existing) {
        await db.runAsync(
          `UPDATE activity_classes SET name=?, teacher_name=?, school_name=?, grade_level=?, school_year=?
           WHERE class_id=?`,
          input.name.trim(),
          (input.teacherName ?? existing.teacherName).trim(),
          (input.schoolName ?? existing.schoolName).trim(),
          (input.gradeLevel ?? existing.gradeLevel).trim(),
          (input.schoolYear ?? existing.schoolYear).trim(),
          input.classId
        );
        return (await store.classById(input.classId))!;
      }
      const enrollmentId = input.enrollmentId ?? newUuid();
      if (!CLASS_UUID.test(enrollmentId)) throw new Error('enrollment id must be a UUID');
      await db.runAsync(
        `INSERT INTO activity_classes(class_id,enrollment_id,name,teacher_name,school_name,grade_level,school_year,created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
        input.classId,
        enrollmentId,
        input.name.trim(),
        (input.teacherName ?? '').trim(),
        (input.schoolName ?? '').trim(),
        (input.gradeLevel ?? '').trim(),
        (input.schoolYear ?? '').trim(),
        input.createdAt ?? now()
      );
      return (await store.classById(input.classId))!;
    },

    /** Deleting a class deletes its activity (PRIV-10). The caller also deletes the keystore key. */
    async deleteClass(classId: string): Promise<void> {
      await db.withExclusiveTransactionAsync(async (tx) => {
        for (const table of [
          'activity_events',
          'activity_students',
          'activity_devices',
          'activity_avatars',
          'activity_classes',
        ])
          await tx.runAsync(`DELETE FROM ${table} WHERE class_id=?`, classId);
      });
    },

    // ---- ingest (TalaDatabase.ingest, byte-for-byte semantics) ----

    /**
     * Commit one checked inner body. `recordSync` is true for a `batch`, false for an `intro`.
     * Returns what to acknowledge. Throws (→ disconnect) only on the whole-message failures the
     * caller has not already checked: unknown class, a bad profile, a bad event id.
     */
    async ingest(
      enrollmentId: string,
      batch: InnerBatch,
      recordSync: boolean
    ): Promise<IngestResult> {
      if (batch.schema !== 1 || batch.class_id !== enrollmentId) throw new Error('class');
      const cls = await store.classByEnrollment(enrollmentId);
      if (!cls) throw new Error('Unknown class');
      const classId = cls.classId;
      const installationId = batch.installation_id;
      if (!ID.test(installationId)) throw new Error('installation');
      const profiles = batch.profiles ?? [];
      const leftProfiles = batch.left_profiles ?? [];
      const events = batch.events;
      if (profiles.length > 50 || leftProfiles.length > 50 || events.length > 50)
        throw new Error('count');
      const accepted: string[] = [];
      const rejected: string[] = [];
      const at = now();
      await db.withExclusiveTransactionAsync(async (tx) => {
        const listed = new Set<string>();
        for (const profile of profiles) {
          const profileId = profile.id;
          const name = profile.name.trim();
          const guest = name.toLowerCase() === 'guest' || profileId === 'guest';
          if (
            !(
              (ID.test(profileId) || (guest && profileId === 'guest')) &&
              name &&
              name.length <= MAX_NAME
            )
          )
            throw new Error('profile');
          listed.add(profileId);
          const existingName = await studentName(tx, classId, installationId, profileId);
          const syntheticGuest =
            guest && profileId !== 'guest'
              ? await studentName(tx, classId, installationId, 'guest')
              : null;
          // The 'guest' placeholder is what older builds left for this phone without listing
          // anyone. A teacher's removal of it does not bind a Guest that now joins by being
          // listed: that Guest starts afresh, under an alias drawn while the placeholder's is
          // still taken, so the removed tile's name never comes back.
          const syntheticRemoved =
            syntheticGuest !== null &&
            (await removedAt(tx, classId, installationId, 'guest')) !== null;
          let storedName: string;
          if (guest) {
            if (existingName?.startsWith('Guest-')) storedName = existingName;
            else if (syntheticGuest?.startsWith('Guest-') && !syntheticRemoved)
              storedName = syntheticGuest;
            else storedName = await guestAlias(tx, classId);
          } else storedName = name;
          if (syntheticGuest !== null) {
            await tx.runAsync(
              `UPDATE activity_events SET profile_id=? WHERE class_id=? AND installation_id=? AND profile_id='guest'`,
              profileId,
              classId,
              installationId
            );
            await tx.runAsync(
              `UPDATE OR IGNORE activity_avatars SET profile_id=? WHERE class_id=? AND installation_id=? AND profile_id='guest'`,
              profileId,
              classId,
              installationId
            );
            await tx.runAsync(
              `DELETE FROM activity_students WHERE class_id=? AND installation_id=? AND profile_id='guest'`,
              classId,
              installationId
            );
            await tx.runAsync(
              `DELETE FROM activity_avatars WHERE class_id=? AND installation_id=? AND profile_id='guest'`,
              classId,
              installationId
            );
          }
          // Being listed means being in the class again, so a student who left is back. A
          // student the teacher removed is not: removal is the teacher's, not the phone's.
          await tx.runAsync(
            `INSERT INTO activity_students(class_id,installation_id,profile_id,name,first_seen)
             VALUES(?,?,?,?,?) ON CONFLICT(class_id,installation_id,profile_id)
             DO UPDATE SET name=excluded.name, left_at=NULL`,
            classId,
            installationId,
            profileId,
            storedName,
            at
          );
        }
        // Leaving is per profile: a phone shared by students of different classes tells each
        // class only about its own. An id that is not an id is skipped; the rest still counts.
        for (const raw of leftProfiles) {
          if (typeof raw !== 'string' || !ID.test(raw) || listed.has(raw)) continue;
          // The phone's Guest goes by its installation id. An older build could also have left
          // a 'guest' placeholder for it here, which is the same Guest and leaves with it.
          const placeholder = raw === installationId && !listed.has('guest') ? 'guest' : raw;
          await tx.runAsync(
            `UPDATE activity_students SET left_at=? WHERE class_id=? AND installation_id=?
             AND profile_id IN (?,?) AND left_at IS NULL`,
            at,
            classId,
            installationId,
            raw,
            placeholder
          );
        }
        // A phone that only came to say its profiles left must not leave a Guest tile behind.
        if (
          !recordSync &&
          profiles.length === 0 &&
          leftProfiles.length === 0 &&
          !(await hasStudents(tx, classId, installationId))
        )
          await ensureGuestRow(tx, classId, installationId, at);
        for (const event of events) {
          const eventId = event.id;
          if (typeof eventId !== 'string' || !ID.test(eventId)) throw new Error('event id');
          const name = typeof event.name === 'string' ? event.name : '';
          const occurredAt = typeof event.occurred_at === 'number' ? event.occurred_at : 0;
          const props =
            event.props && typeof event.props === 'object' && !Array.isArray(event.props)
              ? event.props
              : null;
          const profileId =
            props?.profile_kind === 'student'
              ? typeof props.profile_id === 'string'
                ? props.profile_id
                : ''
              : await ensureGuestRow(tx, classId, installationId, at);
          const propsText = props ? JSON.stringify(props) : '';
          if (
            !EVENTS.has(name) ||
            !Number.isInteger(occurredAt) ||
            occurredAt < MIN_OCCURRED_AT ||
            occurredAt > MAX_OCCURRED_AT ||
            props === null ||
            propsText.length > MAX_PROPS ||
            (profileId !== 'guest' && !ID.test(profileId))
          ) {
            rejected.push(eventId);
            continue;
          }
          // A removed student's phone was never told and would resend forever, so the event
          // is acknowledged as taken — but nothing of it is kept.
          if ((await removedAt(tx, classId, installationId, profileId)) !== null) {
            accepted.push(eventId);
            continue;
          }
          await tx.runAsync(
            `INSERT OR IGNORE INTO activity_events
             (class_id,installation_id,event_id,profile_id,event_name,correct,occurred_at,received_at,props)
             VALUES(?,?,?,?,?,?,?,?,?)`,
            classId,
            installationId,
            eventId,
            profileId,
            name,
            props.correct === true ? 1 : 0,
            occurredAt,
            at,
            propsText
          );
          if ((await studentName(tx, classId, installationId, profileId)) === null)
            await tx.runAsync(
              `INSERT OR IGNORE INTO activity_students(class_id,installation_id,profile_id,name,first_seen)
               VALUES(?,?,?,?,?)`,
              classId,
              installationId,
              profileId,
              'Recovered student',
              at
            );
          accepted.push(eventId);
        }
        if (recordSync)
          await tx.runAsync(
            `INSERT INTO activity_devices(class_id,installation_id,last_sync,last_seen,last_accepted,last_rejected)
             VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,installation_id) DO UPDATE SET
             last_sync=excluded.last_sync, last_seen=excluded.last_seen,
             last_accepted=CASE WHEN ? > 0 THEN excluded.last_accepted ELSE activity_devices.last_accepted END,
             last_rejected=CASE WHEN ? > 0 THEN excluded.last_rejected ELSE activity_devices.last_rejected END`,
            classId,
            installationId,
            at,
            at,
            accepted.length,
            rejected.length,
            events.length,
            events.length
          );
        else
          await tx.runAsync(
            `INSERT INTO activity_devices(class_id,installation_id,last_sync,last_seen,last_accepted,last_rejected)
             VALUES(?,?,0,?,0,0) ON CONFLICT(class_id,installation_id) DO UPDATE SET last_seen=excluded.last_seen`,
            classId,
            installationId,
            at
          );
      });
      return { accepted, rejected };
    },

    // ---- roster ----

    /**
     * The learners in a class with their totals. A learner the teacher removed is never listed;
     * one whose phone said they left only when `includeLeft`.
     */
    async students(classId: string, includeLeft = false): Promise<StudentRow[]> {
      const rows = await db.getAllAsync<Record<string, unknown>>(
        `SELECT s.class_id, s.installation_id, s.profile_id, s.name, s.roster_student_id,
          COALESCE(SUM(e.event_name='card_viewed'),0) AS cards,
          COALESCE(SUM(e.event_name='quiz_graded'),0) AS quizzes,
          COALESCE(SUM(e.event_name='quiz_graded' AND e.correct=1),0) AS correct,
          COALESCE(SUM(e.event_name IN ('download_failed','model_load_failed','generation_failed')),0) AS failures,
          COUNT(e.event_id) AS events, COALESCE(d.last_sync,0) AS last_sync, COALESCE(d.last_seen,0) AS last_seen,
          COALESCE(d.last_accepted,0) AS last_accepted, COALESCE(d.last_rejected,0) AS last_rejected,
          COALESCE(s.left_at,0) AS left_at
         FROM activity_students s
         LEFT JOIN activity_events e ON e.class_id=s.class_id AND e.installation_id=s.installation_id
           AND e.profile_id=s.profile_id
         LEFT JOIN activity_devices d ON d.class_id=s.class_id AND d.installation_id=s.installation_id
         WHERE s.removed_at IS NULL AND s.class_id=? ${includeLeft ? '' : 'AND s.left_at IS NULL'}
         GROUP BY s.class_id, s.installation_id, s.profile_id
         ORDER BY lower(s.name), s.profile_id`,
        classId
      );
      return rows.map((r) => ({
        classId: r.class_id as string,
        installationId: r.installation_id as string,
        profileId: r.profile_id as string,
        name: r.name as string,
        cards: r.cards as number,
        quizzes: r.quizzes as number,
        correct: r.correct as number,
        failures: r.failures as number,
        events: r.events as number,
        lastSync: r.last_sync as number,
        lastSeen: r.last_seen as number,
        lastAccepted: r.last_accepted as number,
        lastRejected: r.last_rejected as number,
        leftAt: r.left_at as number,
        rosterStudentId: (r.roster_student_id as string | null) ?? null,
      }));
    },

    /**
     * The teacher's Remove from class. The learner's activity on this phone goes, and they
     * disappear from the class. The row itself stays behind as the marker ingest checks: the
     * phone is never told, so it keeps listing the profile and sending its events, and neither
     * may bring the learner back.
     */
    async removeStudent(student: {
      classId: string;
      installationId: string;
      profileId: string;
    }): Promise<void> {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync(
          `UPDATE activity_students SET removed_at=?, roster_student_id=NULL WHERE class_id=? AND installation_id=?
           AND profile_id=? AND removed_at IS NULL`,
          now(),
          student.classId,
          student.installationId,
          student.profileId
        );
        await tx.runAsync(
          'DELETE FROM activity_events WHERE class_id=? AND installation_id=? AND profile_id=?',
          student.classId,
          student.installationId,
          student.profileId
        );
      });
    },

    /** PRD ACT-6: linking a connected learner to a roster row is an explicit teacher action. */
    async linkRosterStudent(
      student: { classId: string; installationId: string; profileId: string },
      rosterStudentId: string | null
    ): Promise<void> {
      await db.runAsync(
        `UPDATE activity_students SET roster_student_id=? WHERE class_id=? AND installation_id=? AND profile_id=?`,
        rosterStudentId,
        student.classId,
        student.installationId,
        student.profileId
      );
    },

    /** Saved avatars, keyed "installation:profile"; new ones are saved on first sight, then fixed. */
    async avatars(
      classId: string,
      proposed: {
        installationId: string;
        profileId: string;
        animalIndex: number;
        colorIndex: number;
      }[]
    ): Promise<Map<string, { animalIndex: number; colorIndex: number }>> {
      const saved = new Map<string, { animalIndex: number; colorIndex: number }>();
      for (const r of await db.getAllAsync<{
        installation_id: string;
        profile_id: string;
        animal_index: number;
        color_index: number;
      }>(
        'SELECT installation_id, profile_id, animal_index, color_index FROM activity_avatars WHERE class_id=?',
        classId
      ))
        saved.set(`${r.installation_id}:${r.profile_id}`, {
          animalIndex: r.animal_index,
          colorIndex: r.color_index,
        });
      for (const p of proposed) {
        const key = `${p.installationId}:${p.profileId}`;
        if (saved.has(key)) continue;
        await db.runAsync(
          `INSERT OR IGNORE INTO activity_avatars(class_id,installation_id,profile_id,animal_index,color_index)
           VALUES(?,?,?,?,?)`,
          classId,
          p.installationId,
          p.profileId,
          p.animalIndex,
          p.colorIndex
        );
        saved.set(key, { animalIndex: p.animalIndex, colorIndex: p.colorIndex });
      }
      return saved;
    },

    // ---- activity queries ----

    async eventCount(classId: string): Promise<number> {
      return (
        (
          await db.getFirstAsync<{ n: number }>(
            'SELECT COUNT(*) AS n FROM activity_events WHERE class_id=?',
            classId
          )
        )?.n ?? 0
      );
    },

    /** Activity since a learner-recorded time, leaving out learners who left (eventCountSince). */
    async eventCountSince(classId: string, since: number): Promise<number> {
      return (
        (
          await db.getFirstAsync<{ n: number }>(
            `SELECT COUNT(*) AS n FROM activity_events e WHERE e.class_id=? AND e.occurred_at>=? AND NOT EXISTS (
               SELECT 1 FROM activity_students s WHERE s.class_id=e.class_id AND s.installation_id=e.installation_id
               AND s.profile_id=e.profile_id AND s.left_at IS NOT NULL)`,
            classId,
            since
          )
        )?.n ?? 0
      );
    },

    /** Card views and graded quizzes in [from, until), by learner-recorded time. */
    async learningEvents(
      student: { classId: string; installationId: string; profileId: string },
      from = -8640000000000000,
      until = 8640000000000000
    ): Promise<LearningEvent[]> {
      return (
        await db.getAllAsync<{
          event_name: string;
          occurred_at: number;
          correct: number;
          props: string;
        }>(
          `SELECT event_name, occurred_at, correct, props FROM activity_events
           WHERE class_id=? AND installation_id=? AND profile_id=?
           AND event_name IN ('card_viewed','quiz_graded') AND occurred_at>=? AND occurred_at<?
           ORDER BY occurred_at`,
          student.classId,
          student.installationId,
          student.profileId,
          from,
          until
        )
      ).map(learningEvent);
    },

    /** When the learner last viewed a card or answered a quiz before `before`, if ever. */
    async latestLearningBefore(
      student: { classId: string; installationId: string; profileId: string },
      before: number
    ): Promise<number | null> {
      const row = await db.getFirstAsync<{ occurred_at: number }>(
        `SELECT occurred_at FROM activity_events WHERE class_id=? AND installation_id=? AND profile_id=?
         AND event_name IN ('card_viewed','quiz_graded') AND occurred_at<? ORDER BY occurred_at DESC LIMIT 1`,
        student.classId,
        student.installationId,
        student.profileId,
        before
      );
      return row?.occurred_at ?? null;
    },

    /**
     * The learner's most recent days with any learning before `before`, newest first, each with
     * all of that day's events; empty days are skipped. Days are local calendar days
     * (`dayOf`/`bounds` come from learning.ts so tests can pin a zone). Page backwards by passing
     * the start of the oldest day returned.
     */
    async learningDays(
      student: { classId: string; installationId: string; profileId: string },
      before: number,
      count: number,
      calendar: {
        isoDay(ms: number): string;
        dayBounds(iso: string): { start: number; end: number };
      }
    ): Promise<{ date: string; events: LearningEvent[] }[]> {
      const days: { date: string; events: LearningEvent[] }[] = [];
      let cursor = before;
      while (days.length < count) {
        const latest = await store.latestLearningBefore(student, cursor);
        if (latest === null) break;
        const date = calendar.isoDay(latest);
        const { start, end } = calendar.dayBounds(date);
        days.push({ date, events: await store.learningEvents(student, start, end) });
        cursor = start;
      }
      return days;
    },

    async storedEvents(classId: string): Promise<StoredEvent[]> {
      return (
        await db.getAllAsync<Record<string, unknown>>(
          `SELECT installation_id, profile_id, event_id, event_name, occurred_at, received_at, correct, props
           FROM activity_events WHERE class_id=? ORDER BY received_at, occurred_at, event_id`,
          classId
        )
      ).map((r) => ({
        installationId: r.installation_id as string,
        profileId: r.profile_id as string,
        eventId: r.event_id as string,
        name: r.event_name as string,
        occurredAt: r.occurred_at as number,
        receivedAt: r.received_at as number,
        correct: (r.correct as number) !== 0,
        props: r.props as string,
      }));
    },
  };
  return store;
}
