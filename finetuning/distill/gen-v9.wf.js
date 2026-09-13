/**
 * v9 pedagogy refinement (see build-v9-worklist.py / hiraia-safety-myth-negation-bug). Lifts pedagogy
 * via CLARITY (not warmth — v8's warmth caused agreeableness → safety regression), with myth/abstain
 * BALLAST so the safety behavior can't erode.
 *
 * args = { dir:'finetuning/distill/work-v9', plan:[{type, shards:[...]}, …] }
 * returns { rows:[{type, fact_id, ...}] } → build-v9-assemble.mts.
 */
export const meta = {
  name: 'gen-v9-distill',
  description: 'Generate v9 pedagogy-clarity turns + myth/abstain safety ballast',
  phases: [{ title: 'Generate', detail: 'one agent per shard' }],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const PLAN = _a.plan

const SCHEMAS = {
  pedagogy_clear: { type: 'object', required: ['user', 'assistant'], properties: {
    user: { type: 'string', description: "a natural grade-5 Tagalog 'paano/bakit/ano' question that THIS fact answers (a real kid's curiosity)" },
    assistant: { type: 'string', description: "A CLEAR, well-TAUGHT grade-5 Tagalog answer grounded in the fact. PEDAGOGY TARGETS: (1) SIMPLE everyday words — if a science term is needed, define it plainly right after. (2) Include ONE CONCRETE, FACTUALLY-CORRECT everyday EXAMPLE a Filipino kid has actually seen (e.g. an event in the kitchen, schoolyard, weather, market) that illustrates the idea — a REAL instance, NOT an analogy/metaphor/'parang X'. (3) Build intuition in a clear order (what → why). HARD CONSTRAINTS: NEUTRAL tone — do NOT praise the student or open with agreement ('ang galing mo', 'magaling', 'tama ka', 'Oo!'); just teach. Do NOT use analogies. Stay ACCURATE and grounded (never invent). Concise: 2-3 short sentences. You MAY end with ONE brief on-topic curiosity question (about the science, not praise). At most one fitting emoji." } } },
  myth_debunk: { type: 'object', required: ['seed', 'assistant'], properties: {
    seed: { type: 'string', description: "echo the item's 'Totoo ba…?' seed VERBATIM" },
    assistant: { type: 'string', description: "Decide true vs false, then answer CONFIDENTLY with correct polarity in grade-5 Tagalog. False myth: open 'Hindi po, hindi totoo iyan' then the REAL explanation. True fact: open 'Oo po, totoo' then explain. NEVER affirm a false myth; NEVER fabricate. 2-3 short sentences." } } },
  abstain: { type: 'object', required: ['seed', 'assistant'], properties: {
    seed: { type: 'string', description: "echo the item's unknowable 'seed' question VERBATIM" },
    assistant: { type: 'string', description: "The question is UNKNOWABLE (a superlative/exact number, tomorrow's weather, a lottery number, a private/personal fact). Abstain HONESTLY in grade-5 Tagalog: say plainly you are not sure / cannot know it, do NOT invent or guess a specific, and suggest asking a teacher or the right source. Do NOT give false encouragement. 1-2 sentences." } } },
}

const INSTR = {
  pedagogy_clear: `Each item is a verified fact. Write a natural grade-5 question it answers AND a CLEARLY-TAUGHT answer using simpler words + a concrete real example + good structure — NEUTRAL tone (no praise/agreement), NO analogies, accurate, concise. This is the SAFE pedagogy lever (v8's warmth/encouragement caused agreeableness → it affirmed myths; we avoid that here).`,
  myth_debunk: `Each item has a 'Totoo ba…?' seed. Reinforce confident correct-polarity debunking/confirming. BALLAST so the pedagogy data doesn't erode myth-correction.`,
  abstain: `Each item has an unknowable 'seed' (+ a distractor fact). Reinforce honest abstention with NO confabulation and NO false encouragement. BALLAST against the v8 'pasado ka!'-style confabulation.`,
}

phase('Generate')
const tasks = []
for (const p of PLAN) for (const shard of (p.shards || [])) tasks.push({ type: p.type, shard })

const all = await parallel(tasks.map((t) => () => (async () => {
  return await agent(
    `You are writing TRAINING data for Hiraia, an offline Filipino grade-5 science tutor. ` +
    `Read ${DIR}/${t.type}/${t.shard} — a JSON array of items (each has an "id"; pedagogy_clear items have a fact's en/tl; myth_debunk & abstain items have a "seed", abstain also has a distractor fact's en/tl). ` +
    `For EACH item produce one training row following the schema; return {"rows":[…]} with one object per item IN ORDER, each including "fact_id" = the item's id.\n\n` +
    INSTR[t.type],
    { label: `gen:${t.type}:${t.shard}`, phase: 'Generate',
      schema: { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: {
        ...SCHEMAS[t.type],
        properties: { ...SCHEMAS[t.type].properties, fact_id: { type: 'string' } },
        required: [...SCHEMAS[t.type].required, 'fact_id'],
      } } } },
      agentType: 'general-purpose' })
    .then((r) => (r?.rows || []).map((row) => ({ type: t.type, ...row })))
    .catch(() => [])
})()))
return { rows: all.flat() }
