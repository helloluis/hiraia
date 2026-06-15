#!/usr/bin/env node
/**
 * Build COMPARATIVE + ANONYMIZED judge bundles. For each AUP-safe probe, gather all 5 models'
 * answers, shuffle them under blind labels (A–E), and emit batches for the judge. Comparative
 * scoring (all answers side-by-side) calibrates consistently; anonymization removes brand bias
 * (the judge can't just hand "opus-4.8" a 5). A key file de-anonymizes after.
 *
 * Out: judge-batch-<n>.json (bundles for one judge agent) + bundle-key.json ({probeId:{A:model}}).
 * Usage: node build-judge-bundles.mjs   (expects answers.<model>.safe.json for all MODELS below)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = ['hiraia-v7', 'opus-4.8', 'qwen3.5-9b', 'sailor2-3b', 'qwen3-1.7b'];
const BATCHES = 5; // ~12 probes/agent

const probes = JSON.parse(readFileSync(join(HERE, 'judge-probes.json'), 'utf8')); // 59 AUP-safe
const ans = {};
for (const m of MODELS) {
  const a = JSON.parse(readFileSync(join(HERE, `answers.${m}.safe.json`), 'utf8'));
  ans[m] = Object.fromEntries(a.map((x) => [x.id, x.answer]));
}

// deterministic shuffle (seeded by probe id hash) — no Math.random
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const LABELS = ['A', 'B', 'C', 'D', 'E'];

const key = {};
const bundles = [];
for (const p of probes) {
  const order = [...MODELS].sort((a, b) => hash(p.id + a) - hash(p.id + b)); // per-probe deterministic shuffle
  const candidates = {};
  const map = {};
  order.forEach((m, i) => { candidates[LABELS[i]] = ans[m][p.id] ?? ''; map[LABELS[i]] = m; });
  key[p.id] = map;
  bundles.push({ id: p.id, tier: p.tier, lang: p.lang, prompt: p.prompt, must_answer: p.must_answer, must_cover: p.must_cover, intent: p.intent, candidates });
}

writeFileSync(join(HERE, 'bundle-key.json'), JSON.stringify(key, null, 1));
const per = Math.ceil(bundles.length / BATCHES);
for (let b = 0; b < BATCHES; b++) {
  const slice = bundles.slice(b * per, (b + 1) * per);
  if (slice.length) writeFileSync(join(HERE, `judge-batch-${b}.json`), JSON.stringify(slice, null, 1));
}
console.log(`bundles: ${bundles.length} probes × ${MODELS.length} models → ${BATCHES} batches (~${per} probes each). key → bundle-key.json`);
