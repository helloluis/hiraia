import { decodePostings, type FactSource, type TokenPostings } from './FactSource.js';
import type { ScienceFact } from './types.js';

/**
 * `FactSource` over the `fact` / `fact_token` / `fact_meta` tables that
 * `rag/pipeline/build-facts-db.py` writes into `packages/mobile/assets/data/cards.db`.
 *
 * The SQL driver is injected rather than imported, because the two callers cannot share one:
 * the phone has expo-sqlite (`getAllSync`) and Node has `node:sqlite` (`DatabaseSync`). What
 * they DO share is everything that could go wrong — the posting decode, the ord-order
 * contract, the JSON round-trip of `grades`/`terms`, the staleness stamp. Those live here,
 * once, so `rag/pipeline/rag-parity-probe.mts --source sqlite` exercises the exact code the
 * APK runs and its "identical to the baseline" result means something about the phone.
 *
 * WHAT IS RESIDENT. A count, a hash, and a bounded postings cache. Nothing else: fact rows
 * are fetched for the ~10 ordinals a query actually returns and dropped. That is the whole
 * point of going through SQL rather than handing `MemoryFactSource` 50,279 parsed objects.
 */
export interface FactDbDriver {
  /** `SELECT key, value FROM fact_meta` */
  meta(): Array<{ key: string; value: string }>;
  /** `SELECT df, ords FROM fact_token WHERE token = ?` */
  tokenRow(token: string): { df: number; ords: string } | undefined;
  /** `SELECT … FROM fact WHERE ord IN (…)` — any order; this class re-orders. */
  factRows(ords: readonly number[]): FactDbRow[];
  /** `SELECT ord FROM fact WHERE id IN (…)` */
  ordRows(ids: readonly string[]): Array<{ ord: number }>;
  /** `SELECT MAX(ord) FROM fact` — an indexed lookup, not a scan. */
  maxOrd(): number | undefined;
}

/** A `fact` row exactly as the table stores it. */
export interface FactDbRow {
  ord: number;
  id: string;
  domain: string;
  topic: string;
  /** compact JSON of number[] */
  grades: string;
  /** compact JSON of string[] */
  terms: string;
  tl: string;
  en: string;
  bis: string;
  source: string;
  generator: string;
  /** 0 | 1 */
  reviewed: number;
}

/** The columns, in the order `fact` declares them — handed to drivers so the SELECT is not
 *  spelled out twice and cannot drift between the two of them. */
export const FACT_COLUMNS =
  'ord, id, domain, topic, grades, terms, tl, en, bis, source, generator, reviewed';

/**
 * How many tokens' postings to keep decoded.
 *
 * A turn's query strips to a handful of tokens, and consecutive turns in one conversation
 * reuse most of them, so this is a hit-rate cache rather than a working set. The bound
 * matters because the tail is not uniform: `ang` has df 49,037 and decodes to ~240 KB of
 * typed arrays, so an unbounded cache would slowly accumulate the whole 5.9 MB index in RAM
 * and undo the reason the bank moved into SQLite. Oldest-first eviction, Map insertion order.
 */
const MAX_CACHED_TOKENS = 400;

export class SqlFactSource implements FactSource {
  readonly count: number;
  readonly bankHash?: string;
  private readonly cache = new Map<string, TokenPostings | null>();

  constructor(private readonly db: FactDbDriver) {
    const meta = new Map(db.meta().map((r) => [r.key, r.value]));
    const count = Number(meta.get('count'));
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`fact_meta.count is ${meta.get('count')} — cards.db has no usable fact bank`);
    }
    // `ord` is a dense 0..N-1 range (proven at build time by `build-facts-db.py --check`), so
    // MAX(ord)+1 is the number of rows actually present. Cross-checking it against the stamp
    // catches the failure this whole design is exposed to: cards.db is COPIED out of the APK
    // on first launch, and a truncated copy would still open, still answer queries, and
    // silently mis-align every ordinal against the positional vectors blob.
    const rows = (db.maxOrd() ?? -1) + 1;
    if (rows !== count) {
      throw new Error(`fact table holds ${rows} rows, fact_meta.count says ${count} — cards.db is truncated or half-written`);
    }
    this.count = count;
    const hash = meta.get('bankHash');
    if (hash) this.bankHash = hash;
  }

  hasToken(token: string): boolean {
    const hit = this.cache.get(token);
    if (hit !== undefined) return hit !== null;
    // Deliberately NOT cached, and deliberately not decoded: the spelling probe asks about
    // hundreds of one-character variants that will never be asked about again, so admitting
    // them would evict the query's real postings from a 400-entry cache to store misses.
    // The row's existence is the whole answer.
    return this.db.tokenRow(token) !== undefined;
  }

  postings(token: string): TokenPostings | undefined {
    const hit = this.cache.get(token);
    if (hit !== undefined) return hit ?? undefined;
    const row = this.db.tokenRow(token);
    // Misses are cached too. A query's stop words and typos are not in the vocabulary and
    // would otherwise re-hit SQLite on every turn that repeats them.
    const value = row ? decodePostings(row.ords, row.df) : null;
    if (this.cache.size >= MAX_CACHED_TOKENS) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(token, value);
    return value ?? undefined;
  }

  facts(ords: readonly number[]): Array<ScienceFact | undefined> {
    if (!ords.length) return [];
    // One statement for the whole page of results rather than one per hit: the caller asks
    // for the top-k it is about to return, which is ten rows on the hybrid path.
    const byOrd = new Map<number, ScienceFact>();
    for (const r of this.db.factRows([...new Set(ords)])) byOrd.set(r.ord, toFact(r));
    return ords.map((o) => byOrd.get(o));
  }

  ordsOf(ids: readonly string[]): ReadonlySet<number> {
    if (!ids.length) return EMPTY_ORDS;
    return new Set(this.db.ordRows([...new Set(ids)]).map((r) => r.ord));
  }
}

const EMPTY_ORDS: ReadonlySet<number> = new Set<number>();

/**
 * A stored row back into the `ScienceFact` the rest of the app types against.
 *
 * `grades` and `terms` round-trip as compact JSON rather than a separator join so `JSON.parse`
 * hands back the exact `number[]` / `string[]` the bundled array held, with no type guessing
 * on the way back (proven for all 50,279 rows by `build-facts-db.py --check`).
 */
function toFact(r: FactDbRow): ScienceFact {
  return {
    id: r.id,
    domain: r.domain as ScienceFact['domain'],
    topic: r.topic,
    grades: JSON.parse(r.grades) as number[],
    terms: JSON.parse(r.terms) as string[],
    fact: { tl: r.tl, en: r.en, bis: r.bis },
    source: r.source,
    generator: r.generator,
    reviewed: r.reviewed === 1,
  };
}
