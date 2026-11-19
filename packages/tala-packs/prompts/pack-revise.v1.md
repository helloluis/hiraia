You wrote this Science teaching pack for Philippine public-school teachers (Grade {{GRADE}}). An independent reviewer
found the issues below. Fix every blocker and major issue, and the minor ones that are clearly right. If you are
sure an issue is mistaken, do not change that content and say why. FACTUAL ACCURACY COMES FIRST.

{{LANGUAGE_RULE}}

Change only what an issue requires. Keep ids, slide order, flow minutes (still summing to 45 per day), the slide
rules (titles ≤ 60 characters, ≤ 4 lines of ≤ 90 characters, no answers before a reveal) and every field's type.
When you change an answer or a fact, change it everywhere it appears (guide, vocabulary, assessment, check/reveal
slides, notes, day plan) — one patch per place.

Every blocker and major issue must appear either in a patch's "issueIds" or in "declined".

FIELD LIMITS (characters; a patch over a limit is discarded, so shorten or split): slide title 70, slide line 110 (130 in
the Filipino edition; at most 5 lines), choice 120, slide notes 2400, image alt 200; day objective 300, materials at most 12 items of 300,
flow teacher 2400, flow learners 1000, check question 400 / answer 600 / why 800, support and extension 900,
longerPeriod 800; assessment prompt 500, choice 160, answer 600, explanation 900; guide paragraph 1400, vocabulary
meaning and example 300, misconception belief 240 / correctIdea and howToAddress 500. Write the complete final
text in every patch; never a placeholder such as "[updated]" or "[paragraph updated by issue c1]".
To fix a wrong or answer-revealing picture, set that slide's "image" to null, or to {"slug": "...", "alt": "..."}
with a slug from the APPROVED DRAWINGS below (no other drawing exists).

APPROVED DRAWINGS (slug — what it shows)
{{ART}}

THE PACK (JSON). Every object inside a list carries its position as "_i": build paths from it (the slide with "_i": 27 is slides[27]; the flow step with "_i": 2 inside the day with "_i": 3 is days[3].flow[2]). Never count positions yourself. Do not include "_i" in values.
{{PACK}}

ISSUES
{{ISSUES}}

Return JSON only:
{
  "patches": [ { "path": "exact path of the value you replace, e.g. slides[14].lines or guide.misconceptions[0].correctIdea", "expect": "the first 40 characters of the CURRENT value at that path, copied exactly (for an array, of its first item)", "value": <the complete new value for that path, same type as before>, "issueIds": ["c1"] } ],
  "declined": [ { "issueId": "c4", "reason": "why the reviewer is mistaken" } ]
}
A path must already exist in the pack. Replace whole strings or whole arrays; do not add new top-level fields.
Count array indexes carefully: a patch whose "expect" does not match the current value is discarded.
