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
import cardsIndex from '../generated/cardsIndex.generated.json';

const DB_NAME = 'cards.db';
/** Content hash of the bundled database, stamped by build-cards-db.py. */
const DB_VERSION = (cardsIndex as { dbVersion?: string }).dbVersion ?? 'unversioned';
/** Sits beside the database and records which build wrote it. */
const STAMP_NAME = 'cards.db.version';

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
 * Rows landing is an EVENT, not just a cache fill — because a card can already be on screen
 * when it happens.
 *
 * The feed paints from `cardsIndex`, which is in the JS bundle and therefore never late: id,
 * topic and slug are there from the first frame. The prose is not — it is in a 133 MB asset
 * that has to be copied out of the APK before SQLite can open it, once, on first run. Any
 * page rendered inside that window asks `textOf` for a row that does not exist yet, and
 * `cardText` turns that into ''. An empty string is not visibly a "loading" state: the
 * typewriter finishes instantly on it, so the illustration and the choice tickets fade IN and
 * the card looks finished and deliberate, with no text on it. Nothing then re-rendered it when
 * the database finally opened, so it stayed that way until the app was relaunched.
 *
 * So subscribers are notified when the map GAINS rows. This is the same shape as the art
 * registry (see artPresence): a scalar version, one notification per batch, and readers that
 * compare row identity so a card only re-renders when ITS OWN answer changed. Eviction does
 * not notify — it only ever drops the oldest rows, never one a mounted page is holding, and
 * waking the deck to tell it something got colder helps nobody.
 */
let textVersion = 0;
const textListeners = new Set<() => void>();

function textChanged(): void {
  textVersion += 1;
  for (const fn of textListeners) fn();
}

/** Monotonic snapshot token: changes iff some card's text arrived. */
export function cardTextVersion(): number {
  return textVersion;
}

/** Subscribe to text arriving; returns the unsubscribe. */
export function subscribeCardText(listener: () => void): () => void {
  textListeners.add(listener);
  return () => {
    textListeners.delete(listener);
  };
}

/**
 * Ids asked for by a rendered page that found itself cold, coalesced into ONE query.
 *
 * A page turn mounts up to three CardPages at once (the incoming card, the preview sheet
 * beneath it and the outgoing peel), so the naive version would issue three queries for what
 * is one round trip. `null` means nothing is queued; a non-null set is a batch with its flush
 * already scheduled on the microtask queue — no timer, so nothing polls and nothing is left
 * running between page turns.
 */
let requested: Set<string> | null = null;

/**
 * Where the materialised copy lives. `defaultDatabaseDirectory` is a bare filesystem path
 * while the File/Directory API takes a URI — handing it over unscheme'd throws
 * "URI is not absolute" and leaves the deck textless.
 */
function dbDir(): string {
  const raw = String(SQLite.defaultDatabaseDirectory ?? '');
  return raw.startsWith('file://') ? raw : `file://${raw}`;
}

/**
 * Forget the freshness stamp, so the NEXT launch re-copies from the APK.
 *
 * The stamp certifies "the file beside me is build X". It is written straight after the copy,
 * and a copy can land SHORT without throwing (a dev-mode Metro asset fetch that ends early, an
 * ENOSPC surfacing as a short write). The stamp then vouches for a truncated database forever:
 * `fresh` is true on every subsequent launch, so it is never re-copied, and since cards.db now
 * carries the fact bank too that bricks the tutor rather than just blanking a card. Tearing up
 * the stamp is what turns that permanent state into a self-healing one.
 */
