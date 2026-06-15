#!/usr/bin/env node
/**
 * De-anonymize comparative judge output: map A–E labels back to models via bundle-key.json,
 * producing per-model scores.<model>.json (the shape aggregate.mjs expects).
 * Usage: node deanon.mjs   (reads scores-batch-*.json + bundle-key.json)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const key = JSON.parse(readFileSync(join(HERE, 'bundle-key.json'), 'utf8'));
const DIMS = ['accuracy', 'helpfulness', 'faithfulness', 'naturalness', 'pedagogy'];

const perModel = {}; // model -> [{id, ...dims}]
let probesSeen = 0;
for (const f of readdirSync(HERE).filter((f) => /^scores-batch-\d+\.json$/.test(f))) {
  for (const row of JSON.parse(readFileSync(join(HERE, f), 'utf8'))) {
    const map = key[row.id];
    if (!map) { console.warn(`!! no key for ${row.id}`); continue; }
    probesSeen++;
    for (const label of ['A', 'B', 'C', 'D', 'E']) {
      const model = map[label];
      const sc = row[label];
      if (!model || !sc) { console.warn(`!! ${row.id} label ${label} missing`); continue; }
      (perModel[model] ??= []).push({ id: row.id, ...Object.fromEntries(DIMS.map((d) => [d, sc[d]])) });
    }
  }
}
for (const [model, scores] of Object.entries(perModel)) {
  writeFileSync(join(HERE, `scores.${model}.json`), JSON.stringify({ model, scores }, null, 1));
  console.log(`scores.${model}.json: ${scores.length} probes`);
}
console.log(`de-anon done (${probesSeen} probe-rows).`);
