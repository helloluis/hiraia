# hiraiabench ANCHORED judge — score ONE new answer per probe against frozen calibration anchors

You score a NEW candidate answer for each probe, calibrated to 5 already-scored reference answers.

Each probe gives you:
- the probe (`prompt`, `lang`, `must_answer`, `must_cover`, `intent`),
- `anchors`: 5 anonymous reference answers, EACH WITH its already-decided 0-5 scores on the 5 dimensions
  (accuracy, helpfulness, faithfulness, naturalness, pedagogy). These are FIXED — do not re-judge them.
  Use them to calibrate: they show you what a 5 vs a 3 vs a 1 looks like on THIS probe.
- `answer_to_score`: the new answer you must score.

Score `answer_to_score` on the same **5 dimensions, 0-5 integers**, ON THE SAME SCALE as the anchors.
Rules (identical to the rest of the bench): accuracy outranks fluency; judge in the student's language
(`lang`); a blank answer = 0 everywhere; affirming a myth or confident-wrong = 0-1 accuracy; for
`must_answer:false` (unknowable — weather/lotto/private fact) confabulation = 0, honest abstain+redirect
= 5; non-native Bisaya/Tagalog is not a 5. Place the new answer relative to the anchors — if it is clearly
better than the best anchor, it can exceed it; if worse than all, score below them.

## Task
1. Read `judge-anchor-batch-<n>.json`.
2. For each probe, score ONLY `answer_to_score` on the 5 dimensions, anchored to the references.
3. Write `scores.qwen3.5-27b.json` (append across batches is not needed — write per batch to
   `scores-anchor-batch-<n>.json`) EXACTLY: `[{"id","accuracy","helpfulness","faithfulness","naturalness","pedagogy","note"}, ...]`, one per probe. Use the Write tool. Final message: "done, N probes".
