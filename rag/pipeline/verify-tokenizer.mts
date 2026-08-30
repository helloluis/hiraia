/**
 * Prove that build-facts-db.py's tokeniser is RagStore's tokeniser.
 *
 * The fact bank's inverted index (`fact_token` in cards.db) is built in Python, but the
 * scores it has to reproduce come from `tokenize()` in tokenize.ts — the same function
 * RagStore runs on the QUERY and MemoryFactSource runs on the bank. A one-character
 * disagreement — the length filter landing after the stemmer instead of before it, an accent
 * missing from the keep-set — does not fail anything loudly. It silently shifts idf for every
 * token in the corpus, which is exactly the change this migration is not allowed to make.
 *
 * So the two are compared over the whole bank, field by field, rather than spot-checked:
 *
 *   node_modules/.bin/tsx rag/pipeline/verify-tokenizer.mts
 *
 * Exits non-zero on the first fact whose five token sets differ, and names it.
 */
import { readFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tokenize } from '../../packages/shared/src/rag/tokenize.ts';
import type { ScienceFact } from '../../packages/shared/src/rag/types.ts';

const BANK = new URL('../bank/science-facts.jsonl', import.meta.url);
const BUILDER = new URL('./build-facts-db.py', import.meta.url).pathname;
const PY_OUT = '/tmp/hiraia-tok-py.txt';

const facts = readFileSync(BANK, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as ScienceFact);

// One md5 per fact over its five sorted token sets — the same five sets, in the same order,
// that `field_sets()` builds on the Python side.
const js = facts.map((f) => {
  const sets = [
    tokenize(f.topic),
    tokenize(f.terms.join(' ')),
    tokenize(f.fact.tl),
    tokenize(f.fact.en),
    tokenize(f.fact.bis),
  ].map((t) => [...new Set(t)].sort().join(' '));
  return createHash('md5').update(sets.join('|')).digest('hex');
});

execFileSync('python3', [BUILDER, '--verify-tokens', PY_OUT], { stdio: 'ignore' });
const py = readFileSync(PY_OUT, 'utf8').trim().split('\n');
unlinkSync(PY_OUT);

if (py.length !== js.length) {
  console.error(`fact count differs: js ${js.length}, py ${py.length}`);
  process.exit(1);
}
const bad = js.findIndex((h, i) => h !== py[i]);
if (bad >= 0) {
  const f = facts[bad]!;
  console.error(`TOKENISER MISMATCH at ord ${bad} (${f.id})`);
  console.error(`  topic: ${JSON.stringify([...new Set(tokenize(f.topic))].sort())}`);
  process.exit(1);
}
console.log(`TOKENISER PARITY: identical for all ${js.length} facts (topic, terms, tl, en, bis)`);
