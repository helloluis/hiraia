import * as SQLite from 'expo-sqlite';
import {
  activityWindows,
  type ActivityCounts,
  type ActivitySummary,
  type ActivityDetailRow,
  type ActivityReport,
} from './activity';
import { newId, type Event, type Repository } from './core';
import {
  TEACHER_LEAVE_AGE,
  TEACHER_QUEUE_AGE,
  TEACHER_QUEUE_MAX,
  TEACHER_REJOIN_NOTICE_AGE,
  type ClassKey,
  type LeaveTombstone,
  type ScopedBinding,
  type TeacherStore,
} from '../tala/queue';
import { ID, cleanClassName, sanitizeEvent, type TeacherEvent } from '../tala/protocol';
import { GUEST_SCOPE, eventScope, scopeProps, wireId } from '../tala/scope';

const MAX_EVENTS = 10000;
const MAX_AGE = 90 * 86400000;
export interface TelemetryRepository extends Repository, TeacherStore {
  activity(now?: number, profileId?: string): Promise<ActivitySummary>;
  activityReport(start: number, end: number, profileId?: string): Promise<ActivityReport>;
  isEnabled(): Promise<boolean>;
  setEnabled(value: boolean): Promise<void>;
}
export async function openRepository(session: Event): Promise<TelemetryRepository> {
  // Separate file: telemetry failures and migrations cannot break the learning database.
  const db = await SQLite.openDatabaseAsync('hiraia-telemetry.db');
  // expo-sqlite gives every exclusive transaction its OWN connection, and the busy_timeout below
  // belongs to this one alone, so two writers that meet fail at once with "database is locked".
  // At launch that is routine (the image downloader logs events while Tala starts up), and the
  // losing write used to be dropped. A failed transaction has rolled back entirely: run it again.
  const write = async (task: Parameters<typeof db.withExclusiveTransactionAsync>[0]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await db.withExclusiveTransactionAsync(task);
      } catch (error) {
        if (attempt >= 6 || !/database (table )?is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error)))
          throw error;
        await new Promise((r) => setTimeout(r, 20 * 2 ** attempt * (0.5 + Math.random())));
      }
    }
  };
  await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
      queued_at INTEGER NOT NULL,event TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,occurred_at INTEGER NOT NULL,
      name TEXT NOT NULL,source TEXT,correct INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_time ON activity(occurred_at);
    CREATE TABLE IF NOT EXISTS activity_details(id TEXT PRIMARY KEY,grade INTEGER,language TEXT,card_id TEXT);
    CREATE INDEX IF NOT EXISTS activity_details_grade ON activity_details(grade);
    CREATE TABLE IF NOT EXISTS teacher_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
      queued_at INTEGER NOT NULL,event TEXT NOT NULL,scope TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS teacher_sent(id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS activity_payloads(id TEXT PRIMARY KEY,event TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teacher_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS teacher_bindings(scope TEXT PRIMARY KEY,class_id TEXT NOT NULL,
      public_key TEXT NOT NULL,class_name TEXT NOT NULL DEFAULT '',bound_at INTEGER NOT NULL,
      last_sync INTEGER NOT NULL DEFAULT 0,dropped INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS teacher_sent_scoped(class_id TEXT NOT NULL,id TEXT NOT NULL,
      PRIMARY KEY(class_id,id));
    CREATE TABLE IF NOT EXISTS teacher_leaves(class_id TEXT NOT NULL,public_key TEXT NOT NULL,
      wire_id TEXT NOT NULL,left_at INTEGER NOT NULL,PRIMARY KEY(class_id,wire_id));
    CREATE TABLE IF NOT EXISTS teacher_rejoined(scope TEXT PRIMARY KEY);`);
  await write(async (tx) => {
    const columns = await tx.getAllAsync<{ name: string }>('PRAGMA table_info(activity_details)');
    if (!columns.some((c) => c.name === 'profile_id'))
      await tx.runAsync(
        "ALTER TABLE activity_details ADD COLUMN profile_id TEXT NOT NULL DEFAULT 'guest'"
      );
    await tx.runAsync(
      'CREATE INDEX IF NOT EXISTS activity_details_profile ON activity_details(profile_id)'
    );
  });
  const recordActivity = async (tx: Pick<SQLite.SQLiteDatabase, 'runAsync'>, e: Event) => {
    if (e.name !== 'card_viewed' && e.name !== 'quiz_graded') return;
    await tx.runAsync(
      'INSERT OR IGNORE INTO activity_payloads(id,event) VALUES(?,?)',
      e.id,
      JSON.stringify(e)
    );
    await tx.runAsync(
      'INSERT OR IGNORE INTO activity(id,occurred_at,name,source,correct) VALUES(?,?,?,?,?)',
      e.id,
      e.occurred_at,
      e.name,
      String(e.props.source || ''),
      e.props.correct === true ? 1 : 0
    );
    const grade = Number(e.props.grade);
    await tx.runAsync(
      'INSERT OR IGNORE INTO activity_details(id,grade,language,card_id,profile_id) VALUES(?,?,?,?,?)',
      e.id,
      Number.isInteger(grade) && grade >= 3 && grade <= 10 ? grade : null,
      typeof e.props.language === 'string' ? e.props.language : null,
      typeof e.props.card_id === 'string'
        ? e.props.card_id
        : typeof e.props.question_id === 'string'
          ? e.props.question_id
          : null,
      typeof e.props.profile_id === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(e.props.profile_id)
        ? e.props.profile_id
        : 'guest'
    );
  };
  // Backfill only pending records: acknowledged historic events no longer exist locally.
  await write(async (tx) => {
    const migrated = await tx.getFirstAsync("SELECT value FROM meta WHERE key='activity_since'");
    if (!migrated) {
      await tx.runAsync(
        "INSERT INTO meta(key,value) VALUES('activity_since',?)",
        String(Date.now())
      );
      const pending = await tx.getAllAsync<{ event: string }>('SELECT event FROM outbox');
      for (const row of pending) {
        try {
          const e = JSON.parse(row.event) as Event;
          if (typeof e.id === 'string' && Number.isSafeInteger(e.occurred_at) && e.props)
            await recordActivity(tx, e);
        } catch {
          /* Malformed queued records are handled by list(). */
        }
      }
    }
  });
  // Upgrade once using metadata that still exists in the delivery queue. Never infer a
  // historic grade from today's persona. Acknowledged old rows remain unattributed.
  await write(async (tx) => {
    if (await tx.getFirstAsync("SELECT value FROM meta WHERE key='activity_details_since'")) return;
    await tx.runAsync(
      "INSERT INTO meta(key,value) VALUES('activity_details_since',?)",
      String(Date.now())
    );
    const pending = await tx.getAllAsync<{ event: string }>('SELECT event FROM outbox');
    for (const row of pending) {
      try {
        const e = JSON.parse(row.event) as Event;
        if (typeof e.id === 'string' && Number.isSafeInteger(e.occurred_at) && e.props)
          await recordActivity(tx, e);
      } catch {
        /* Preserve legacy counters if a queued event cannot be read. */
      }
    }
  });
  await write(async (tx) => {
    if (await tx.getFirstAsync("SELECT value FROM meta WHERE key='activity_payloads_since'"))
      return;
    const pending = await tx.getAllAsync<{ event: string }>(
      'SELECT event FROM outbox UNION ALL SELECT event FROM teacher_outbox'
    );
    for (const row of pending) {
      try {
        const e = JSON.parse(row.event) as Event;
        if (sanitizeEvent(e)) await recordActivity(tx, e);
      } catch {
        /* Keep compact history when the original payload is unavailable. */
      }
    }
    await tx.runAsync(
      "INSERT INTO meta(key,value) VALUES('activity_payloads_since',?)",
      String(Date.now())
    );
  });
  // 0.4.24: classes are joined per student, not per phone. A 0.4.23 phone's one binding cannot
  // be attributed to any single student, so nobody inherits it and everyone re-scans. Its
  // delivered ids stay recorded for that class, so re-joining it does not resend history.
  await write(async (tx) => {
    const columns = await tx.getAllAsync<{ name: string }>('PRAGMA table_info(teacher_outbox)');
    if (!columns.some((c) => c.name === 'scope'))
      await tx.runAsync("ALTER TABLE teacher_outbox ADD COLUMN scope TEXT NOT NULL DEFAULT ''");
    await tx.runAsync(
      'CREATE INDEX IF NOT EXISTS teacher_outbox_scope ON teacher_outbox(scope,seq)'
    );
    if (await tx.getFirstAsync("SELECT value FROM meta WHERE key='teacher_scoped_v1'")) return;
    const legacy = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM teacher_meta WHERE key='class_id'"
    );
    if (legacy?.value) {
      await tx.runAsync(
        'INSERT OR IGNORE INTO teacher_sent_scoped(class_id,id) SELECT ?,id FROM teacher_sent',
        legacy.value
      );
      await tx.runAsync(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('teacher_rejoin_at',?)",
        String(Date.now())
      );
      // That class listed every profile on the phone (or the Guest). Its key is kept until the
      // profiles are loaded, so it can be told who left: settleLegacyClass.
      const key = await tx.getFirstAsync<{ value: string }>(
        "SELECT value FROM teacher_meta WHERE key='public_key'"
      );
      if (key?.value)
        await tx.runAsync(
          "INSERT OR REPLACE INTO meta(key,value) VALUES('teacher_legacy',?)",
          JSON.stringify({ class_id: legacy.value, public_key: key.value, left_at: Date.now() })
        );
    }
    // Unscoped rows mix every student's events; each student's history is paged in again on join.
    await tx.runAsync("DELETE FROM teacher_outbox WHERE scope=''");
    await tx.runAsync(
      "DELETE FROM teacher_meta WHERE key IN ('class_id','public_key','bound_at','last_sync','dropped','status')"
    );
    await tx.runAsync(
      "INSERT INTO meta(key,value) VALUES('teacher_scoped_v1',?)",
      String(Date.now())
    );
  });
  let installationId = '';
  // One connection and exclusive transactions: appends/acks/initialization cannot mingle.
  await write(async (tx) => {
    const row = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key='installation'"
    );
    installationId = row?.value || newId();
    const preference = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key='enabled'"
    );
    if (!row) {
      await tx.runAsync("INSERT INTO meta(key,value) VALUES('installation',?)", installationId);
      const first = { ...session, name: 'first_open', id: newId() };
      if (preference?.value !== 'false')
        await tx.runAsync(
          'INSERT INTO outbox(id,queued_at,event) VALUES(?,?,?)',
          first.id,
          Date.now(),
          JSON.stringify(first)
        );
    }
    if (preference?.value !== 'false')
      await tx.runAsync(
        'INSERT OR IGNORE INTO outbox(id,queued_at,event) VALUES(?,?,?)',
        session.id,
        Date.now(),
        JSON.stringify(session)
      );
  });
  return {
    installationId,
    async activity(now = Date.now(), profileId?: string) {
      const counts: ActivityCounts[] = [];
      for (const start of activityWindows(now)) {
        const row = await db.getFirstAsync<ActivityCounts>(
          `
          SELECT COALESCE(SUM(a.name='card_viewed'),0) AS cards,
            COALESCE(COUNT(DISTINCT CASE WHEN a.name='card_viewed' AND d.card_id IS NOT NULL AND d.card_id != '' THEN d.card_id END),0) AS unique_cards,
            COALESCE(SUM(a.name='card_viewed' AND a.source='generated'),0) AS dynamic,
            COALESCE(SUM(a.name='quiz_graded'),0) AS quizzes,
            COALESCE(SUM(a.name='quiz_graded' AND a.correct=1),0) AS correct
          FROM activity a LEFT JOIN activity_details d ON a.id=d.id WHERE a.occurred_at >= ? AND a.occurred_at <= ? AND (? IS NULL OR COALESCE(d.profile_id,'guest')=?)`,
          start,
          now,
          profileId ?? null,
          profileId ?? null
        );
        counts.push(row!);
      }
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='activity_since'"
      );
      return { counts, since: Number(row!.value), asOf: now };
    },
    async activityReport(start, end, profileId) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
        throw new Error('Invalid activity range');
      const rows = await db.getAllAsync<ActivityDetailRow>(
        `
        SELECT d.grade, d.language, d.card_id AS cardId, a.source,
          SUM(a.name='card_viewed') AS cards,
          COUNT(DISTINCT CASE WHEN a.name='card_viewed' AND d.card_id IS NOT NULL AND d.card_id != '' THEN d.card_id END) AS unique_cards,
          SUM(a.name='card_viewed' AND a.source='generated') AS dynamic,
          SUM(a.name='quiz_graded') AS quizzes,
          SUM(a.name='quiz_graded' AND a.correct=1) AS correct,
          MAX(a.occurred_at) AS lastSeen
        FROM activity a LEFT JOIN activity_details d ON a.id=d.id
        WHERE a.occurred_at >= ? AND a.occurred_at <= ? AND (? IS NULL OR COALESCE(d.profile_id,'guest')=?)
        GROUP BY d.grade,d.language,d.card_id,a.source`,
        start,
        end,
        profileId ?? null,
        profileId ?? null
      );
      const days = await db.getAllAsync<{ grade: number | null; days: number }>(
        `
        SELECT d.grade, COUNT(DISTINCT date(a.occurred_at/1000,'unixepoch','localtime')) AS days
        FROM activity a LEFT JOIN activity_details d ON a.id=d.id
        WHERE a.occurred_at >= ? AND a.occurred_at <= ? AND (? IS NULL OR COALESCE(d.profile_id,'guest')=?) GROUP BY d.grade`,
        start,
        end,
        profileId ?? null,
        profileId ?? null
      );
      const since = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='activity_details_since'"
      );
      return { rows, days, since: Number(since!.value), asOf: Date.now(), start, end };
    },
    async isEnabled() {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='enabled'"
      );
      return row?.value !== 'false';
    },
    async setEnabled(value) {
      await write(async (tx) => {
        await tx.runAsync(
          "INSERT OR REPLACE INTO meta(key,value) VALUES('enabled',?)",
          String(value)
        );
        if (!value) {
          await tx.runAsync('DELETE FROM outbox');
          await tx.runAsync('DELETE FROM teacher_outbox');
        }
      });
    },
    async bindings() {
      return db.getAllAsync<ScopedBinding>(
        `SELECT scope,class_id,public_key,class_name,bound_at,last_sync,dropped
        FROM teacher_bindings ORDER BY bound_at,scope`
      );
    },
    async binding(scope) {
      return (
        (await db.getFirstAsync<ScopedBinding>(
          `SELECT scope,class_id,public_key,class_name,bound_at,last_sync,dropped
          FROM teacher_bindings WHERE scope=?`,
          scope
        )) ?? null
      );
    },
    async bind(scope, next) {
      await write(async (tx) => {
        const previous = await tx.getFirstAsync<ClassKey>(
          'SELECT class_id,public_key FROM teacher_bindings WHERE scope=?',
          scope
        );
        const same =
          previous?.class_id === next.class_id && previous?.public_key === next.public_key;
        const name = cleanClassName(next.class_name);
        if (same) {
          // Re-scanning the same QR keeps this student's queue; a newer name still applies.
          await tx.runAsync(
            "UPDATE teacher_bindings SET bound_at=?,class_name=CASE WHEN ?='' THEN class_name ELSE ? END WHERE scope=?",
            next.bound_at,
            name,
            name,
            scope
          );
        } else {
          // Binding + this student's delivery reset are one transaction. Delivered ids are kept
          // per class, so a student who returns to a class does not resend its history.
          await tx.runAsync('DELETE FROM teacher_outbox WHERE scope=?', scope);
          await tx.runAsync(
            `INSERT OR REPLACE INTO teacher_bindings(scope,class_id,public_key,class_name,bound_at,last_sync,dropped)
            VALUES(?,?,?,?,?,0,0)`,
            scope,
            next.class_id,
            next.public_key,
            name,
            next.bound_at
          );
        }
        // Coming back cancels a leave the teacher has not been told about yet.
        await tx.runAsync(
          'DELETE FROM teacher_leaves WHERE class_id=? AND wire_id=?',
          next.class_id,
          wireId(scope, installationId)
        );
        await tx.runAsync('INSERT OR IGNORE INTO teacher_rejoined(scope) VALUES(?)', scope);
      });
    },
    async unbind(scope) {
      await write(async (tx) => {
        const previous = await tx.getFirstAsync<ClassKey>(
          'SELECT class_id,public_key FROM teacher_bindings WHERE scope=?',
          scope
        );
        await tx.runAsync('DELETE FROM teacher_outbox WHERE scope=?', scope);
        await tx.runAsync('DELETE FROM teacher_bindings WHERE scope=?', scope);
        if (previous)
          await tx.runAsync(
            'INSERT OR REPLACE INTO teacher_leaves(class_id,public_key,wire_id,left_at) VALUES(?,?,?,?)',
            previous.class_id,
            previous.public_key,
            wireId(scope, installationId),
            Date.now()
          );
      });
    },
    async settleLegacyClass(profileIds) {
      // One transaction, then the record is gone: a crash retries it all, a rerun does nothing.
      await write(async (tx) => {
        const row = await tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM meta WHERE key='teacher_legacy'"
        );
        if (!row) return;
        let legacy: Partial<LeaveTombstone> = {};
        try {
          legacy = JSON.parse(row.value) as Partial<LeaveTombstone>;
        } catch {
          /* Unreadable: nothing can be told to that class. */
        }
        const { class_id, public_key, left_at } = legacy;
        if (typeof class_id === 'string' && typeof public_key === 'string') {
          // Whoever is in that class again is not leaving it (bind also cancels a later notice).
          const back = new Set(
            (
              await tx.getAllAsync<{ scope: string }>(
                'SELECT scope FROM teacher_bindings WHERE class_id=?',
                class_id
              )
            ).map((b) => b.scope)
          );
          // 0.4.23 listed every named profile, or the Guest (as the installation) when there
          // was none. An id that class never saw is ignored by Tala, so all of them are told.
          for (const scope of new Set([...profileIds, GUEST_SCOPE])) {
            const wire = wireId(scope, installationId);
            if (back.has(scope) || !ID.test(wire)) continue;
            await tx.runAsync(
              'INSERT OR IGNORE INTO teacher_leaves(class_id,public_key,wire_id,left_at) VALUES(?,?,?,?)',
              class_id,
              public_key,
              wire,
              typeof left_at === 'number' && Number.isSafeInteger(left_at) ? left_at : Date.now()
            );
          }
        }
        await tx.runAsync("DELETE FROM meta WHERE key='teacher_legacy'");
      });
    },
    async leaves() {
      await db.runAsync(
        'DELETE FROM teacher_leaves WHERE left_at < ?',
        Date.now() - TEACHER_LEAVE_AGE
      );
      return db.getAllAsync<LeaveTombstone>(
        'SELECT class_id,public_key,wire_id,left_at FROM teacher_leaves ORDER BY left_at'
      );
    },
    async clearLeaves(classId, wireIds) {
      if (!wireIds.length) return;
      await db.runAsync(
        `DELETE FROM teacher_leaves WHERE class_id=? AND wire_id IN (${wireIds.map(() => '?').join(',')})`,
        classId,
        ...wireIds
      );
    },
    async setClassName(expected, value) {
      const name = cleanClassName(value);
      if (!name) return;
      await db.runAsync(
        'UPDATE teacher_bindings SET class_name=? WHERE class_id=? AND public_key=?',
        name,
        expected.class_id,
        expected.public_key
      );
    },
    async teacherAppend(events: TeacherEvent[]) {
      await write(async (tx) => {
        const preference = await tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM meta WHERE key='enabled'"
        );
        if (preference?.value === 'false') return;
        const bound = new Map(
          (
            await tx.getAllAsync<{ scope: string; class_id: string }>(
              'SELECT scope,class_id FROM teacher_bindings'
            )
          ).map((b) => [b.scope, b.class_id])
        );
        if (!bound.size) return;
        // Each event joins its own student's queue, and only if that student is in a class.
        const touched = new Map<string, { template: TeacherEvent; reported: number }>();
        for (const e of events) {
          const clean = sanitizeEvent(e);
          if (!clean) continue;
          const scope = eventScope(clean.props);
          const classId = bound.get(scope);
          if (!classId) continue;
          const entry = touched.get(scope) ?? { template: clean, reported: 0 };
          touched.set(scope, entry);
          if (clean.name === 'queue_dropped') {
            entry.reported += Number(clean.props.count || 0);
            continue;
          }
          if (
            await tx.getFirstAsync(
              'SELECT 1 FROM teacher_sent_scoped WHERE class_id=? AND id=?',
              classId,
              clean.id
            )
          )
            continue;
          await tx.runAsync(
            'INSERT OR IGNORE INTO teacher_outbox(id,queued_at,event,scope) VALUES(?,?,?,?)',
            clean.id,
            Date.now(),
            JSON.stringify(clean),
            scope
          );
        }
        // Caps are per student, so one busy sibling cannot evict another's unsent work.
        for (const [scope, entry] of touched) {
          const old = await tx.runAsync(
            'DELETE FROM teacher_outbox WHERE scope=? AND queued_at < ?',
            scope,
            Date.now() - TEACHER_QUEUE_AGE
          );
          const extra = await tx.runAsync(
            'DELETE FROM teacher_outbox WHERE seq IN (SELECT seq FROM teacher_outbox WHERE scope=? ORDER BY seq DESC LIMIT -1 OFFSET ?)',
            scope,
            TEACHER_QUEUE_MAX - 1
          );
          const dropped = old.changes + extra.changes + entry.reported;
          if (!dropped) continue;
          await tx.runAsync(
            'UPDATE teacher_bindings SET dropped=dropped+? WHERE scope=?',
            dropped,
            scope
          );
          const row = await tx.getFirstAsync<{ dropped: number }>(
            'SELECT dropped FROM teacher_bindings WHERE scope=?',
            scope
          );
          // The report carries its student's identity, or the teacher would file it under Guest.
          const report = {
            ...entry.template,
            id: newId(),
            name: 'queue_dropped',
            occurred_at: Date.now(),
            props: { count: Number(row?.dropped || dropped), ...scopeProps(scope) },
          };
          await tx.runAsync(
            'INSERT INTO teacher_outbox(id,queued_at,event,scope) VALUES(?,?,?,?)',
            report.id,
            Date.now(),
            JSON.stringify(report),
            scope
          );
        }
      });
    },
    async teacherList(expected, scopes, limit) {
      const preference = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='enabled'"
      );
      if (preference?.value === 'false' || !scopes.length) return [];
      let live: string[] = [];
      // Page retained learning history into the bounded delivery queue. A large semester
      // never needs to fit in memory/the outbox; ACKs advance recovery across restarts.
      await write(async (tx) => {
        const enabled = await tx.getFirstAsync<{value: string}>("SELECT value FROM meta WHERE key='enabled'");
        if (enabled?.value === 'false') return;
        // Only students still in this class: one who left mid-sync sends nothing more.
        live = (
          await tx.getAllAsync<{ scope: string }>(
            `SELECT scope FROM teacher_bindings WHERE class_id=? AND public_key=?
            AND scope IN (${scopes.map(() => '?').join(',')})`,
            expected.class_id,
            expected.public_key,
            ...scopes
          )
        ).map((r) => r.scope);
        if (!live.length) return;
        const within = live.map(() => '?').join(',');
        const queued = await tx.getFirstAsync<{ n: number }>(
          `SELECT count(*) n FROM teacher_outbox WHERE scope IN (${within})`,
          ...live
        );
        const room = Math.max(0, Math.min(50, limit) - (queued?.n || 0));
        if (!room) return;
        // History with no known owner goes nowhere. The Guest is whoever used the phone without
        // a profile since profiles were recorded; before that, 'guest' only means "unattributed"
        // (the column's default, and rows backfilled from pre-profile builds), which may be any
        // sibling. Rows with no details row at all are unattributed too.
        const attributed = await tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM meta WHERE key='activity_details_since'"
        );
        const since = Number(attributed?.value);
        const history = await tx.getAllAsync<{
          id: string;
          occurred_at: number;
          name: string;
          source: string;
          correct: number;
          grade: number | null;
          card_id: string | null;
          scope: string;
          language: string | null;
          event: string | null;
        }>(
          `SELECT a.id,a.occurred_at,a.name,a.source,a.correct,d.grade,d.card_id,
            d.profile_id AS scope,d.language,p.event
          FROM activity a JOIN activity_details d ON a.id=d.id
          LEFT JOIN activity_payloads p ON a.id=p.id
          WHERE a.name IN ('card_viewed','quiz_graded') AND a.occurred_at>=1577836800000
          AND length(a.id) BETWEEN 16 AND 80 AND a.id NOT GLOB '*[^A-Za-z0-9_-]*'
          AND d.profile_id IN (${within})
          AND (d.profile_id<>'guest' OR a.occurred_at>=?)
          AND NOT EXISTS(SELECT 1 FROM teacher_sent_scoped s WHERE s.class_id=? AND s.id=a.id)
          AND NOT EXISTS(SELECT 1 FROM teacher_outbox o WHERE o.id=a.id)
          ORDER BY a.occurred_at,a.id LIMIT ?`,
          ...live,
          Number.isSafeInteger(since) ? since : Number.MAX_SAFE_INTEGER,
          expected.class_id,
          room
        );
        for (const row of history) {
          let event: TeacherEvent | null = null;
          try {
            if (row.event) event = sanitizeEvent(JSON.parse(row.event) as TeacherEvent);
          } catch {}
          // The stored payload must speak for the same student its history row belongs to.
          if (event?.id !== row.id || eventScope(event.props) !== row.scope) event = null;
          if (!event) {
            const props: Record<string, string | number | boolean> = {};
            if (row.source === 'curated' || row.source === 'generated') props.source = row.source;
            if (row.card_id) props.card_id = row.card_id;
            if (row.grade != null) props.grade = row.grade;
            if (row.language) props.language = row.language;
            Object.assign(props, scopeProps(row.scope));
            if (row.name === 'quiz_graded') props.correct = row.correct === 1;
            event = sanitizeEvent({
              id: row.id,
              name: row.name,
              occurred_at: row.occurred_at,
              session_id: installationId,
              props,
              reconstructed: true,
            });
          }
          if (event)
            await tx.runAsync(
              'INSERT OR IGNORE INTO teacher_outbox(id,queued_at,event,scope) VALUES(?,?,?,?)',
              event.id,
              Date.now(),
              JSON.stringify(event),
              row.scope
            );
        }
      });
      if (!live.length) return [];
      const rows = await db.getAllAsync<{ id: string; event: string }>(
        `SELECT id,event FROM teacher_outbox WHERE scope IN (${live.map(() => '?').join(',')})
        ORDER BY seq LIMIT ?`,
        ...live,
        limit
      );
      const valid: TeacherEvent[] = [];
      for (const row of rows) {
        try {
          const e = JSON.parse(row.event) as TeacherEvent;
          const clean = sanitizeEvent(e);
          if (!clean || clean.id !== row.id) throw new Error('corrupt');
          valid.push(clean);
        } catch {
          await db.runAsync('DELETE FROM teacher_outbox WHERE id=?', row.id);
        }
      }
      return valid;
    },
    async teacherAcknowledge(ids, expected, lost = []) {
      if (!ids.length) return;
      await write(async (tx) => {
        // Only this class's key can read the batch, so its teacher really has these ids,
        // whatever happened to the binding meanwhile.
        for (const id of ids)
          await tx.runAsync(
            'INSERT OR IGNORE INTO teacher_sent_scoped(class_id,id) VALUES(?,?)',
            expected.class_id,
            id
          );
        // The queue rows, though, belong to whoever holds the binding now: a student who
        // re-joined elsewhere keeps the rows its new class still needs.
        const owned = `scope IN (SELECT scope FROM teacher_bindings WHERE class_id=? AND public_key=?)`;
        if (lost.length) {
          const losses = await tx.getAllAsync<{ scope: string; n: number }>(
            `SELECT scope,count(*) n FROM teacher_outbox
            WHERE id IN (${lost.map(() => '?').join(',')}) AND ${owned} GROUP BY scope`,
            ...lost,
            expected.class_id,
            expected.public_key
          );
          for (const { scope, n } of losses)
            await tx.runAsync(
              'UPDATE teacher_bindings SET dropped=dropped+? WHERE scope=?',
              n,
              scope
            );
        }
        await tx.runAsync(
          `DELETE FROM teacher_outbox WHERE id IN (${ids.map(() => '?').join(',')}) AND ${owned}`,
          ...ids,
          expected.class_id,
          expected.public_key
        );
      });
    },
    async setLastSync(scopes, time) {
      if (!scopes.length) return;
      await db.runAsync(
        `UPDATE teacher_bindings SET last_sync=? WHERE scope IN (${scopes.map(() => '?').join(',')})`,
        time,
        ...scopes
      );
    },
    async rejoinNotice(scope) {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='teacher_rejoin_at'"
      );
      const at = Number(row?.value || 0);
      if (!at || Date.now() - at > TEACHER_REJOIN_NOTICE_AGE) return 0;
      const settled = await db.getFirstAsync(
        'SELECT 1 FROM teacher_bindings WHERE scope=? UNION ALL SELECT 1 FROM teacher_rejoined WHERE scope=?',
        scope,
        scope
      );
      return settled ? 0 : at;
    },
    async append(events) {
      await write(async (tx) => {
        const preference = await tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM meta WHERE key='enabled'"
        );
        if (preference?.value === 'false') return;
        for (const e of events.filter((e) => e.name !== 'queue_dropped')) {
          await recordActivity(tx, e);
          await tx.runAsync(
            'INSERT OR IGNORE INTO outbox(id,queued_at,event) VALUES(?,?,?)',
            e.id,
            Date.now(),
            JSON.stringify(e)
          );
        }
        // Independent of upload acknowledgments and the bounded delivery queue.
        // Learning history is retained across semesters; only the delivery queue expires.
        const old = await tx.runAsync(
          'DELETE FROM outbox WHERE queued_at < ?',
          Date.now() - MAX_AGE
        );
        // Reserve room for one durable loss report. It accumulates across evictions.
        const extra = await tx.runAsync(
          'DELETE FROM outbox WHERE seq IN (SELECT seq FROM outbox ORDER BY seq DESC LIMIT -1 OFFSET ?)',
          MAX_EVENTS - 1
        );
        const dropped =
          old.changes +
          extra.changes +
          events
            .filter((e) => e.name === 'queue_dropped')
            .reduce((n, e) => n + Number(e.props.count || 0), 0);
        if (dropped) {
          const row = await tx.getFirstAsync<{ value: string }>(
            "SELECT value FROM meta WHERE key='dropped'"
          );
          const count = Number(row?.value || 0) + dropped;
          await tx.runAsync(
            "INSERT OR REPLACE INTO meta(key,value) VALUES('dropped',?)",
            String(count)
          );
        }
        const row = await tx.getFirstAsync<{ value: string }>(
          "SELECT value FROM meta WHERE key='dropped'"
        );
        if (dropped > 0 && events[0]) {
          const report = {
            ...events[0],
            id: newId(),
            name: 'queue_dropped',
            props: { count: Number(row!.value) },
          };
          await tx.runAsync(
            'INSERT INTO outbox(id,queued_at,event) VALUES(?,?,?)',
            report.id,
            Date.now(),
            JSON.stringify(report)
          );
        }
      });
    },
    async list(limit) {
      const preference = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='enabled'"
      );
      if (preference?.value === 'false') return [];
      const rows = await db.getAllAsync<{ id: string; event: string }>(
        'SELECT id,event FROM outbox ORDER BY seq LIMIT ?',
        limit
      );
      const valid: Event[] = [];
      for (const row of rows) {
        try {
          const e = JSON.parse(row.event) as Event;
          if (
            !e ||
            e.id !== row.id ||
            typeof e.name !== 'string' ||
            !Number.isSafeInteger(e.occurred_at) ||
            typeof e.session_id !== 'string' ||
            !e.props
          )
            throw new Error('corrupt event');
          valid.push(e);
        } catch {
          await write(async (tx) => {
            await tx.runAsync('DELETE FROM outbox WHERE id=?', row.id);
            await tx.runAsync(
              "INSERT INTO meta(key,value) VALUES('dropped','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1"
            );
          });
        }
      }
      return valid;
    },
    async acknowledge(ids) {
      if (ids.length)
        await db.runAsync(
          `DELETE FROM outbox WHERE id IN (${ids.map(() => '?').join(',')})`,
          ...ids
        );
    },
    async retryAt() {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='retry_at'"
      );
      // Device clock changes must not strand the queue indefinitely.
      const value = Number(row?.value || 0);
      if (value > Date.now() + 86400000) {
        const adjusted = Date.now() + 3600000;
        await db.runAsync(
          "INSERT OR REPLACE INTO meta(key,value) VALUES('retry_at',?)",
          String(adjusted)
        );
        return adjusted;
      }
      return value;
    },
    async setRetryAt(time) {
      await db.runAsync(
        "INSERT OR REPLACE INTO meta(key,value) VALUES('retry_at',?)",
        String(time)
      );
    },
  };
}
