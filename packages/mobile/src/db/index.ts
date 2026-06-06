// SQLite is the app's durable store (replaces the zustand→AsyncStorage blob).
// One DB, versioned migrations via PRAGMA user_version. Tables: conversations
// (thread names), messages, compactions (auto-compacter), notes, settings.
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'hiraia.db';
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  title       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  kind            TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);
CREATE TABLE IF NOT EXISTS compactions (
  message_id  TEXT PRIMARY KEY,
  summary     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notes (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT,
  title           TEXT,
  body            TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v < 1) {
    await db.execAsync(SCHEMA_V1);
    await db.execAsync('PRAGMA user_version = 1');
  }
  // Future migrations: if (v < 2) { ...; PRAGMA user_version = 2 }
}

/** Opens (once) and migrates the database. */
export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

/** Sortable, collision-resistant id for rows (messages, conversations, notes). */
export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
