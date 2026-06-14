#!/usr/bin/env node
// Local-judge a subset of probes via an OpenAI-compatible endpoint (the AUP bypass).
//
// The Usage Policy classifier deterministically kills Claude contexts containing certain
// child-tutor body/biology transcripts in Tagalog/Cebuano (see judge.workflow.js header).
// Those probes must never enter a Claude context — main session OR subagent — so they are
// judged by a LOCAL model instead (default: Qwen2.5-14B via llama-server). For a clean A/B,
// judge the BASELINE answers for the same probe ids with this same script, so the per-probe
// delta is same-judge.
//
// Usage:  JUDGE_ENDPOINT=http://localhost:9099 [JUDGE_MODEL=...] \
//           node judge-local.mjs <items.json> <out-result.json>
//   items.json = [{tag, id, file}] (judge-split.mjs output, possibly filtered)
//   out-result.json = bare [{tag, id, score}] (judge-merge.mjs accepts this shape)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const [itemsFile, outFile] = process.argv.slice(2)
if (!itemsFile || !outFile) {
  console.error('usage: JUDGE_ENDPOINT=... node judge-local.mjs <items.json> <out-result.json>')
  process.exit(1)
}
const ENDPOINT = process.env.JUDGE_ENDPOINT
if (!ENDPOINT) { console.error('JUDGE_ENDPOINT is required'); process.exit(1) }
const MODEL = process.env.JUDGE_MODEL || ''
const CONC = Math.max(1, Number(process.env.CONC ?? '4'))

const RUBRIC = fs.readFileSync(path.join(HERE, 'rubric.md'), 'utf8')
const items = JSON.parse(fs.readFileSync(itemsFile, 'utf8'))

const langLine = (tag) =>
  tag === 'bisaya'
    ? 'This is a Bisaya probe — the answer must be genuinely Cebuano; drifting into Tagalog scores naturalness ≤2.'
    : tag === 'english'
      ? 'This is an ENGLISH probe — the answer should be in clear English; drifting into Tagalog scores naturalness low.'
      : 'Tagalog is expected; heavy English drift scores naturalness low.'

function judgePrompt(it, row) {
  const p = row.probe
  const mt = p.tier === 'multi-turn'
  const body = mt
    ? `=== DIALOGUE (multi-turn; STUDENT turns were scripted, every TUTOR turn is the model under test) ===\n${row.answer || '(empty)'}\n\n` +
      `This is a MULTI-TURN probe: score the TUTOR's conduct across the WHOLE dialogue, per the ` +
      `rubric's "Multi-turn dialogue probes" section. Hard caps: re-delivering an earlier answer ` +
      `near-verbatim caps pedagogy at 1; asking the student a question they already answered (or ` +
      `re-asking the tutor's own earlier question) caps helpfulness at 1.`
    : `QUESTION: ${p.prompt}\n\n=== MODEL ANSWER ===\n${row.answer || '(empty)'}`
  return (
    `You are the impartial judge for the Hiraia tutor capability benchmark (an offline AI Science ` +
    `tutor for Filipino grade-school students). Score the MODEL ANSWER 0-5 on each of: accuracy, ` +
    `helpfulness, faithfulness, naturalness, pedagogy. Use the rubric exactly. Score what the answer ` +
    `ACTUALLY is, not what it tried to be; accuracy outranks fluency; a confident wrong claim in ANY ` +
    `turn scores accuracy as if it were the central claim. ${langLine(it.tag)}\n` +
    `Output ONLY strict JSON: {"accuracy":n,"helpfulness":n,"faithfulness":n,"naturalness":n,"pedagogy":n,"notes":"..."}.\n\n` +
    `=== RUBRIC ===\n${RUBRIC}\n\n` +
    `=== PROBE ===\nid: ${p.id} | grade: ${p.grade} | tier: ${p.tier}\n` +
    `must_answer: ${p.must_answer}\nintent: ${p.intent}\nmust_cover: ${(p.must_cover || []).join('; ')}\n` +
    `${body}\n\nScore now. JSON only.`
  )
}

async function judgeOne(it) {
  const row = JSON.parse(fs.readFileSync(it.file, 'utf8'))
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${ENDPOINT}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(MODEL ? { model: MODEL } : {}),
          messages: [{ role: 'user', content: judgePrompt(it, row) }],
          // Disable hybrid thinking (Qwen3/3.5): an over-budget <think> block
          // truncates before the JSON and silently parses to zeros. Servers
          // that don't know chat_template_kwargs ignore it; the <think> strip
          // below stays as a belt-and-suspenders for judges that think anyway.
          chat_template_kwargs: { enable_thinking: false },
          temperature: 0, max_tokens: 2048, stream: false,
        }),
      })
      if (!res.ok) throw new Error(`judge HTTP ${res.status}`)
      const data = await res.json()
      let raw = data.choices?.[0]?.message?.content ?? '{}'
      raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '')
      const m = raw.match(/\{[\s\S]*\}/)
      const j = JSON.parse(m ? m[0] : '{}')
      const score = {
        accuracy: +j.accuracy || 0, helpfulness: +j.helpfulness || 0, faithfulness: +j.faithfulness || 0,
        naturalness: +j.naturalness || 0, pedagogy: +j.pedagogy || 0, notes: String(j.notes ?? ''),
      }
      const dims = [score.accuracy, score.helpfulness, score.faithfulness, score.naturalness, score.pedagogy]
      if (dims.some((d) => d < 0 || d > 5)) throw new Error('score out of range')
      // all-zero almost always means the JSON never arrived (truncated think,
      // empty reply) and every `+undefined || 0` defaulted — fail loudly, retry
      if (dims.every((d) => d === 0) && !/"accuracy"\s*:\s*0/.test(m ? m[0] : '')) throw new Error('all-zero score (parse failure?)')
      console.log(`  judged ${it.id}`)
      return { tag: it.tag, id: it.id, score }
    } catch (e) {
      console.error(`  ${it.id} attempt ${attempt}: ${e.message}`)
      if (attempt === 3) return null
    }
  }
}

const out = []
let i = 0
await Promise.all(Array.from({ length: CONC }, async () => {
  while (i < items.length) {
    const it = items[i++]
    const r = await judgeOne(it)
    if (r) out.push(r)
  }
}))
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n')
const failed = items.filter((it) => !out.some((o) => o.id === it.id)).map((it) => it.id)
console.log(`${outFile}: ${out.length}/${items.length} judged${failed.length ? ` — FAILED: ${failed.join(', ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
