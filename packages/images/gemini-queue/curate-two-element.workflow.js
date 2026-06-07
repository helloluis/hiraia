export const meta = {
  name: 'hiraia-curate-two-element',
  description: 'Curate fact-bank clusters into SIMPLE two-element interaction illustrations (exactly two recognizable things in one clear relationship) — skip single subjects, webs, cycles, layouts, abstractions',
  phases: [{ title: 'Curate', detail: 'one agent per batch — find drawable two-element pairings' }],
}

const NBATCHES = 246
const DIR = '/tmp/img-all'

const ITEM = {
  type: 'object',
  required: ['id', 'name', 'subject', 'hint'],
  properties: {
    id: { type: 'string', description: 'kebab-case unique slug naming the pairing, e.g. bee-on-flower, remora-on-shark, chick-hatching-egg' },
    name: { type: 'string', description: 'short display name of the two-element scene' },
    subject: { type: 'string', enum: ['biology', 'chemistry', 'physics', 'earth-science', 'general'] },
    hint: { type: 'string', description: 'ONE short concrete VISUAL description naming exactly TWO recognizable elements and their simple spatial relationship (~15-28 words). No color, text, labels, or third element.' },
  },
}
const SCHEMA = {
  type: 'object',
  required: ['kept', 'rejected'],
  properties: {
    kept: { type: 'array', items: ITEM },
    rejected: { type: 'array', items: { type: 'object', required: ['subject_key', 'reason'], properties: { subject_key: { type: 'string' }, reason: { type: 'string' } } } },
  },
}

const RULES = `You are curating EASY two-element illustrations for Hiraia, an offline science tutor for Filipino kids. We ALREADY have single-subject pictures for the obvious lone subjects (one animal, one plant, one organ, one object). Now find concepts best shown as exactly TWO recognizable elements in ONE clear, simple interaction.

KEEP a cluster only if its facts describe a clean, drawable relationship between TWO concrete things — like: a bee on a flower (pollination), a remora attached to a shark, a chick hatching from an egg, a hermit crab in a shell, a clownfish in a sea anemone, a woodpecker on a tree trunk, a frog catching a fly with its tongue, a tick on a dog, a bird carrying a worm, a barnacle on a whale, a moth drawn to a lamp, a seed sprouting from soil, a magnet picking up a nail, a ball rolling down a ramp. Exactly TWO clear elements, one obvious interaction.

REJECT (these are what image generators botch — be strict):
- anything with THREE or more elements, or a busy scene
- food WEBS or food CHAINS (multiple predator-prey links)
- cycles (water/carbon/nitrogen/rock cycle), processes with stages
- cellular / anatomical / system layouts (parts of a cell, organs of a system)
- abstract diagrams or ideas (forces as arrows, energy flow, classification trees), and anything where EITHER element is not a single recognizable drawable thing
- a concept already fine as a SINGLE subject (a lone animal/plant/object) — that is handled elsewhere; only keep it if the PAIRING is the point.

For each KEPT cluster: {id, name, subject, hint}. The hint names the TWO elements and their simple arrangement (~15-28 words), e.g. "A single bee perched on the open face of one flower, wings out, gathering pollen." NO color/text/labels, NO third element. subject maps LIVING_THINGS->biology, EARTH_SPACE->earth-science, MATTER->chemistry, FORCE_MOTION_ENERGY->physics.
Reject the rest with a terse reason. Quality over quantity — a clean two-element pairing or nothing.`

async function tryAgent(prompt, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await agent(prompt, { ...opts, label: i ? `${opts.label}#${i + 1}` : opts.label })
      if (r) return r
    } catch (e) {
      log(`retry ${opts.label} (${i + 1}/${tries}): ${e?.message || e}`)
    }
  }
  return null
}

phase('Curate')
const idxs = Array.from({ length: NBATCHES }, (_, i) => i)
const results = await pipeline(idxs, (i) => {
  const path = `${DIR}/batch-${String(i).padStart(3, '0')}.json`
  return tryAgent(
    `Read the file ${path} — a JSON array of ~60 subject clusters (subject_key, domain, topics, sample_en). Find the ones best drawn as a SIMPLE two-element interaction.\n\n${RULES}`,
    { schema: SCHEMA, label: `pair:b${i}`, phase: 'Curate' }
  )
})

const kept = results.filter(Boolean).flatMap((r) => r.kept ?? [])
const rejected = results.filter(Boolean).flatMap((r) => r.rejected ?? [])
log(`two-element curation: kept ${kept.length}, rejected ${rejected.length} across ${NBATCHES} batches`)
return { kept, rejected }
