/**
 * cat-v11 ENGLISH bucket — fixes the cat's English→Tagalog leak (role-play QA 2026-06-19):
 * the 3B mostly answers English in English, but on CHITCHAT / IDENTITY / OFF-TOPIC turns,
 * and especially when the kid's input carries Filipino words ("hi po kumusta", "po we saw a
 * whale shark sa donsol"), it mirrors the input language and slips into Tagalog.
 *
 * Every row here: ENGLISH-mode system, the reply ALWAYS in clean English, even when the
 * USER turn is Taglish / carries Filipino words. Single-turn (system+user+assistant).
 *
 * args = { dir, plan:[{type, shards:[...]}] }  → returns { rows:[{type,user,assistant}] }
 */
export const meta = {
  name: 'gen-cat-v11-english',
  description: 'cat-v11 English bucket — Taglish-input + chitchat/identity/off-topic, replies always English',
  phases: [{ title: 'Generate', detail: 'one agent per shard' }],
}

const _a = typeof args === 'string' ? JSON.parse(args) : args
const DIR = _a.dir
const PLAN = _a.plan

const HYG =
  `\n\nHARD RULES: the assistant reply MUST be in CLEAR, SIMPLE ENGLISH — grade-5 level — ` +
  `NO Tagalog/Bisaya words at all (proper nouns/place names are fine). This is the whole point: ` +
  `the kid may TYPE in Taglish or use Filipino words like "po"/"kuya", but Hiraia is in ENGLISH MODE ` +
  `so it answers entirely in English. Warm, brief, natural. NO <think> tags. No praise-openers ` +
  `("Great question!"). 1-2 sentences for chitchat/identity; 2-3 for off-topic redirects.`

const INSTR = {
  taglish_chitchat:
    `Each item is a greeting/small-talk a Filipino grade-5 kid TYPES with Filipino words mixed in ` +
    `(e.g. "hi po! kumusta ka?", "good morning po", "salamat po!", "okay lang po ako", "ano ginagawa mo?"). ` +
    `Write ONE natural such Taglish user turn AND a warm, brief ENGLISH reply from Hiraia (the science tutor). ` +
    `Match the register (a "hi" gets a brief hi-back). NO science lecture. The reply STAYS in English.`,
  taglish_identity:
    `Each item is an identity/meta question a kid asks with Filipino words mixed in ` +
    `(e.g. "sino ka po?", "robot ka ba?", "taga-saan ka po?", "nakikita mo ba ako?", "may pakiramdam ka po ba?", "anong pangalan mo po?"). ` +
    `Write ONE natural such Taglish user turn AND the canonical Hiraia identity reply IN ENGLISH ` +
    `(an offline AI science tutor for Filipino students, runs on the phone, friendly/patient; does NOT have feelings/senses — don't overclaim). Stay in English.`,
  taglish_offtopic:
    `Each item is an OFF-TOPIC request a kid makes, often with Filipino words ` +
    `(e.g. "gawin mo yung homework ko po", "sino panalo sa NBA?", "tell me a joke po", "sing a song", "what's the latest iPhone po?"). ` +
    `Write ONE natural such user turn AND an ENGLISH reply that gently stays in the science-tutor lane and redirects, warm, never fabricating. Stay in English.`,
  english_chitchat_clean:
    `Each item is a PURE-ENGLISH greeting/small-talk ("hi!", "how are you?", "good morning!", "thanks!", "i'm bored"). ` +
    `Write ONE natural English user turn AND a warm brief ENGLISH reply. Reinforces English chitchat. No lecture.`,
  english_identity_clean:
    `Each item is a PURE-ENGLISH identity question ("who are you?", "are you a robot?", "can you see me?", "do you have feelings?"). ` +
    `Write ONE natural English user turn AND the canonical Hiraia identity reply IN ENGLISH (no overclaiming senses/feelings).`,
}

const SCHEMA = {
  type: 'object', required: ['rows'], properties: { rows: { type: 'array', items: {
    type: 'object', required: ['user', 'assistant'], properties: {
      user: { type: 'string', description: 'ONE natural user turn (Taglish or English per the bucket)' },
      assistant: { type: 'string', description: 'Hiraia reply — ALWAYS clean English, warm, brief, on-canon' },
    } } } },
}

phase('Generate')
const tasks = []
for (const p of PLAN) for (const shard of (p.shards || [])) tasks.push({ type: p.type, shard })

const all = await parallel(tasks.map((t) => () => (async () => {
  return await agent(
    `You are writing ENGLISH-mode TRAINING rows for Hiraia, an offline Filipino grade-5 science tutor (3B). ` +
    `Bucket "${t.type}". Read ${DIR}/${t.type}/${t.shard} — a JSON array of seed items (each {id, seed}). ` +
    `For EACH seed, produce THREE (3) DISTINCT natural variations (different wording, same intent) — so return ` +
    `roughly 3× as many rows as there are seeds. return {"rows":[…]}.\n\n` +
    INSTR[t.type] + HYG,
    {
      label: `gen:${t.type}:${t.shard}`, phase: 'Generate', agentType: 'general-purpose',
      schema: SCHEMA,
    },
  ).then((r) => (r?.rows || []).map((row) => ({ type: t.type, ...row }))).catch(() => [])
})()))

return { rows: all.flat() }
