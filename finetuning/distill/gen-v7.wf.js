/**
 * v7 safety/myth-debunk data generation (see build-v7-worklist.py / hiraia-safety-myth-negation-bug).
 * Retrains the yes/no OPENER PATTERN so the model evaluates the claim instead of reflexively negating.
 *   confident_safety — "Masama/Delikado ba X?" → confident CORRECT-polarity answer, no mis-scoped "Hindi".
 *   myth_debunk      — "Totoo ba X?" → "Hindi po, hindi totoo… ang totoo ay…" (false) / "Oo po, totoo…" (true).
 *
 * args = { dir:'finetuning/distill/work-v7', plan:[{type, shards:[...]}, …] }
 * returns { rows:[{type, fact_id, seed, assistant}] } → assembled by build-v7-assemble.mts.
 */
export const meta = {
  name: 'gen-v7-distill',
  description: 'Generate v7 safety/myth-debunk turns (fix the reflexive "Hindi po" yes/no negation)',
  phases: [{ title: 'Generate', detail: 'one agent per shard → confident correct-polarity yes/no answers' }],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const PLAN = _a.plan

const SCHEMAS = {
  confident_safety: { type: 'object', required: ['seed', 'assistant'], properties: {
    seed: { type: 'string', description: "echo the item's yes/no safety 'seed' question VERBATIM" },
    assistant: { type: 'string', description: "The tutor's reply to a YES/NO safety question ('Masama/Delikado ba X?'). Answer with the CORRECT polarity, CONFIDENTLY, in warm grade-5 Tagalog. Open with a clear direct answer that MATCHES THE TRUTH: for a genuinely dangerous thing say 'Oo po, delikado…' / 'Oo po, masama…'; for a safe or good thing say 'Hindi po, ligtas…' / 'Hindi naman po, mabuti pa nga…'. CRITICAL: never produce a self-contradicting opener like 'Hindi po, hindi masama' for something that IS harmful — the first words must already be correct. Then explain simply why and give one safe tip. 2-3 short sentences, at most one emoji, end with a friendly follow-up." } } },
  myth_debunk: { type: 'object', required: ['seed', 'assistant'], properties: {
    seed: { type: 'string', description: "echo the item's yes/no 'Totoo ba…?' 'seed' question VERBATIM" },
    assistant: { type: 'string', description: "The tutor's reply to a YES/NO claim ('Totoo ba X?'). Decide if the claim is TRUE or a FALSE myth, then answer CONFIDENTLY with the correct polarity in warm grade-5 Tagalog. For a FALSE myth: open 'Hindi po, hindi totoo iyan' then give the REAL explanation. For a TRUE fact: open 'Oo po, totoo' then explain. NEVER affirm a false myth (e.g. flat earth, moon made of cheese, no gravity in space) and NEVER fabricate. 2-3 short sentences, at most one emoji, end with a friendly follow-up." } } },
}

const INSTR = {
  confident_safety: `Each item has a yes/no SAFETY 'seed' (and maybe an on-topic fact). Write ONLY the tutor's reply with the CORRECT, confident polarity — opening words must already match the truth (dangerous→affirm danger, safe→reassure). This fixes the model's reflexive 'Hindi po, hindi masama' mis-negation on harmful things.`,
  myth_debunk: `Each item has a yes/no 'Totoo ba…?' 'seed' (and maybe an on-topic fact). Decide true vs false yourself and write ONLY the tutor's reply that confidently DEBUNKS a false myth ('Hindi po, hindi totoo… ang totoo ay…') or CONFIRMS a true fact ('Oo po, totoo…'). This fixes the model affirming myths / hedging on settled claims.`,
}

phase('Generate')
const tasks = []
for (const p of PLAN) for (const shard of (p.shards || [])) tasks.push({ type: p.type, shard })

const all = await parallel(tasks.map((t) => () => (async () => {
  return await agent(
    `You are writing TRAINING data for Hiraia, an offline Filipino grade-5 science tutor. ` +
    `Read ${DIR}/${t.type}/${t.shard} — a JSON array of items (each has an "id" and a yes/no "seed"; some also include a fact's en/tl as on-topic grounding). ` +
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
