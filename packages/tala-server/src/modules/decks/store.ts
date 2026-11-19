/**
 * Storage for teachers' own deck copies. Two tables, both the module's own:
 *   decks_decks  one row per copy, always read and written with its owner in the WHERE clause;
 *   decks_media  drawings by the SHA-256 of their bytes (the Hiraia-watermarked derivative exactly as the built deck
 *                embeds it), shared by every copy that shows them. Kept in the database, not beside the library,
 *                so replacing the library on the host can never take a copy's drawings away.
 */
import type { Database } from 'better-sqlite3';
import type {
  Deck,
  DeckMedia,
  DeckSlide,
  DeckSummary,
  PackLang,
} from '@hiraia/tala-core/contracts';
import type { Migration } from '../../kernel/types';

export const decksMigrations: Migration[] = [
  {
    id: 'decks:001_init',
    sql: `
CREATE TABLE decks_decks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'fil')),
  title TEXT NOT NULL,
  grade TEXT NOT NULL,
  term INTEGER NOT NULL,
  week INTEGER NOT NULL,
  -- the original was approved by a named teacher when the copy was made (drives the draft label)
  source_approved INTEGER NOT NULL CHECK (source_approved IN (0, 1)),
  -- content hash of the original the copy was made from
  base_content_sha256 TEXT NOT NULL,
  credits_json TEXT NOT NULL,
  slides_json TEXT NOT NULL,
  -- the slides exactly as copied; never changed by a save
  base_slides_json TEXT NOT NULL,
  media_json TEXT NOT NULL,
  -- kept beside the JSON so listing copies never parses a deck
  slide_count INTEGER NOT NULL,
  changed_slides INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX decks_decks_owner ON decks_decks (owner_id, pack_id, language);
CREATE TABLE decks_media (
  sha256 TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  mime TEXT NOT NULL
) STRICT;
`,
  },
];

export interface DeckRow {
  id: string;
  owner_id: string;
  pack_id: string;
  language: PackLang;
  title: string;
  grade: string;
  term: number;
  week: number;
  source_approved: number;
  base_content_sha256: string;
  credits_json: string;
  slides_json: string;
  base_slides_json: string;
  media_json: string;
  slide_count: number;
  changed_slides: number;
  rev: number;
  created_at: string;
  updated_at: string;
}

