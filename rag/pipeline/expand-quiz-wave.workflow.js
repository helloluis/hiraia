export const meta = {
  name: 'hiraia-expand-quiz-wave',
  description: 'Quiz-recall fact wave: plan discrete-recall beats (inventors, constants, planetary stats, records, firsts), generate trilingual on-schema facts, adversarially accuracy-verify',
  phases: [
    { title: 'Plan', detail: 'enumerate quiz-recall beats (who/what/how-much/how-many)' },
    { title: 'Generate', detail: 'one agent per beat → trilingual discrete facts' },
    { title: 'Verify', detail: 'STRICT numeric/name accuracy + trilingual prune' },
  ],
}

// args: { wave:number, usedBeats:string[], beatsThisWave:number, factsPerBeat:number }
const wave = args?.wave ?? 1
const BEATS = args?.beatsThisWave ?? 50
const FPB = args?.factsPerBeat ?? 30
const usedBeats = args?.usedBeats ?? []

// Inventors/discoverers/firsts map onto the science domain of the thing (lightbulb →
// FORCE_MOTION_ENERGY, telescope/space → EARTH_SPACE), so we reuse the existing enum —
// no new domain (which would ripple into RagStore/image-domain scoping).
const DOMAINS = 'MATTER | LIVING_THINGS | FORCE_MOTION_ENERGY | EARTH_SPACE | PH_CIVICS | PH_GEOGRAPHY'

const FACT_ITEM = {
  type: 'object',
  required: ['id', 'domain', 'topic', 'grades', 'terms', 'fact', 'source'],
  properties: {
    id: { type: 'string', description: 'unique kebab-case slug, suffixed with primary grade, e.g. lightbulb-edison-g5' },
    domain: { type: 'string', enum: ['MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE', 'PH_CIVICS', 'PH_GEOGRAPHY'] },
    topic: { type: 'string', description: 'short english topic phrase (e.g. "who invented the lightbulb", "speed of light")' },
    grades: { type: 'array', items: { type: 'integer' }, description: 'DepEd grade band, e.g. [5,6,7]' },
    terms: { type: 'array', items: { type: 'string' }, description: 'REQUIRED: distinctive Tagalog AND Bisaya AND English query words incl. the proper noun / number / unit a kid would type. >=6 items.' },
    fact: {
      type: 'object', required: ['tl', 'en', 'bis'],
      properties: {
        tl: { type: 'string', description: 'one clear grade-appropriate sentence in Tagalog, stating the specific answer (name/number/unit)' },
        en: { type: 'string', description: 'one clear grade-appropriate sentence in English, stating the specific answer' },
        bis: { type: 'string', description: 'one clear grade-appropriate sentence in Cebuano/Bisaya, stating the specific answer' },
      },
    },
    source: { type: 'string', description: 'where grounded, e.g. "encyclopedia-stable consensus", "NASA"' },
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
          name: { type: 'string', description: 'a quiz-recall theme that can sustain ~20-30 DISTINCT discrete facts' },
          domain: { type: 'string', enum: ['MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE', 'PH_CIVICS', 'PH_GEOGRAPHY'] },
          gradeBand: { type: 'array', items: { type: 'integer' } },
          angle: { type: 'string', description: 'what discrete facts to mine (the specific who/what/how-much)' },
        },
      },
    },
  },
}

