# Movement, next-step cues and the AI waiting state (27 Nov 2026)

Luis's request (Beaniebot thread ddb4d22d, rq_ejzaibn8, 27 Nov 2026 12:29 Manila): add interface flourishes so the app
feels sophisticated and professional, with no change to the text content. He named three: a transition when moving
blocks in the lesson plan timetable, floating arrows that fade in to show where to go next and fade out after a second
or two, and a working animation with reassuring captions while AI drafts a plan.

Owner of this work: Fable 5.2 task `b11-dev:b3a74512` (movement and polish only). Branch `tala-v1-motion`, cut from the
release owner's integration branch `tala-v1-lesson-feedback`. **Not pushed, not deployed.** It is merged and released
only by the Tala release owner (`b11-dev:12af59a8`) under the usual approval.

## What a teacher sees

1. **Moving a time block or a step is drawn.** Pressing a block's arrow used to swap the cards in one frame while the
   browser scrolled the page by the block's height, so nothing appeared to move. Now the block she pressed stays under
   her finger and the rest of the timetable flows around it in about a third of a second. The Session Flow bar's
   segments glide to their new places, and the moved block and its segment are ringed for a moment. Keyboard focus stays
   on the block's arrow; when that arrow is switched off at the top or the bottom, the other arrow takes it.
2. **A small arrow shows the next step.** When a screen's one next step becomes possible, a small arrow fades in beside
   that control, nudges twice towards it and fades out, 1.8 seconds in all. When the control is further down or up the
   page the arrow waits at that edge of the screen and points the way. Placed in three spots: "Make the draft" on the
   Draft page (it is below the fold on a desktop and on a phone), "Write a plan" on This Week's next lesson, and Lock
   once a lesson can be locked.
3. **While Tala writes, the page says where the request is.** A calm bar and mark run while the request is open. One
   line follows the request's own state (being sent, being written, or waiting in line when another draft really is
   ahead of it) and the time really waited is shown. After 20, 45 and 75 seconds the line changes to a reassurance,
   then to "longer than usual" with what she can do. With no connection it says so and stops claiming movement.
4. **Small things.** Sheets and toasts arrive over a fifth of a second instead of popping in. A part that an AI rewrite
   has just replaced has its card ringed for a moment. Grey loading rows breathe. Hover and press colours change over a
   blink.

## Rules it keeps

The PRD asks for little motion (SIMPLE-12: no decorative animation, reduced motion honoured) and says no animation may
delay an action on a slow phone. So:

- Every movement explains a change the teacher just made or is waiting for. Nothing loops except the working bar, and
  only while a request is really open.
- The new state is already there when a movement starts. Nothing waits for an animation, and a second press during a
  movement continues from where the first had got to.
- What travels uses transform and opacity. The two exceptions are the timeline bar's segments (left and width, inside a
  36-pixel bar) and the page scroll that keeps a moved block in place.
- **Reduced motion** switches all of it off and each piece keeps a still alternative: the new order with a still ring;
  the arrow standing still for the same 1.8 seconds; a full pale bar while Tala writes, with the words and the time
  still updating.
- Nothing here is announced more than once: a move says the block's new place once, with words the interface already
  has ("Time block 2"); the waiting line changes a handful of times per request; the arrow, the bar and the ticking
  time are hidden from screen readers.
- No new dependency. The walk needs no new tool beyond those already used by the other walks.

## The parts (for whoever builds on them)

All under `packages/tala-web/src/components/motion/`.

| Part | Use |
|---|---|
| `useReorderMotion(ids)` | A list reordered with arrow buttons. Call `motion.before({ id, direction, announce })` in the handler right before the change of order; spread `motion.item(id)` on each item and `motion.control('up' \| 'down')` on a wrapper of each arrow. It only reads where items are drawn before and after React has reordered them. `reorder.ts` holds the arithmetic. |
| `<NextStepCue show cueKey prefer>` | Wrap the one control that is the next step. `show` is a state of the screen. It is placed only where it covers no words, no picture and no other control; otherwise it is not shown. Once per visit to the app, three times in all per device. `next-cue.ts` holds the geometry and the memory. |
| `<AiStatus phase startedAt label onCancel canBackground reachable>` | The waiting state. `phase` is `'sending'` until `generation.create` answers, then the job's own status while it is `'queued'` or `'running'` (pass `'queued'` as soon as the job says so). The caller removes it when the request ends. `ai-status.ts` decides the words; it says "waiting in line" only once the phase has been `'queued'` for a second and a half. |
| `useJustChanged(signature, settled)` | True for a moment after a value was replaced from outside; the caller marks its own edits with `mine(...)`. It starts watching with the first settled value, so a screen that opens marks nothing. |
| `prefersReducedMotion()` | Asked by anything moved from script; the base stylesheet's rule cannot reach it. |

