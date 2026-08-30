import { tokenize } from './tokenize.js';
import type { ScienceFact } from './types.js';

/**
 * Where `RagStore` gets its facts from.
 *
 * The bank used to BE the retriever's data structure: `facts.generated.ts` was imported at
 * the top of RagStore.ts and became the default constructor argument, so every consumer —
 * the phone, the web demo, a dozen Node scripts — paid for all 50,279 facts whether or not
 * it wanted them. On the phone that was the expensive case: Metro cannot tree-shake, so the
 * array compiled to 41.2 MB of Hermes bytecode (measured), and the bundle is STORED rather
 * than deflated in the APK because React Native's gradle plugin adds the bundle extension to
 * `noCompress` — so those were 41.2 real megabytes of a budget phone's storage.
 *
 * So the store now reads through this interface instead, and the bank lives wherever suits
 * the consumer: `packages/mobile/assets/data/cards.db` on the phone (SqlFactSource, next to
 * the card text that moved for exactly the same reason), the source-of-truth JSONL in Node
 * (MemoryFactSource via bankFile.ts).
 *
 * SHAPE. The interface is an INVERTED index, not "give me the facts", because that is what
 * makes the SQLite side worth having: a query touches the few hundred rows that carry its
 * tokens instead of materialising 50k. The memory implementation builds the same inverted
 * shape from a `ScienceFact[]`, so there is ONE scorer with one arithmetic order rather than
 * a fast path and a slow path that have to be kept agreeing.
 *
 * EVERY METHOD IS SYNCHRONOUS. `RagStore.search` is called from synchronous code (the feed's
 * page-turn path, `retrieveForGrounding`, the stress harnesses), and making it async would
 * have rippled through every caller for no benefit — expo-sqlite exposes `getAllSync`, so a
 * device-side lookup is a synchronous indexed read, the same as the Map lookup it replaces.
 * A source that CANNOT answer synchronously (a network fetch, an async file read) must be
 * warmed before the store is constructed, not plumbed in here.
 */
export interface FactSource {
  /** How many facts the bank holds. Drives idf and `attachSemantic`'s alignment check. */
  readonly count: number;
  /**
   * Content stamp of the bank this source was built from (md5 of science-facts.jsonl,
   * first 12 hex chars — the same value `rag/scripts/build-vectors.py` writes into
   * `vectors-labse.meta.json`). Optional: a source built from an in-memory array has no
   * file to hash. When present, `attachSemantic` uses it to reject a mismatched blob.
   */
  readonly bankHash?: string;
  /** Postings for one token, or undefined when the token is not in the bank's vocabulary. */
  postings(token: string): TokenPostings | undefined;
  /**
   * Is this token in the bank's vocabulary at all?
   *
   * Membership only — no postings decode, no caching obligation. It exists because
   * `RagStore`'s spelling probe asks it about several hundred one-character respellings of
   * a single unknown word, and every one of those answers is discarded: routing that through
   * `postings` would decode and cache runs of typed arrays for words no one typed.
   */
  hasToken(token: string): boolean;
  /** The facts at these ordinals, in the SAME order; a hole means the row is missing. */
  facts(ords: readonly number[]): Array<ScienceFact | undefined>;
  /** Ordinals of these fact ids. Unknown ids are simply absent. */
  ordsOf(ids: readonly string[]): ReadonlySet<number>;
}

/**
 * One token's postings list.
 *
 * `ords` and `masks` are PARALLEL and ascending by ord. The mask is what makes a posting
 * scoreable on its own: RagStore weights a hit by WHICH FIELD it landed in (topic 8, terms
 * 4, the active language's body 1, the English body 0.5 as a code-switch bridge, first match
 * wins), so a posting that only said "fact 12345 contains this token" could not be scored
 * without going back to the fact.
 */
export interface TokenPostings {
  /** Document frequency across the whole bank — the idf input. */
  readonly df: number;
  /** Ascending fact ordinals carrying the token. Length === df. */
  readonly ords: Int32Array;
  /** Field bits per ord, parallel to `ords`. See FIELD_BIT. */
  readonly masks: Uint8Array;
}

/**
 * Which field of a fact a token was found in. Mirrored by `rag/pipeline/build-facts-db.py`,
 * which writes these bits into `fact_token.ords`; the values are also recorded in the
 * database's own `fact_meta.fieldBits` so a reader never has to trust a constant it cannot
 * see. Order matters only in that RagStore checks them in weight-priority order.
 */
export const FIELD_BIT = { topic: 1, terms: 2, tl: 4, en: 8, bis: 16 } as const;

// ---------------------------------------------------------------------------------------
// The packed postings encoding, shared with rag/pipeline/build-facts-db.py (which owns the
// writer half and round-trips every row against its source postings on every build).
//
// A posting is an ascending-by-ord DELTA in uppercase base36, then one character from a
// 31-value mask alphabet that shares no character with the base36 digits — so that character
// both carries the mask and terminates the entry. No separators, no fixed widths.
//
// Measured on the real bank: this is 5.9 MB of payload against 19.5 MB for the obvious
// `ord:mask,ord:mask,…` spelling (3.3 vs 6.9 MB deflated). The size is the smaller half of
// the reason. `ang` has df 49,037 and the strips-to-nothing fallback in `search` DOES score
// raw stop words, so a `split(',')` would allocate ~49k throwaway strings per such token on
// a budget phone; this decodes by scanning characters straight into two typed arrays.
// ---------------------------------------------------------------------------------------
const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const MASK_ALPHABET = 'abcdefghijklmnopqrstuvwxyz.-_~!';

