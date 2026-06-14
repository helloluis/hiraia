export const meta = {
  name: 'term-hygiene',
  description: 'Clean over-broad/hijacking retrieval terms from the 5040 expansion facts (per-fact judgment)',
  whenToUse: 'Fix RAG retrieval verb/noun-hijack regressions from the fact-bank expansion before the gate can pass.',
  phases: [{ title: 'Review', detail: 'one agent per ~100-fact chunk flags over-broad terms to remove' }],
}

// args: { items: [{idx, file}], maxRounds?: 2 }
// Each chunk file is [{id, topic, fact, terms}]. Agent returns terms to REMOVE per fact.
const a = typeof args === 'string' ? JSON.parse(args) : args
const MAX_ROUNDS = a.maxRounds || 2

const SCHEMA = {
  type: 'object',
  properties: {
    removals: {
      type: 'array',
      description: 'one entry per fact that has at least one over-broad term to remove; omit facts whose terms are all fine',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          remove: { type: 'array', items: { type: 'string' }, description: 'exact term strings to delete from this fact' },
        },
        required: ['id', 'remove'],
      },
    },
  },
  required: ['removals'],
}

const prompt = (it) => `You are doing retrieval-term hygiene for Hiraia, an offline science tutor for Filipino kids. Each fact has a \`terms\` list used for LEXICAL search: a kid's question is matched against these terms. Bad terms cause WRONG facts to surface.

Read ${it.file} — a JSON array of facts: {id, topic, fact (Tagalog snippet), terms}.

For EACH fact, decide which terms (if any) to REMOVE. A term should be REMOVED if it is too broad/generic — i.e. it would make this fact wrongly match questions that are NOT about this fact's topic:
- generic activity/format words: proyekto/project, report, gawa/gumawa (make/do), klase/class, aralin, takdang-aralin, talata, sanaysay, halimbawa
- bare common verbs and filler: gamit, mga, meron, kailangan, tingnan
- words describing the fact's FORMAT rather than its science content
- anything a kid would type in MANY unrelated questions

KEEP every term that is specific to this fact's science topic — including common-but-discriminative science words (air, acid, dugo, oxygen, bulkan, planeta, etc.). When unsure, KEEP it (be conservative; only remove clearly over-broad terms).

Canonical example of the bug: a "school recycling project" fact carrying the term "proyekto" hijacks the query "project about planets" away from the planet facts. Removing "proyekto" (and "gawa", "klase") from that fact fixes it while keeping ecobrick/plastik/recycling terms.

Return ONLY the structured removals (one entry per fact needing changes; skip clean facts).`

phase('Review')
const done = []
let pending = a.items
for (let round = 1; round <= MAX_ROUNDS && pending.length; round++) {
  if (round > 1) log(`retry round ${round}: ${pending.length} chunk(s)`)
  const results = await parallel(pending.map((it) => () =>
    agent(prompt(it), { label: `terms:chunk-${it.idx}`, phase: 'Review', schema: SCHEMA })
      .then((r) => ({ it, removals: r?.removals || null }))
  ))
  const ok = results.filter((r) => r && r.removals !== null)
  done.push(...ok)
  const okIdx = new Set(ok.map((r) => r.it.idx))
  pending = pending.filter((it) => !okIdx.has(it.idx))
  log(`round ${round}: ${ok.length} chunks done, ${pending.length} remaining`)
  if (ok.length === 0) break
}
// flatten
const all = []
for (const d of done) for (const rm of d.removals) if (rm.remove && rm.remove.length) all.push(rm)
log(`total facts with removals: ${all.length}`)
return { removals: all, chunksFailed: pending.map((i) => i.idx) }
