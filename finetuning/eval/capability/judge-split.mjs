#!/usr/bin/env node
// Split an answers.<name>.<tag>.json file into one file per probe, for the judging
// workflow (judge.workflow.js). Each judge agent then reads ONLY its own probe instead
// of the full answer set — smaller per-agent context, and a spuriously killed agent
// costs one probe, not the run.
//
// Usage:  node judge-split.mjs <answers-file.json> <tag> [<answers-file.json> <tag> ...]
// Output: per-probe files under .judge-work/<answers-basename>/<probe-id>.json
//         and the workflow `items` array printed to stdout (feed it to judge.workflow.js
//         as args.items, alongside args.rubric).

import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
if (argv.length < 2 || argv.length % 2 !== 0) {
  console.error('usage: node judge-split.mjs <answers-file.json> <tag> [<answers-file.json> <tag> ...]')
  process.exit(1)
}

const items = []
for (let i = 0; i < argv.length; i += 2) {
  const [answersFile, tag] = [argv[i], argv[i + 1]]
  const rows = JSON.parse(fs.readFileSync(answersFile, 'utf8'))
  const dir = path.resolve(
    path.dirname(answersFile),
    '.judge-work',
    path.basename(answersFile).replace(/\.json$/, '')
  )
  fs.mkdirSync(dir, { recursive: true })
  for (const row of rows) {
    if (!row.probe?.id) throw new Error(`${answersFile}: row without probe.id`)
    const file = path.join(dir, `${row.probe.id}.json`)
    fs.writeFileSync(file, JSON.stringify({ probe: row.probe, answer: row.answer }, null, 2) + '\n')
    items.push({ tag, id: row.probe.id, file })
  }
}
console.log(JSON.stringify(items, null, 2))