Styles are one block at the end of `src/app/globals.css` ("Motion (27 Nov 2026)"): one curve (`--tala-ease`), three
speeds, the keyframes, and the rules above.

## Text added

Nine lines, in one block at the end of `src/i18n/en.ts` and `fil.ts`. The Filipino wording is the Filipino owner's
(bridge 74372ed4: four kept as drafted, five reworded). No existing line was changed.

| Key | English | Filipino |
|---|---|---|
| `ai.status.sending` | Sending your request… | Ipinapadala ang kahilingan mo… |
| `ai.status.queued` | Waiting in line. Tala starts yours when the one before it is done. | Nakapila ang kahilingan mo. Sisimulan ito ng Tala kapag tapos na ang nauna. |
| `ai.status.running` | Your request arrived. Tala is writing now. | Natanggap na ang kahilingan mo. Nagsusulat na ang Tala. |
| `ai.status.still` | Still writing. Nothing in your lesson changes until it is ready. | Nagsusulat pa ang Tala. Wala itong babaguhin sa aralin mo habang ginagawa ang draft. |
| `ai.status.longer` | Still working. Thank you for waiting. | Ginagawa pa rin ang draft. Salamat sa paghihintay. |
| `ai.status.slow` | This is taking longer than usual. You can keep waiting or cancel. | Mas matagal ito kaysa karaniwan. Puwede kang maghintay pa o kanselahin ito. |
| `ai.status.slowBackground` | This is taking longer than usual. You can keep waiting, or let it finish in the background. | Mas matagal ito kaysa karaniwan. Puwede kang maghintay pa o magpatuloy sa ibang gawain habang ginagawa pa rin ng Tala ang draft. |
| `ai.status.offline` | No connection right now. Tala will keep checking. | Walang koneksyon ngayon. Patuloy na titingnan ng Tala kung bumalik na ang koneksyon. |
| `ai.status.elapsed` | {time} so far | {time} na ang lumipas |

"Waiting in line" is said only when it is true. The server writes one draft at a time, and it reports every new
request as queued for an instant, even with nothing ahead of it; the page hears "running" about a second later. So
the line is shown only once a request has been queued for a second and a half (`QUEUE_SHOWN_AFTER_MS`), which happens
only when another draft is being written. Until then the page goes on saying the request is being sent. If the
server ever writes several drafts at once, that line and this rule change with it.

## Changes that are not movement

