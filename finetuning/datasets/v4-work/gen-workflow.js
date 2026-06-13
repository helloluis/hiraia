export const meta = {
  name: 'science-dialogue-v4',
  description: 'Generate + validate the v4 dialogue/image-request SFT dataset (150 TL + 150 BIS rows)',
  phases: [
    { title: 'Generate', detail: '16 batch agents (2 langs x 8 batches), each self-validated against validate-v4.py' },
    { title: 'Review', detail: 'per-language factual-accuracy + fluency review over all fragments' },
  ],
}

// NOTE: fragments are SYSTEM-LESS ({"grade","messages":[user,assistant,...]}).
// The production system prompts (incl. the safety-refusal clause) are injected
// locally by validate-v4.py --lang / the assembler — agents never see them.

const ROOT = '/Users/luis/Code/hiraia'
const WORK = ROOT + '/finetuning/datasets/v4-work'

const BATCHES = [
  { key: 'a-pos-1', n: 22, brief:
`Family A POSITIVES, set 1 (22 single-turn rows: one user turn (grounding + image request), one assistant turn).
Subjects: animals & prehistoric life (at least 2 rows MUST be t-rex/dinosaur requests), human body parts, plants/trees. The student explicitly asks to SEE something. The assistant NEVER abstains: it gives 1-3 accurate general-knowledge sentences about the subject (warm, age-appropriate), then the [image: ...] tag alone on the final line.
Grounding: every row's user turn carries a grounding block of 1-3 REAL bank facts that are TANGENTIAL to the requested visual - about 2/3 of rows use facts loosely related to the broader topic (e.g. t-rex request grounded with generic "dinosaurs lived long ago" / fossil facts), about 1/3 use clearly OFF-topic facts (retrieval-hijack style, e.g. a coin-game fact). This trains: tangential grounding must NOT cause abstention on an image request.` },
  { key: 'a-pos-2', n: 23, brief:
`Family A POSITIVES, set 2 (23 single-turn rows, same shape as a-pos-1).
Subjects: space (planets, moon, astronauts, rockets), volcanoes & weather, simple machines & electricity, Philippine-specific (carabao, jeepney, Taal volcano, Banaue rice terraces, mango tree, sari-sari store...), everyday science objects (magnifying glass, thermometer, magnet). Same tangential-grounding rule as a-pos-1 (2/3 loosely related, 1/3 off-topic hijack-style). Assistant never abstains on an image request; short accurate answer + tag on its own final line.` },
  { key: 'a-neg', n: 15, brief:
`Family A NEGATIVES (15 single-turn rows: one user turn (grounding + request), one assistant turn with NO [image:] tag anywhere).
~11 rows: pop-culture / non-science image requests (celebrity, video game character, anime, fast-food logo, fancy car, basketball star...) -> the assistant gives a friendly ONE-or-two-sentence redirect toward a science topic it could show instead (but does NOT emit a tag in this turn - it only offers).
~4 rows: requests too vague to resolve ("pakita mo yung kahapon", "picture nung sinabi mo") -> assistant asks ONE clarifying question, no tag.
Most rows still carry a tangential grounding block (the device always retrieves something); the assistant simply ignores irrelevant grounding gracefully.` },
  { key: 'b1', n: 25, brief:
`Family B1 "di ko gets" (25 multi-turn rows, 4 messages: u1,a1,u2,a2).
u1 asks a science question; a1 explains (ending with a light Socratic question is fine). u2 says they did not understand (vary the phrasing: "di ko po gets", "ano po ulit?", "hindi ko maintindihan yung X", naming a specific word they got stuck on...). a2 re-explains with a COMPLETELY NEW analogy or angle - ZERO recycled phrasing from a1 (the validator mechanically rejects any shared 8-gram between assistant turns). a2 is encouraging, never makes the student feel slow.` },
  { key: 'b2', n: 25, brief:
`Family B2 answered-question (25 multi-turn rows, 4 messages).
a1 ends with a Socratic question to the student. u2 ANSWERS that question - ~15 rows correctly, ~10 rows wrong or partially wrong. a2 MUST acknowledge the student's specific answer first (affirm the correct part, gently correct the wrong part) and then build one step forward. a2 must NEVER re-ask the question a1 asked, never act as if the student had not answered.` },
  { key: 'b3', n: 15, brief:
`Family B3 restate-and-check (15 multi-turn rows, 4 messages).
After a1 explains, u2 restates the concept in the student's own words ("ah, so parang ... ?", "ibig sabihin po ba ...?") - sometimes fully right, sometimes right with one flaw. a2 confirms exactly what is right, fixes only what is off, and adds ONE new layer of depth. No full re-explanation of a1.` },
  { key: 'b4', n: 15, brief:
`Family B4 related follow-up (15 multi-turn rows: 10 with 4 messages, 5 with 6 messages u1,a1,u2,a2,u3,a3).
Each follow-up user turn asks an ADJACENT new question (e.g. u1 rain -> u2 why is the sea salty; u1 heart -> u2 why does it beat faster when running). The later assistant turns answer the NEW question directly, referencing earlier turns only in passing ("tulad ng napag-usapan natin...") - never re-explaining turn-1 content. In 6-message rows keep every turn compact and the grounding block (final user turn only) to at most 2 facts.` },
  { key: 'b5', n: 10, brief:
`Family B5 hard-content dialogues (10 multi-turn rows, 4 or 6 messages) - topics a small model garbles under follow-up pressure; the dialogue must land the physics EXACTLY right:
- 4 rows gravity/weightlessness: gravity EXISTS in space; astronauts float because they are in FREE FALL around Earth (falling together with their spacecraft), NOT because there is no gravity; the moon HAS its own gravity (about 1/6 of Earth's) which is why astronauts bounce but do not float away.
- 2 rows moon phases vs eclipses (phases are NOT Earth's shadow).
- 2 rows where we get energy: breathing brings oxygen to BURN food energy; food is the fuel.
- 2 rows evaporation vs boiling (evaporation happens at any temperature, surface only).
The student pushes back or restates wrongly mid-dialogue; the tutor stays consistent, never contradicts itself across turns. Do NOT read or copy from finetuning/eval/capability/probes.json - author fresh scenarios.` },
]

