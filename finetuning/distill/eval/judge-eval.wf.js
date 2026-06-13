export const meta = {
  name: 'distill-eval-judge',
  description: 'Blind A/B judge: base Sailor2-3B vs distilled adapter on held-out framed queries (intent / grounding / over-abstention)',
  phases: [{ title: 'Judge', detail: 'one agent per held-out item reads its file, scores A/B blind' }],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const N = _a.n
const DIR = _a.dir || '/Users/luis/Code/hiraia/finetuning/distill/eval/items'

const SCHEMA = {
  type: 'object',
  properties: {
    intentA: { type: 'integer', description: '0-5: did answer A address the kid’s REAL topic (not distracted by framing, not refusing)' },
    groundA: { type: 'integer', description: '0-5: factually accurate and consistent with the verified fact (0 if confabulated/wrong)' },
    abstainA: { type: 'boolean', description: 'true if A wrongly refuses/deflects instead of answering the topic' },
    intentB: { type: 'integer' },
    groundB: { type: 'integer' },
    abstainB: { type: 'boolean' },
    winner: { type: 'string', enum: ['A', 'B', 'tie'], description: 'which answer better serves a grade-5 kid: on-topic + accurate + not refusing' },
    note: { type: 'string', description: 'one-line reason' },
  },
  required: ['intentA', 'groundA', 'abstainA', 'intentB', 'groundB', 'abstainB', 'winner', 'note'],
}

const prompt = (i) => `Read the file ${DIR}/item-${String(i).padStart(3, '0')}.json. It has: framed_q (a Filipino grade-5 kid's messy, framed message to a science tutor), topic/en/tl (the VERIFIED fact it is really about), and two tutor answers ansA and ansB (generated with NO retrieval — pure model knowledge).

Judge which answer is better for the kid. Score EACH:
- intent 0-5: did it see through the "homework/essay/project/assignment" framing and actually TEACH the real topic? (Refusing, replying about the essay itself, formatting boilerplate, or answering a different topic = low.)
- ground 0-5: factually accurate and consistent with the verified fact? Confabulated or wrong details = low.
- abstain: true if it wrongly refuses/deflects/says it can't help instead of answering.
Then pick the overall winner for a grade-5 kid (on-topic + accurate + not refusing) and give a one-line reason. Be strict; short correct beats long padded.`

phase('Judge')
const idx = Array.from({ length: N }, (_, i) => i)
const results = await parallel(idx.map((i) => () =>
  agent(prompt(i), { label: `judge:item-${i}`, phase: 'Judge', schema: SCHEMA, agentType: 'general-purpose' })
    .then((j) => {
      const distIsA = i % 2 === 0
      const dist = { intent: distIsA ? j.intentA : j.intentB, ground: distIsA ? j.groundA : j.groundB, abstain: distIsA ? j.abstainA : j.abstainB }
      const base = { intent: distIsA ? j.intentB : j.intentA, ground: distIsA ? j.groundB : j.groundA, abstain: distIsA ? j.abstainB : j.abstainA }
      let winner = 'tie'
      if (j.winner === 'A') winner = distIsA ? 'distill' : 'base'
      else if (j.winner === 'B') winner = distIsA ? 'base' : 'distill'
      return { i, winner, dist, base, note: j.note }
    })
))

const r = results.filter(Boolean)
const avg = (side, ax) => +(r.reduce((s, x) => s + x[side][ax], 0) / r.length).toFixed(2)
const absPct = (side) => +(100 * r.filter((x) => x[side].abstain).length / r.length).toFixed(0)
const wins = { distill: 0, base: 0, tie: 0 }
for (const x of r) wins[x.winner]++
return {
  summary: {
    n: r.length,
    distill: { intent: avg('dist', 'intent'), ground: avg('dist', 'ground'), abstainPct: absPct('dist') },
    base: { intent: avg('base', 'intent'), ground: avg('base', 'ground'), abstainPct: absPct('base') },
    wins,
  },
  perItem: r.map((x) => ({ i: x.i, winner: x.winner, dG: x.dist.ground, bG: x.base.ground, note: x.note })),
}
