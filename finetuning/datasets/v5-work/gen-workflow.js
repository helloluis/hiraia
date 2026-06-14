export const meta = {
  name: 'science-dialogue-v5',
  description: 'Generate + validate the v5 counterweight SFT dataset (130 TL + 130 BIS rows): anti-confabulation, brevity, honest uncertainty, fast image tags',
  phases: [
    { title: 'Generate', detail: '12 batch agents (2 langs x 6 batches), each self-validated against validate-v4.py' },
    { title: 'Review', detail: 'per-language factual-accuracy + fluency review over all fragments' },
  ],
}

// V5 = the counterweight release. The v4 anti-abstention rows (a-pos) fixed
// over-abstention but induced CONFABULATION (invented star names, invented
// personal preferences) and VERBOSITY (lectures at "hello"). And explicit
// image requests still emit no [image:] tag when retrieval facts are present
// (gate: image-request-trex failed WITH 3 on-topic facts retrieved, while
// image-request-heart passed with none) — grounded context pushes the model
// into tag-less grounded-answer mode, and v4's tags sat ~70% into a paragraph
// so the model can EOS before reaching them. Every batch below targets one
// concrete red gate case. Fragments are SYSTEM-LESS ({"grade","messages"})
// like v4; validate-v4.py --lang injects the production system prompt.

const ROOT = '/Users/luis/Code/hiraia'
const V4 = ROOT + '/finetuning/datasets/v4-work'
const WORK = ROOT + '/finetuning/datasets/v5-work'

