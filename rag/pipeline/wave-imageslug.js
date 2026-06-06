export const meta = {
  name: 'hiraia-fact-gen-imageslug',
  description: 'Generate trilingual facts from image-concept slugs (author + adversarial fact-check)',
  phases: [
    { title: 'Author', detail: 'each agent reads a slice of worklist.jsonl and writes a fact per concept slug' },
    { title: 'Verify', detail: 'adversarial fact-check: drop/correct inaccurate or non-trilingual facts' },
  ],
}

// args: { offset, count, sliceSize } — process worklist.jsonl slugs [offset, offset+count).
// worklist.jsonl is one {slug,...} per line; agents read their own slice by line range.
const offset = (args && args.offset) || 0
const count = (args && args.count) || 900
const sliceSize = (args && args.sliceSize) || 30
const WL = 'rag/pipeline/worklist.jsonl'

const nAgents = Math.ceil(count / sliceSize)
const slices = []
for (let i = 0; i < nAgents; i++) {
  const start = offset + i * sliceSize // 0-based slug index
  if (start >= offset + count) break
  slices.push({ idx: i, lineStart: start + 1, lines: Math.min(sliceSize, offset + count - start) })
}

const DOMAINS = ['MATTER', 'LIVING_THINGS', 'FORCE_MOTION_ENERGY', 'EARTH_SPACE']
const FACTS_SCHEMA = {
  type: 'object',
  properties: {
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'kebab-case slug (base it on the concept slug) + grade suffix e.g. -g5' },
          domain: { type: 'string', enum: DOMAINS },
          topic: { type: 'string' },
          grades: { type: 'array', items: { type: 'number' } },
          terms: { type: 'array', items: { type: 'string' }, description: 'TL + BIS + EN query keywords incl. inflections' },
          fact: {
            type: 'object',
            properties: { tl: { type: 'string' }, en: { type: 'string' }, bis: { type: 'string' } },
            required: ['tl', 'en', 'bis'],
          },
          source: { type: 'string' },
        },
        required: ['id', 'domain', 'topic', 'grades', 'terms', 'fact', 'source'],
      },
    },
  },
  required: ['facts'],
}

const authorPrompt = (s) => `You are authoring science facts for **Hiraia**, an offline Filipino grade-school science tutor that answers ONLY from this fact bank. Accuracy is non-negotiable: never invent a number, name, or mechanism. Many concepts are Philippine plants/animals/foods/scenes — write what a trustworthy children's reference would state.

STEP 1: Read \`rag/pipeline/GENERATION-BRIEF.md\` (the spec).
STEP 2: Read EXACTLY these lines of \`${WL}\` with the Read tool: offset ${s.lineStart}, limit ${s.lines}. Each line is a JSON object with a "slug" — a specific science concept (often Filipino-relevant).
STEP 3: For EACH slug, write ONE accurate, trilingual, grade-appropriate science fact teaching that concept (write a SECOND fact only if the concept is clearly rich enough). Skip a slug ONLY if it is not a teachable science concept (e.g. a purely decorative scene) — note nothing, just omit it.

Each fact:
- \`id\`: base it on the slug + a grade suffix (e.g. slug "aloe-vera-sabila" -> "aloe-vera-sabila-g5").
- trilingual \`fact.tl\` / \`fact.en\` / \`fact.bis\` — ONE clear grade-appropriate sentence each, faithful translations, never English-only.
- \`terms\`: pack distinctive Tagalog + Bisaya + English query words (incl. the Filipino name of the plant/animal and inflection variants).
- \`grades\`: DepEd band (3-10). \`domain\`: most accurate of ${DOMAINS.join('/')}.
- \`source\`: framework citation or "encyclopedia-stable consensus".
- accurate, specific, the kind of thing a curious kid asks. For a Philippine plant/animal: what it is, where it lives/grows, and one standout trait or use.

Return ONLY the structured facts for your slice.`

const verifyPrompt = (idx, facts) => `You are an adversarial science fact-checker for a children's tutor. Below are ${facts.length} candidate facts (slice ${idx}). Scrutinize EACH:
1. ACCURATE? (no invented numbers/names/mechanisms; for a Philippine plant/animal, the identity and trait must be correct and not confused with another species)
2. All three languages present and FAITHFUL translations?
3. Grade-appropriate, one clear sentence each?
4. \`terms\` include vernacular (Tagalog + Bisaya) query words?

Return the facts that PASS, correcting small fixable errors. DROP anything inaccurate, mis-identified, or not faithfully trilingual. Better to drop than ship a wrong fact to a child.

CANDIDATES:
${JSON.stringify(facts)}`

log(`Image-slug wave: slugs [${offset}, ${offset + count}) across ${slices.length} agents`)

const results = await pipeline(
  slices,
  (s) => agent(authorPrompt(s), { label: `author:slice${s.idx}`, phase: 'Author', schema: FACTS_SCHEMA })
           .then((r) => ({ idx: s.idx, facts: (r && r.facts) || [] })),
  (a) => {
    if (!a.facts.length) return { idx: a.idx, facts: [] }
    return agent(verifyPrompt(a.idx, a.facts), { label: `verify:slice${a.idx}`, phase: 'Verify', schema: FACTS_SCHEMA })
             .then((v) => ({ idx: a.idx, facts: (v && v.facts) || [] }))
  }
)

const all = results.filter(Boolean).flatMap((r) => r.facts)
log(`verified facts: ${all.length}`)
return { count: all.length, facts: all }
