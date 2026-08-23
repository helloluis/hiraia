/**
 * The card TEXT store: everything the feed reads one card at a time.
 *
 * The inventory used to be imported straight into the JS bundle, which is the most expensive
 * place it could live. Hermes stores any string containing non-ASCII as UTF-16 and nearly
 * every Tagalog and Cebuano string qualifies, so ~50 MB of JSON became ~100 MB of bytecode;
 * and the bundle is STORED in the APK rather than deflated (measured: 111.1 MB -> 111.1 MB,
 * 0%) while everything around it compresses. It also meant parsing the whole inventory into
 * the JS heap at startup to show one card.
 *
 * So the split follows what is actually read. Sequencing needs ids, terms, slug, cats, topic
 * and domain — 7.4 MB of 27.5 — and stays resident in cardsIndex, which is why every
 * adjacency decision remains synchronous. The prose is 19.0 MB and lives here, fetched for
 * the handful of cards actually on screen.
 *
 * Reads are SYNCHRONOUS by design (see `textOf`): the feed is linear, so the store warms a
 * card's successors while that card is being read, and by the time the reader turns the page
 * its text is already in the map.
 */
import { Asset } from 'expo-asset';
import { Directory, File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

import DB_ASSET from '../../assets/data/cards.db';

const DB_NAME = 'cards.db';

export interface CardTextRow {
  fact: { tl: string; en: string; bis: string };
  title: { tl: string; en: string; bis: string };
  emphasis?: { tl?: string[]; en?: string[]; bis?: string[] };
  poster?: boolean;
}

/** Unit separator — never occurs in the content, so the joins are lossless. */
const SEP = '\x1f';
/**
 * How many cards' text to keep. A session walks a few hundred pages at most and each row is
 * ~700 bytes, so this is well under a megabyte and never evicts anything still on screen.
 */
const MAX_RESIDENT = 600;

const TEXT = new Map<string, CardTextRow>();
let db: SQLite.SQLiteDatabase | null = null;
let opening: Promise<void> | null = null;

/**
 * Copy the bundled database somewhere SQLite can open it, once.
 *
 * The asset lives inside the APK, where it is a compressed zip entry rather than a file —
 * SQLite cannot mmap that, so it has to be materialised. Done once on first run; afterwards
 * the copy is found and reused.
 */
async function open(): Promise<void> {
  if (db) return;
  // openDatabaseAsync takes a NAME and a DIRECTORY, not a path. Passing a full path as the
  // name silently opens an EMPTY database under that odd name — every query then fails on a
  // missing table, which is exactly how the first build of this hung the feed on its splash.
  // defaultDatabaseDirectory is a bare filesystem path, while the File/Directory API takes a
  // URI — handing it over unscheme'd throws "URI is not absolute" and leaves the deck
  // textless.
  const raw = String(SQLite.defaultDatabaseDirectory ?? '');
  const dir = raw.startsWith('file://') ? raw : `file://${raw}`;
  const target = new File(dir, DB_NAME);
  if (!target.exists) {
    new Directory(dir).create({ intermediates: true, idempotent: true });
    const asset = Asset.fromModule(DB_ASSET);
    await asset.downloadAsync();
    new File(asset.localUri ?? asset.uri).copy(target);
  }
  db = await SQLite.openDatabaseAsync(DB_NAME);
}

export function ensureDb(): Promise<void> {
  if (!opening)
    opening = open().catch((e) => {
      // A card with no text renders empty rather than crashing the feed; log loudly so this
      // never passes for "the pool is empty".
      console.warn('[cardDb] could not open the card database:', e);
    });
  return opening;
}

const split = (s: string | null): string[] | undefined => {
  const v = (s ?? '').split(SEP).filter(Boolean);
  return v.length ? v : undefined;
};

/** Fetch and cache the text for these cards. Already-resident ids cost nothing. */
export async function loadText(ids: readonly string[]): Promise<void> {
  await ensureDb();
  if (!db) return;
  try {
    const want = [...new Set(ids)].filter((id) => id && !TEXT.has(id));
    if (!want.length) return;
    const rows = await db.getAllAsync<{
      id: string;
      tl: string;
      en: string;
      bis: string;
      title_tl: string;
      title_en: string;
      title_bis: string;
      emph_tl: string;
      emph_en: string;
      emph_bis: string;
      poster: number;
    }>(
      `SELECT id, tl, en, bis, title_tl, title_en, title_bis, emph_tl, emph_en, emph_bis, poster
       FROM card_text WHERE id IN (${want.map(() => '?').join(',')})`,
      want
    );
    for (const r of rows) {
      TEXT.set(r.id, {
        fact: { tl: r.tl, en: r.en, bis: r.bis },
        title: { tl: r.title_tl, en: r.title_en, bis: r.title_bis },
        emphasis: {
          tl: split(r.emph_tl),
          en: split(r.emph_en),
          bis: split(r.emph_bis),
        },
        poster: r.poster === 1,
      });
    }
  } catch (e) {
    // A card with no text renders empty; the feed still turns. Never let this reject, or the
    // caller's Promise.all takes the whole page down with it.
    console.warn('[cardDb] loadText failed:', e);
    return;
  }
  // Evict oldest-first once past the ceiling. Map preserves insertion order, and anything
  // on screen was inserted most recently, so it is never the thing dropped.
  if (TEXT.size > MAX_RESIDENT) {
    const over = TEXT.size - MAX_RESIDENT;
    let n = 0;
    for (const k of TEXT.keys()) {
      if (n++ >= over) break;
      TEXT.delete(k);
    }
  }
}

/** Text for a card, or undefined if it was never warmed. Synchronous on purpose. */
export function textOf(id: string): CardTextRow | undefined {
  return TEXT.get(id);
}

export function isWarm(id: string): boolean {
  return TEXT.has(id);
}

/**
 * Postings for the query's own tokens: how many cards carry each (for idf) and which ones.
 *
 * This is what turns search from a scan into a lookup. The old searchCards walked all 29,737
 * cards per query because the only index it had was forward (card -> tokens); an inverted one
 * is 8.3 MB and could never be resident, which is precisely why it had to. Measured on the
 * same queries the two agree exactly and this is 2.5-16x faster — "volcano" touches 290 cards
 * instead of 29,737.
 */
export async function searchTokenRows(
  tokens: readonly string[]
): Promise<Array<{ token: string; df: number; ords: string }>> {
  await ensureDb();
  if (!db || !tokens.length) return [];
  return db.getAllAsync<{ token: string; df: number; ords: string }>(
    `SELECT token, df, ords FROM search_token WHERE token IN (${tokens.map(() => '?').join(',')})`,
    tokens as string[]
  );
}

/**
 * MCQs, warmed the same way the text is.
 *
 * The interject picks one SYNCHRONOUSLY while committing a page turn, so it cannot wait on a
 * query. It only ever asks about a card in the recent trail, and those were warmed when they
 * were read — so by the time it fires, the question it wants is already here.
 */
const QUESTIONS = new Map<string, unknown>();

export async function loadQuestions(factIds: readonly string[]): Promise<void> {
  await ensureDb();
  if (!db) return;
  const want = [...new Set(factIds)].filter((f) => f && !QUESTIONS.has(f));
  if (!want.length) return;
  const rows = await db.getAllAsync<{ factId: string; json: string }>(
    `SELECT factId, json FROM card_question WHERE factId IN (${want.map(() => '?').join(',')})`,
    want
  );
  const found = new Set(rows.map((r) => r.factId));
  for (const r of rows) QUESTIONS.set(r.factId, JSON.parse(r.json));
  // Remember the misses too, so a card without an MCQ is not re-queried on every page turn.
  for (const f of want) if (!found.has(f)) QUESTIONS.set(f, null);
  if (QUESTIONS.size > MAX_RESIDENT) {
    const over = QUESTIONS.size - MAX_RESIDENT;
    let n = 0;
    for (const k of QUESTIONS.keys()) {
      if (n++ >= over) break;
      QUESTIONS.delete(k);
    }
  }
}

/** A warmed MCQ, or undefined if it was never fetched. Synchronous on purpose. */
export function questionOf(factId: string): unknown | undefined {
  return QUESTIONS.get(factId) ?? undefined;
}

/** One row out of a quiz bank table, by index. */
export async function bankRow(table: 'question' | 'quiz_bank', i: number): Promise<unknown> {
  await ensureDb();
  if (!db) return null;
  const r = await db.getFirstAsync<{ json: string }>(`SELECT json FROM ${table} WHERE i = ?`, [i]);
  return r ? JSON.parse(r.json) : null;
}

export async function bankCount(table: 'question' | 'quiz_bank'): Promise<number> {
  await ensureDb();
  if (!db) return 0;
  const r = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return r?.n ?? 0;
}

// ---------------------------------------------------------------------------------------
// The token index: every card's vocabulary, as one flat Int32Array.
//
// textJaccard runs inside nextChoices and must be synchronous and EXACT — a 24-way MinHash
// was tried and agreed with the 0.35 threshold on only 73% of pairs in the 0.20-0.55 decision
// band, which is the whole job of that check. The sets are only ever intersected, so they do
// not need to be strings: each token is hashed to an int (zero collisions across all 46,177)
// and stored sorted, which makes the comparison a merge over a typed array and keeps 1.4M
// tokens off the JS heap.
// ---------------------------------------------------------------------------------------
import TOKENS_ASSET from '../../assets/data/tokens.bin';

let TOK: Int32Array | null = null;
let TOK_OFF: Int32Array | null = null;

/** Load the token index. Until it lands, textJaccard reports "not a duplicate". */
export async function loadTokenIndex(): Promise<void> {
  if (TOK) return;
  try {
    const asset = Asset.fromModule(TOKENS_ASSET);
    await asset.downloadAsync();
    const bytes = await new File(asset.localUri ?? asset.uri).bytes();
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getInt32(0, true);
    // Offsets and tokens are one contiguous Int32 run after the count.
    const all = new Int32Array(bytes.buffer, bytes.byteOffset + 4, (bytes.byteLength - 4) >> 2);
    TOK_OFF = all.subarray(0, n + 1);
    TOK = all.subarray(n + 1);
  } catch (e) {
    console.warn('[cardDb] token index unavailable — duplicate check disabled:', e);
  }
}

/**
 * Jaccard over two cards' vocabularies, by ordinal. Returns 0 when the index has not loaded,
 * which reads as "not a duplicate" and lets the candidate through — the safe direction, and
 * only reachable on the very first card of a cold start.
 */
export function tokenJaccard(a: number, b: number): number {
  if (!TOK || !TOK_OFF || a < 0 || b < 0) return 0;
  const as = TOK_OFF[a]!,
    ae = TOK_OFF[a + 1]!;
  const bs = TOK_OFF[b]!,
    be = TOK_OFF[b + 1]!;
  const la = ae - as,
    lb = be - bs;
  if (!la || !lb) return 0;
  // both runs are sorted, so this is a merge rather than a lookup per element
  let i = as,
    j = bs,
    both = 0;
  while (i < ae && j < be) {
    const x = TOK[i]!,
      y = TOK[j]!;
    if (x === y) {
      both++;
      i++;
      j++;
    } else if (x < y) i++;
    else j++;
  }
  return both / (la + lb - both);
}
