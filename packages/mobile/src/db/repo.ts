// Typed repositories over the SQLite tables. Keep all SQL here.
//
// The `conversations` / `messages` / `compactions` tables still exist in the schema (see
// ./index.ts) but have NO repository functions any more: they belonged to the chat surface,
// which is gone. They are left in the migration so an installed database is not rewritten.
import type { SeenRecord } from '@hiraia/shared';

import { getDb } from './index';

// ------------------------------------------------------------ notes (UI pending)
export interface Note {
  id: string;
  conversation_id: string | null;
  title: string | null;
  body: string | null;
  created_at: number;
  updated_at: number;
}

export async function upsertNote(n: { id: string; conversationId?: string | null; title?: string | null; body?: string | null }): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO notes (id, conversation_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
       conversation_id = excluded.conversation_id, updated_at = excluded.updated_at`,
    n.id, n.conversationId ?? null, n.title ?? null, n.body ?? null, now, now
  );
}

export async function listNotes(): Promise<Note[]> {
  const db = await getDb();
  return db.getAllAsync<Note>('SELECT * FROM notes ORDER BY updated_at DESC');
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM notes WHERE id = ?', id);
}

// ----------------------------------------------- settings (backs settings page)
export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ------------------------------------------ feed seen-store (rag/pipeline/seen-store.sql)
/** A card became current: bump card_seen + competency_seen ('off' = untagged / low-confidence). */
export async function recordCardSeen(cardId: string, competency: string, now: number): Promise<void> {
  const db = await getDb();
  // One transaction: the caller has already bumped BOTH counters in memory, so they must land
  // together — a crash between two auto-committed upserts would leave competency_seen lagging
  // card_seen for good.
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO card_seen (card_id, first_seen, last_seen, times) VALUES (?, ?, ?, 1)
       ON CONFLICT(card_id) DO UPDATE SET times = times + 1, last_seen = excluded.last_seen`,
      cardId, now, now
    );
    await db.runAsync(
      `INSERT INTO competency_seen (competency, last_seen, times) VALUES (?, ?, 1)
       ON CONFLICT(competency) DO UPDATE SET times = times + 1, last_seen = excluded.last_seen`,
      competency, now
    );
  });
}

/** Both seen tables as maps (card id → record, competency code → record) for the feed weighting. */
export async function loadSeen(): Promise<{ cards: Map<string, SeenRecord>; competencies: Map<string, SeenRecord> }> {
  const db = await getDb();
  const cards = await db.getAllAsync<{ card_id: string; last_seen: number; times: number }>(
    'SELECT card_id, last_seen, times FROM card_seen'
  );
  const competencies = await db.getAllAsync<{ competency: string; last_seen: number; times: number }>(
    'SELECT competency, last_seen, times FROM competency_seen'
  );
  return {
    cards: new Map(cards.map((r) => [r.card_id, { times: r.times, lastSeen: r.last_seen }])),
    competencies: new Map(competencies.map((r) => [r.competency, { times: r.times, lastSeen: r.last_seen }])),
  };
}

/** Bump competency_seen for one more code a shown card serves (recordCardSeen already bumped the primary). */
export async function recordCompetencySeen(competency: string, now: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO competency_seen (competency, last_seen, times) VALUES (?, ?, 1) ON CONFLICT(competency) DO UPDATE SET last_seen = excluded.last_seen, times = competency_seen.times + 1',
    competency,
    now
  );
}
