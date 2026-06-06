export const meta = {
  name: 'hiraia-expand-wave',
  description: 'One wave of the fact-bank expansion: plan deep beats, generate trilingual on-schema facts per beat, adversarially verify, return for ingestion',
  phases: [
    { title: 'Plan', detail: 'enumerate deep, non-redundant concept beats' },
    { title: 'Generate', detail: 'one agent per beat → trilingual facts' },
    { title: 'Verify', detail: 'prune inaccurate / non-trilingual facts' },
  ],
}

// args: { wave:number, usedBeats:string[], beatsThisWave:number, factsPerBeat:number }
const wave = args?.wave ?? 1
const BEATS = args?.beatsThisWave ?? 100
const FPB = args?.factsPerBeat ?? 25
const usedBeats = args?.usedBeats ?? []

const DOMAINS = 'MATTER | LIVING_THINGS | FORCE_MOTION_ENERGY | EARTH_SPACE | PH_CIVICS | PH_GEOGRAPHY'

const FACT_ITEM = {
  type: 'object',
  required: ['id', 'domain', 'topic', 'grades', 'terms', 'fact', 'source'],
  properties: {
    id: { type: 'string', description: 'unique kebab-case slug, suffixed with primary grade, e.g. tarsier-nocturnal-eyes-g4' },
    domain: { type: 'string', enum: ['MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE', 'PH_CIVICS', 'PH_GEOGRAPHY'] },
    topic: { type: 'string', description: 'short english topic phrase' },
    grades: { type: 'array', items: { type: 'integer' }, description: 'DepEd grade band, e.g. [4,5,6]' },
    terms: { type: 'array', items: { type: 'string' }, description: 'REQUIRED: distinctive Tagalog AND Bisaya AND English query words (incl. inflection variants). >=6 items.' },
    fact: {
      type: 'object', required: ['tl', 'en', 'bis'],
      properties: {
        tl: { type: 'string', description: 'one clear grade-appropriate sentence in Tagalog' },
        en: { type: 'string', description: 'one clear grade-appropriate sentence in English' },
        bis: { type: 'string', description: 'one clear grade-appropriate sentence in Cebuano/Bisaya' },
      },
    },
    source: { type: 'string', description: 'where grounded, e.g. "NRC LS1.A; encyclopedia-stable"' },
  },
}
const FACTS_SCHEMA = { type: 'object', required: ['facts'], properties: { facts: { type: 'array', items: FACT_ITEM } } }
const BEATS_SCHEMA = {
  type: 'object', required: ['beats'],
  properties: {
    beats: {
      type: 'array',
      items: {
        type: 'object', required: ['name', 'domain', 'gradeBand'],
        properties: {
          name: { type: 'string', description: 'specific medium-grained concept that can sustain ~15-25 distinct facts' },
          domain: { type: 'string', enum: ['MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE', 'PH_CIVICS', 'PH_GEOGRAPHY'] },
          gradeBand: { type: 'array', items: { type: 'integer' } },
          angle: { type: 'string', description: 'what facets to mine so facts stay distinct' },
        },
      },
    },
  },
}

const BRIEF = `
You are building the knowledge bank for Hiraia, an offline AI science COMPANION for Filipino grade-school kids (grades 3-10). The tutor speaks ONLY from this bank, so every fact must be ACCURATE — distill encyclopedia-stable, consensus facts a children's reference would state plainly. NEVER invent a number, name, or mechanism; if unsure, omit it.
HARD RULES:
- All three languages, always: tl (Tagalog), en (English), bis (Cebuano/Bisaya). One short, clear, grade-appropriate sentence each. Translate faithfully — never leave a language blank or English-only.
- terms[] is the #1 retrieval lever: pack the distinctive Tagalog AND Bisaya AND English content words a kid would actually type, including inflection variants that differ across languages. >=6 terms. A missing vernacular term = the fact is unfindable in that language.
- One concept → the right number of DISTINCT facts (different sub-claims). Do NOT pad or repeat the same claim reworded. Do NOT merge unrelated claims into one fact.
- Grade-band honestly: a grade-3 fact and a grade-9 fact on the same topic are different facts with different vocabulary.
- PH-relevant where natural (PAGASA/PHIVOLCS, native species, local examples) — a Filipino tutor should feel local.
- domain is one of: ${DOMAINS}.
- id: unique kebab-case, suffixed with the primary grade (e.g. snake-shed-skin-g4).
`