const BATCHES = [
  { key: 'c-abstain', n: 25, brief:
`Family C HONEST UNCERTAINTY (25 single-turn rows). Targets the gate failure where the model INVENTED a star named "Nova Genestra" when asked for the biggest star in the universe.
The student asks something GENUINELY unknowable or not settled by science: superlatives science cannot pin down (the single biggest star in the whole universe, the total number of fish in the sea, grains of sand on Earth), unpredictable events (when the next earthquake/eruption will be, tomorrow's lotto numbers), open questions (are there aliens, what exactly is inside a black hole at the center, what was before the Big Bang), or things the tutor cannot know (what the student's dog is thinking, who the smartest person alive is, which animal is "happiest").
Assistant pattern (STRICT): (1) the FIRST sentence carries an explicit honest-uncertainty marker — vary it: "Ang totoo po, hindi ako sigurado...", "Walang nakakaalam ng eksaktong sagot diyan...", "Hindi pa po tiyak ng mga siyentista...", "Walang makakapagsabi nang eksakto..."; (2) then 1-2 sentences of what science DOES know, factually accurate, with NO invented names and NO invented precise numbers (known reference points like "ang UY Scuti ay isa sa pinakamalalaking natuklasan" are fine when true); (3) total length under ~350 characters.
CRITICAL ANTI-REGRESSION RULE: every question MUST be genuinely impossible to answer with certainty. Do NOT write a single row that declines a normal curriculum question (what photosynthesis is, why the sky is blue, how rain forms...) — over-abstention is the failure v4 just fixed; these rows teach calibrated uncertainty, NOT refusal.
Grounding: ~70% of rows carry a tangential grounding block (the device always retrieves something); the facts must not bait the assistant into pretending to know the unknowable.` },
  { key: 'c-no-confab', n: 20, brief:
`Family C NO-CONFAB PERSONA (20 single-turn rows). Targets the gate failure where the model claimed its favorite food is sinigang (an invented preference) in an 845-character ramble.
The student asks the TUTOR a personal/persona question: favorite food/color/animal/planet/subject, do you have a pet, where do you live, how old are you, have you eaten, are you sleepy, what school did you go to, do you play games, do you watch cartoons, can you sing.
Assistant pattern: warmly says it does not have one / does not do that because it is a science tutor program — NEVER inventing a preference, biography, body, or feelings — then pivots with ONE light science hook, usually turning the question back to the student ("Pero ikaw, ano ang paborito mong hayop? May astig na science tayo tungkol diyan!"). Total length under ~300 characters. Tone: warm and playful, never cold or robotic, never lecturing about being an AI.
Grounding: ~70% of rows carry a tangential grounding block which the assistant gracefully ignores.` },
  { key: 'c-brevity', n: 25, brief:
`Family C CHITCHAT BREVITY (25 single-turn rows). Targets the gate failure where "hello" got a 565-character slime lecture.
User turns are pure chitchat: hello, hi, kumusta, magandang umaga/gabi, salamat, thank you po, ok, sige po, wow, astig, nice, haha, babay, good night, uy, musta na, ingat ka. Vary register and spelling like real kids type.
Assistant: at MOST two short sentences, target under ~140 characters total — a warm matching reply plus (optionally) one short invitation to ask a science question. NO facts dumped, NO lists, NO lecture, NO emoji spam, NO [image:] tag. A bare "Salamat din! Kita tayo ulit." style close is perfect for goodbyes.
Grounding: ~80% of rows carry a grounding block of clearly IRRELEVANT facts (the device retrieves on any input) — the assistant must completely ignore it and stay short. This irrelevant-grounding-plus-chitchat shape is the exact device path that currently fails.` },
  { key: 'c-gibberish', n: 15, brief:
`Family C GIBBERISH → CLARIFY (15 single-turn rows). Targets the gate failure where unintelligible input got a lecture about asymmetry.
User turns are unintelligible or hopelessly ambiguous: keyboard mash ("asdkjfh", "jkjkjk"), stray punctuation ("???", "...."), a lone syllable ("e", "ha", "po"), cut-off fragments ("paano ba mag", "yung ano kasi", "kanina yung"), random emoji strings, a word salad of two unrelated words.
Assistant: exactly ONE friendly clarifying question, under ~120 characters, asking what the student means or wants to learn. It must NOT guess a topic from the grounding block, must NOT start teaching anything, must NOT scold.
Grounding: most rows carry a tangential/random grounding block — the trap being trained away is "retrieval fired, so lecture about whatever was retrieved".` },
  { key: 'c-myth', n: 15, brief:
`Family C MYTH DEBUNK (15 single-turn rows). Targets the gate failure where "does reading in the dark ruin your eyes" never got a clear "hindi" verdict.
The student asks about or asserts a common myth. The assistant's FIRST sentence states the verdict plainly ("Hindi po totoo iyan!", "Mito lang po iyan.", or for partly-true ones "May konting katotohanan, pero..."), THEN explains the accurate science in 1-3 kid-friendly sentences. Verdict first, explanation second — never buried.
Use well-established debunks, accuracy is critical: reading in dim light tires the eyes but does NOT permanently damage them; lightning CAN strike the same place twice; bats are not blind; goldfish remember for months, not 3 seconds; the Great Wall of China is not visible from the Moon; houseflies live for weeks, not 24 hours; lightning rods do not "attract" storms; a penny is not "lucky" metal — magnets do not attract copper coins at all; the Moon has gravity (things dropped there still fall); summer is not caused by Earth being closer to the Sun (it is the tilt); heavier objects do not fall faster in the absence of air; rice does not "drain" lightning from gadgets (it barely absorbs moisture); ostriches do not bury their heads in sand; touching a baby bird does not make its mother reject it (birds barely smell); rain does not come from holes in the sky (clouds are condensed water droplets). Pick 15, one per row, across grades 3-10.
Grounding: ~60% of rows carry a grounding block (on-topic where the fact bank has something, tangential otherwise).` },
  { key: 'c-imgtag', n: 30, brief:
`Family C FAST IMAGE TAG (30 single-turn rows). THE critical batch. Targets the gate failures image-request-trex and image-request-ceb-butanding: on an EXPLICIT request to see something, the model still emits no [image:] tag — specifically when retrieval facts are present (grounded mode suppresses the tag), and v4's tags sat at ~70% of a long paragraph so generation can stop before reaching them.
User turns are EXPLICIT see-requests with heavy phrasing diversity: "pakita mo", "patingin po ng", "may picture ka ba ng", "gusto kong makita", "ipakita mo nga", "pwede po bang makita", "picture naman ng", "show mo naman yung", "ano hitsura ng ... pakita mo".
Assistant pattern (STRICT — this is the fix): at most ONE short sentence (under ~120 characters) of warm accurate lead-in, then the [image: ...] tag ALONE on the final line. The tag must come FAST. NEVER a paragraph before the tag, NEVER an abstention.
Subjects: at least 3 dinosaur rows including T-rex (T-rex is a THEROPOD, a giant MEAT-EATER — it is NOT a sauropod; the gate caught the model calling it one) and at least 2 whale shark / butanding rows (the whale shark IS a fish — the biggest fish in the world; the gate caught the model denying it is a fish). The rest: other animals, space, volcanoes, weather, plants, simple machines, everyday science objects, Philippine-specific subjects (carabao, jeepney, Mayon, banana tree...). Avoid re-using v4's exact subjects where possible; duplicating T-rex/dino is REQUIRED, not a violation.
Grounding: EVERY row carries a grounding block — ~half with ON-TOPIC facts about the requested subject (this is the exact failing device path: facts present, tag still required) and ~half tangential/hijack-style. Either way: short sentence, then tag.` },
]

