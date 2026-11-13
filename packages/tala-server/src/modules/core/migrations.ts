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
];