/** charCode -> base36 digit value, or -1. A table so the hot loop is not two indexOf scans. */
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < B36.length; i++) DIGIT[B36.charCodeAt(i)] = i;
/** charCode -> field mask (1..31), or 0. */
const MASK = new Uint8Array(128);
for (let i = 0; i < MASK_ALPHABET.length; i++) MASK[MASK_ALPHABET.charCodeAt(i)] = i + 1;

/**
 * Unpack a `fact_token.ords` string into parallel (ord, mask) arrays.
 *
 * `df` is the row's own document frequency and therefore the exact posting count, so both
 * arrays are allocated once at the right size. A string that decodes to a different number
 * of postings than `df` claims is a corrupt row, not a short read: throwing here surfaces it
 * as a broken database rather than as a quietly wrong ranking.
 */
export function decodePostings(packed: string, df: number): TokenPostings {
  const ords = new Int32Array(df);
  const masks = new Uint8Array(df);
  let n = 0;
  let gap = 0;
  let prev = -1;
  for (let i = 0; i < packed.length; i++) {
    const c = packed.charCodeAt(i);
    const d = c < 128 ? DIGIT[c]! : -1;
    if (d >= 0) {
      gap = gap * 36 + d;
    } else {
      const m = c < 128 ? MASK[c]! : 0;
      if (m === 0) throw new Error(`fact_token: unknown character ${JSON.stringify(packed[i])} in postings`);
      prev += gap;
      if (n >= df) throw new Error(`fact_token: more postings than df ${df}`);
      ords[n] = prev;
      masks[n] = m;
      n++;
      gap = 0;
    }
  }
  if (n !== df) throw new Error(`fact_token: decoded ${n} postings, df says ${df}`);
  return { df, ords, masks };
}

/**
 * The bank held as a plain array, indexed in RAM. What every Node consumer uses (fed by
 * `loadFactBank()` from the source-of-truth JSONL) and what the old bundled-array default
 * was, minus the bundling.
 *
 * The index is built with the SAME `tokenize` the query side uses, so the memory path and
 * the database path agree on the vocabulary by construction on one side and by
 * `rag/pipeline/verify-tokenizer.mts` on the other.
 *
 * LAYOUT. Postings are three flat typed arrays plus a token -> slot map, rather than a
 * per-token pair of small arrays: 58,863 tokens would otherwise mean ~118k typed-array
 * objects whose per-object overhead exceeds the 2.4M postings they hold. `postings()` hands
 * back `subarray` VIEWS, which allocate nothing beyond the view itself.
 */
export class MemoryFactSource implements FactSource {
  readonly count: number;
  readonly bankHash?: string;
  private readonly bank: readonly ScienceFact[];
  private readonly ordById = new Map<string, number>();
  private readonly slot = new Map<string, number>();
  private readonly off: Int32Array;
  private readonly ordsFlat: Int32Array;
  private readonly masksFlat: Uint8Array;

  constructor(facts: readonly ScienceFact[], bankHash?: string) {
    this.bank = facts;
    this.count = facts.length;
    if (bankHash) this.bankHash = bankHash;
    for (let i = 0; i < facts.length; i++) this.ordById.set(facts[i]!.id, i);

    // Pass 1: token -> slot, and how many postings each slot gets. The mask per (fact, token)
    // is folded first so a token appearing in three fields of one fact is ONE posting, which
    // is also what makes `df` the document frequency RagStore counts rather than a term count.
    const perFact: Array<Map<string, number>> = new Array(facts.length);
    const counts: number[] = [];
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i]!;
      const m = new Map<string, number>();
      const mark = (text: string, bit: number) => {
        for (const t of tokenize(text)) m.set(t, (m.get(t) ?? 0) | bit);
      };
      mark(f.topic, FIELD_BIT.topic);
      mark(f.terms.join(' '), FIELD_BIT.terms);
      mark(f.fact.tl, FIELD_BIT.tl);
      mark(f.fact.en, FIELD_BIT.en);
      mark(f.fact.bis, FIELD_BIT.bis);
      perFact[i] = m;
      for (const t of m.keys()) {
        let s = this.slot.get(t);
        if (s === undefined) {
          s = counts.length;
          this.slot.set(t, s);
          counts.push(0);
        }
        counts[s]!++;
      }
    }

    // Pass 2: prefix-sum the counts into offsets, then fill. Facts are visited in ordinal
    // order, so each slot's run comes out ascending by ord — which the scorer and the
    // database encoding both rely on.
    const slots = counts.length;
    this.off = new Int32Array(slots + 1);
    for (let s = 0; s < slots; s++) this.off[s + 1] = this.off[s]! + counts[s]!;
    const total = this.off[slots]!;
    this.ordsFlat = new Int32Array(total);
    this.masksFlat = new Uint8Array(total);
    const cursor = this.off.slice(0, slots);
    for (let i = 0; i < facts.length; i++) {
      for (const [t, mask] of perFact[i]!) {
        const s = this.slot.get(t)!;
        const at = cursor[s]!;
        this.ordsFlat[at] = i;
        this.masksFlat[at] = mask;
        cursor[s] = at + 1;
      }
    }
  }

  hasToken(token: string): boolean {
    return this.slot.has(token);
  }

  postings(token: string): TokenPostings | undefined {
    const s = this.slot.get(token);
    if (s === undefined) return undefined;
    const a = this.off[s]!;
    const b = this.off[s + 1]!;
    return { df: b - a, ords: this.ordsFlat.subarray(a, b), masks: this.masksFlat.subarray(a, b) };
  }

  facts(ords: readonly number[]): Array<ScienceFact | undefined> {
    return ords.map((o) => this.bank[o]);
  }

  ordsOf(ids: readonly string[]): ReadonlySet<number> {
    const out = new Set<number>();
    for (const id of ids) {
      const o = this.ordById.get(id);
      if (o !== undefined) out.add(o);
    }
    return out;
  }
}