export const rowToDeck = (row: DeckRow): Deck => ({
  id: row.id,
  packId: row.pack_id,
  language: row.language,
  title: row.title,
  grade: row.grade,
  term: row.term,
  week: row.week,
  sourceApproved: row.source_approved === 1,
  baseContentSha256: row.base_content_sha256,
  credits: JSON.parse(row.credits_json) as Deck['credits'],
  slides: JSON.parse(row.slides_json) as DeckSlide[],
  media: JSON.parse(row.media_json) as DeckMedia[],
  rev: row.rev,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const rowToSummary = (
  row: Omit<DeckRow, 'slides_json' | 'base_slides_json' | 'media_json' | 'credits_json'>
): DeckSummary => ({
  id: row.id,
  packId: row.pack_id,
  language: row.language,
  title: row.title,
  grade: row.grade,
  term: row.term,
  week: row.week,
  slideCount: row.slide_count,
  changedSlides: row.changed_slides,
  rev: row.rev,
  updatedAt: row.updated_at,
});

/** What a fresh copy of an original holds (also what a reset writes back). */
export interface DeckSeed {
  title: string;
  grade: string;
  term: number;
  week: number;
  sourceApproved: boolean;
  baseContentSha256: string;
  credits: Deck['credits'];
  slides: DeckSlide[];
  media: DeckMedia[];
}

export interface StoredMedia {
  sha256: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  mime: string;
}

export function createDeckStore(db: Database) {
  const SUMMARY =
    'id, owner_id, pack_id, language, title, grade, term, week, source_approved, base_content_sha256, slide_count, changed_slides, rev, created_at, updated_at';
  return {
    /** A deck, only for its owner: someone else's id answers exactly like one that does not exist. */
    get(ownerId: string, id: string): DeckRow | null {
      return (
        (db.prepare('SELECT * FROM decks_decks WHERE id = ? AND owner_id = ?').get(id, ownerId) as
          | DeckRow
          | undefined) ?? null
      );
    },
    /** The owner's most recently changed copy of a pack in a language, if any. */
    latestCopy(ownerId: string, packId: string, language: PackLang): DeckRow | null {
      return (
        (db
          .prepare(
            'SELECT * FROM decks_decks WHERE owner_id = ? AND pack_id = ? AND language = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1'
          )
          .get(ownerId, packId, language) as DeckRow | undefined) ?? null
      );
    },
    /** Only the drawing list of a deck (a picture request must not read the whole deck). Null when not the owner's. */
    media(ownerId: string, id: string): DeckMedia[] | null {
      const row = db
        .prepare('SELECT media_json FROM decks_decks WHERE id = ? AND owner_id = ?')
        .get(id, ownerId) as { media_json: string } | undefined;
      return row ? (JSON.parse(row.media_json) as DeckMedia[]) : null;
    },
    list(ownerId: string): DeckSummary[] {
      return (
        db
          .prepare(
            `SELECT ${SUMMARY} FROM decks_decks WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC`
          )
          .all(ownerId) as DeckRow[]
      ).map(rowToSummary);
    },
    insert(args: {
      id: string;
      ownerId: string;
      packId: string;
      language: PackLang;
      seed: DeckSeed;
      now: string;
    }): void {
      const { seed } = args;
      db.prepare(
        `INSERT INTO decks_decks (id, owner_id, pack_id, language, title, grade, term, week, source_approved, base_content_sha256, credits_json, slides_json, base_slides_json, media_json, slide_count, changed_slides, rev, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
      ).run(
        args.id,
        args.ownerId,
        args.packId,
        args.language,
        seed.title,
        seed.grade,
        seed.term,
        seed.week,
        seed.sourceApproved ? 1 : 0,
        seed.baseContentSha256,
        JSON.stringify(seed.credits),
        JSON.stringify(seed.slides),
        JSON.stringify(seed.slides),
        JSON.stringify(seed.media),
        seed.slides.length,
        args.now,
        args.now
      );
    },
    /** Write an edit. With `expectRev` the row changes only if it still has that rev; false means it did not. */
    save(args: {
      ownerId: string;
      id: string;
      title: string;
      slides: DeckSlide[];
      changedSlides: number;
      rev: number;
      now: string;
      expectRev: number | null;
    }): boolean {
      const base =
        'UPDATE decks_decks SET title = ?, slides_json = ?, slide_count = ?, changed_slides = ?, rev = ?, updated_at = ? WHERE id = ? AND owner_id = ?';
      const values = [
        args.title,
        JSON.stringify(args.slides),
        args.slides.length,
        args.changedSlides,
        args.rev,
        args.now,
        args.id,
        args.ownerId,
      ];
      const done =
        args.expectRev === null
          ? db.prepare(base).run(...values)
          : db.prepare(`${base} AND rev = ?`).run(...values, args.expectRev);
      return done.changes === 1;
    },
    /** Replace everything copied from the library (a reset). Keeps the id, owner and creation time. */
    reseed(args: {
      ownerId: string;
      id: string;
      seed: DeckSeed;
      rev: number;
      now: string;
    }): boolean {
      const { seed } = args;
      return (
        db
          .prepare(
            `UPDATE decks_decks SET title = ?, grade = ?, term = ?, week = ?, source_approved = ?, base_content_sha256 = ?, credits_json = ?, slides_json = ?, base_slides_json = ?, media_json = ?,
               slide_count = ?, changed_slides = 0, rev = ?, updated_at = ? WHERE id = ? AND owner_id = ?`
          )
          .run(
            seed.title,
            seed.grade,
            seed.term,
            seed.week,
            seed.sourceApproved ? 1 : 0,
            seed.baseContentSha256,
            JSON.stringify(seed.credits),
            JSON.stringify(seed.slides),
            JSON.stringify(seed.slides),
            JSON.stringify(seed.media),
            seed.slides.length,
            args.rev,
            args.now,
            args.id,
            args.ownerId
          ).changes === 1
      );
    },
    remove(ownerId: string, id: string): boolean {
      return (
        db.prepare('DELETE FROM decks_decks WHERE id = ? AND owner_id = ?').run(id, ownerId)
          .changes === 1
      );
    },
    removeOwner(ownerId: string): number {
      return db.prepare('DELETE FROM decks_decks WHERE owner_id = ?').run(ownerId).changes;
    },
    moveOwner(fromOwnerId: string, toOwnerId: string): number {
      return db
        .prepare('UPDATE decks_decks SET owner_id = ? WHERE owner_id = ?')
        .run(toOwnerId, fromOwnerId).changes;
    },
    putMedia(m: StoredMedia): void {
      db.prepare(
        'INSERT OR IGNORE INTO decks_media (sha256, bytes, width, height, mime) VALUES (?, ?, ?, ?, ?)'
      ).run(
        m.sha256,
        Buffer.from(m.bytes.buffer, m.bytes.byteOffset, m.bytes.byteLength),
        m.width,
        m.height,
        m.mime
      );
    },
    getMedia(sha256: string): StoredMedia | null {
      const row = db
        .prepare('SELECT sha256, bytes, width, height, mime FROM decks_media WHERE sha256 = ?')
        .get(sha256) as
        | { sha256: string; bytes: Buffer; width: number; height: number; mime: string }
        | undefined;
      return row
        ? {
            sha256: row.sha256,
            bytes: new Uint8Array(row.bytes.buffer, row.bytes.byteOffset, row.bytes.byteLength),
            width: row.width,
            height: row.height,
            mime: row.mime,
          }
        : null;
    },
    /** Drop drawings no copy shows any more. */
    sweepMedia(): number {
      return db
        .prepare(
          `DELETE FROM decks_media WHERE NOT EXISTS (
             SELECT 1 FROM decks_decks d, json_each(d.media_json) m WHERE json_extract(m.value, '$.sha256') = decks_media.sha256)`
        )
        .run().changes;
    },
  };
}

export type DeckStore = ReturnType<typeof createDeckStore>;
