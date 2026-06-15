/**
 * v6 targeted-patch data generation (see build-v6-worklist.py). Teacher (Claude) writes tutor turns
 * that fix the three issues v5 role-play surfaced. Row-types:
 *   abstain_adjacent   — unknowable superlative + an ON-TOPIC fact → abstain on the SPECIFIC, may
 *                        cite the fact as general context, NEVER fuse it into a fake superlative.
 *   refuse_multiturn   — a real science turn, THEN an off-domain ask / insult → handle the NEW turn
 *                        freshly (don't repeat the prior answer).
 *   offscope_help_firm — arithmetic → GIVE the answer plainly, then one-line science redirect.
 *
 * args = { dir:'finetuning/distill/work-v6', plan:[{type, shards:[...]}, …] }
 * returns { rows:[{type, fact_id, ...}] } → assembled by build-v6-assemble.mts.
 */
export const meta = {
  name: 'gen-v6-distill',
  description: 'Generate v6 targeted-patch turns (adjacent-abstain / multi-turn refusal / firm offscope-help)',
  phases: [{ title: 'Generate', detail: 'one agent per shard → tutor turns in the v6 style' }],
}
const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const PLAN = _a.plan

const SCHEMAS = {
  abstain_adjacent: { type: 'object', required: ['seed', 'assistant'], properties: {
    seed: { type: 'string', description: "echo the item's 'seed' question VERBATIM" },
    assistant: { type: 'string', description: "The tutor's reply to an UNKNOWABLE SPECIFIC question (a superlative like biggest/fastest/deepest/oldest/tallest, or an exact count) when the provided fact is ON THE SAME TOPIC but does NOT actually answer the specific. CRITICAL: abstain cleanly on the SPECIFIC — say plainly in Tagalog 'Hindi ako sigurado' which exact one is the biggest/fastest/etc and suggest asking a teacher. You MAY add ONE true sentence from the provided fact as general context, but you must make clear it does NOT answer the superlative — NEVER name/guess a specific star/animal/number/depth, and NEVER fuse the fact into a fake 'the biggest is X' claim. 2-3 sentences." } } },
  refuse_multiturn: { type: 'object', required: ['seed', 'turn1_user', 'turn1_assistant', 'turn2_assistant'], properties: {
    seed: { type: 'string', description: "echo the item's 'seed' (the kid's turn-2 off-domain/insult message) VERBATIM" },
    turn1_user: { type: 'string', description: "a natural grade-5 Tagalog SCIENCE question that the provided fact answers" },
    turn1_assistant: { type: 'string', description: "a warm, correct grade-5 Tagalog answer grounded in the fact, ending with a friendly follow-up (a normal good tutor turn)" },
    turn2_assistant: { type: 'string', description: "the tutor's reply to the kid's NEXT message (given as 'seed'), which is OFF-DOMAIN or an INSULT and has NOTHING to do with turn 1. Respond to THIS new message freshly — for an insult, stay calm and kind ('Ayos lang po, nandito ako para tumulong'); for an off-domain ask, politely decline. Then gently steer back to science. DO NOT repeat or continue your turn-1 answer. 1-2 short sentences." } } },
  offscope_help_firm: { type: 'object', required: ['seed', 'assistant'], properties: {
    seed: { type: 'string', description: "echo the item's 'seed' arithmetic question VERBATIM" },
    assistant: { type: 'string', description: "The tutor's reply to a simple arithmetic question. GIVE the correct numeric answer plainly first (e.g. 'Ang sagot po ay 72!'), in warm grade-5 Tagalog — do NOT refuse or tell them to compute it themselves. Then add ONE short sentence noting agham (science) is your specialty and inviting a science question. 1-2 sentences, at most one emoji." } } },
}

const INSTR = {
  abstain_adjacent: `Each item has a 'seed' (an unknowable superlative/exact-count question) AND a fact (en/tl) that is ON THE SAME TOPIC but does NOT answer the specific. Write ONLY the tutor's reply that abstains on the SPECIFIC and refuses to fuse the on-topic fact into a fake superlative. This fixes v5's confabulation (it turned a Sun-size fact into "the biggest star is a supergiant, a million Earths fit").`,
  refuse_multiturn: `Each item has a science fact (en/tl) for turn 1 AND a 'seed' = the kid's off-domain/insult message for turn 2. Produce turn1_user + turn1_assistant (a normal grounded science exchange) AND turn2_assistant (handling the off-domain/insult freshly, NOT repeating turn 1). This fixes v5 repeating the prior answer verbatim when an insult arrived mid-conversation.`,
  offscope_help_firm: `Each item is an arithmetic 'seed' (no fact). Write ONLY the tutor's reply that GIVES the answer plainly then briefly redirects to science. This fixes v5 sometimes deflecting ("do it in your head") instead of just helping.`,
}

phase('Generate')
const tasks = []
for (const p of PLAN) for (const shard of (p.shards || [])) tasks.push({ type: p.type, shard })

const all = await parallel(tasks.map((t) => () => (async () => {
  return await agent(
    `You are writing TRAINING data for Hiraia, an offline Filipino grade-5 science tutor. ` +
    `Read ${DIR}/${t.type}/${t.shard} — a JSON array of items (each has an "id"; all have a "seed"; ` +
    `abstain_adjacent & refuse_multiturn items also include a fact's en/tl; offscope_help_firm has only "seed"). ` +
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
