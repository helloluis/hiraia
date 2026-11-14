/** node:sqlite behind the Database surface, for tests only (same shape as ../../storage/store.test.ts). */
import { DatabaseSync } from 'node:sqlite';
import type { Database } from './store';

export function memoryDatabase(path = ':memory:'): Database & { raw: DatabaseSync } {
  const sql = new DatabaseSync(path);
  const db: Database & { raw: DatabaseSync } = {
    raw: sql,
    async execAsync(s) {
      sql.exec(s);
    },
    async runAsync(s, ...p) {
      sql.prepare(s).run(...p);
    },
    async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) {
      return (sql.prepare(s).get(...p) as T) ?? null;
    },
    async getAllAsync<T>(s: string, ...p: (string | number | null)[]) {
      return sql.prepare(s).all(...p) as T[];
    },
    async withExclusiveTransactionAsync(fn) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        await fn(db);
        sql.exec('COMMIT');
      } catch (e) {
        sql.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db;
}