Wiring the waiting state to the real request showed four behaviours of the Draft page that were wrong on `e2534953d`.
They are fixed in `features/generate/GenerateScreen.tsx` only (commit "asking again after a cancel or a failure is a new
request…"), each measured before and after with the real server and a stand-in model:

- Cancel, then "Make the draft" again: the page was handed the cancelled job back and made no new request. Each attempt
  now has its own request key (re-sends of one attempt still share it, so a lost reply is charged once).
- "Queue it" after "the writing service is not answering": the queue was handed the old failure back without asking
  the model. A finished attempt is now queued as a new request.
- Cancel pressed before the server's answer arrived cancelled nothing on the server. The attempt's key now finds the
  job and cancels it.
- Leaving the page while Tala writes: the closed page kept waiting, wrote the draft and pulled the teacher back to the
  lesson from wherever she was; closing the tab lost the finished draft. The request is now handed to the device queue
  (the call "Run in background" makes) and the background runner writes it once.

Three more were found the same way and fixed by the release owner in its own files: "Saved" shown after a failed local
save; a full draft thrown away when one part had the teacher's own text; a queued draft that was paid for and never
written because the pre-filled template counted as her text. The Draft page uses the owner's `applyDraft` for those.

## Files touched outside `src/components/motion/`

| File | Whose | What |
|---|---|---|
| `features/editor/SectionEditors.tsx`, `FlowTimeline.tsx` | this task | reorder movement, timeline segments, the ring on a part that just changed |
| `features/generate/GenerateScreen.tsx` | this task | `<AiStatus>`, the cue, the four request fixes, `applyDraft` |
| `app/globals.css` | this task (additive block) | all motion styles |
| `i18n/en.ts`, `i18n/fil.ts` | shared | the nine lines above, at the end |
| `components/ui.tsx` | release owner (agreed) | two attributes, no behaviour: `data-sheet` on the Sheet dialog, `data-toast` on the Toast |
| `features/editor/EditorScreen.tsx` | release owner (Lock agreed; the prop reported at hand-over) | `<NextStepCue>` around Lock; one prop on the section editor, `settled={Boolean(rec)}`, so the ring never shows when a lesson opens |
| `features/week/WeekParts.tsx` | worker W (agreed) | `<NextStepCue>` around "Write a plan", optional `cue` prop on `LessonBlock` |
| `scripts/motion-walk.mjs` | this task | the browser walk |

Still for the release owner: swap `<AiStatus>` into `features/editor/RegenSheet.tsx` (its file) in place of `<Waiting>`.

## How to check

```bash
# unit tests (pure parts: reorder arithmetic, cue geometry and memory, waiting-state words)
cd packages/tala-web && pnpm test

# the browser walk, on a LOCAL production build, signed in as an invented teacher
tsx scripts/motion-walk.mjs seed       http://127.0.0.1:PORT <out> --db <TALA_DB_PATH>
tsx scripts/motion-walk.mjs reorder    …   # frame by frame: movement, identity, focus, persistence
tsx scripts/motion-walk.mjs reduced    …   # prefers-reduced-motion
tsx scripts/motion-walk.mjs cue        …   # where the arrow sits, how long, what it never does
tsx scripts/motion-walk.mjs surfaces   …   # sheets, toasts, the ring after a rewrite
tsx scripts/motion-walk.mjs ai-standin …   # the waiting state against the real server with a STAND-IN model
tsx scripts/motion-walk.mjs ai-real    … --real   # two real drafts with the server's real provider
tsx scripts/motion-walk.mjs record     …   # recordings (WebM; GIF with FFMPEG_PATH and SHARP_PATH)
```

`--label before` runs the same instrument on a build without this work and records what it finds as notes.
`--only A,L` runs chosen scenarios or clips of a phase. Run the phases in the order above on a freshly seeded account:
the `surfaces` phase rewrites the Procedure lesson with the stand-in, after which that lesson is an AI draft.

A recording or a still is evidence only of what is in it. Each arrow clip checks that the arrow was drawn while it
recorded, and the arrow stills are taken while the arrow is on screen; look through the frames before publishing
anyway (three files were wrong before those checks existed).

The stand-in model: the server is started with its lesson route on its "local model" setting, pointing at a loopback
address that the walk answers (`TALA_LLM_ROUTE_LESSON_GENERATE=local`, `TALA_LLM_LOCAL_ENDPOINT`, prompt version 1).
The request, the job, its states, the time-out, the cancel and the browser are the real ones; only the model's answer is
simulated, and every check from that phase says so.

## Results

**Preview published 27 Nov 2026 through the report relay (unlisted links, expiring 4 Dec 2026).** The address of the
index page is in the hand-off message to the release owner and in the report to Luis; it is not written here because
the page is reachable by anyone who has the address.

That page lists 57 files: recordings (GIF and WebM), screenshots and the raw result files. Checked after
publishing: the page answers HTTP 200 over HTTPS and contains all 57 links; 57 of 57 files
come back over HTTPS with exactly the bytes of the local file, both when asked plainly and when asked as a browser asks
for a page. The page itself is the relay's rendering of the report text, not a copy of a local file. It was also opened
in the pinned browser at desktop and phone width (no sideways scroll; a GIF opens as an image, a WebM as a video). The
relay's pages allow no inline images, so the recordings are links.

### Before and after

The same walk on the build before this work and on the final build; every figure is read from the two runs' files.

| What a teacher does | Before (`0f7b8b38b`) | After (`c6b5967d5`) |
|---|---|---|
| Moves a time block up, desktop, mouse | the cards swap in one frame (0 frames in between) while the page jumps 678 px | 20 frames in between over 367 ms; the block she pressed strays 0.00 px from the pointer |
| Moves a block down on a phone, by touch | the block she tapped lands 934.00 px away from her finger | it stays under her finger (0.00 px) and the rest moves |
| Moves a block to the top with the keyboard | keyboard focus is lost (the focused element is the page itself: BODY) | focus passes to “Move block 1 down”, so she can go on with the same block |
| Presses “move down” twice quickly on Grade 5 | the second press lands on another block, which has jumped under the pointer. Order afterwards: Opening song and review / Grade 5 with the teacher / Grade 4 with the teacher / Wrap-up and sharing | both presses move the same block. Order afterwards: Opening song and review / Grade 4 with the teacher / Wrap-up and sharing / Grade 5 with the teacher |
| Moves a step in the Procedure | one frame; the step she pressed lands 258.00 px away | 14 frames over 250 ms; it strays 0.00 px |
| Opens a sheet; gets a toast | both are simply there (0 ms) | the sheet rises 14 px and fades in over 150 ms; the toast over 150 ms |
| Waits for a draft (STAND-IN MODEL) | one line that never changes, nothing moving: “Writing the draft… this usually takes under a minute.” with a Cancel button; animations running on the page: 0 | the line follows the request (being sent, then being written; “waiting in line” only when another draft really is ahead), the bar moves (55 frames: 55 bar positions, 41 mark levels) and the time waited is shown (0:00 so far → 0:04 so far) |
| Cancels a draft, then asks again (STAND-IN MODEL) | no new request is made; the page says “Draft cancelled” again (jobs on the server: [{"status":"cancelled","reason":null}]) | a new request; the draft arrives (jobs: [{"status":"cancelled","reason":null},{"status":"done","reason":null}]) |
| Presses “Queue it” after a failure (STAND-IN MODEL) | the model is never asked (model calls after “Queue it”: 0); the old failure is shown in the lesson | model calls after “Queue it”: 1; the draft is written into the lesson |
| Leaves the Draft page while Tala writes (STAND-IN MODEL) | she is pulled back to the lesson (she was on: /week, /lessons/mw-mwym24qk-003m) | she stays where she went (she was on: /week); the draft is in the lesson when she opens it |
| Arrives at the Draft page on a desktop | the only main button is below the fold and nothing points to it (button below the fold: true; arrow: false) | an arrow at the bottom edge points down to it: at 710 ms, edge pointing down, on screen 1783 ms (108 frames), nudged 6 px, opacity 0 → 1 → 0 |

### The checks

Local production builds (clean exports, built the way the host builds). Nothing was deployed.

- Everything below ran on commit `c6b5967d5`, the last commit that changes the app, unless a line names another commit.
- The real AI provider was used within an allowance agreed with the release owner: four full drafts (three at first, a fourth allowed for the final build) and six part rewrites. One draft ran on the final build `c6b5967d5`, one on `1d86555e0` and two on `25cbcc28e`; the release owner’s lesson walk made two part rewrites on `25cbcc28e`.
- What changed in the app after those earlier real runs. After `25cbcc28e`: the ring around a just-rewritten part goes around the whole card and no longer shows when a lesson opens; the arrow waits for a still control and leaves if the control moves; a page the browser keeps for “back” keeps its own request. After `1d86555e0`: “Waiting in line” is said only when a request has really waited (below). So the recordings from the two earlier commits still show that line for about a second at the start of a draft; the final build does not.

| What was checked | Passed | Failed |
|---|---|---|
| Moving blocks and steps (mouse, touch, keyboard; desktop, phone, foldable; English and Filipino) | 41 | 0 |
| Reduced motion | 15 | 0 |
| Next-step arrow | 31 | 0 |
| Sheets, toasts, the ring after a rewrite | 12 | 0 |
| Waiting state against the real server with a STAND-IN model | 35 | 0 |
| Recordings made (each arrow clip also checks that the arrow was drawn) | 15 | 0 |
| One real draft with the REAL provider, on the final build | 4 | 0 |
| One real draft with the REAL provider, on `1d86555e0` | 4 | 0 |
| Two real drafts with the REAL provider, on `25cbcc28e` | 6 | 0 |
| **Browser checks in all** | **163** | **0** |

A correction to three check names in the result files. They count lines of the waiting state loosely (“3 lines in all”, “four lines in all”, “(3 lines)”): the page’s log has an entry for the instant the job is reported queued, when the words on screen do not change. What a screen reader hears is in the logs printed beside them: two lines on an ordinary draft (being sent; being written) and five over the 80-second wait. The walk now counts them that way.

**Found by looking at the recordings, and corrected before this run.** Before publishing, the recordings and stills were looked through (sheets of frames from every clip, frame-by-frame strips of the moves and the arrows). That found four things. The complete run above was made after all four were corrected.

- In the app: on every draft the page said “Waiting in line. Tala starts yours when the one before it is done.” for about a second, with nothing before it. The server reports every new request as queued for an instant, and the page repeated that. It now says the line only once a request has been waiting for a second and a half, which happens only when another draft really is being written. Checked both ways against the server’s own job table.
- In the walk: the clip “the arrow points up to Lock” had no arrow in it. Its lesson had been touched by an AI rewrite earlier in the walk, and for a lesson marked “Drafted by AI. Read it through and edit before locking.” the arrow to Lock is withheld on purpose. The clip now has its own lesson, and each arrow clip fails unless the arrow was drawn while it recorded.
- In the walk: two stills of the arrow had been taken after the arrow had gone. They are now taken while it is on screen, and a check says so.
- In the walk: stills of the real-provider wait could catch a line while it was still fading in. They now wait for it.

**The release owner’s own walks** (to look for regressions in the six Lesson Plan items and the curriculum screens):

| Walk | On `c6b5967d5`, no AI provider | On `25cbcc28e`, real provider first, then invalid keys |
|---|---|---|
| lesson-layout | 20/20 checks passed (success) | not run |
| lesson-failure | 6/6 checks passed (failure) | 6/6 checks passed (failure) |
| lesson-savefail | 5/5 checks passed (savefail) | 5/5 checks passed (savefail) |
| slides-seed | 1/1 checks passed (seed) | 1/1 checks passed (seed) |
| weekend | 51/51 checks passed | 51/51 checks passed |
| english | 34/34 checks passed | 34/34 checks passed |
| langshs | 33/33 checks passed | 33/33 checks passed |
| multigrade | 19/19 checks passed | 18/19 checks passed |
| lesson-success-REAL | not run | 33/33 checks passed (success) |
| lesson-queued | not run | 5/5 checks passed (queued) |

`lesson-layout` is the same walk as `lesson-success-REAL` without its two real rewrites. `lesson-queued` needs those rewrites first, so it only runs in the right-hand column.

Not run by this task: the slides walks that ask the real model to write slides (the release owner runs them when it merges).

The one `multigrade` failure in the right-hand column (18/19: “three grades: three turns in one session”) was not seen again: run 15 more times on its own, the same walk passed every check every time (the build before this work: 5 of 5 runs passed every check; `25cbcc28e`: 5 of 5 runs passed every check; `1d86555e0`: 5 of 5 runs passed every check). The walk reads the page as soon as the Session Note label shows, which can be a moment before the time blocks are on screen. That is this task’s reading of the one failure, not something it reproduced, and it was reported to the release owner as such.

**Unit tests on the branch** (at `a86c7831d`): tala-core 326 of 326; tala-server 376 of 377 (1 skipped); tala-web 169 of 169. Type-check of the web package: clean.

One earlier run of the server tests, made while another job was loading this four-core machine, had 1 failure: the upload worker’s time-limit test (`uploads-hostile.test.ts`, “a file that takes longer than is allowed is stopped… the next file is read as ever”), which measures real time. This branch changes no file of the server or core packages. The counts above are from a run made with the machine otherwise idle.

**The real provider, exactly what was used and seen:**

- on `c6b5967d5` — REAL PROVIDER, a single-grade lesson: the waiting state followed the real request (3 lines) and was taken away when it ended, after 5.1 s: 0.0 s sending/sending “Sending your request…” → 0.1 s queued/sending “Sending your request…” → 1.1 s running/running “Your request arrived. Tala is writing now.” → 4.9 s gone
- on `c6b5967d5` — REAL PROVIDER: what this draft used: 1 model call; 2431 tokens in, 727 out; US$ 0.00160 by the server's own price table; jobs: [{"status":"done","kind":"full","provider":"deepseek","model":"deepseek-flash","reason":null}]
- on `1d86555e0` — REAL PROVIDER, a single-grade lesson: the waiting state followed the real request (3 lines) and was taken away when it ended, after 5.2 s: 0.0 s sending/sending “Sending your request…” → 0.1 s queued/queued “Waiting in line. Tala starts yours when the one before it is done.” → 1.1 s running/running “Your request arrived. Tala is writing now.” → 4.9 s gone
- on `1d86555e0` — REAL PROVIDER: what this draft used: 1 model call; 2430 tokens in, 749 out; US$ 0.00163 by the server's own price table; jobs: [{"status":"done","kind":"full","provider":"deepseek","model":"deepseek-flash","reason":null}]
- on `25cbcc28e` — REAL PROVIDER, a single-grade lesson: the waiting state followed the real request (2 lines) and was taken away when it ended, after 8.5 s: 0.0 s sending/sending “Sending your request…” → 0.1 s running/running “Your request arrived. Tala is writing now.” → 8.3 s gone
- on `25cbcc28e` — REAL PROVIDER, a multi-grade session: the waiting state followed the real request (3 lines) and was taken away when it ended, after 4.9 s: 0.0 s sending/sending “Sending your request…” → 0.1 s queued/queued “Waiting in line. Tala starts yours when the one before it is done.” → 1.1 s running/running “Your request arrived. Tala is writing now.” → 4.9 s gone
- on `25cbcc28e` — REAL PROVIDER: what these two drafts used: 2 model calls; 5327 tokens in, 1340 out; US$ 0.00321 by the server's own price table; jobs: [{"status":"done","kind":"full","provider":"deepseek","model":"deepseek-flash","reason":null},{"status":"done","kind":"full","provider":"deepseek","model":"deepseek-flash","reason":null}]

Server usage table on `25cbcc28e` (the two drafts, the two part rewrites of the release owner’s lesson walk, and then that walk’s failure checks with invalid keys on the same data): `{"n":10,"cost":0.05083,"i":9870,"o":1437} by feature [{"feature":"lesson.generate","provider":"deepseek","n":2,"cost":0.00321,"i":5327,"o":1340},{"feature":"lesson.regenerate","provider":"deepseek","n":5,"cost":0.02455,"i":4543,"o":97},{"feature":"lesson.regenerate","provider":"qwen","n":3,"cost":0.02307,"i":0,"o":0}] jobs [{"kind":"full","status":"done","n":2},{"kind":"section","status":"done","n":2},{"kind":"section","status":"failed","n":3}]`

Of those rows, answered by a model: `{"n":4,"cost":0.00469,"i":9870,"o":1437}`. The rest are the amounts the server sets aside before each call, left in the table by calls made with invalid keys that no provider answered: `{"n":6,"cost":0.04614}`.

Server usage table on `1d86555e0` (the one draft): `{"n":1,"cost":0.00163,"i":2430,"o":749} by feature [{"feature":"lesson.generate","provider":"deepseek","n":1,"cost":0.00163}] jobs [{"kind":"full","status":"done","n":1}]`

Server usage table on `c6b5967d5` (the one draft): `{"n":1,"cost":0.0016,"i":2431,"o":727} by feature [{"feature":"lesson.generate","provider":"deepseek","n":1,"cost":0.0016}] jobs [{"kind":"full","status":"done","n":1}]`

5 server logs (every run that had the real keys, and the stand-in and invalid-key runs made beside them on `25cbcc28e`) were searched for anything that looks like a key: 0 lines.


## Not done

- Two things seen in the recordings predate this branch and are the release owner's (logged by it as follow-ups):
  the Draft page shows raw competency ids for a few tenths of a second while curriculum packs load, and an account set
  to English sees the shell in Filipino for an instant after a full reload.
- The section rewrite sheet and the slides AI still show the old one-line waiting state until the release owner swaps
  `<AiStatus>` in.
- The roster list and the slide lists are also reordered with arrows; `useReorderMotion` fits them, but they are outside
  this task.
- Checked in Chromium only (the pinned headless build). Firefox and Safari were not run; the movement asks nothing they
  lack, and without it they fall back to the plain change.
- Exit movements were left out on purpose: a sheet closes and a removed block goes at once, because holding them on
  screen would delay the action.
