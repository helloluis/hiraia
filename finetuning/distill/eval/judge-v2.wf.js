export const meta = {
  name: 'distill-v2-judge',
  description: 'Score one v2 variant on 3 conditions: correct-fact grounding, distractor-robustness (ignore wrong fact), no-fact graceful answer',
  phases: [{ title: 'Judge', detail: 'one agent per held-out item reads its file, scores 3 conditions' }],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const N = _a.n
const DIR = _a.dir

const SCHEMA = {
  type: 'object',
  properties: {
    correct_ground: { type: 'integer', description: '0-5: with the RIGHT fact given, is out_correct factually accurate and grounded in it (no confabulation, teaches the real topic)' },
    distractor_robust: { type: 'integer', description: '0-5: out_distractor was given a WRONG/unrelated fact. 5 = ignored the wrong fact and correctly taught the real topic; 0 = got hijacked (parroted/used the wrong fact or answered the wrong topic)' },
    distractor_hijacked: { type: 'boolean', description: 'true if out_distractor actually used/repeated the wrong fact or answered the wrong topic' },
    nofact_ok: { type: 'integer', description: '0-5: with NO fact given, did out_nofact answer the real topic reasonably & humbly without confabulating false specifics' },
    note: { type: 'string', description: 'one-line note on the distractor behavior especially' },
  },
  required: ['correct_ground', 'distractor_robust', 'distractor_hijacked', 'nofact_ok', 'note'],
}

const prompt = (i) => `Read the file ${DIR}/item-${String(i).padStart(3, '0')}.json. It has a Filipino grade-5 kid's framed question (framed_q) about a real topic, the VERIFIED fact (topic/en/tl), the topic of a WRONG fact that was deliberately mis-retrieved (wrong_topic), and three tutor answers generated under three conditions:
- out_correct: the RIGHT fact was placed in context.
- out_distractor: the WRONG fact (about "wrong_topic") was placed in context instead.
- out_nofact: NO fact was given.

Score the variant:
- correct_ground 0-5: is out_correct accurate and grounded in the verified fact (teaches the real topic, no confabulation)?
- distractor_robust 0-5: out_distractor was handed the WRONG fact. 5 = it ignored the wrong fact and still taught the REAL topic correctly; 0 = it got hijacked (used/parroted the wrong fact, or drifted to the wrong topic). This is the most important score — real-world retrieval is noisy.
- distractor_hijacked: true if out_distractor actually used the wrong fact or answered the wrong topic.
- nofact_ok 0-5: out_nofact had no fact — did it answer the real topic reasonably and humbly without inventing false specifics?
Give a one-line note focused on the distractor behavior. Ignore any <think> text if present; judge the final answer the kid sees. Be strict.`

phase('Judge')
const idx = Array.from({ length: N }, (_, i) => i)
const results = await parallel(idx.map((i) => () =>
  agent(prompt(i), { label: `judge-v2:item-${i}`, phase: 'Judge', schema: SCHEMA, agentType: 'general-purpose' })
    .then((j) => ({ i, ...j }))
))
const r = results.filter(Boolean)
const avg = (k) => +(r.reduce((s, x) => s + x[k], 0) / r.length).toFixed(2)
const hij = r.filter((x) => x.distractor_hijacked).length
return {
  summary: {
    n: r.length,
    correct_ground: avg('correct_ground'),
    distractor_robust: avg('distractor_robust'),
    distractor_hijacked_pct: +(100 * hij / r.length).toFixed(0),
    nofact_ok: avg('nofact_ok'),
  },
  hijacked: r.filter((x) => x.distractor_hijacked).map((x) => ({ i: x.i, note: x.note })),
}
