// Typed repositories over the SQLite tables. Keep all SQL here.
import type { Message, SeenRecord } from '@hiraia/shared';

import { getDb } from './index';

// ---------------------------------------------------------------- conversations
export interface Conversation {
  id: string;
  title: string | null;
  created_at: number;
  updated_at: number;
}

export async function createConversation(id: string, title: string | null = null): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    'INSERT OR IGNORE INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    id, title, now, now
  );
}

export async function setConversationTitle(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', title, Date.now(), id);
}

async function touchConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', Date.now(), id);
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  return db.getAllAsync<Conversation>('SELECT * FROM conversations ORDER BY updated_at DESC');
}

export async function getLatestConversationId(): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1'
  );
  return row?.id ?? null;
}

// --------------------------------------------------------------------- messages
interface MsgRow { id: string; role: string; content: string; kind: string | null; image_slug: string | null; created_at: number }

export async function addMessage(conversationId: string, m: Message): Promise<void> {
  if (!m.id) return;
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO messages (id, conversation_id, role, content, kind, image_slug, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    m.id, conversationId, m.role, m.content, m.metadata?.kind ?? null, m.imageSlug ?? null, (m.timestamp ?? new Date()).getTime()
  );
  await touchConversation(conversationId);
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MsgRow>(
    'SELECT id, role, content, kind, image_slug, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    conversationId
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role as Message['role'],
    content: r.content,
    timestamp: new Date(r.created_at),
    ...(r.image_slug ? { imageSlug: r.image_slug } : {}),
    ...(r.kind ? { metadata: { kind: r.kind as 'factoid' } } : {}),
  }));
}

// ------------------------------------------------------------------ compactions
export async function saveCompaction(messageId: string, summary: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO compactions (message_id, summary, created_at) VALUES (?, ?, ?)',
    messageId, summary, Date.now()
  );
}

/** message_id -> summary, for the ids that have a compaction. */
export async function getCompactions(messageIds: string[]): Promise<Map<string, string>> {
  if (messageIds.length === 0) return new Map();
  const db = await getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ message_id: string; summary: string }>(
    `SELECT message_id, summary FROM compactions WHERE message_id IN (${placeholders})`,
    ...messageIds
  );
  return new Map(rows.map((r) => [r.message_id, r.summary]));
}

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