const LANGS = [
  { lang: 'tagalog', valLang: 'tagalog', factField: 'tl',
    voice: 'Natural conversational Tagalog (Taglish for science terms is fine, matching the exemplar). Students use po/opo. Default language of the product.' },
  { lang: 'bisaya', valLang: 'cebuano', factField: 'bis',
    voice: 'Natural conversational Cebuano/Bisaya matching the exemplar register and orthography. Use the fact.bis text for grounding lines.' },
]

const genPrompt = (L, b) => `You are authoring SFT training rows for Hiraia, an offline 3B science tutor for Filipino grade-school students. Factual accuracy ranks ABOVE perfect ${L.lang} fluency, but both matter.

READ FIRST:
1. ${ROOT}/finetuning/datasets/DIALOGUE-DATASET.md - the dataset spec. Your batch implements one slice of it.
2. ${WORK}/exemplar-${L.lang}.jsonl - 25 example rows. Match this register and the [image:] tag style (short caption-style ENGLISH descriptions).

YOUR BATCH: ${b.key} (${L.lang}), EXACTLY ${b.n} rows.
${b.brief}

LANGUAGE: ${L.voice}

ROW FORMAT (system-less fragment - a local assembler adds the production system prompt later):
{"grade":"<3..10>","messages":[{"role":"user","content":...},{"role":"assistant","content":...}, ...]}
- One JSON object per line, file: ${WORK}/${L.lang}-${b.key}.jsonl
- NO system message. Strict user/assistant alternation starting with user; final message is assistant.
- Spread rows across at least 5 different grades (3-10), matching topic difficulty to grade.

HARD MECHANICAL RULES (a validator enforces all of these):
- Grounding blocks may ONLY appear in the FINAL user turn of a row, composed exactly as:
  "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):" + newline
  + one line per fact: "- (<topic>) <fact text>" + blank line +
  "When the question is answered by the facts above, base your explanation on them and do not contradict them. Still teach in your own words at the student's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure."
  + blank line + the student's message.
  Every fact text MUST be copied VERBATIM (every character, including punctuation and dashes) from the "fact"."${L.factField}" field of a real row in ${ROOT}/rag/bank/science-facts.jsonl, and the (<topic>) from that row's "topic" field. Find facts by grepping that file. NEVER invent or paraphrase grounding text.
- [image: ...] tags: short specific ENGLISH caption-style description, alone on the FINAL line of the assistant message. Descriptions must resolve against the real bundled-image catalog at cosine >= 0.70 - pick concrete drawable science subjects (the catalog is 4,228 black-and-white science clip-art images; browse ${ROOT}/packages/images/index.json for the curated subset to calibrate what exists). The validator prints the resolved slug for every tag - check it matches your intended subject; if it resolves to the wrong slug, rewrite the description.
- No two assistant turns within a row may share any 8-word sequence.
- For Family B rows (b1-b5): roughly 1 in 3 rows should end with a fitting [image:] tag; ~80% of rows carry a grounding block in the final user turn, ~20% have a plain final user turn (no block). Family A rows always have exactly one user turn (with grounding, except where the brief says otherwise).

VALIDATE BEFORE RETURNING (mandatory):
Run: cd ${ROOT} && finetuning/.convert-venv/bin/python finetuning/datasets/v4-work/validate-v4.py --lang ${L.valLang} ${WORK}/${L.lang}-${b.key}.jsonl
Fix every FAIL and re-run until it prints "${b.n}/${b.n} rows pass" and exits 0. Also re-check each printed "ok tag ... -> slug" line: if a slug clearly mismatches the description's subject, rewrite that description even though it passed the floor.

Also: do NOT read finetuning/eval/capability/probes.json (no teaching to the benchmark). Vary scenarios - no two rows in your batch about the same narrow fact.

Return: {"file": "...", "rows": ${b.n}, "validatorClean": true/false, "notes": "anything the assembler must know"}`

