'use strict';
/**
 * SQLite connection + migration runner for the Hiraia CRM service.
 *
 * WAL mode, like the other hiraia.org databases (web hiraia.db, telemetry.db). Migrations are
 * numbered SQL files in ./migrations, applied in order inside one transaction each and recorded
 * in schema_migrations; running the runner twice applies nothing the second time. Every
 * migration is also written with IF NOT EXISTS so a database that lost its bookkeeping can be
 * re-migrated safely.
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

function listMigrations(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}-[a-z0-9-]+\.sql$/.test(f))
    .sort()
    .map((file) => ({ version: Number(file.slice(0, 3)), name: file, sql: fs.readFileSync(path.join(dir, file), 'utf8') }));
}

/** Apply pending migrations. Returns the names applied in this call (empty when up to date). */
function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const record = db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
  const done = [];
  for (const m of listMigrations(dir)) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      record.run(m.version, m.name, new Date().toISOString());
    })();
    done.push(m.name);
  }
  return done;
}

function migrationStatus(db, dir = MIGRATIONS_DIR) {
  const applied = new Map(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
      ? db.prepare('SELECT version, name, applied_at FROM schema_migrations').all().map((r) => [r.version, r])
      : []
  );
  return listMigrations(dir).map((m) => ({ version: m.version, name: m.name, applied_at: applied.get(m.version)?.applied_at || null }));
}

module.exports = { openDatabase, migrate, migrationStatus, listMigrations, MIGRATIONS_DIR };
