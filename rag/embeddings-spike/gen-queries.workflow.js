export const meta = {
  name: 'hiraia-gen-eval-queries',
  description: 'Generate a labeled retrieval benchmark: realistic kid queries -> gold fact id, multilingual + varied styles, fair to both lexical and semantic',
  phases: [{ title: 'Queries' }, { title: 'Negatives' }],
}

const NBATCHES = 15
const DIR = '/tmp/qgen'

const QSCHEMA = {
  type: 'object',
  required: ['queries'],
  properties: {
    queries: {
      type: 'array',
      items: {
        type: 'object',
        required: ['fact_id', 'query', 'lang', 'style'],
        properties: {
          fact_id: { type: 'string' },
          query: { type: 'string' },
          lang: { type: 'string', enum: ['tagalog', 'cebuano', 'english', 'taglish'] },
          style: { type: 'string', enum: ['natural', 'keyword', 'morphology', 'homonym', 'codeswitch'] },
        },
      },
    },
  },
}
const NEG_SCHEMA = {
  type: 'object',
  required: ['queries'],
  properties: {
    queries: {
      type: 'array',
      items: { type: 'object', required: ['query', 'lang'], properties: { query: { type: 'string' }, lang: { type: 'string' } } },
    },
  },
}

async function tryAgent(prompt, opts, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await agent(prompt, { ...opts, label: i ? `${opts.label}#${i + 1}` : opts.label }); if (r) return r } catch (e) { log(`retry ${opts.label}: ${e?.message || e}`) }
  }
  return null
}

phase('Queries')
const idxs = Array.from({ length: NBATCHES }, (_, i) => i)
const results = await pipeline(idxs, (i) => {
  const path = `${DIR}/batch-${String(i).padStart(2, '0')}.json`
  return tryAgent(
    `Read ${path} — it has {lang_emphasis, facts:[{id,domain,topic,tl,bis,en}]}. For EACH fact, write 2-3 realistic questions a Filipino grade-school kid (grades 3-10) would actually type, whose correct answer IS that fact.

FAIRNESS RULES (critical — this is an unbiased retrieval benchmark):
- Use a KID's everyday words and phrasing. Do NOT copy the fact's distinctive or technical vocabulary — paraphrase the concept the way a curious child would ask it. (Copying the fact's words would unfairly favor keyword search over semantic.)
- Each query must be genuinely answerable by THIS fact (not a different one).
- VARY the queries across styles. Tag each with a "style":
  - "natural": a normal full question ("bakit ...", "ano ang ...", "paano ...")
  - "keyword": terse, just content words a kid might type
  - "morphology": uses an inflected verb form that differs from the dictionary form (e.g. gumagawa vs ginagawa, lumilipad vs lumipad)
  - "homonym": phrases it using a word with multiple meanings if the topic has one (puso, baga, bituin, etc.)
  - "codeswitch": natural Tagalog/English (Taglish) mixing
- LANGUAGE: lean toward the batch's lang_emphasis ("${''}" is set in the file), but real kids code-switch — include some variation. Tag each query's "lang" as tagalog | cebuano | english | taglish.

Return {queries:[{fact_id, query, lang, style}]} — fact_id is the source fact's id. Aim for ~2-3 per fact.`,
    { schema: QSCHEMA, label: `qgen:b${i}`, phase: 'Queries' }
  )
})

phase('Negatives')
const neg = await tryAgent(
  `Generate 40 "negative" questions for a Filipino kids' SCIENCE tutor: realistic questions a kid might type that the science fact-bank should NOT confidently answer — i.e., they belong to a different domain or are not science facts. Mix: personal/chit-chat ("anong paborito mong kulay"), other subjects (math homework, history dates, spelling), pop culture, and nonsense. Mix languages (tagalog, cebuano, english, taglish). These calibrate the abstain floor.
Return {queries:[{query, lang}]} with 40 items.`,
  { schema: NEG_SCHEMA, label: 'negatives', phase: 'Negatives' }
)

const queries = results.filter(Boolean).flatMap((r) => r.queries ?? [])
const negatives = (neg?.queries ?? []).map((n) => ({ fact_id: 'NONE', query: n.query, lang: n.lang, style: 'negative' }))
log(`generated ${queries.length} labeled queries + ${negatives.length} negatives`)
return { queries: queries.concat(negatives) }
