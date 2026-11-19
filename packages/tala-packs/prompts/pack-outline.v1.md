You are writing one week of a Science teaching pack for Philippine public-school teachers. The pack is published by
Hiraia, a not-for-profit. Many Science teachers in these schools did not major in Science. Your job is to make sure a
non-specialist teacher understands the science well enough to teach it correctly and answer learners' questions —
without talking down to them.

FACTUAL ACCURACY COMES FIRST. A wrong explanation taught to forty children is worse than a plain one. If you are not
certain a statement is true, leave it out. Do not invent statistics, dates, species, place names, products, laws or
quotations. Use only widely known, checkable Philippine examples (for example: rice fields, coconut trees, carabao,
jeepneys, sari-sari stores, typhoons and PAGASA wind signals, earthquakes and PHIVOLCS, mangroves, Taal and Mayon
volcanoes). If no safe local example exists, use a general everyday one.

THIS WEEK
{{TARGET}}

DEPED'S SUGGESTED ACTIVITIES AND PERFORMANCE TASKS FOR THIS TERM (verbatim; adopt or adapt the ones that fit this
week's competencies; you do not have to use all of them)
{{BOW_ACTIVITIES}}

STATEMENTS HIRAIA ALREADY TEACHES FOR THESE COMPETENCIES (model-written and model-reviewed context, not sources;
stay consistent with them unless one is wrong — if one is wrong, do not repeat it)
{{GROUNDING}}

SOURCES YOU MAY CITE (cite only these ids, with a specific locator such as a chapter, section or DCI code)
{{REFERENCES}}

CLASSROOM
- 5 lessons this week, 45 minutes each (DepEd Order 010 and 012, s. 2024: Science is taught five times a week).
- A typical public-school class of 35–45 learners, few lab materials, sometimes no electricity. A TV or projector may
  show slides. Use low-cost, locally available materials and give a substitute for anything a school may not have.
- Lessons follow DepEd's MATATAG procedure: Activating Prior Knowledge → Establishing Lesson Purpose → Developing and
  Deepening Understanding → Making Generalizations → Evaluating Learning.
- If a competency spans several weeks, this week covers only its part (see "position"). Build on last week's topic
  and lead toward next week's; do not repeat the same lessons.

WRITE (JSON only, matching this shape exactly)
{
  "title": "pack title, ≤ 70 characters, learner-friendly",
  "summary": "2–3 sentences: what learners do and learn this week",
  "sensitivity": [],  // any of "human_reproduction", "health", "disaster", "safety_critical" that apply
  "guide": {
    "bigIdea": "the one idea everything this week builds toward, in one or two sentences",
    "whyItMatters": "why this matters in learners' lives in the Philippines",
    "background": [ { "heading": "...", "paragraphs": ["..."], "refIds": ["..."] } ],
    "prerequisites": [ { "idea": "...", "quickCheck": "a question to ask on Day 1", "ifMissing": "what to do" } ],
    "vocabulary": [ { "term": "...", "filipino": "Filipino term if one is commonly used in Philippine schools, else null", "meaning": "plain meaning", "example": "everyday example" } ],
    "misconceptions": [ { "belief": "...", "whyLearnersThinkIt": "...", "correctIdea": "...", "howToAddress": "a concrete move in class" } ],
    "studentQuestions": [ { "question": "a question learners really ask", "answer": "correct answer the teacher can say, with the reason" } ],
    "localExamples": [ { "example": "...", "connection": "how it shows the science" } ],
    "materials": [ { "item": "...", "amount": "per group or per class", "notes": "...", "substitute": "... or null" } ],
    "preparation": ["what to prepare before the week, with timing"],
    "safety": ["specific precautions; empty only if nothing in the week carries any risk"],
    "sources": [ { "refId": "...", "locator": "...", "usedFor": "..." } ]
  },
  "days": [
    {
      "day": 1,
      "title": "≤ 60 characters",
      "competencyIds": ["ids from THIS WEEK only"],
      "objective": "Learners will be able to … (observable, one sentence)",
      "keyIdeas": ["2–4 short statements learners should leave with"],
      "mainActivity": "the core activity in 1–3 sentences, naming materials",
      "check": { "question": "exit-ticket question", "answer": "correct answer", "why": "why it is correct" }
    }
  ],
  "assessment": [
    { "id": "q1", "kind": "multiple_choice", "prompt": "...", "choices": ["A", "B", "C", "D"], "correctChoice": 0,
      "answer": "the correct answer in words", "explanation": "worked explanation, including why each wrong choice is wrong", "competencyId": "..." }
  ]
}

REQUIREMENTS
- background: 3–6 sections that explain what is actually happening and why (the mechanism), one level deeper than
  the learners need, in plain sentences. Expand every technical term or acronym the first time. Point out where
  textbooks or common sayings oversimplify. Each section cites 1–3 refIds.
- vocabulary: 5–10 terms learners need this week. Filipino terms only where you are confident they are the ones used
  in Philippine classrooms; otherwise null. Never write Cebuano or other languages.
- misconceptions: 3–5 that research or classroom experience shows learners of this age really hold about this topic.
- studentQuestions: 4–6, including at least one "but why…?" question that a non-specialist might find hard.
- days: exactly 5. Every competency in THIS WEEK must appear in at least one day's competencyIds. Day 5 should
  consolidate and assess (it may include the weekly assessment and a performance task step).
- assessment: 6–8 items covering every competency this week: mostly multiple choice with four plausible choices
  (wrong choices built from the misconceptions), at least one short answer, and one performance task drawn from
  DepEd's suggestions when one fits. Exactly one correct choice. Explanations must show the reasoning.
- Write the teacher-facing text in clear, warm, professional English. Short sentences. No jargon left unexplained.
- Learner-facing wording (titles, keyIdeas, questions) must suit Grade {{GRADE}} learners.
- Never include human reproductive anatomy beyond what the competency text itself states; keep it factual and
  age-appropriate if the competency requires it, and add "human_reproduction" to sensitivity.
