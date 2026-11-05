-- Hiraia CRM schema v2: structured contact details, affiliation and first-message evidence.
-- Additive only: no existing table, column or behaviour changes. Every statement is idempotent
-- (IF NOT EXISTS), like 001, so a database that lost its bookkeeping re-migrates cleanly.

-- Affiliation, kept apart from contacts.school and contacts.role (the pipeline role a classifier
-- assigns). One row per contact that has any of these; each value carries where it came from
-- (e.g. 'manual_note', 'google_contacts', or the client that wrote it).
CREATE TABLE IF NOT EXISTS contact_profiles (
  contact_id          INTEGER PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  organization        TEXT,      -- employer/affiliation, e.g. "Department of Education (DepEd)"
  organization_source TEXT,
  department          TEXT,      -- unit within the organization
  department_source   TEXT,
  job_title           TEXT,      -- formal title, e.g. "Instructional Leader"
  job_title_source    TEXT,
  location            TEXT,      -- free-text place, e.g. "Siay, Zamboanga Sibugay"
  location_source     TEXT,
  updated_at          TEXT NOT NULL
);

-- Phone numbers and e-mail addresses: several per contact, each with a label and its provenance.
CREATE TABLE IF NOT EXISTS contact_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id  INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('phone', 'email')),
  value       TEXT NOT NULL,      -- phones: '+' and digits only; e-mail: lower-case
  label       TEXT,               -- free text, e.g. 'mobile', 'work'
  is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  source      TEXT NOT NULL,      -- e.g. 'google_contacts', 'manual_note', or the writing client
  source_ref  TEXT,               -- opaque pointer into the source (never shown to the admin browser)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_points_identity ON contact_points(contact_id, kind, value);

-- The earliest recorded message of one source conversation with a contact (incoming or outgoing).
-- A contact's first_contact is the earliest row across all of its conversations. Rows only ever
-- improve: an earlier time, or the same time with stronger evidence, replaces the stored one; a later
-- or weaker report never does. `exact` requires an absolute message timestamp; `approximate` covers a
-- relative label resolved against its capture time, or the time a message was first observed (an
-- upper bound). Record bookkeeping times (created_at, first_seen, extract times) never go here.
CREATE TABLE IF NOT EXISTS first_message_evidence (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id        INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  thread_id         INTEGER REFERENCES threads(id) ON DELETE SET NULL,
  evidence_key      TEXT NOT NULL,  -- opaque, deterministic per source conversation
  platform          TEXT NOT NULL,
  conversation_kind TEXT NOT NULL CHECK (conversation_kind IN ('direct', 'group')),
  first_message_at  TEXT NOT NULL,  -- ISO 8601 UTC
  quality           TEXT NOT NULL CHECK (quality IN ('exact', 'approximate')),
  basis             TEXT NOT NULL CHECK (basis IN ('message_timestamp', 'relative_label', 'first_observed')),
  direction         TEXT NOT NULL DEFAULT 'unknown' CHECK (direction IN ('incoming', 'outgoing', 'unknown')),
  source            TEXT NOT NULL,  -- the client or maintenance task that reported it
  recorded_at       TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (quality = 'approximate' OR basis = 'message_timestamp')
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_first_message_evidence_identity ON first_message_evidence(contact_id, evidence_key);
CREATE INDEX IF NOT EXISTS idx_first_message_evidence_thread ON first_message_evidence(thread_id);
