#!/usr/bin/env node
// Merge judge.workflow.js results onto an answers file → a scores file
// ([{probe, answer, score}], the shape run-capability.mts PHASE=report reads).
//
// Usage:  node judge-merge.mjs <answers-file.json> <tag> <out-scores.json> <judge-result.json> [...]
//
// Judge-result files are `{ scores: [{tag, id, score}], ... }` (the workflow's return
// value) or a bare `[{tag, id, score}]` array (e.g. in-session fallback judgments).
// Later files overlay earlier ones, and an existing out file's scores are kept as the
// base — so the fallback flow is: merge (exits 1 listing unjudged ids) → judge those
// in-session → merge again with the extra result file.

import fs from 'node:fs'

const [answersFile, tag, outFile, ...resultFiles] = process.argv.slice(2)
if (!answersFile || !tag || !outFile || resultFiles.length === 0) {
  console.error('usage: node judge-merge.mjs <answers-file.json> <tag> <out-scores.json> <judge-result.json> [...]')
  process.exit(1)
}

const byId = new Map()
if (fs.existsSync(outFile)) {
  for (const row of JSON.parse(fs.readFileSync(outFile, 'utf8'))) {
    if (row.score) byId.set(row.probe.id, row.score)
  }
}
for (const rf of resultFiles) {
  const parsed = JSON.parse(fs.readFileSync(rf, 'utf8'))
  const scores = Array.isArray(parsed) ? parsed : parsed.scores
  for (const s of scores) {
    if (s.tag !== tag) continue
    byId.set(s.id, s.score)
  }
}

const rows = JSON.parse(fs.readFileSync(answersFile, 'utf8'))
const out = []
const missing = []
for (const row of rows) {
  const score = byId.get(row.probe.id)
  if (!score) { missing.push(row.probe.id); continue }
  out.push({ probe: row.probe, answer: row.answer, score })
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n')
console.log(`${outFile}: ${out.length}/${rows.length} scored rows`)
if (missing.length) {
  console.error(`MISSING scores for: ${missing.join(', ')} — judge in-session, then re-merge`)
  process.exit(1)
}
