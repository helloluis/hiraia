#!/usr/bin/env node
/**
 * Build ANCHORED judge bundles to score a NEW model (Qwen3.5-27B) on the SAME 0-5 scale as the
 * existing 5 — WITHOUT re-judging them (keeps their numbers frozen, per user request).
 *
 * For each AUP-safe probe: show the judge the 5 already-scored answers as anonymous CALIBRATION
 * anchors (answer + its 5-dim scores, shuffled) plus the NEW answer to score. The judge places the
 * new answer relative to the anchors. Out: judge-anchor-batch-<n>.json (+ reuses bundle-key? no key
 * needed — anchors carry their own scores; only the new answer is scored).
 *
 * Usage: node build-anchor-bundles.mjs <new-model>   (e.g. qwen3.5-27b)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const NEW = process.argv[2] ?? 'qwen3.5-27b';
const ANCHORS = ['hiraia-v7', 'opus-4.8', 'qwen3.5-9b', 'sailor2-3b', 'qwen3-1.7b'];
const DIMS = ['accuracy', 'helpfulness', 'faithfulness', 'naturalness', 'pedagogy'];
const BATCHES = 5;

const probes = JSON.parse(readFileSync(join(HERE, 'judge-probes.json'), 'utf8')); // 59 AUP-safe
const safeIds = new Set(probes.map((p) => p.id));
const ansOf = (m) => Object.fromEntries(JSON.parse(readFileSync(join(HERE, `answers.${m}.json`), 'utf8')).answers.filter((a) => safeIds.has(a.id)).map((a) => [a.id, a.answer]));
const safeAnsOf = (m) => Object.fromEntries(JSON.parse(readFileSync(join(HERE, `answers.${m}.safe.json`), 'utf8')).map((a) => [a.id, a.answer]));
const scoresOf = (m) => Object.fromEntries(JSON.parse(readFileSync(join(HERE, `scores.${m}.json`), 'utf8')).scores.map((s) => [s.id, s]));

const anchorAns = Object.fromEntries(ANCHORS.map((m) => [m, safeAnsOf(m)]));
const anchorScore = Object.fromEntries(ANCHORS.map((m) => [m, scoresOf(m)]));
const newAns = ansOf(NEW); // answers.<new>.json filtered to safe

const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

const bundles = probes.map((p) => {
  const order = [...ANCHORS].sort((a, b) => hash(p.id + a) - hash(p.id + b)); // anonymized order
  const anchors = order.map((m) => ({
    answer: anchorAns[m][p.id] ?? '',
    scores: Object.fromEntries(DIMS.map((d) => [d, anchorScore[m][p.id]?.[d]])),
  }));
  return { id: p.id, lang: p.lang, prompt: p.prompt, must_answer: p.must_answer, must_cover: p.must_cover, intent: p.intent, anchors, answer_to_score: newAns[p.id] ?? '' };
});

const per = Math.ceil(bundles.length / BATCHES);
for (let b = 0; b < BATCHES; b++) {
  const slice = bundles.slice(b * per, (b + 1) * per);
  if (slice.length) writeFileSync(join(HERE, `judge-anchor-batch-${b}.json`), JSON.stringify(slice, null, 1));
}
console.log(`anchored bundles for ${NEW}: ${bundles.length} probes → ${BATCHES} batches (~${per} each). 5 frozen anchors each.`);