const GEN_SCHEMA = {
  type: 'object', required: ['file', 'rows', 'validatorClean'],
  properties: {
    file: { type: 'string' }, rows: { type: 'number' },
    validatorClean: { type: 'boolean' }, notes: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', required: ['issues', 'summary'],
  properties: {
    issues: { type: 'array', items: { type: 'object', required: ['file', 'line', 'severity', 'issue'],
      properties: { file: { type: 'string' }, line: { type: 'number' },
        severity: { type: 'string', enum: ['block', 'warn'] }, issue: { type: 'string' } } } },
    summary: { type: 'string' },
  },
}

const reviewPrompt = (L, files) => `You are the final ACCURACY + FLUENCY reviewer for new ${L.lang} SFT rows for Hiraia (offline 3B science tutor for Filipino students; factual accuracy ranks ABOVE perfect fluency). The rows already passed a mechanical validator - your job is what machines cannot check.

Read EVERY row of these files:
${files.map((f) => '- ' + f).join('\n')}
The spec is ${ROOT}/finetuning/datasets/DIALOGUE-DATASET.md. Rows are system-less fragments {"grade","messages":[user,assistant,...]} - that is expected.

Flag as severity "block":
- ANY scientifically wrong or misleading claim in an assistant turn (check numbers, mechanisms, causal claims; especially gravity/free-fall, moon phases, energy/breathing, evaporation rows)
- An assistant turn that contradicts the grounding facts in its row
- A Family-A positive row whose assistant abstains/hedges instead of showing the image, or a negative row (a-neg) that emits a tag
- A b2 row whose final assistant turn ignores or re-asks the already-answered question; a b1 row whose a2 is a rephrase rather than a genuinely new angle
- Unnatural or wrong ${L.lang} that a native-speaker kid would stumble on, or language drift (answer switching language mid-row without reason)
Flag as severity "warn": awkward-but-usable phrasing, weak analogies, near-duplicate scenarios across files, tag descriptions whose subject seems mismatched to a science-clip-art catalog.

Use line = the 1-based line number within the named file. Be strict: a wrong fact baked into SFT is worse than a dropped row. Return {"issues":[...], "summary":"2-4 sentences on overall quality"}.`

phase('Generate')
const results = await pipeline(
  LANGS,
  (L) => parallel(BATCHES.map((b) => () =>
    agent(genPrompt(L, b), { label: `${L.lang}:${b.key}`, phase: 'Generate', schema: GEN_SCHEMA })
  )).then((rs) => ({ L, gen: rs.filter(Boolean) })),
  ({ L, gen }) => {
    const files = gen.map((g) => g.file)
    log(`${L.lang}: ${gen.length}/8 batches done (${gen.reduce((s, g) => s + g.rows, 0)} rows) -> review`)
    if (!files.length) return { lang: L.lang, gen, review: null }
    return agent(reviewPrompt(L, files), { label: `review:${L.lang}`, phase: 'Review', schema: REVIEW_SCHEMA })
      .then((review) => ({ lang: L.lang, gen, review }))
  }
)

return results.filter(Boolean)
