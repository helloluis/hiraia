#!/usr/bin/env node
/**
 * Aggregate per-probe 5-dim judge scores (scores.<model>.json) into the 7 public
 * hiraiabench categories, per model → bench-results.json.
 *
 * Each category is a projection: mean over a PROBE SUBSET of one or more of the
 * judge's 5 dims (accuracy, helpfulness, faithfulness, naturalness, pedagogy).
 * This reuses our real rubric — no new scoring. Scores 0–5.
 *
 *   Science Accuracy : accuracy on reasoning+synthesis+helpfulness-floor
 *   Tagalog Fluency  : naturalness on lang=tl
 *   English Fluency  : naturalness on lang=en
 *   Bisaya           : mean(naturalness,accuracy) on lang=bis
 *   Pedagogy         : pedagogy on tier=pedagogy
 *   Safety & Honesty : mean(accuracy,helpfulness) on safety-myth+abstain-correct
 *   Code-switching   : mean(naturalness,helpfulness) on tier=codeswitch
 *
 * Usage: node aggregate.mjs hiraia-v7 opus-4.8 qwen3.5-9b sailor2-3b qwen3-1.7b
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const models = process.argv.slice(2);
const probes = JSON.parse(readFileSync(join(HERE, 'bench-set.json'), 'utf8')).probes;
const byId = Object.fromEntries(probes.map((p) => [p.id, p]));

const CATS = {
  'Science Accuracy': { dims: ['accuracy'], pick: (p) => ['reasoning', 'synthesis', 'helpfulness-floor'].includes(p.tier) },
  'Tagalog Fluency': { dims: ['naturalness'], pick: (p) => p.lang === 'tl' },
  'English Fluency': { dims: ['naturalness'], pick: (p) => p.lang === 'en' },
  Bisaya: { dims: ['naturalness', 'accuracy'], pick: (p) => p.lang === 'bis' },
  Pedagogy: { dims: ['pedagogy'], pick: (p) => p.tier === 'pedagogy' },
  'Safety & Honesty': { dims: ['accuracy', 'helpfulness'], pick: (p) => ['safety-myth', 'abstain-correct'].includes(p.tier) },
  'Code-switching': { dims: ['naturalness', 'helpfulness'], pick: (p) => p.tier === 'codeswitch' },
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const results = {};
for (const m of models) {
  const f = join(HERE, `scores.${m}.json`);
  if (!existsSync(f)) { console.warn(`!! missing ${f} — skipping ${m}`); continue; }
  const scored = JSON.parse(readFileSync(f, 'utf8')).scores; // [{id, accuracy, helpfulness, faithfulness, naturalness, pedagogy}]
  const byScoreId = Object.fromEntries(scored.map((s) => [s.id, s]));
  const cats = {};
  for (const [cat, { dims, pick }] of Object.entries(CATS)) {
    const vals = [];
    for (const s of scored) {
      const p = byId[s.id];
      if (!p || !pick(p)) continue;
      const ds = dims.map((d) => s[d]).filter((v) => typeof v === 'number');
      if (ds.length) vals.push(mean(ds));
    }
    cats[cat] = vals.length ? Number(mean(vals).toFixed(2)) : null;
    cats[`${cat}__n`] = vals.length;
  }
  results[m] = cats;
}
writeFileSync(join(HERE, 'bench-results.json'), JSON.stringify(results, null, 1));
console.log('bench-results.json:');
for (const [m, c] of Object.entries(results)) {
  console.log(`  ${m}:`, Object.fromEntries(Object.keys(CATS).map((k) => [k, c[k]])));
}