const BRIEF = `
You are building the QUIZ-RECALL layer of Hiraia's knowledge bank — an offline AI science companion for Filipino grade-school kids (grades 3-10). The existing bank is strong on CONCEPTS but thin on the DISCRETE, specific facts kids get asked in quizzes and trivia: WHO invented/discovered X, WHAT is the value/name of Y, HOW MUCH/HOW MANY/HOW FAST/HOW LONG/HOW BIG. This wave fills that gap.

ACCURACY IS PARAMOUNT — these are exact-recall facts (names, numbers, units, dates). A wrong number or name is worse than no fact. State ONLY encyclopedia-stable consensus values a children's reference states plainly. NEVER invent or approximate-as-if-exact; if a value is uncertain or commonly disputed, omit it.

HARD RULES:
- All three languages, always: tl (Tagalog), en (English), bis (Cebuano/Bisaya). One short clear grade-appropriate sentence each, and EACH must state the specific answer (the name/number/unit), not just gesture at it. Translate faithfully — never blank or English-only. Keep the proper noun / number / unit identical across languages (e.g. "Thomas Edison", "299,792 km/s", "9.8 m/s²").
- terms[] is the #1 retrieval lever: include the distinctive Tagalog + Bisaya + English query words AND the proper noun / number / unit a kid would type (e.g. "lightbulb", "bombilya", "Edison", "ilaw", "sino gumawa", "speed of light", "bilis ng liwanag", "299792"). >=6 terms.
- One discrete fact per entry. "Who invented the lightbulb" and "when was the lightbulb invented" are TWO facts. Do NOT merge.
- Grade-band honestly. A simple "who invented the lightbulb" is grade 4-5; "speed of light in km/s" is grade 6-8.
- Round numbers sensibly for kids but keep them CORRECT (e.g. speed of light ≈ 300,000 km/s is fine; "how long is a day on Mars" → about 24 hours 37 minutes).
- PH-relevant quiz facts where natural (highest PH mountain = Apo, longest PH river = Cagayan, national hero, etc.).
- domain is one of: ${DOMAINS}. Map inventors/firsts to the science domain of the thing (lightbulb/electricity → FORCE_MOTION_ENERGY; telescope/space firsts → EARTH_SPACE).
- id: unique kebab-case, suffixed with primary grade (e.g. lightbulb-edison-g5).
- AVOID human-body internal-anatomy/medical specifics (those live in another layer); a few external/skeleton "how many bones (206)"-class facts in ENGLISH-forward framing are OK, but do not dwell on body/biology.
`

async function tryAgent(prompt, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await agent(prompt, { ...opts, label: i ? `${opts.label}#${i + 1}` : opts.label })
      if (r) return r
    } catch (e) {
      log(`retry ${opts.label} (attempt ${i + 1}/${tries}): ${e?.message || e}`)
    }
  }
  return null
}

phase('Plan')
const usedSample = usedBeats.slice(-400)
const plan = await tryAgent(
  `Wave ${wave} of the QUIZ-RECALL expansion. Propose exactly ${BEATS} NEW, specific, non-redundant quiz-recall "beats" for the Hiraia science bank, spread across the domains (${DOMAINS}) and grades 3-10.

Each beat is a quiz-recall THEME that can honestly sustain ~20-30 DISTINCT discrete facts. Aim squarely at the kinds of things kids get asked in quizzes and would look up. Cover these families richly (and more):
- INVENTORS & DISCOVERERS: who invented the lightbulb (Edison/Swan), telephone (Bell), printing press, airplane (Wright brothers), who discovered gravity (Newton), electricity, penicillin (Fleming), the law of motion, radioactivity (Curie), evolution (Darwin), etc.
- NAMED CONSTANTS & MEASUREMENTS: speed of light (≈300,000 km/s), speed of sound (343 m/s), gravity g (9.8 m/s²), boiling/freezing point of water, body temperature, number of seconds in a day, etc.
- PLANETARY & ASTRONOMY STATS: how long is a day on Mars (~24h 37m), hottest/coldest planet, largest planet (Jupiter), number of moons, distance facts, how long light from the Sun takes (~8 min), how many planets (8), what is a light-year, etc.
- ANIMAL SUPERLATIVES & RECORDS: largest animal (blue whale), fastest land animal (cheetah), fastest bird (peregrine falcon), tallest (giraffe), longest-lived, etc.
- EARTH & GEOGRAPHY RECORDS: tallest mountain (Everest), deepest ocean trench (Mariana), longest river (Nile/Amazon), largest desert, biggest ocean, etc.
- CHEMISTRY BASICS: chemical formula of water (H2O), what gas we breathe (oxygen, O2), symbol for gold (Au), most abundant gas in air (nitrogen), etc.
- HISTORICAL FIRSTS: first person in space (Gagarin), first on the Moon (Armstrong), first satellite (Sputnik), first telescope, etc.
- NUMBER FACTS: how many bones in the body (206), how many planets, how many continents (7), how many colors in a rainbow (7), etc.
- PHILIPPINE QUIZ FACTS: highest mountain (Apo), longest river (Cagayan), national symbols, PH-specific science/geography records.

${wave > 1 ? 'Earlier quiz waves covered the obvious ones — push into less-common but still quiz-worthy specifics.' : ''}

AVOID anything close to these already-used beats:
${usedSample.map((b) => `- ${b}`).join('\n') || '(none yet)'}

Return ${BEATS} beats. ${BRIEF}`,
  { schema: BEATS_SCHEMA, label: `plan:qw${wave}`, phase: 'Plan' }
)

