# Curriculum review series

The ordinary feed combines short checks with longer reviews:

- One standalone question about every five ordinary cards, returning directly to the
  feed after its answer feedback. This uses the same persisted quiz history and does
  not reset the checkpoint window. Topics with fewer than 20 cards receive at most
  two standalone questions before their closing review; the third round is skipped.
- A three-question checkpoint after 20 distinct newly viewed cards in the active
  profile/grade. Previews and cards hidden behind a review do not count.
- A topic recap of 3–5 questions on leaving the last card of a curriculum topic.
  Small pools produce shorter sets. Coincident checkpoint/topic triggers produce
  one recap, not two. Recaps reset the checkpoint window.
- One question at a time, existing explanation after each answer, then a summary
  separating first attempts from repeats. Standalone questions skip that extra summary.
- Encouraging recap cards every 15–25 ordinary cards, once at least three distinct
  card titles are available. These use localized templates when no model is loaded.

Selection uses bundled quizzes for cards the student saw. It prefers different
competencies and ideally two unasked questions plus one spaced repeat, prioritizing
previously missed answers. Correct answers can also occupy the repeat slot. No duplicates
within or across pending sets. Repeats become eligible after five intervening card
views; correct answers can also return after three days, when those cards are again
in the review scope. If a suitable repeat is unavailable, new questions fill the set. This is a small scheduling policy, not a mastery claim.

Each attempt stores its question snapshot, option permutation, selected answer,
and stable telemetry ID. Resuming preserves the permutation; a later attempt draws
another one. Canonical answer identity determines correctness. Answer writes finish
before grading events and counters are emitted. Duplicate submissions are ignored.

Review later preserves the unfinished set and lets the student continue; it is offered
again after five card views. Closing and reopening during an active review restores
it. The current topic is tracked separately from the next-topic cursor so the recap
and visible ribbon refer to the topic actually read.

State lives under cards.reviews.v1.<grade> in the existing profile-specific SQLite
settings database. There is no time-based pruning: seen-card coverage, unfinished
sets, and per-question first/latest/cumulative results survive the school year unless
app data is cleared. It uses no model and no network. Existing offline telemetry
carries quiz shown/submitted/graded events with stable attempt IDs.

Validation commands:

    node --import tsx --test packages/mobile/scripts/review-series.test.mts packages/mobile/scripts/review-persistence.test.mjs packages/mobile/scripts/curriculum-default.test.mts
    node node_modules/typescript/bin/tsc --noEmit -p packages/mobile/tsconfig.json

Scheduler tests cover trigger collision, missing quizzes, topic scope, variety,
retries, answer identity, deferral, and serialization. Controller tests cover real
save/load behavior, profile/grade isolation, restart, write failure/retry, and duplicate
grading. Topic accuracy still depends on the ongoing curriculum-tag audit.

## Learning history, awards, and reinforcement

The feed retains the most recent 30 displayed fact cards and answered review questions for
the current app session. A downward swipe walks backward; left, right, or up walks forward
toward the live feed. Active review questions remain locked, while historical questions are
read-only and print the saved option order, selected answer, correct answer, and explanation.
History navigation never records another view or quiz grade.

Completing a topic recap records a profile- and grade-local award for that curriculum topic.
Completion earns one star, at least 60% earns two, and at least 80% earns three. The Calendar
prints the best award beside each completed topic; the footer aggregates the best completed
topic results into an overall 1–3-star mark.

A missed review question queues its source fact card for one deliberate repeat in the next
ordinary feed run. The queue persists across restart and is consumed when that card lands.
A later correct answer for the same source card clears an outstanding repeat. This remains
same-level reinforcement. Strict-majority topic failures can also start the silent cross-grade
support loop documented in `docs/SUBCATEGORY-REGRESSION.md`.
