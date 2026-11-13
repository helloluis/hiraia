# Full-stack journey (wave 3)

Scripted headless-browser walk at 360 px against the **production build** (`next build` + `next start`, temp
`TALA_DB_PATH`), two runs:

- `fallback/` — server LLM routes off (`TALA_LLM_ROUTE_LESSON_GENERATE=off`, `…_REGENERATE=off`,
  `TALA_LLM_ROUTE_COMMUNITY_MODERATE=off`): proves the pre-filled-template fallback and rule-only moderation.
- `live/` — one live generation through the gateway with Qwen as the fallback provider (`qwen-flash`); no DeepSeek key,
  so the primary is skipped. At most one live call per run.

Steps: register → verify email via the local outbox → one-tap sample class → This Week (Grade 2 + Grade 4 paced
multigrade timeline) → open a "no plan yet" slot → generate → edit a section → lock → PDF sheet → post (the sample
class correctly refuses; a real class set up through the wizard posts) → second account finds, copies and modifies
it → roster import of a pasted list with the review step → mark a no-class day and apply the realignment → sign out.

`results-<mode>.json` records pass/fail per step with console errors. Screenshots use fixture data only
(sample learners are fictional; emails are `journey*@example.com`). No secrets appear anywhere in this folder.
The script lives outside the repo (`/tmp/tala-smoke/journey.mjs` on the dev box) because it depends on the
monorepo's Playwright install; it is reproduced in `JOURNEY.md` for reference.
