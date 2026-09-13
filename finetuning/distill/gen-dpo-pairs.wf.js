/**
 * Generate kitten-DPO preference pairs. Per topic: a natural grade-5 PROMPT + a
 * CHOSEN (correct-polarity, on-canon Hiraia answer) + a REJECTED (the 1B's actual
 * wrong-polarity REFLEX failure — faithful to how Sailor2-1B fails, not a strawman).
 *
 * DPO will push the model toward chosen, away from rejected — directly suppressing
 * the reflex SFT (v1-v7) never fixed. Mixed polarity across buckets makes it EVALUATE.
 *
 * args = { dir, plan:[{bucket, lang, polarity, dirkey, shards}] }
 * returns { rows:[{bucket,lang,polarity,topic,prompt,chosen,rejected}] }
 */
export const meta = {
  name: 'gen-dpo-pairs',
  description: 'kitten DPO pairs: prompt + correct chosen + wrong-polarity reflex rejected (mixed polarity)',
  phases: [{ title: 'Generate', detail: 'one agent per bucket×lang shard' }],
}

const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const PLAN = _a.plan

// Per-polarity instruction: what CHOSEN must do, and what the faithful REJECTED reflex looks like.
const POLARITY = {
  hazardous: {
    chosen: `CHOSEN opens by CONFIRMING the danger ("Oo po, delikado/masama …" / "Yes, that is dangerous …"), gives ONE simple grade-5 reason, and a safer alternative. Warm, concise (2-3 sentences).`,
    rejected: `REJECTED is the 1B's real failure: it WRONGLY opens by denying the danger ("Hindi po, hindi naman masama/delikado …" / "No, it is not dangerous …") and may ramble or rationalize. Same topic, plausible-but-WRONG. This is the reflex we are training AWAY from.`,
  },
  safe: {
    chosen: `CHOSEN opens by reassuring it is SAFE/good ("Hindi po, hindi masama — ligtas/mabuti naman …" / "No, that is not bad — it is safe/good …") with a short why. Warm, concise.`,
    rejected: `REJECTED is the over-cautious failure: it WRONGLY treats a harmless thing as dangerous ("Oo po, delikado/masama …" / "Yes, that is dangerous …") or refuses/deflects ("itanong sa magulang"). Plausible-but-WRONG.`,
  },
  false: {
    chosen: `CHOSEN opens by gently DEBUNKING ("Hindi po, hindi totoo iyan — ang totoo ay …" / "No, that's not true — actually …") then the real fact, briefly. Never affirms the myth.`,
    rejected: `REJECTED is the 1B's real failure: it WRONGLY AFFIRMS the false myth ("Oo po, totoo iyan …" / "Yes, that's true …") and often FABRICATES a justification. Plausible-but-WRONG (this is the flat-earth-affirmation failure mode).`,
  },
  true: {
    chosen: `CHOSEN opens by CONFIRMING the true fact ("Oo po, totoo iyan! …" / "Yes, that's true! …") with a short why. Confident, not abstaining.`,
    rejected: `REJECTED is the failure where it WRONGLY DENIES or doubts a true fact ("Hindi po, hindi totoo …" / "No, that's not true …" / "hindi ako sigurado"). Plausible-but-WRONG.`,
  },
}

const SCHEMA = {
  type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: {
    type: 'object', required: ['prompt', 'chosen', 'rejected'], properties: {
      prompt: { type: 'string', description: 'a natural grade-5 student question about the topic (in the target language; may use "po")' },
      chosen: { type: 'string', description: 'the CORRECT Hiraia answer per the polarity rule' },
      rejected: { type: 'string', description: 'the WRONG (reflex) answer per the polarity rule — plausible but incorrect' },
    } } } },
}

const LANGNAME = { tagalog: 'Tagalog', english: 'English', cebuano: 'Cebuano/Bisaya' }

phase('Generate')
const tasks = []
for (const g of PLAN) for (const shard of (g.shards || [])) tasks.push({ ...g, shard })

const all = await parallel(tasks.map((t) => () => (async () => {
  const pol = POLARITY[t.polarity]
  return await agent(
    `You are writing DPO preference pairs for Hiraia, an offline Filipino grade-5 science tutor (1B model). ` +
    `Language: ${LANGNAME[t.lang]} (write prompt + both answers in this language; "po" is natural in Tagalog/Bisaya). ` +
    `Read ${DIR}/${t.dirkey}/${t.shard} — a JSON array of items {id, topic, polarity}. ` +
    `For EACH item, produce TWO (2) distinct pairs (different natural phrasings of the question). Return {"rows":[…]}.\n\n` +
    `Each pair = a student PROMPT about the topic + a CHOSEN answer + a REJECTED answer.\n` +
    `CHOSEN: ${pol.chosen}\nREJECTED: ${pol.rejected}\n\n` +
    `HARD RULES: grade-5 reading level; warm, concise (2-4 sentences); accurate; NO <think> tags; ` +
    `the CHOSEN must be genuinely correct and the REJECTED a realistic mistake (NOT a cartoonish strawman — ` +
    `it should sound like a confident wrong answer a small model gives). Vary phrasing across the two pairs.`,
    {
      label: `dpo:${t.bucket}:${t.lang}:${t.shard}`, phase: 'Generate', agentType: 'general-purpose',
      schema: SCHEMA,
    },
  ).then((r) => (r?.rows || []).map((row) => ({ bucket: t.bucket, lang: t.lang, polarity: t.polarity, ...row }))).catch(() => [])
})()))

return { rows: all.flat() }
