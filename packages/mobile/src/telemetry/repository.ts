import * as SQLite from 'expo-sqlite';
import { activityWindows, type ActivityCounts, type ActivitySummary } from './activity';
import { newId, type Event, type Repository } from './core';

const MAX_EVENTS = 10000;
const MAX_AGE = 90 * 86400000;
export interface TelemetryRepository extends Repository {
  activity(now?: number): Promise<ActivitySummary>;
  isEnabled(): Promise<boolean>;
  setEnabled(value: boolean): Promise<void>;
}
export async function openRepository(session: Event): Promise<TelemetryRepository> {
  // Separate file: telemetry failures and migrations cannot break the learning database.
  const db = await SQLite.openDatabaseAsync('hiraia-telemetry.db');
  await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
      queued_at INTEGER NOT NULL,event TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY,occurred_at INTEGER NOT NULL,
      name TEXT NOT NULL,source TEXT,correct INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS activity_time ON activity(occurred_at);`);
  const recordActivity = async (tx: Pick<SQLite.SQLiteDatabase, 'runAsync'>, e: Event) => {
    if (e.name !== 'card_viewed' && e.name !== 'quiz_graded') return;
    await tx.runAsync('INSERT OR IGNORE INTO activity VALUES(?,?,?,?,?)',
      e.id, e.occurred_at, e.name, String(e.props.source || ''), e.props.correct === true ? 1 : 0);
  };
  // Backfill only pending records: acknowledged historic events no longer exist locally.
  await db.withExclusiveTransactionAsync(async (tx) => {
    const migrated = await tx.getFirstAsync("SELECT value FROM meta WHERE key='activity_since'");
    if (!migrated) {
      await tx.runAsync("INSERT INTO meta VALUES('activity_since',?)", String(Date.now()));
      const pending = await tx.getAllAsync<{event: string}>('SELECT event FROM outbox');
      for (const row of pending) {
        try {
          const e = JSON.parse(row.event) as Event;
          if (typeof e.id === 'string' && Number.isSafeInteger(e.occurred_at) && e.props)
            await recordActivity(tx, e);
        } catch { /* Malformed queued records are handled by list(). */ }
      }
    }
  });
  let installationId = '';
  // One connection and exclusive transactions: appends/acks/initialization cannot mingle.
  await db.withExclusiveTransactionAsync(async (tx) => {
    const row = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key='installation'"
    );
    installationId = row?.value || newId();
    const preference = await tx.getFirstAsync<{ value: string }>(
      "SELECT value FROM meta WHERE key='enabled'"
    );
    if (!row) {
      await tx.runAsync("INSERT INTO meta VALUES('installation',?)", installationId);
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
    async activity(now = Date.now()) {
      const counts: ActivityCounts[] = [];
      for (const start of activityWindows(now)) {
        const row = await db.getFirstAsync<ActivityCounts>(`
          SELECT COALESCE(SUM(name='card_viewed'),0) AS cards,
            COALESCE(SUM(name='card_viewed' AND source='generated'),0) AS dynamic,
            COALESCE(SUM(name='quiz_graded'),0) AS quizzes,
            COALESCE(SUM(name='quiz_graded' AND correct=1),0) AS correct
          FROM activity WHERE occurred_at >= ? AND occurred_at <= ?`, start, now);
        counts.push(row!);
      }
      const row = await db.getFirstAsync<{value:string}>("SELECT value FROM meta WHERE key='activity_since'");
      return { counts, since: Number(row!.value), asOf: now };
    },
    async isEnabled() {
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM meta WHERE key='enabled'"
      );
      return row?.value !== 'false';
    },
    async setEnabled(value) {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.runAsync("INSERT OR REPLACE INTO meta VALUES('enabled',?)", String(value));
        if (!value) await tx.runAsync('DELETE FROM outbox');
      });
    },
    async append(events) {
      await db.withExclusiveTransactionAsync(async (tx) => {
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
        // 100 days covers every calendar quarter plus clock/DST margin.
        await tx.runAsync('DELETE FROM activity WHERE occurred_at < ?', Date.now() - 100 * 86400000);
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
          await tx.runAsync("INSERT OR REPLACE INTO meta VALUES('dropped',?)", String(count));
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
          await db.withExclusiveTransactionAsync(async (tx) => {
            await tx.runAsync('DELETE FROM outbox WHERE id=?', row.id);
            await tx.runAsync(
              "INSERT INTO meta VALUES('dropped','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1"
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
        await db.runAsync("INSERT OR REPLACE INTO meta VALUES('retry_at',?)", String(adjusted));
        return adjusted;
      }
      return value;
    },
    async setRetryAt(time) {
      await db.runAsync("INSERT OR REPLACE INTO meta VALUES('retry_at',?)", String(time));
    },
  };
}
