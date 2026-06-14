/**
 * Capability-benchmark judge (subscription, no API key) — scores each collected answer on the
 * 5 rubric dimensions, mirroring run-capability.mts's inline judge but via parallel Claude agents.
 *
 * Invoke after run-capability.sh collects answers. The caller writes one small item file per
 * answer to `<dir>/.judge-items/<tag>-<NNN>.json` ({probe, answer, multiTurn}) + a manifest, then
 * passes the manifest as args. Each agent reads the rubric + its item file and returns a Scored
 * object; the caller groups results by tag and writes capability-scores.<tag>.json, then
 * `PHASE=report run-capability.mts` merges + prints (Capability Score + presentation metrics).
 *
 * args = {
 *   dir: 'finetuning/eval/capability',                 // repo-relative; agents Read from here
 *   passes: [{ tag: 'tagalog', n: 104 }, …]            // item files are <tag>-<NNN>.json, 0..n-1
 * }
 * returns { scored: [{ tag, i, score:{accuracy,helpfulness,faithfulness,naturalness,pedagogy,notes} }] }
 */
export const meta = {
  name: 'capability-judge',
  description: 'Score Hiraia capability-benchmark answers on the 5 rubric dimensions (parallel blind judge)',
  phases: [{ title: 'Judge', detail: 'one agent per collected answer → strict-JSON 0–5 per dimension' }],
}

const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const ITEMS = _a.passes.flatMap((p) =>
  Array.from({ length: p.n }, (_, i) => ({ tag: p.tag, i, file: `${p.tag}-${String(i).padStart(3, '0')}.json` }))
)

const SCHEMA = {
  type: 'object',
  properties: {
    accuracy: { type: 'integer', description: '0-5, factual correctness (textbook consensus)' },
    helpfulness: { type: 'integer', description: '0-5, did it actually answer? (must_answer:true → a refusal is 0; must_answer:false → a correct abstain+redirect is 5)' },
    faithfulness: { type: 'integer', description: '0-5, grounded / no fabrication; honest uncertainty scores high' },
    naturalness: { type: 'integer', description: '0-5, TL/BIS/EN fluency + grade-appropriate; wrong language or persona-leak is low' },
    pedagogy: { type: 'integer', description: '0-5, teaches (analogy/example/check) vs dumps; restraint on chit-chat' },
    notes: { type: 'string', description: 'one line on the deciding factor' },
  },
  required: ['accuracy', 'helpfulness', 'faithfulness', 'naturalness', 'pedagogy', 'notes'],
}

const prompt = (it) =>
  `You are the impartial judge for the Hiraia tutor capability benchmark.\n` +
  `1. Read ${DIR}/rubric.md — apply it EXACTLY (5 dimensions, 0–5; accuracy outranks fluency; a refusal on a must_answer:true probe is helpfulness 0; a correct abstain+redirect on must_answer:false is 5).\n` +
  `2. Read ${DIR}/.judge-items/${it.file} — it has { probe, answer, multiTurn }. The probe gives id/tier/lang/grade/intent/must_answer/must_cover; "answer" is the model output the child sees (image tags already stripped). If multiTurn is true, it is a full dialogue transcript — apply the rubric's "Multi-turn dialogue probes" hard caps (near-verbatim repetition → pedagogy ≤1; re-asking an answered question → helpfulness ≤1).\n` +
  `3. Score that one answer against its probe. For the 'presentation' tier, follow the rubric's "Presentation probes" guidance (illustration restraint, natural non-forced endings incl. no English persona-leak, engagement).\n` +
  `Return ONLY the strict JSON object: {accuracy, helpfulness, faithfulness, naturalness, pedagogy, notes}. Be strict.`

phase('Judge')
const scored = await parallel(ITEMS.map((it) => () =>
  agent(prompt(it), { label: `judge:${it.tag}:${it.i}`, phase: 'Judge', schema: SCHEMA, agentType: 'general-purpose' })
    .then((s) => ({ tag: it.tag, i: it.i, score: s }))
    .catch(() => null)
))
return { scored: scored.filter(Boolean) }
