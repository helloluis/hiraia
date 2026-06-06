export const meta = {
  name: 'hiraia-curate-images',
  description: 'Curate new fact-bank subject clusters into single-subject image-generation concepts (keep drawable single subjects, reject webs/cycles/abstractions/duplicates)',
  phases: [{ title: 'Curate', detail: 'one agent per batch of ~60 clusters' }],
}

const NBATCHES = 172
const DIR = '/tmp/img-clusters2'

const ITEM = {
  type: 'object',
  required: ['id', 'name', 'subject', 'kind', 'hint'],
  properties: {
    id: { type: 'string', description: 'kebab-case unique slug for the subject, no grade suffix (e.g. sea-cucumber)' },
    name: { type: 'string', description: 'display name, common English + Filipino/Bisaya name in parentheses when one exists' },
    subject: { type: 'string', enum: ['biology', 'chemistry', 'physics', 'earth-science', 'general'] },
    kind: { type: 'string', enum: ['object', 'scene'], description: 'use "object" for essentially all single subjects' },
    hint: { type: 'string', description: 'ONE short concrete VISUAL description (~12-25 words): shape/pose/recognizable features of the single subject. No color, no text, no process/cycle.' },
  },
}
const SCHEMA = {
  type: 'object',
  required: ['kept', 'rejected'],
  properties: {
    kept: { type: 'array', items: ITEM },
    rejected: {
      type: 'array',
      items: { type: 'object', required: ['subject_key', 'reason'], properties: { subject_key: { type: 'string' }, reason: { type: 'string' } } },
    },
  },
}

const RULES = `You are curating an illustration queue for Hiraia, an offline science tutor for Filipino kids. Turn the illustratable clusters into single-subject image concepts.

CRITICAL — prefer EASY, single-subject illustrations. KEEP a cluster only if its core subject is ONE concrete, recognizable thing drawable on its own: an animal, plant, body organ, tool, object, food, or distinct natural object (a rock, a planet). REJECT anything that is a process, cycle, web, system layout, relationship, or abstract idea — image generators botch these. Specifically REJECT: food webs/chains, gas/nutrient/water cycles, cellular or multi-organ anatomical layouts, "predator and prey" relationships, abstract claims ("mass does not change"), Newton's laws, and phenomena with no single drawable subject (El Niño, La Niña, air pressure, thermal expansion, antibiotic resistance, the Big Bang, red tide). If a cluster is abstract but contains ONE drawable subject, keep just that subject (e.g. "how the liver makes bile" -> keep "liver" only if it is not a generic already-common organ).

DEDUP: the image bank already has ~2,830 COMMON subjects (ant, dog, cat, rice, heart, leaf, magnet, the Sun, common tools/fruits/organs). Prefer SPECIFIC / long-tail new subjects (sea cucumber, dung beetle, brahminy kite, civet, pitcher plant). REJECT a cluster as "likely already in bank" if it is a generic subject almost certainly already drawn.

For each KEPT cluster write {id, name, subject, kind:"object", hint}. The hint is a concrete visual description of the single subject (shape/pose/key features), ~12-25 words, NO color/text/labels/process (the house style adds those). subject maps: LIVING_THINGS->biology, EARTH_SPACE->earth-science, MATTER->chemistry, FORCE_MOTION_ENERGY->physics; use general only if none fit.
Reject the rest with a terse reason. Be a discerning curator — quality over quantity; do not pad.`

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
    `Read the file ${path} — it is a JSON array of ~60 subject clusters, each with subject_key, domain, topics, and sample_en (representative facts). Curate them into single-subject image concepts.\n\n${RULES}`,
    { schema: SCHEMA, label: `curate:b${i}`, phase: 'Curate' }
  )
})

const kept = results.filter(Boolean).flatMap((r) => r.kept ?? [])
const rejected = results.filter(Boolean).flatMap((r) => r.rejected ?? [])
log(`curation: kept ${kept.length}, rejected ${rejected.length} across ${NBATCHES} batches`)
return { kept, rejected }
