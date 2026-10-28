-- Hiraia CRM schema v1. Every statement is idempotent (IF NOT EXISTS) so the file can be
-- re-applied against a database whose schema_migrations table was lost. Timestamps are
-- ISO 8601 UTC text (lexicographically sortable), written by the service.

CREATE TABLE IF NOT EXISTS contacts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  platform      TEXT NOT NULL,                      -- messenger | viber | ... (lower-case)
  aliases_json  TEXT NOT NULL DEFAULT '[]',         -- JSON array of strings
  role          TEXT,
  school        TEXT,
  stage         TEXT NOT NULL DEFAULT 'unknown'
                CHECK (stage IN ('intro', 'pilot', 'active', 'dormant', 'unknown')),
  notes         TEXT,                               -- extracted summary only, never raw messages
  first_seen    TEXT,
  last_contact  TEXT,
  is_test       INTEGER NOT NULL DEFAULT 0 CHECK (is_test IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_platform_name ON contacts(platform, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_contacts_stage ON contacts(stage);
CREATE INDEX IF NOT EXISTS idx_contacts_last_contact ON contacts(last_contact);

CREATE TABLE IF NOT EXISTS threads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  app         TEXT NOT NULL,                        -- messenger | viber | ... (lower-case)
  thread_name TEXT NOT NULL,
  last_seen   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_threads_identity ON threads(contact_id, app, thread_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS extracts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id     INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  thread_id      INTEGER REFERENCES threads(id) ON DELETE SET NULL,
  source_thread  TEXT,
  extracted_json TEXT NOT NULL,                     -- JSON object exactly as submitted
  model_version  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_extracts_contact_created ON extracts(contact_id, created_at);

-- Append-only audit log of API writes. The triggers make UPDATE/DELETE fail at the SQL level.
CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source          TEXT NOT NULL,                    -- authenticated client name
  endpoint        TEXT NOT NULL,                    -- e.g. "POST /api/crm/contacts"
  idempotency_key TEXT,
  action          TEXT NOT NULL,                    -- created | updated | appended | replayed
  entity          TEXT,                             -- contacts | threads | extracts
  entity_id       INTEGER,
  request_sha256  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TRIGGER IF NOT EXISTS events_append_only_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_append_only_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events is append-only'); END;

-- Stored responses for Idempotency-Key replays (per client). Purged after 30 days.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  client          TEXT NOT NULL,
  key             TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  request_sha256  TEXT NOT NULL,
  status          INTEGER NOT NULL,
  response_json   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (client, key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);