function dropStamp(): void {
  try {
    const stamp = new File(dbDir(), STAMP_NAME);
    if (stamp.exists) stamp.delete();
  } catch (e) {
    console.warn('[cardDb] could not clear the database stamp:', e);
  }
}

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
  const dir = dbDir();
  const target = new File(dir, DB_NAME);
  const stamp = new File(dir, STAMP_NAME);
  //
  // Copy when the database is MISSING **or STALE**. It used to copy on absence alone, and
  // that shipped silently wrong content for as long as the app stayed installed: the deck
  // kept serving the database it wrote on first launch while every later APK carried a newer
  // one it never read. The symptom is the worst kind — the build is verifiably correct, the
  // install reports success, and the app still shows the old cards.
  //
  // This is the same failure the downloaded LoRA adapters hit (cached by file existence, no
  // size or hash check), which is why the stamp records a CONTENT hash rather than a version
  // someone has to remember to bump.
  let fresh = false;
  try {
    fresh = target.exists && stamp.exists && stamp.textSync().trim() === DB_VERSION;
  } catch {
    fresh = false; // an unreadable stamp means re-copy, never means keep
  }
  if (!fresh) {
    new Directory(dir).create({ intermediates: true, idempotent: true });
    if (target.exists) target.delete();
    const asset = Asset.fromModule(DB_ASSET);
    await asset.downloadAsync();
    new File(asset.localUri ?? asset.uri).copy(target);
    stamp.write(DB_VERSION);
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
    // Wake anything already rendered against these ids. Only when rows actually landed: a
    // query that found nothing (or one whose ids were all resident, which returned above)
    // changes no card's answer and must not re-render the deck.
    if (rows.length) textChanged();
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

/**
 * "I am rendering this card and it has no text." Fetch it, and notify when it lands.
 *
 * The warm path is the ONLY path that matters for cost, and on it this is a single
 * `Map.has` — the store warms a page and its successors a page ahead, so by the time a card
 * is drawn its row is resident and this returns without touching the database. It is
 * therefore safe to call from render-time code on every card of every page turn.
 *
 * The cold path is the repair, and it exists because warming ahead cannot cover every way a
 * card reaches the screen: the very first card of a first run races the one-time copy of the
 * database out of the APK, and the reroll (`jumpToRandom`) navigates to a card nothing warmed
 * at all. Rather than teach each of those to await, the page that is actually showing the
 * card asks for what it is missing and re-renders when it arrives.
 *
 * Fire-and-forget by design: `loadText` never rejects, and a card whose row genuinely does not
 * exist simply stays empty — the request is not retried, because the caller only asks again
 * when it re-mounts.
 */
export function requestText(id: string | null | undefined): void {
  if (!id || TEXT.has(id)) return;
  if (requested) {
    requested.add(id);
    return;
  }
  const batch = (requested = new Set([id]));
  void Promise.resolve().then(() => {
    requested = null;
    void loadText([...batch]);
  });
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
): Promise<
  Array<{
    token: string;
    df: number;
    ords: string;
    /** Salience rank of this token in each card, parallel to `ords`; 255 = prose only. */
    ranks: Uint8Array | null;
    /** Content-word count of the slot that gave that rank, parallel to `ords`; a divisor. */
    widths: Uint8Array | null;
  }>
> {
  await ensureDb();
  if (!db || !tokens.length) return [];
  try {
    return await db.getAllAsync<{
      token: string;
      df: number;
      ords: string;
      ranks: Uint8Array | null;
      widths: Uint8Array | null;
    }>(
      `SELECT token, df, ords, ranks, widths FROM search_token WHERE token IN (${tokens.map(() => '?').join(',')})`,
      tokens as string[]
    );
  } catch (e) {
    // Same degradation as loadText, and it must NOT reject: cardStore.ask awaits this on the
    // way to the search box, so a throw here takes the whole ask down instead of declining.
    // No postings reads as "nothing matched", which falls to the model path — the safe way to
    // be wrong. (`ranks` and `widths` are why this guard is here: a database written before
    // those columns exist would fail the SELECT, and the version stamp is what normally
    // prevents it.)
    console.warn('[cardDb] searchTokenRows failed:', e);
    return [];
  }
}

/**
 * How many distinct HEAD tokens each card has — its topic plus its terms, by pool ordinal.
 *
 * This is the divisor in searchCards' aboutness share: the query's salience-weighted match has
 * to be measured against the card's OWN salience mass, or a card with twenty terms that mentions
 * the query word fifth scores the same as a card whose entire subject is that word. 46,421 bytes
 * in one row, decoded once per launch — it is per-CARD data, so it cannot ride on the postings.
 *
 * Returns null when the database could not be opened or predates the column, which searchCards
 * reads as "no card-side normalisation": a worse ranking, never a wrong one.
 */
let HEAD_SIZES: Uint8Array | null = null;
let headSizesLoad: Promise<Uint8Array | null> | null = null;

async function readHeadSizes(): Promise<Uint8Array | null> {
  await ensureDb();
  if (!db) return null;
  try {
    const row = await db.getFirstAsync<{ value: Uint8Array }>(
      "SELECT value FROM search_meta WHERE key = 'head_sizes'"
    );
    const v = row?.value;
    if (!v || v.length < 1) return null;
    // One byte per POOL ORDINAL, so a blob of any other length is not addressable by ordinal.
    // The check is not paranoia: searchCards reads `headSizes[o]` for every candidate, and a
    // short blob returns `undefined` there rather than throwing — HEAD_MASS[undefined] is
    // undefined, the aboutness becomes NaN, every NaN comparison is false, and the ranking
    // silently degrades to first-card-scanned, which is the exact bug aboutness exists to fix.
    // Refusing the blob degrades to a uniform H = 1 instead: a worse ranking, but a consistent
    // one, and it says so.
    const want = (cardsIndex as { cards: unknown[] }).cards.length;
    if (v.length !== want) {
      console.warn(
        `[cardDb] head sizes are ${v.length} bytes for ${want} cards — search ranks without them`
      );
      return null;
    }
    HEAD_SIZES = v instanceof Uint8Array ? v : new Uint8Array(v);
    return HEAD_SIZES;
  } catch (e) {
    console.warn('[cardDb] head sizes unavailable — search ranks without them:', e);
    return null;
  }
}

export function cardHeadSizes(): Promise<Uint8Array | null> {
  if (HEAD_SIZES) return Promise.resolve(HEAD_SIZES);
  if (!headSizesLoad) headSizesLoad = readHeadSizes();
  return headSizesLoad;
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


// ---------------------------------------------------------------------------------------
// The tutor's grounding fact bank, in the SAME database.
//
// 50,279 facts used to ship as `packages/shared/src/rag/facts.generated.ts` — 43.5 MB of
// TypeScript that was the DEFAULT CONSTRUCTOR ARGUMENT of RagStore, so it landed in the JS
// bundle for exactly the reason the card inventory did, one file over. Metro cannot
// tree-shake it; it compiled to 41.2 MB of Hermes bytecode (measured with the toolchain's own
// hermesc) and the bundle is STORED rather than deflated in the APK, because React Native's
// gradle plugin puts the bundle extension in `noCompress`. As SQLite rows the same content
// costs 17.8 MB deflated — the APK's own encoding for a .db asset.
//
// It now lives in cards.db as `fact` + `fact_token` + `fact_meta` (rag/pipeline/
// build-facts-db.py), and RagStore reads it through the inverted index rather than holding
// it: a query touches the few hundred rows carrying its tokens and materialises only the
// ten facts it returns. Measured in Node against this same database and the same
// SqlFactSource: 380 MB of heap and 2.4 s of startup become 6 MB and 2 ms.
//
// Reads are SYNCHRONOUS (getAllSync) because RagStore.search is, and because these are
// indexed lookups of a handful of rows — the same shape as the Map lookups they replace.
// Making retrieval async would have rippled through every caller for no gain.
// ---------------------------------------------------------------------------------------
import { FACT_COLUMNS, SqlFactSource, type FactDbDriver, type FactDbRow } from '@hiraia/shared';

let FACTS: SqlFactSource | null = null;

/**
 * The fact bank as a `FactSource`, ready to hand to `new RagStore(...)`.
 *
 * Returns null when the database could not be opened — the same degradation the rest of this
 * module takes, except that here it means UNGROUNDED answers rather than a blank card, so the
 * caller is expected to log it as an error, not a warning.
 */
export async function openFactSource(): Promise<SqlFactSource | null> {
  if (FACTS) return FACTS;
  await ensureDb();
  const handle = db;
  if (!handle) return null;
  const holes = (n: number) => new Array(n).fill('?').join(',');
  const driver: FactDbDriver = {
    meta: () => handle.getAllSync<{ key: string; value: string }>('SELECT key, value FROM fact_meta'),
    tokenRow: (token) =>
      handle.getFirstSync<{ df: number; ords: string }>(
        'SELECT df, ords FROM fact_token WHERE token = ?',
        [token]
      ) ?? undefined,
    factRows: (ords) =>
      handle.getAllSync<FactDbRow>(
        `SELECT ${FACT_COLUMNS} FROM fact WHERE ord IN (${holes(ords.length)})`,
        ords as number[]
      ),
    ordRows: (ids) =>
      handle.getAllSync<{ ord: number }>(
        `SELECT ord FROM fact WHERE id IN (${holes(ids.length)})`,
        ids as string[]
      ),
    maxOrd: () => handle.getFirstSync<{ m: number | null }>('SELECT MAX(ord) AS m FROM fact')?.m ?? undefined,
  };
  // Throws on a truncated or bank-mismatched database rather than serving mis-aligned
  // ordinals — see SqlFactSource's constructor. That verdict is also the only evidence we
  // ever get that the copy in open() went wrong, so spend it: drop the stamp before
  // rethrowing and the next launch re-copies from the APK instead of trusting a stamp that
  // certifies a half-written file. The caller degrades to ungrounded (LocalEngine.initialize).
  try {
    FACTS = new SqlFactSource(driver);
  } catch (e) {
    dropStamp();
    throw e;
  }
  return FACTS;
}
