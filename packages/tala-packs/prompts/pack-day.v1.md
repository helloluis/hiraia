You are turning one day of a Science teaching pack into a full 45-minute lesson plan and the classroom slides a
Philippine public-school teacher will show on a TV. Many of these teachers did not major in Science, so the speaker
notes must let them teach confidently. FACTUAL ACCURACY COMES FIRST: if you are not certain a statement is true, leave
it out. Do not invent statistics, species, places or products.

THIS WEEK
{{TARGET}}

THE WEEK'S PLAN (already written; stay consistent with it — same vocabulary, same misconceptions, same answers)
{{OUTLINE}}

TODAY: DAY {{DAY}}
{{DAY_OUTLINE}}

ILLUSTRATIONS YOU MAY USE (black-and-white Hiraia drawings; use a slug only if the drawing directly shows what that
slide explains; never decorative; at most one per slide; leave image null when nothing fits)
{{ART}}

WRITE (JSON only, matching this shape exactly)
{
  "day": {{DAY}},
  "title": "{{DAY_TITLE}}",
  "competencyIds": [...],
  "objective": "Learners will be able to …",
  "minutes": 45,
  "materials": ["what this lesson needs, with amounts"],
  "flow": [
    { "phase": "activating_prior_knowledge", "minutes": 5, "teacher": "what the teacher does and says", "learners": "what learners do", "slideIds": ["d{{DAY}}s1", "d{{DAY}}s2"] }
  ],
  "expectedObservations": ["what learners should see or find in today's activity"],
  "check": { "question": "exit-ticket question", "answer": "...", "why": "..." },
  "support": "how to help learners who struggle",
  "extension": "a stretch task for learners who finish early",
  "longerPeriod": "what to add if the school runs 50–60 minute periods",
  "slides": [
    { "id": "d{{DAY}}s1", "day": {{DAY}}, "kind": "day", "title": "Day {{DAY}}: …", "lines": ["Today: …"], "choices": [], "revealOf": null, "correctChoice": null, "image": null, "notes": "…" },
    { "id": "d{{DAY}}s2", "day": {{DAY}}, "kind": "concept", "title": "…", "lines": ["…", "…"], "choices": [], "revealOf": null, "correctChoice": null, "image": { "slug": "a slug from the list above", "alt": "what the drawing shows" }, "notes": "…" }
  ]
}

LESSON RULES
- flow follows DepEd's MATATAG order. Use exactly these phase values: "activating_prior_knowledge",
  "lesson_purpose", "developing_understanding" (one to three consecutive steps, each with this same value),
  "generalization", "evaluating_learning". Minutes add up to exactly 45. Keep each "teacher" under 2,000 characters.
- Never mention slide ids or slide numbers in "teacher", "learners" or "notes" (say "show the next slide" or name
  its title instead): the plan prints which slides go with each step.
- teacher: concrete actions and the actual questions to ask, with expected answers in brackets. learners: what they
  do (individually, in pairs or in groups of 4–6). Include classroom management for large classes.
- Any activity with heat, flame, sharp tools, chemicals (even vinegar or bleach), electricity, glass, outdoor work or
  tasting gets a specific safety instruction inside the step where it happens.

SLIDE RULES (the slides are read from the back of a classroom, by children)
- Write slide text the way the Hiraia student app writes for children: natural, simple, warm and kid-friendly for
  Grade {{GRADE}}; short sentences (about 10–14 words in Grades 3–6, up to 18 in Grades 7–10); at most 48 words on a
  slide; a title of at most 8 words with no semicolon; a check question shorter than its answer; numerals and unit
  symbols kept (25 °C, 10 cm).
- 6 to 9 slides for the day. The first is kind "day" (title "Day {{DAY}}: …", one line starting "Today:").
- Kinds: "question" (a discussion question that activates prior knowledge or hooks interest), "concept" (one idea,
  explained in ≤ 3 short lines, ideally beside an illustration), "vocabulary" (1–3 terms, each "term — meaning"),
  "activity" (numbered steps as lines, ≤ 5, plus what to record), "check" (title = the question if it fits in 60
  characters, otherwise a short title with the question as the only line; the 3–4 options go ONLY in "choices",
  without letters; no hint of the answer), "reveal" (immediately after its check: revealOf = the check's id, correctChoice = index of the right
  choice, lines = the correct answer and one short reason), "summary" (2–3 lines learners can copy).
- At least one check + reveal pair per day. The exit-ticket question (check) in the plan is NOT shown on slides; it
  is answered on paper and its answer stays in the notes. It must be a NEW question that needs the day's idea, never
  a question already asked or revealed earlier that day (that only tests memory of the reveal).
- title ≤ 60 characters. At most 4 lines, each ≤ 90 characters, in words Grade {{GRADE}} learners can read. No
  teacher instructions on slides. No answers on a slide before its reveal.
- Every slide id ("d{{DAY}}s1", "d{{DAY}}s2", …, in order) appears in exactly one flow step, in the same order.
- notes (teacher-only speaker notes, 50–180 words each): what to say in plain language, the questions to ask and the
  answers to expect, what a common wrong answer means and how to respond, timing, and any safety reminder. Expand
  every acronym. Never paste the slide text back.
- image.alt describes what the drawing shows in one sentence.
- Simplify without saying anything false: "the heart works all the time", not "the heart never gets tired";
  "breathing brings in oxygen", not "breathing is respiration" (respiration happens in cells).
