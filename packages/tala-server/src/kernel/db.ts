/**
 * SQLite access and the migration runner.
 * OWNER: workstream A.
 *
 * One connection per server (better-sqlite3 is synchronous, so a request's statements never interleave
 * with another's unless a handler awaits in the middle; use `db.transaction` around multi-statement writes).
 *
 * Migrations: each module lists `{ id: '<module>:<nnn>_<name>', sql }`. They are applied once, in array
 * order, each inside its own transaction, and recorded in `kernel_migrations` with a checksum.
 * A shipped migration must never be edited: the runner refuses to start if a recorded one changed.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { Logger, Migration } from './types';

export type Db = Database.Database;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function openDatabase(path: string): Db {
  const inMemory = path === ':memory:';
  let created = false;
  if (!inMemory) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    created = !existsSync(path);
  }
  const db = new Database(path);
  if (!inMemory) {
    // The file holds password hashes and class lists: owner-only.
    if (created) {
      try {
        chmodSync(path, 0o600);
      } catch {
        /* not fatal on filesystems without modes */
      }
    }
    db.pragma('journal_mode = WAL');
    // An acknowledged save must survive a crash (PRD §14.6).
    db.pragma('synchronous = FULL');
  }
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

const MIGRATION_ID_RE = /^([a-z][a-z0-9_]*):(\d{3})_([a-z0-9_]+)$/;

function checksum(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

export interface MigrationSource {
  name: string;
  migrations: Migration[];
}

/** Validate ids before touching the database: format, module prefix, global uniqueness, ascending order. */
export function validateMigrations(sources: MigrationSource[]): void {
  const seen = new Set<string>();
  for (const source of sources) {
    let last = 0;
    for (const m of source.migrations) {
      const match = MIGRATION_ID_RE.exec(m.id);
      if (!match)
        throw new MigrationError(
          `Migration id "${m.id}" must look like "${source.name}:001_name".`
        );
      if (match[1] !== source.name)
        throw new MigrationError(
          `Migration "${m.id}" belongs to module "${source.name}" and must start with "${source.name}:".`
        );
      if (seen.has(m.id)) throw new MigrationError(`Migration id "${m.id}" is used twice.`);
      seen.add(m.id);
      const n = Number(match[2]);
      if (n <= last)
        throw new MigrationError(
          `Migration "${m.id}" is out of order: numbers must increase within a module.`
        );
      last = n;
    }
  }
}

export function runMigrations(
  db: Db,
  sources: MigrationSource[],
  now: () => Date,
  log?: Logger
): string[] {
  validateMigrations(sources);
  db.exec(`CREATE TABLE IF NOT EXISTS kernel_migrations (
    id TEXT PRIMARY KEY,
    module TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const recorded = new Map<string, string>();
  for (const row of db.prepare('SELECT id, checksum FROM kernel_migrations').all() as Array<{
    id: string;
    checksum: string;
  }>) {
    recorded.set(row.id, row.checksum);
  }
  const insert = db.prepare(
    'INSERT INTO kernel_migrations (id, module, checksum, applied_at) VALUES (?, ?, ?, ?)'
  );
  const applied: string[] = [];

  for (const source of sources) {
    let pendingSeen: string | null = null;
    for (const m of source.migrations) {
      const sum = checksum(m.sql);
      const previous = recorded.get(m.id);
      if (previous !== undefined) {
        if (previous !== sum) {
          throw new MigrationError(
            `Migration "${m.id}" was changed after it was applied. A shipped migration must not be edited: add a new one instead. ` +
              `(For a local scratch database, delete the file named by TALA_DB_PATH and start again.)`
          );
        }
        if (pendingSeen) {
          throw new MigrationError(
            `Migration "${pendingSeen}" was added before "${m.id}", which is already applied. New migrations go at the end.`
          );
        }
        continue;
      }
      pendingSeen ??= m.id;
      const apply = db.transaction(() => {
        db.exec(m.sql);
        insert.run(m.id, source.name, sum, now().toISOString());
      });
      try {
        apply();
      } catch (err) {
        throw new MigrationError(
          `Migration "${m.id}" failed: ${err instanceof Error ? err.message : 'unknown error'}`
        );
      }
      applied.push(m.id);
      log?.info('migration_applied', { migration: m.id, module: source.name });
    }
  }
  return applied;
}
