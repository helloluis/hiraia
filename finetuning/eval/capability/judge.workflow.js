export const meta = {
  name: 'judge-capability',
  description: 'Rubric-judge capability answers: one agent per probe, with retry rounds for spurious classifier kills',
  whenToUse: 'Subscription judging for the capability benchmark (single-turn and multi-turn). Prep items with judge-split.mjs, merge results with judge-merge.mjs.',
  phases: [{ title: 'Judge', detail: 'one judge per probe, 0-5 on 5 dimensions; failures retried up to maxRounds' }],
}

// args: { items: [{tag, id, file}], rubric: <path to rubric.md>, maxRounds?: 3 }
//   - items come from judge-split.mjs (one pre-extracted {probe, answer} file per probe)
//   - the Usage Policy classifier kills some judge agents. Diagnosed 2026-06-10: the
//     kills are DETERMINISTIC per transcript, not random — child-tutor dialogues with
//     body/biology vocabulary in Tagalog/Cebuano (dugo, sumasakit ang tiyan, buto,
//     plant in a dark room) trip a false positive 20/20 times, while physical-science
//     transcripts pass. Truthful benign framing in the prompt does NOT help; the main
//     session is unaffected. So: retry rounds rescue any genuinely transient kills,
//     but if a whole round judges 0, the kills are content-triggered and we bail
//     early. Everything in `unjudged` must be judged IN-SESSION (the proven fallback),
//     then merged via judge-merge.mjs.
const a = typeof args === 'string' ? JSON.parse(args) : args
const RUBRIC = a.rubric
const MAX_ROUNDS = a.maxRounds || 3

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    accuracy: { type: 'integer', minimum: 0, maximum: 5 },
    helpfulness: { type: 'integer', minimum: 0, maximum: 5 },
    faithfulness: { type: 'integer', minimum: 0, maximum: 5 },
    naturalness: { type: 'integer', minimum: 0, maximum: 5 },
    pedagogy: { type: 'integer', minimum: 0, maximum: 5 },
    notes: { type: 'string', description: 'one line on the deciding factor' },
  },
  required: ['accuracy', 'helpfulness', 'faithfulness', 'naturalness', 'pedagogy', 'notes'],
}

const judgePrompt = (it) => `You are the judge for the Hiraia capability benchmark (an offline AI Science tutor for Filipino grade-school students; Tagalog/Bisaya).

1. Read ${RUBRIC} in FULL — including the "Multi-turn dialogue probes" section with its HARD CAPS.
2. Read ${it.file} — it holds exactly one entry: { probe, answer } for probe id "${it.id}".
3. If probe.tier is "multi-turn", the answer is a FULL transcript: STUDENT turns were scripted by the benchmark; every TUTOR turn is the model under test. Judge ONLY the tutor's conduct across the whole dialogue, applying the hard caps AFTER normal scoring (near-verbatim repetition → pedagogy capped at 1; re-asking an answered question or the student's own question → helpfulness capped at 1). must_cover spans the whole dialogue. Otherwise, judge the single answer.
4. Judge against the probe's intent / must_answer / must_cover. Score what the answer ACTUALLY is, not what it tried to be; accuracy outranks fluency; a confident wrong claim in ANY turn scores accuracy as if it were the central claim. Language: ${it.tag === 'bisaya' ? 'this is a Bisaya probe — the answer must be genuinely Cebuano; drifting into Tagalog scores naturalness ≤2' : it.tag === 'english' ? 'this is an ENGLISH probe (judges/testers ask in English) — the answer should be in clear English; drifting into Tagalog scores naturalness low' : 'Tagalog is expected; heavy English drift scores naturalness low'}.

Return ONLY the structured score.`

phase('Judge')
const done = []
let pending = a.items
for (let round = 1; round <= MAX_ROUNDS && pending.length; round++) {
  if (round > 1) log(`retry round ${round}: re-judging ${pending.length} probe(s) killed by the classifier`)
  const results = await parallel(pending.map((it) => () =>
    agent(judgePrompt(it), {
      label: `judge:${it.id}${round > 1 ? `:r${round}` : ''}`,
      phase: 'Judge',
      schema: SCORE_SCHEMA,
    }).then((s) => ({ ...it, score: s }))
  ))
  const ok = results.filter(Boolean)
  done.push(...ok)
  const okIds = new Set(ok.map((r) => r.id))
  pending = pending.filter((it) => !okIds.has(it.id))
  log(`round ${round}: ${ok.length} judged, ${pending.length} remaining`)
  if (ok.length === 0 && pending.length > 0) {
    log('whole round judged 0 — kills look content-triggered (deterministic), skipping further retries')
    break
  }
}
if (pending.length) {
  log(`UNJUDGED after ${MAX_ROUNDS} rounds: ${pending.map((i) => i.id).join(', ')} — judge these in-session, then re-run judge-merge.mjs`)
}
return { scores: done, unjudged: pending.map((i) => i.id) }