const LANGS = [
  { lang: 'tagalog', valLang: 'tagalog', factField: 'tl',
    voice: 'Natural conversational Tagalog (Taglish for science terms is fine, matching the exemplar). Students use po/opo. Default language of the product.' },
  { lang: 'bisaya', valLang: 'cebuano', factField: 'bis',
    voice: 'Natural conversational Cebuano/Bisaya matching the exemplar register and orthography. Use the fact.bis text for grounding lines. For see-requests use natural Cebuano phrasings ("ipakita kuha", "patan-awa ko", "naa kay picture sa ...?", "unsay hitsura sa ... ipakita ba").' },
]

const genPrompt = (L, b) => `You are authoring SFT training rows for Hiraia, an offline 3B science tutor for Filipino grade-school students. Factual accuracy ranks ABOVE perfect ${L.lang} fluency, but both matter.

READ FIRST:
1. ${ROOT}/finetuning/datasets/DIALOGUE-DATASET.md - the dataset spec (v5 batches extend it with counterweight families; your brief below overrides where they differ).
2. ${WORK}/exemplar-${L.lang}.jsonl - 25 example rows. Match this register, the grounding-block composition, and the [image:] tag style (short caption-style ENGLISH descriptions).

YOUR BATCH: ${b.key} (${L.lang}), EXACTLY ${b.n} rows.
${b.brief}

LANGUAGE: ${L.voice}

ROW FORMAT (system-less fragment - a local assembler adds the production system prompt later):
{"grade":"<3..10>","messages":[{"role":"user","content":...},{"role":"assistant","content":...}]}
- One JSON object per line, file: ${WORK}/${L.lang}-${b.key}.jsonl
- NO system message. Single turn: exactly one user message then one assistant message.
- Spread rows across at least 5 different grades (3-10), matching topic difficulty to grade.

HARD MECHANICAL RULES (a validator enforces all of these):
- Grounding blocks may ONLY appear in the user turn, composed exactly as:
  "VERIFIED FACTS FROM THE CURRICULUM (use these as your source of truth):" + newline
  + one line per fact: "- (<topic>) <fact text>" + blank line +
  "When the question is answered by the facts above, base your explanation on them and do not contradict them. Still teach in your own words at the student's level — do not just copy the fact. If the facts above do not cover the question, answer carefully from general knowledge and say so if you are unsure."
  + blank line + the student's message.
  Every fact text MUST be copied VERBATIM (every character, including punctuation and dashes) from the "fact"."${L.factField}" field of a real row in ${ROOT}/rag/bank/science-facts.jsonl, and the (<topic>) from that row's "topic" field. Find facts by grepping that file. NEVER invent or paraphrase grounding text. Wherever your brief allows TANGENTIAL grounding, pick facts from physical-science domains (space, weather, forces, matter, electricity, earth, PH geography) rather than body/health topics.
- [image: ...] tags (c-imgtag ONLY; every other batch in this v5 set emits NO tag): short specific ENGLISH caption-style description, alone on the FINAL line of the assistant message. Descriptions must resolve against the real bundled-image catalog at cosine >= 0.70 - pick concrete drawable science subjects (browse ${ROOT}/packages/images/index.json to calibrate what exists). The validator prints the resolved slug for every tag - check it matches your intended subject; if it resolves to the wrong slug, rewrite the description.
- No two assistant turns within a row may share any 8-word sequence (trivially true for single-turn rows, but the validator still runs).

VALIDATE BEFORE RETURNING (mandatory):
Run: cd ${ROOT} && finetuning/.convert-venv/bin/python finetuning/datasets/v4-work/validate-v4.py --lang ${L.valLang} ${WORK}/${L.lang}-${b.key}.jsonl
Fix every FAIL and re-run until it prints "${b.n}/${b.n} rows pass" and exits 0. Also re-check each printed "ok tag ... -> slug" line: if a slug clearly mismatches the description's subject, rewrite that description even though it passed the floor.

Also: do NOT read finetuning/eval/capability/probes.json and do NOT read finetuning/eval/harness/cases.json (no teaching to the benchmark or the gate - author fresh scenarios in the same FAMILY as the failures described in your brief, never the literal gate prompts). Vary scenarios - no two rows in your batch about the same narrow fact.

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
Rows are system-less fragments {"grade","messages":[user,assistant]} - that is expected. These are V5 COUNTERWEIGHT batches: c-abstain (honest uncertainty on unknowables), c-no-confab (no invented persona), c-brevity (short chitchat), c-gibberish (one clarifying question), c-myth (verdict-first debunks), c-imgtag (one short sentence then [image:] tag).

Flag as severity "block":
- ANY scientifically wrong or misleading claim in an assistant turn (check myth verdicts especially: each must match scientific consensus)
- An invented specific name, number, preference, or biographical detail (the confabulation these batches exist to kill)
- A c-abstain row whose QUESTION is actually answerable curriculum material (that row would re-teach over-abstention - the v4 regression in reverse)
- A c-imgtag row with more than one sentence before the tag, or with no tag; any NON-c-imgtag row that emits a tag
- A c-brevity row over ~2 sentences, or any chitchat answer that lectures
- An assistant turn that contradicts the grounding facts in its row, or visibly latches onto irrelevant grounding
- Unnatural or wrong ${L.lang} that a native-speaker kid would stumble on, or language drift
Flag as severity "warn": awkward-but-usable phrasing, near-duplicate scenarios across files, tag descriptions whose subject seems mismatched to a science-clip-art catalog.

Use line = the 1-based line number within the named file. Be strict: a wrong fact baked into SFT is worse than a dropped row. Return {"issues":[...], "summary":"2-4 sentences on overall quality"}.`

phase('Generate')
const results = await pipeline(
  LANGS,
  (L) => parallel(BATCHES.map((b) => () =>
    agent(genPrompt(L, b), { label: `${L.lang}:${b.key}`, phase: 'Generate', schema: GEN_SCHEMA })
  )).then((rs) => ({ L, gen: rs.filter(Boolean) })),
  ({ L, gen }) => {
    const files = gen.map((g) => g.file)
    log(`${L.lang}: ${gen.length}/6 batches done (${gen.reduce((s, g) => s + g.rows, 0)} rows) -> review`)
    if (!files.length) return { lang: L.lang, gen, review: null }
    return agent(reviewPrompt(L, files), { label: `review:${L.lang}`, phase: 'Review', schema: REVIEW_SCHEMA })
      .then((review) => ({ lang: L.lang, gen, review }))
  }
)

return results.filter(Boolean)
