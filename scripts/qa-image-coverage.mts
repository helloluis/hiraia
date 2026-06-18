/**
 * Audit script for task #26 (image-catalog QA sweep).
 *
 * Loads the fact bank + FACT_IMAGE map and emits:
 *   - per-domain coverage (fact_count, image_count, coverage_pct, sample uncovered ids)
 *   - volcano slug audit: every fact whose topic mentions "volcano"/"bulkan" with its
 *     mapped slug, flagged when topic words don't appear in the slug (heuristic for
 *     "wrong volcano picture").
 *
 * Usage: node_modules/.bin/tsx scripts/qa-image-coverage.mts
 *        node_modules/.bin/tsx scripts/qa-image-coverage.mts --domain EARTH_SPACE
 */
import { readFileSync } from 'node:fs';

type Fact = { id: string; domain: string; topic: string; fact: { tl?: string; en?: string } };

const BANK = 'rag/bank/science-facts.jsonl';
const MAP  = 'packages/mobile/src/generated/factImage.ts';

const flagDomain = process.argv.find((a) => a.startsWith('--domain='))?.split('=')[1];

// Parse FACT_IMAGE.ts → Map<fact_id, slug>.
const factImage = new Map<string, string>();
for (const line of readFileSync(MAP, 'utf8').split('\n')) {
  const m = /^\s*"([^"]+)":\s*"([^"]+)"/.exec(line);
  if (m) factImage.set(m[1], m[2]);
}

// Load bank.
const facts: Fact[] = [];
for (const l of readFileSync(BANK, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  facts.push(JSON.parse(l));
}

// === per-domain coverage ===
const byDomain = new Map<string, { count: number; withImage: number; sampleMissing: string[] }>();
for (const f of facts) {
  const d = f.domain || 'UNKNOWN';
  const e = byDomain.get(d) ?? { count: 0, withImage: 0, sampleMissing: [] };
  e.count++;
  if (factImage.has(f.id)) e.withImage++;
  else if (e.sampleMissing.length < 3) e.sampleMissing.push(f.id);
  byDomain.set(d, e);
}

console.log('\n=== per-domain image coverage ===');
console.log('domain                          facts  with-img   pct  sample-missing-ids');
console.log('-'.repeat(108));
const rows = [...byDomain.entries()].sort((a, b) => b[1].count - a[1].count);
for (const [d, e] of rows) {
  const pct = (100 * e.withImage / e.count).toFixed(1).padStart(5);
  console.log(
    `${d.padEnd(28)} ${String(e.count).padStart(7)}  ${String(e.withImage).padStart(7)}  ${pct}%  ${e.sampleMissing.slice(0, 3).join(', ')}`,
  );
}
const totalFacts = facts.length, totalImg = facts.filter((f) => factImage.has(f.id)).length;
console.log('-'.repeat(108));
console.log(`TOTAL                        ${String(totalFacts).padStart(7)}  ${String(totalImg).padStart(7)}  ${(100 * totalImg / totalFacts).toFixed(1).padStart(5)}%`);

// === volcano slug audit ===
console.log('\n=== volcano/bulkan slug audit ===');
const volcanoFacts = facts.filter((f) =>
  /volcan|bulkan/i.test((f.topic || '') + ' ' + (f.fact?.en || '') + ' ' + (f.fact?.tl || '')),
);
console.log(`${volcanoFacts.length} facts mention volcano/bulkan`);
let flagged = 0;
const tokenize = (s: string) => s.toLowerCase().match(/[a-z]+/g) ?? [];
for (const f of volcanoFacts) {
  const slug = factImage.get(f.id);
  if (!slug) continue; // no image is a coverage gap, not a mismatch
  const slugTokens = new Set(tokenize(slug));
  const topicTokens = tokenize(f.topic || '');
  // Heuristic mismatch: topic mentions volcano/eruption/lava/magma but slug doesn't.
  const topicHasVolcanoWord = topicTokens.some((t) => /volcan|erupt|lava|magma|caldera|bulkan/.test(t));
  const slugHasVolcanoWord = [...slugTokens].some((t) => /volcan|erupt|lava|magma|caldera|bulkan/.test(t));
  if (topicHasVolcanoWord && !slugHasVolcanoWord) {
    flagged++;
    if (flagged <= 20) {
      console.log(`  MISMATCH: ${f.id.padEnd(40)} topic=${(f.topic || '').slice(0, 30).padEnd(30)}  slug=${slug}`);
    }
  }
}
console.log(`${flagged} volcano-topic facts with slug not mentioning volcano/eruption/lava/magma/caldera/bulkan`);
if (flagged > 20) console.log(`  (showing first 20; total ${flagged})`);

// === optional: detail a specific domain ===
if (flagDomain) {
  const missing = facts.filter((f) => f.domain === flagDomain && !factImage.has(f.id));
  console.log(`\n=== uncovered facts in ${flagDomain} (${missing.length}) ===`);
  for (const f of missing.slice(0, 50)) {
    console.log(`  ${f.id.padEnd(42)} ${f.topic}`);
  }
  if (missing.length > 50) console.log(`  ... +${missing.length - 50} more`);
}
