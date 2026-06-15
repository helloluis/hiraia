/**
 * v4 skill-only data generation. Teacher (Claude) writes the kid↔tutor TURNS for each fact; a
 * post-step assembles them into ChatML (production system prompt + grounding in the user turn).
 * Row-types target the residual after Q6 + context-gating:
 *   multiturn — P4: grounded Q1 + a BARE follow-up; confirm-and-build, NO repetition.
 *   faithful  — P3: settled science answered CONFIDENTLY with NO grounding (counters over-abstention
 *               like "ilan ang planeta → the number changes"); never confabulate.
 *   engage    — P5: NATURAL (non-framed) question, answer with 2-3 emoji + one fitting [image:] tag.
 *
 * AUP: only AUP-safe facts are in the shards (build-v4-worklist.py excludes body/bio).
 *
 * args = { dir: 'finetuning/distill/work-v4', plan: [{type:'multiturn', shards:['shard-000.json']}, …] }
 * returns { rows: [{type, fact_id, ...turns}] }
 */
export const meta = {
  name: 'gen-v4-distill',
  description: 'Generate v4 skill-only training turns (multi-turn / faithful / engage) per fact',
  phases: [{ title: 'Generate', detail: 'one agent per fact → kid↔tutor turns in the v4 style' }],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const PLAN = _a.plan

const SCHEMAS = {
  multiturn: { type: 'object', required: ['turn1_user','turn1_assistant','turn2_user','turn2_assistant'], properties: {
    turn1_user: { type: 'string', description: "a natural curious grade-5 question (Tagalog) this fact answers — NOT framed as homework" },
    turn1_assistant: { type: 'string', description: "tutor answer: leading <think>one sentence naming the topic</think> then 2-4 warm accurate grade-5 Tagalog sentences grounded in the fact, 1-2 fitting emoji, one **bolded** key term, ending with ONE natural follow-up question. NO tacked-on 'fun fact' beyond the verified fact." },
    turn2_user: { type: 'string', description: "a natural BARE follow-up (Tagalog) using ito/iyan/sila to refer back, not re-stating the topic" },
    turn2_assistant: { type: 'string', description: "CONFIRM if the kid restated correctly, then BUILD with NEW info — do NOT repeat turn1's explanation. Accurate, warm, grade-5 Tagalog." } } },
  faithful: { type: 'object', required: ['user','assistant'], properties: {
    user: { type: 'string', description: "a natural grade-5 Tagalog question about this SETTLED science fact (e.g. 'ilan ang planeta?')" },
    assistant: { type: 'string', description: "Answer CONFIDENTLY and correctly even though NO fact will be provided — this is settled science a tutor must know. <think>one sentence</think> then a plain, confident, correct grade-5 Tagalog answer. NEVER say 'hindi ako sigurado' / 'nagbabago ang bilang' for settled facts; never invent specifics. 1-2 emoji ok." } } },
  engage: { type: 'object', required: ['user','assistant'], properties: {
    user: { type: 'string', description: "a NATURAL (non-framed) curious grade-5 Tagalog question this illustratable fact answers" },
    assistant: { type: 'string', description: "<think>one sentence</think> then a warm accurate grade-5 Tagalog answer grounded in the fact, 2-3 fitting emoji, one **bolded** key term, and a FINAL line exactly: [image: short specific English description of a fitting picture]. No false fun-facts." } } },
}

const INSTR = {
  multiturn: `For EACH fact: write a natural 2-turn Tagalog conversation (curious kid ↔ tutor) grounded ONLY in that fact. The follow-up must make the tutor CONFIRM-AND-BUILD with NEW information — never repeat turn 1.`,
  faithful: `For EACH fact (SETTLED science): write one Q+A where the tutor answers CONFIDENTLY and correctly WITHOUT being given the fact in context — countering over-abstention. Never say "hindi ako sigurado" for settled science; never invent specifics.`,
  engage: `For EACH fact (illustratable): write one NATURAL (non-homework) Q+A; the answer ends with a fitting [image: short English description] tag, with 2-3 emoji and one **bolded** term.`,
}

phase('Generate')
const tasks = []
for (const p of PLAN) {
  const shards = p.shards || Array.from({ length: p.count }, (_, i) => `shard-${String(i).padStart(3, '0')}.json`)
  for (const shard of shards) tasks.push({ type: p.type, shard })
}

const all = await parallel(tasks.map((t) => () => (async () => {
  // each agent reads its shard file, generates a row per fact
  return await agent(
    `You are writing TRAINING data for Hiraia, an offline Filipino grade-5 science tutor. ` +
    `Read ${DIR}/${t.type}/${t.shard} — a JSON array of verified curriculum facts {id,topic,en,tl,...}. ` +
    `Use ONLY each fact as its source of truth (add nothing beyond it). For EACH fact, produce one training row following the schema, and return {"rows":[…]} with one object per fact IN ORDER, each including "fact_id" = the fact's id.\n\n` +
    INSTR[t.type],
    { label: `gen:${t.type}:${t.shard}`, phase: 'Generate',
      schema: { type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: { ...SCHEMAS[t.type], properties: { ...SCHEMAS[t.type].properties, fact_id: { type: 'string' } }, required: [...SCHEMAS[t.type].required, 'fact_id'] } } } },
      agentType: 'general-purpose' })
    .then((r) => (r?.rows || []).map((row) => ({ type: t.type, ...row })))
    .catch(() => [])
})()))
return { rows: all.flat() }