const beats = (plan?.beats ?? []).slice(0, BEATS)
log(`quiz wave ${wave}: planned ${beats.length} beats`)
if (beats.length === 0) return { wave, facts: [], beats: [] }

const results = await pipeline(
  beats,
  (b) =>
    agent(
      `Generate up to ${FPB} DISTINCT, ACCURATE, trilingual QUIZ-RECALL facts for this beat:
BEAT: "${b.name}" | domain: ${b.domain} | grade band: ${JSON.stringify(b.gradeBand)} | angle: ${b.angle ?? ''}

Each fact answers one discrete "who/what/how-much/how-many/how-fast/how-long/how-big" question with the SPECIFIC answer stated in all three languages. Produce as many genuinely distinct facts as the beat honestly supports up to ${FPB}. Do NOT pad or invent. Every fact MUST have tl+en+bis and >=6 cross-language terms including the proper noun/number/unit.
${BRIEF}`,
      { schema: FACTS_SCHEMA, label: `gen:${(b.name || 'beat').slice(0, 28)}`, phase: 'Generate' }
    ),
  (gen, b) => {
    const facts = gen?.facts ?? []
    if (!facts.length) return { facts: [] }
    return agent(
      `You are a STRICT fact-checker for a children's quiz-recall bank. Review these ${facts.length} facts for the beat "${b?.name}". These are exact-recall facts, so accuracy of every NAME, NUMBER, UNIT, and DATE is critical.
KEEP a fact only if: (1) the specific answer (name/number/unit/date) is FACTUALLY CORRECT and encyclopedia-stable — verify each value from memory of consensus reference knowledge; DROP anything you cannot confirm or that is commonly disputed/misattributed; (2) the same proper noun/number/unit appears CONSISTENTLY across tl/en/bis (drop if a translation changed the value or name); (3) it has a non-empty faithful tl AND en AND bis; (4) terms[] includes Tagalog+Bisaya+English query words plus the proper noun/number (>=6); (5) it is grade-appropriate and not a near-duplicate within this set. Fix small translation/terms gaps where you are CONFIDENT of the underlying fact; otherwise DROP. Be conservative — a dropped shaky fact is better than a shipped wrong one. Return ONLY the surviving, corrected facts in the exact schema.

FACTS:
${JSON.stringify(facts)}`,
      { schema: FACTS_SCHEMA, label: `verify:${(b?.name || 'beat').slice(0, 26)}`, phase: 'Verify' }
    )
  }
)

const allFacts = results.filter(Boolean).flatMap((r) => r.facts ?? [])
log(`quiz wave ${wave}: ${allFacts.length} verified facts from ${beats.length} beats`)
return { wave, facts: allFacts, beats: beats.map((b) => b.name) }
