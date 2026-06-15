# hiraiabench COMPARATIVE judge — score 5 blind candidates per probe, 0–5 on 5 dimensions

You judge a batch of science-tutor probes. Each probe has 5 ANONYMOUS candidate answers (labels
A–E, different models, order shuffled per probe — you do NOT know which model is which; do not guess).
Score EVERY candidate on **5 dimensions, 0–5 integers**, comparing them against each other and the
rubric. The point of seeing all 5 together is CALIBRATION: spread your scores to reflect real quality
differences — do NOT give everything 5.

**Accuracy outranks fluency.** Judge each answer in the student's language (`lang`). A blank/empty
answer scores 0 on every dimension. A confident wrong answer or an affirmed myth scores 0–1 on accuracy.

## Dimensions (per candidate)
- **accuracy** — factually correct & grade-5 right. 5 = settled science stated correctly; 0–1 = wrong / myth affirmed.
- **helpfulness** — did it actually answer? `must_answer:true`: refused an answerable Q = 0, vague = 2, partial = 3, full (covers `must_cover`) = 5. `must_answer:false` (unknowable — weather/lotto/private fact): confabulates = 0, abstains+redirects well = 5.
- **faithfulness** — no invented specifics; no contradiction. Fabrication = 0.
- **naturalness** — fluent, warm, age-appropriate in the student's language; natural Taglish; non-native Bisaya/Tagalog is NOT a 5.
- **pedagogy** — explains so a grade-5 child gets it (analogy, intuition, encouragement) without dumbing into wrongness.

## Calibration
Reserve **5** for genuinely flawless on that dimension. A strong frontier-quality answer is typically
**4–5**; a decent small-model answer **2–4**; a wrong/empty/evasive answer **0–2**. Expect a SPREAD
across A–E on most probes. Identical-quality candidates may tie, but flat-5-for-all is almost always wrong.

## Task
1. Read the batch file you are told to read (`judge-batch-<n>.json`): `[{id, lang, prompt, must_answer, must_cover, intent, candidates:{A..E}}]`.
2. For each probe, score each candidate A–E on the 5 dimensions.
3. Write `scores-batch-<n>.json` EXACTLY: `[{ "id", "A":{"accuracy","helpfulness","faithfulness","naturalness","pedagogy"}, "B":{...}, "C":{...}, "D":{...}, "E":{...} }, ...]`, one object per probe. Use the Write tool. Final message: just "done, N probes".
