import type { EntityName, LocalRecord, LocalStore, OutboxItem } from '@hiraia/tala-core/contracts';
/** Minimal SQLite surface; injected so durability and rollback run against real SQLite in tests. */
export interface Database {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (tx: Database) => Promise<void>): Promise<void>;
}
export async function createSqliteStore(db: Database): Promise<LocalStore> {
  await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS records(entity TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(entity,id));
    CREATE TABLE IF NOT EXISTS outbox(id TEXT NOT NULL PRIMARY KEY,json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meta(key TEXT NOT NULL PRIMARY KEY,value TEXT NOT NULL);`);
  const decode = <T>(rows: { json: string }[]) => rows.map((r) => JSON.parse(r.json) as T);
  return {
    async get(entity, id) {
      const r = await db.getFirstAsync<{ json: string }>(
        'SELECT json FROM records WHERE entity=? AND id=?',
        entity,
        id
      );
      return r ? JSON.parse(r.json) : null;
    },
    async list(entity: EntityName, opts) {
      return decode<LocalRecord>(
        await db.getAllAsync('SELECT json FROM records WHERE entity=? ORDER BY id', entity)
      ).filter((r) => opts?.includeDeleted || !r.deletedAt);
    },
    async commit(batch) {
      await db.withExclusiveTransactionAsync(async (tx) => {
        for (const r of batch.put ?? [])
          await tx.runAsync(
            'INSERT OR REPLACE INTO records VALUES(?,?,?)',
            r.entity,
            r.id,
            JSON.stringify(r)
          );
        for (const row of batch.remove ?? [])
          await tx.runAsync('DELETE FROM records WHERE entity=? AND id=?', row.entity, row.id);
        for (const o of batch.outboxAdd ?? [])
          await tx.runAsync(
            'INSERT OR REPLACE INTO outbox VALUES(?,?)',
            o.mutationId,
            JSON.stringify(o)
          );
        for (const id of batch.outboxRemove ?? [])
          await tx.runAsync('DELETE FROM outbox WHERE id=?', id);
        for (const [key, value] of Object.entries(batch.meta ?? {})) {
          if (value === null) await tx.runAsync('DELETE FROM meta WHERE key=?', key);
          else await tx.runAsync('INSERT OR REPLACE INTO meta VALUES(?,?)', key, value);
        }
      });
    },
    async outbox() {
      return decode<OutboxItem>(await db.getAllAsync('SELECT json FROM outbox ORDER BY rowid'));
    },
    async getMeta(key) {
      return (
        (await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key=?', key))
          ?.value ?? null
      );
    },
    async clear() {
      await db.withExclusiveTransactionAsync(async (tx) => {
        await tx.execAsync('DELETE FROM records; DELETE FROM outbox; DELETE FROM meta;');
      });
    },
  };
}
