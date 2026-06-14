import 'server-only';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

/**
 * SQLite connection (singleton) + schema.
 *
 * The DB file is intentionally kept OUTSIDE packages/web so it isn't bundled,
 * served, or committed. Default location: <repo>/data/hiraia.db (packages/web
 * is two levels deep). Override with HIRAIA_DB_PATH.
 *
 * Relationships:
 *   users 1──* chats 1──* messages
 *   users 1──* sessions
 * Assistant messages carry `message_feedback` (1 = useful, -1 = not useful, NULL = none).
 *
 * `demo_messages` is intentionally separate and anonymous: the public web demo
 * has no accounts, so its transcripts are keyed only by a client-generated
 * session id (localStorage) — no user_id, no FK. We keep them for product
 * insight into what visitors actually try, not as per-user history.
 */

const DB_PATH =
  process.env.HIRAIA_DB_PATH || path.join(process.cwd(), '..', '..', 'data', 'hiraia.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS chats (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT,                              -- optional, user-set
  is_primary INTEGER NOT NULL DEFAULT 0,        -- the user's default thread
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id          INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content          TEXT NOT NULL,
  message_feedback INTEGER,                     -- 1 useful | -1 not useful | NULL (assistant only)
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);

CREATE TABLE IF NOT EXISTS demo_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,                     -- client-generated demo session (localStorage), NOT an auth session
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  kind       TEXT,                              -- 'factoid' for the cold-start trivia card, else NULL
  language   TEXT,                              -- demo language at the time (tagalog|english|cebuano)
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_demo_messages_session ON demo_messages(session_id);
`;

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  _db = db;
  return db;
}
