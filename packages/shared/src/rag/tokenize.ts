/**
 * The retriever's tokeniser, on its own because three things have to agree on it exactly:
 * `RagStore.search` (which tokenises the QUERY), `MemoryFactSource` (which tokenises the
 * BANK), and `rag/pipeline/build-facts-db.py` (which tokenises the bank again, in Python,
 * to write `fact_token` into cards.db).
 *
 * A one-character disagreement between those does not fail loudly — it shifts idf for the
 * whole corpus and quietly reranks everything. `rag/pipeline/verify-tokenizer.mts` proves
 * the Python mirror against this file over all 50,279 facts rather than trusting a comment.
 */

/** matches build-bank.py's `len(t) > 2` */
const MIN_TOKEN_LEN = 3;

/**
 * Conservative plural collapse so singular/plural forms unify (the query "dinosaur"
 * must reach the fact whose terms say "dinosaurs"). Applied to BOTH index and query,
 * so it only needs to be CONSISTENT, not linguistically correct — over-stemming a
 * word the same way on both sides still matches. Excludes -ss/-us/-is/-os/-as/-ous
 * and short words so proper nouns (Uranus, Venus) and Tagalog/Cebuano words survive.
 */
function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y'; // batteries->battery
  if (t.length > 4 && t.endsWith('s') && !/(ss|us|is|os|as|ous)$/.test(t)) return t.slice(0, -1);
  return t;
}

/**
 * Lowercase, strip punctuation, split, stem. Keeps ñ + a few accents for "niño".
 *
 * The length filter runs BEFORE stemming (so "cats" survives as "cat" while "ads" is
 * dropped whole) — easy to invert when re-implementing, and it changes the vocabulary.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9ñáéíóúàèìòù]+/i)
    .filter((t) => t.length >= MIN_TOKEN_LEN)
    .map(stem);
}
