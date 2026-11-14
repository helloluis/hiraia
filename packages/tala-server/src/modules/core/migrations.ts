/**
 * Core module schema. Never edit a migration that has shipped: add a new one at the end.
 * OWNER: workstream A.
 *
 * Timestamps are ISO-8601 UTC strings from Date.toISOString(), which sort correctly as text.
 * Secrets are stored only as SHA-256 hashes (session and email tokens) or Argon2id hashes (passwords).
 */
import type { Migration } from '../../kernel/types';

export const coreMigrations: Migration[] = [
  {
    id: 'core:001_accounts',
    sql: `
      CREATE TABLE core_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_norm TEXT NOT NULL UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        display_name TEXT NOT NULL,
        ui_language TEXT NOT NULL DEFAULT 'fil',
        password_hash TEXT,
        password_changed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      -- External sign-in identities (Google, AUTH-11). One identity belongs to exactly one account.
      CREATE TABLE core_identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (provider, subject)
      ) STRICT;
      CREATE INDEX core_identities_user ON core_identities(user_id);

      CREATE TABLE core_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        device_label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX core_sessions_user ON core_sessions(user_id);

      -- Why a token stopped working, so a device can tell "signed out here" from "account deleted".
      -- Token hashes only: nothing here identifies a person.
      CREATE TABLE core_ended_tokens (
        token_hash TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        ended_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE core_email_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        email_norm TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      ) STRICT;
      CREATE INDEX core_email_tokens_user ON core_email_tokens(user_id, purpose);

      -- Local and staging only: mail is written here instead of being sent.
      CREATE TABLE core_mail_outbox (
        id TEXT PRIMARY KEY,
        to_email TEXT NOT NULL,
        template TEXT NOT NULL,
        lang TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        vars TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      -- Keys are hashed so no address or email is stored here.
      CREATE TABLE core_rate_limits (
        key_hash TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE core_login_failures (
        key_hash TEXT PRIMARY KEY,
        failures INTEGER NOT NULL,
        last_failure_at INTEGER NOT NULL
      ) STRICT;
    `,
  },
  {
    id: 'core:002_records',
    sql: `
      -- Every synced record of every teacher. The owner is part of the key: ids are made on devices,
      -- so each teacher has a separate id space and can never touch another teacher's row.
      CREATE TABLE core_records (
        owner_id TEXT NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        entity TEXT NOT NULL,
        id TEXT NOT NULL,
        rev INTEGER NOT NULL,
        seq INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        data TEXT NOT NULL,
        PRIMARY KEY (owner_id, entity, id)
      ) STRICT;
      CREATE UNIQUE INDEX core_records_by_seq ON core_records (owner_id, seq);
      CREATE INDEX core_records_sections_by_plan ON core_records (owner_id, json_extract(data, '$.planId')) WHERE entity = 'plan_section';
      CREATE INDEX core_records_checks ON core_records (json_extract(data, '$.curriculumVersion'), json_extract(data, '$.competencyId'))
        WHERE entity = 'competency_check' AND deleted_at IS NULL;

      -- One counter for the whole database; the pull cursor is a position in it.
      CREATE TABLE core_seq (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value INTEGER NOT NULL
      ) STRICT;
      INSERT INTO core_seq (id, value) VALUES (1, 0);

      -- Answers already given to applied mutations, so a replay changes nothing (RES-5).
      CREATE TABLE core_sync_mutations (
        owner_id TEXT NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        mutation_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        op TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (owner_id, mutation_id)
      ) STRICT;
      CREATE INDEX core_sync_mutations_by_record ON core_sync_mutations (owner_id, entity, record_id);
      CREATE INDEX core_sync_mutations_by_age ON core_sync_mutations (created_at);

      -- Whole-plan snapshots: plan record plus its sections at one moment.
      CREATE TABLE core_plan_revisions (
        owner_id TEXT NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        reason TEXT NOT NULL,
        locked INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        session_id TEXT,
        device_id TEXT,
        plan TEXT NOT NULL,
        sections TEXT NOT NULL,
        PRIMARY KEY (owner_id, plan_id, revision)
      ) STRICT;
    `,
  },
  {
    id: 'core:003_record_device_and_history_index',
    sql: `
      -- Which device last wrote a record (null for server-side writes). Lets a lock be checked against
      -- the section versions the locking device saw: a version it wrote itself is one it saw.
      ALTER TABLE core_records ADD COLUMN device_id TEXT;
      -- On-demand fetch of an older plan brings its section history with it.
      CREATE INDEX core_records_history_by_plan ON core_records (owner_id, json_extract(data, '$.planId')) WHERE entity = 'section_revision';
    `,
  },
  {
    id: 'core:004_packed_revisions',
    sql: `
      -- Snapshots are stored compressed: a year of lessons with their history is many megabytes otherwise.
      -- The table is rebuilt rather than converted (SQL cannot compress). Tala holds no production data yet,
      -- so the only history lost is in development databases.
      DROP TABLE core_plan_revisions;
      CREATE TABLE core_plan_revisions (
        owner_id TEXT NOT NULL REFERENCES core_users(id) ON DELETE CASCADE,
        plan_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        reason TEXT NOT NULL,
        locked INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        session_id TEXT,
        device_id TEXT,
        digest TEXT NOT NULL,
        snapshot BLOB NOT NULL,
        PRIMARY KEY (owner_id, plan_id, revision)
      ) STRICT;
    `,
  },
  {
    id: 'core:005_email_token_payload',
    sql: `
      -- An emailed link that connects a Google identity must remember WHICH Google account asked for it.
      ALTER TABLE core_email_tokens ADD COLUMN payload TEXT;
    `,
  },
  {
    id: 'core:006_email_verified_how',
    sql: `
      -- HOW an email came to count as confirmed: 'link', 'reset', 'google', or 'auto' (the stop-gap that
      -- confirms at sign-up while the server cannot send mail). Accounts marked 'auto' never proved the
      -- address; this column is what lets them be asked to, once mail works.
      ALTER TABLE core_users ADD COLUMN email_verified_how TEXT;
    `,
  },
  {
    id: 'core:007_lock_keys',
    sql: `
      -- On a lock revision: which section keys that lock froze and which it left open for post-class
      -- writing, as JSON {"outside": [...], "inside": [...]} (see LockKeys in plan-rules.ts). A teacher's own
      -- template can be edited or deleted later; a locked plan goes by this record, so that cannot reopen a
      -- locked part. NULL on every other revision, and on locks taken before this column existed.
      ALTER TABLE core_plan_revisions ADD COLUMN lock_keys TEXT;
    `,
  },
];
