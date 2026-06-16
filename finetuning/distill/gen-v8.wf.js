/**
 * v8 pedagogy patch data-gen (see build-v8-worklist.py). Teaches an ELI5, ENGAGING answering STYLE —
 * simpler words + warmth + an ending question — WITHOUT analogies (a small model can confabulate one)
 * and WITHOUT sacrificing accuracy (grounded) or concision. Fixes Hiraia's weak pedagogy on hiraiabench.
 *
 * args = { dir:'finetuning/distill/work-v8', plan:[{type:'pedagogy_eli5', shards:[...]}] }
 * returns { rows:[{type, fact_id, user, assistant}] } → build-v8-assemble.mts.
 */
export const meta = {
  name: 'gen-v8-distill',
  description: 'Generate v8 pedagogy/ELI5 turns (simpler words + engagement, NO analogy)',
  phases: [{ title: 'Generate', detail: 'one agent per shard → ELI5 engaging tutor answers' }],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const PLAN = _a.plan

const SCHEMAS = {
  pedagogy_eli5: { type: 'object', required: ['user', 'assistant'], properties: {
    user: { type: 'string', description: "a natural, curious grade-5 Tagalog science question that THIS fact answers (a 'bakit'/'paano'/'ano' question a real kid would ask)" },
    assistant: { type: 'string', description: "An ELI5, ENGAGING grade-5 Tagalog answer grounded in the fact. STYLE TARGETS: (1) SIMPLE everyday words — avoid jargon; if a science term is truly needed, explain it in plain words right after. (2) Warm, encouraging tone. (3) END with ONE short friendly check/follow-up question to keep the child engaged. HARD CONSTRAINTS: do NOT use an analogy or 'imagine it's like…' comparison (just explain plainly); stay factually ACCURATE and grounded in the fact (never invent); stay CONCISE — 2-3 short sentences plus the ending question. At most one fitting emoji." } } },
}

const INSTR = {
  pedagogy_eli5: `Each item is a verified science fact (en/tl). Write a natural grade-5 question it answers AND an ELI5 answer in the target style: simpler everyday words, warm/encouraging, ending with a friendly question — but NO analogies and staying accurate to the fact and concise. This teaches Hiraia to TEACH (engaging + simple), not just define, without confabulating analogies.`,
}

phase('Generate')
const tasks = []
for (const p of PLAN) for (const shard of (p.shards || [])) tasks.push({ type: p.type, shard })

const all = await parallel(tasks.map((t) => () => (async () => {
  return await agent(
    `You are writing TRAINING data for Hiraia, an offline Filipino grade-5 science tutor. ` +
    `Read ${DIR}/${t.type}/${t.shard} — a JSON array of verified facts (each has an "id" and en/tl text). ` +
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