phase('Plan')
const usedSample = usedBeats.slice(-400) // cap context; recent beats matter most for de-dup
const plan = await agent(
  `Wave ${wave} of an expansion toward ~20,000 facts. Propose exactly ${BEATS} NEW, specific, non-redundant concept "beats" for the Hiraia science bank, spread across the domains (${DOMAINS}) and across grades 3-10.

Each beat is a MEDIUM-grained concept that can honestly sustain ~15-25 DISTINCT child-level facts (e.g. "how snakes move and shed skin", "the Philippine tarsier and tarsiers", "phases and tides caused by the Moon", "simple machines: the lever family", "dengue and mosquito-borne illness basics", "rice farming and the rice plant"), NOT a single narrow fact and NOT a whole domain.

Go DEEP and long-tail: specific animals (incl. PH-native: tamaraw, pawikan, pating, tarsier, kalaw), plants and crops, body systems and health/hygiene, weather and PH hazards (bagyo, lindol, bulkan), astronomy, rocks/soil/water, matter and materials, forces, electricity/magnetism, light/sound/heat, energy, ecosystems and conservation. ${wave > 1 ? 'Earlier waves already covered the obvious basics — push into less-common, more-specific concepts kids are curious about.' : ''}

AVOID anything close to these already-used beats:
${usedSample.map((b) => `- ${b}`).join('\n') || '(none yet)'}

Return ${BEATS} beats. ${BRIEF}`,
  { schema: BEATS_SCHEMA, label: `plan:w${wave}`, phase: 'Plan' }
)

const beats = (plan?.beats ?? []).slice(0, BEATS)
log(`wave ${wave}: planned ${beats.length} beats`)

const results = await pipeline(
  beats,
  (b) =>
    agent(
      `Generate up to ${FPB} DISTINCT, accurate, trilingual facts for this beat:
BEAT: "${b.name}" | domain: ${b.domain} | grade band: ${JSON.stringify(b.gradeBand)} | angle: ${b.angle ?? ''}

Produce as many genuinely distinct facts as the beat honestly supports (different sub-claims, different grade depths) up to ${FPB}. Do NOT pad. Every fact MUST have tl+en+bis and >=6 cross-language terms.
${BRIEF}`,
      { schema: FACTS_SCHEMA, label: `gen:${(b.name || 'beat').slice(0, 28)}`, phase: 'Generate' }
    ),
  (gen, b) => {
    const facts = gen?.facts ?? []
    if (!facts.length) return { facts: [] }
    return agent(
      `You are a strict science-accuracy + completeness checker for a children's bank. Review these ${facts.length} facts for the beat "${b?.name}".
KEEP a fact only if: (1) it is factually accurate and encyclopedia-stable (no invented numbers/names), (2) it has a non-empty, faithful tl AND en AND bis (drop English-only or mistranslated), (3) terms[] includes Tagalog+Bisaya+English query words (>=6), (4) it is grade-appropriate and not a near-duplicate of another fact in this same set. Fix small translation/terms gaps where you are confident; otherwise DROP the fact. Return ONLY the surviving, corrected facts in the exact schema.

FACTS:
${JSON.stringify(facts)}`,
      { schema: FACTS_SCHEMA, label: `verify:${(b?.name || 'beat').slice(0, 26)}`, phase: 'Verify' }
    )
  }
)

const allFacts = results.filter(Boolean).flatMap((r) => r.facts ?? [])
log(`wave ${wave}: ${allFacts.length} verified facts from ${beats.length} beats`)
return { wave, facts: allFacts, beats: beats.map((b) => b.name) }
