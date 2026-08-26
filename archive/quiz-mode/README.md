# Quiz mode — archived 2026-08-25

A full-screen "yellow legal pad" practice quiz, opened from the chat header: topic prompt →
5 questions on a 15s timer → score, with the round appended back into the chat thread. Zero
model in the loop; every question was pre-verified bank data.

## Why it was archived

Nothing in the current design points at it. The card feed's interject now asks about a fact
the kid *just read*, in the place they already are, which covers the same ground better than
a separate mode you have to go and find.

It was also unreachable twice over. Of its 1,567 bundled questions, **969 were tied to facts
that never became cards** — so even if the mode were reopened, most of its content could not
be reached by the feed's design either. And it cost **2.2 MB in every APK** for a feature with
no entry point.

## What was removed

- `QuizOverlay.tsx`, `quizStore.ts`, `data/quiz.ts`, and the bundled `quiz-bank-sample.json`
- the pill button in `ChatHeader.tsx` and the overlay branch in `app/(tabs)/chat.tsx`

`localize()` and the `Tri` type moved to `packages/mobile/src/data/tri.ts` — VERBATIM. The
card feed's `QuestionPage` needed only that one function, and importing it from `quiz.ts`
dragged the 2.2 MB sample into the bundle. Unwiring the UI alone would not have dropped it.

## To restore

Move these files back under `packages/mobile/src/` (`QuizOverlay.tsx` → `components/`,
`quizStore.ts` → `store/`, `quiz.ts` + the sample → `data/`), re-point `quiz.ts` at
`./quiz-bank-sample.json`, and re-add the two wiring points above. `chatStore.addQuizRecap()`
was deliberately left in place, so the recap path still exists.

Regenerating the sample from the current bank is the better option: see
`rag/pipeline/assemble-quiz-v2.py` for the v2 records, which are 3-option and much shorter.
