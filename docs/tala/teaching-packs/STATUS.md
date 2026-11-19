# Tala rework: prebuilt Science teaching packs — task status

Owner: Paseo agent `0a1a3e5f` ("Tala rework: prebuilt science teaching packs + illustrated PPTX"),
Claude Opus 5.5. Started 2026-11-19 01:45 UTC (09:45 PHT). Requested by Luis via Beaniebot thread
`e3152c3c-5bd6-4cd6-8593-d0ba681def48`.

## Ownership check (2026-11-19 01:47 UTC)

- No other Paseo agent (active, idle, errored or archived, last 30 days) owns this rework. Prior Tala V1 agents
  (orchestrator `8bcea9e`, workers B–H, P, T) have been idle since 2026-11-14 and owned the V1 build, not this.
- `tala-v1` worktree (`/home/b11/code/tala-v1`) was clean at `53ae53b1d`; local `tala-v1` is 85 commits ahead of
  `origin/tala-v1`. Live site runs tag `tala-v1-demo.9` (`4aa7187c5`, 2026-11-14).

## Workspace and scope

- Branch `tala-v1-packs`, cut from local `tala-v1` at `53ae53b1d`; worktree `/home/b11/code/tala-wt/packs`
  (sparse: same set as `tala-v1` plus `packages/tala-packs/`). Nothing is pushed, merged, deployed or published
  to production by this task. `main`, `tala-0.4.x`, `packages/tala/**`, `packages/mobile/**` are untouched.
- Paths this task owns on the branch: `packages/tala-packs/**` (new), `docs/tala/teaching-packs/**` (new),
  `packages/tala-core/src/contracts/packs.ts` (new) plus additive route entries in `contracts/api.ts`,
  `packages/tala-server/src/modules/packs/**` (new) plus one line in `modules/index.ts`,
  `packages/tala-web/src/features/library/**` and `src/app/library/**` (new), and wording/navigation edits in
  `packages/tala-web` (landing copy, i18n strings, shell navigation). PRD/ARCHITECTURE notes in `docs/tala/`.
- Never committed: `pnpm-lock.yaml`, the tracked `packages/tala-core/node_modules/.bin/*` shims pnpm rewrites,
  any `.env`. Provider keys are read at runtime from the ignored `packages/tala-server/.env` of the `tala-v1`
  worktree; no credential file is copied.

## Decisions taken (reversible; Luis can override)

| # | Decision | Basis |
|---|---|---|
| 1 | A weekly pack = **5 daily lessons of 45 minutes**, with notes for 50/55/60-minute periods. | DO 010 s. 2024 Tables 3, 5, 6 (Science 45 min, 5× a week, Grades 3–10); DO 012 s. 2024 §2.a (flexible 50/55/60-min periods, Science still 5× a week, ≥225 min/week). The 2026 BOWs give weeks, not daily allotments. Carry-over into the SY 2026–2027 three-term calendar (DO 009 s. 2026) is assumed, not verified from the order's full text. |
| 2 | Day plans use the MATATAG procedure: Activating Prior Knowledge → Establishing Lesson Purpose → Developing and Deepening Understanding → Making Generalizations → Evaluating Learning. | MATATAG training deck and pilot exemplars (2024). |
| 3 | **Every pack in English and Filipino** (Luis, 2026-11-19 03:02 UTC: "The slides need to be generatable in Filipino as well"). Same competencies, timing, lesson structure, slides and drawings in both; text written per language; review status kept per language. The Filipino edition is composed from the checked English lesson by a separate model call instructed to write natural classroom Filipino, not translate line by line; its structure is copied from English, never taken from the model. Official DepEd competency text stays verbatim (English) in both. Cebuano is never generated. | Luis; Beanie relay; project rule on Cebuano. |
| 3a | **Learner-facing Filipino is child-readable Taglish, following the Hiraia student app's existing wording rules** (Luis, 03:22 UTC: "basic enough for grade school kids… Taglish is allowed… roughly follow the Hiraia app's verbiage rules with the slides too"). Rules are cited from their source files in `VERBIAGE-RULES.md`; `src/verbiage.ts` measures them on every slide and the result is stored in each language's `review.json`. Teacher-facing text stays plain but complete. | Luis; Beanie relay. |
| 4 | **Model tiers** (Luis, 03:02 UTC: "Can this be DeepSeek v4.1 flash?" — yes; Beanie: stronger models allowed where reasoning matters, economise on volume, never OpenRouter). `deepseek-flash` (DeepSeek V4.1 Flash, direct API) writes the high-volume parts in both languages: day plans, slides, speaker notes. `deepseek-v4-pro` writes each week's design and teacher-guide science with reasoning (explanations, misconceptions, worked answers), the Filipino guide and assessment (no reasoning), and review patches (no reasoning). `qwen4-max` (Alibaba Model Studio direct, Singapore) is the independent critic per language. `qwen3-vl-plus` checks every illustration against its slide. | Luis; Beanie; PRD §9.1, §9.8. |
| 5 | Review stages are recorded separately and never merged: `auto_checks` (deterministic) → `model_critique` (a second model; **not** human review) → `teacher_review` / `expert_review` (named humans only) → publication (`approved` only by Luis or a reviewer he names). The public library lists only approved packs; drafts are visible only to reviewers and in non-production environments. | Brief §5. |
| 6 | Illustrations come only from Hiraia's approved B&W card art, mapped per competency and checked; none are generated, regenerated or edited. Missing art is reported, not filled with clip art. **Licence closed (Luis, 2026-11-19: "License granted, we just need to watermark with the Hiraia brand-name"): Hiraia owns the drawings; decks embed a derived copy with the Hiraia wordmark in a white strip below the drawing (watermark `wm/1`, `src/render/watermark.ts`), so the mark never covers science content; the manifest records the approved file's hash and the derivative's.** | Brief §3; Luis. |
| 7 | Decks use Office-safe fonts (Cambria titles, Calibri body) instead of the Fraunces display face, so a downloaded deck renders the same offline on any school laptop. | Brief §4 (no online dependencies); PRD BRAND-4. |
| 8 | **Decks are genuinely editable by the teacher** (Luis, 2026-11-19: "The presentations we generate need to be editable by the actual teacher user"). All text is in text boxes, placeholders or text-bearing shapes (answer choices are one shape each); lists are native PowerPoint auto-numbering/bullets (no typed "1." or "•"); pictures are only the drawings and brand marks (largest ≈ 21% of a slide); fonts Cambria/Calibri; speaker notes on every slide. Audited per deck at build time (`editability/1`, `src/render/editability.ts`), recorded in each manifest and in INVENTORY.md. The drawings themselves are raster art (their few labels are not editable text); teachers can replace or delete them. | Luis; Beanie relay. |
| 9 | **Priority batch approved** (Luis, 2026-11-19: "That's fine, I'll budget for it"; Beanie: 102 weeks — Term 2 weeks 10–11 and Term 3 — at off-peak pricing, hard cap $90; the remaining weeks are not approved). Run as batch `priority-2026-11-19` with `--cap 90`: the cap is summed from ledger rows tagged with the batch (so it survives restarts) and counts the worst case of calls in flight; DeepSeek calls wait for off-peak and are priced at the rate in force per call. | Luis; Beanie relay. |

## waiting_for_user

Updated 2026-11-19 07:00 UTC. Luis answered the earlier items (verbatim): "1. Topped up 2. That's fine, I'll budget for
it 3. The presentations we generate need to be editable by the actual teacher user 4. License granted, we just need to
watermark with the Hiraia brand-name". Closed: DeepSeek balance (topped up; G7 T1 W6 Filipino finished), batch spend
(priority batch approved with a $90 cap — decision 9), illustration licence (decision 6), deploy (done, see below).

Still open, not blocking the batch:
1. **Human review**: a named Science teacher, and a Filipino reader for the Filipino editions, per pack. Until then
   every pack stays "draft / model-critiqued"; nothing is marked teacher- or expert-reviewed.
2. **The remaining weeks** (all 262 minus the priority 103) are not approved; the batch does not start them.

## Attempt history

- 02:20–02:29 UTC — first draft (G4 T1 W8): outline with reasoning OK ($0.15 incl. one repair for an enum spelling);
  a day call with reasoning spent its whole 16k budget reasoning and returned nothing → stopped; day calls moved to
  no-reasoning. Mechanical day failures (missing `day`, image as bare slug, phase spellings, flow bookkeeping) moved to
  a deterministic, logged normaliser.
- 02:36–02:52 — full English pipeline: Qwen critique found 19 real issues (carotid-pulse safety for children, exhaled
  air "is CO2", bile described as digesting, root/shoot defined by position); revision fixed them but one wrong-index
  patch wrote the root-system definition into the shoot-system entry → patches must now quote what they replace.
- 02:52 — render failures: pptxgenjs ESM default import; LibreOffice needed host libraries (cairo, cups, fontconfig,
  Xinerama…) → extracted from the exact Arch archive packages into `~/.local/opt/lo-libs` (no system change).
- 03:00 — a reasoning-mode revision used its whole 24k budget again → revisions run without reasoning. Run stopped
  for Luis's bilingual steer (03:02) and rebuilt.
- 03:14 — first bilingual run: Flash days failed on minutes summing to 40, over-tight text caps, and once a missing
  check/reveal pair → minutes rebalanced deterministically (logged), caps raised (readability is measured
  separately), and a third attempt allowed only when the failure changed.
- 03:26–03:41 — first full bilingual attempt (G4 T1 W8): English finished with **13 open critique issues after 3
  rounds**. Causes found in the logs: (1) the first revision answered 20 issues with a single placeholder patch
  (`"[paragraph updated by issue c1]"`), which was applied; (2) every patch that swapped a picture was refused because
  the quote guard compared an object as text; (3) each fresh critique round raised a different set of issues, so the
  loop could not converge. Stopped at 03:41, before spending on a Filipino edition of English text that was about to
  change.
- 03:48 — fixes: rounds 2+ are **verification rounds** (the critic rules fixed / open / withdrawn on each earlier issue
  and may add only new blocker or major problems; an issue it does not rule on stays open); a revision must answer
  every blocker and major issue with a patch or a stated reason (one repair request, then the partial revision is kept
  and logged); placeholder values are refused; picture patches are matched by slug and the reviser gets the approved
  drawing list; a slide line that repeats its title is dropped; cover and day dividers get distinct pictures that are
  not on the next slide or on a question slide. Three rounds is now the default for every run (reasoning only for the
  English first critique). Relaunched G4 T1 W8, G7 T1 W6, G5 T3 W7 with the **batch settings** (not `--thorough`), so
  the samples show what the batch will produce.
- 03:50 — G5 T3 W7 and G7 T1 W6 failed the first verification round the same way twice: Qwen returned only the
  status list (a bare JSON array; its JSON mode allows arrays). The revisions before it were complete (G5: 28 patches,
  every blocker/major issue answered; G7: 53 patches). Fix: the prompt asks for one object explicitly, and a bare
  status list is accepted as the statuses with every "open" issue carried forward with the critic's note (logged).
- Decks were also written with 19 ZIP folder entries, which cloud drives have refused to open; the renderer now
  rebuilds the package without them (`[Content_Types].xml` first) and the render test asserts it.
- 03:56 — with verification rounds, open issues fell (G5 T3 W7: 2 open, G7 T1 W6: 3 open, from 13 in the first
  attempt), but the revision logs show the remaining cause: patches quoting the right text at the **wrong array
  index** (G7's second revision: 11 of 14 rejected patches) and a few over field-length limits. Stopped before the
  Filipino editions. Third approach to convergence: every list item shown to the models carries its index as `"_i"`,
  paths may name slides and questions by id (`slides[d4s2]`), a patch whose quote matches exactly one other item of
  the same list (≥ 16 letters/digits) is moved there and logged (`from`), and the reviser gets the field limits.
  If this does not converge, the loop stays as is and the open issues are reported for human review.
- 04:04–04:10 — with index labels, G4 T1 W8 English ended with 3 open issues (14 confirmed fixed). New failures, each
  different: G7's verification reply came back as the object wrapped in a one-item list with ids copied from the
  format example ("c2 (still open)") → unwrapped and ids normalised; G4's Filipino guide overflowed a 500-character
  field and the repair returned identical text → teacher-facing prose limits are now the English design length × 1.4
  (slide text keeps its TV limits) and the Filipino guide prompt asks for lengths close to the English; the quote
  guard compared a quoted list only with its first item, demanded a quote for paths with no list index, and gave a
  misleading reason for paths that do not exist → lists compare whole, the quote is required only for indexed paths
  (picture removal excepted), and a missing path says so. All three weeks rerun on this one code version.
- 04:13–04:17 — English with index labels: G7 1 open issue, G4 4, G5 7 (17–21 fixes per week confirmed by the
  critic). Remaining English rejections were mechanical (slide lines over 110 characters, a slide moved between two
  flow steps that only passes when both steps change, minutes sent as text). First Filipino run: all three failed
  before review — G5 and G7 because Qwen without reasoning returned the critique as a bare list (same failure twice →
  shape restored deterministically for every critic reply, logged); G4 because one Filipino slide line was a single
  125-character sentence on a full slide, and the repair did not shorten it.
- 04:25 — fixes: Filipino slide lines may be 130 characters (English stays 110; per-slide total and the 48-word
  readability limit unchanged), leading "1." numbering is not counted, long lines are split at sentence boundaries
  when the slide has room (generation and revision), patches that only pass together are applied together, numbers
  sent as text are converted, and every failed attempt's reasons are now logged. Rerun of all three weeks.
- 04:15–04:30 — visual QA of every slide of the G7 T1 W6 English deck (53 slides, contact sheets): no clipping,
  overlap or contrast faults; cover and dividers now carry distinct drawings. Two design faults: one litmus drawing on
  four of six Day 4 slides → the renderer now shows a drawing at most twice a day and never on consecutive slides
  (the slide takes the full width instead); the Day 4 exit ticket repeated the check answered two slides earlier →
  day prompt rule for new weeks plus a checker warning. Added `render --targets …` (re-render from the library, no
  model calls) and accepted quoted lists/numbers in patch quotes (they cost a full repair round each).
- 04:24–04:27 — rerun results: G5 T3 W7 Filipino **draft** (8 critique issues confirmed fixed, none open), English
  2 open; G4 both needs_work; G7 Filipino failed: two Filipino slides of 60–69 words (the English revision had added
  accuracy qualifiers, and Filipino runs longer). Fixes: Filipino per-slide character allowance 420 (English 340; the
  48/60-word readability limit is the same for both); hard wording failures (over 60 words on a slide, average
  sentence too long, English sentences in Filipino) now enter the review loop as issues the critic must raise and
  count against any patch that worsens them; quotes ignore a leading "2." on slide lines (a correct patch was refused
  twice for it). Final rerun of the three weeks; open issues after it are reported, not chased further.
- 04:42–04:52 — final state of the samples (inventory): G4 T1 W8 English needs_work (6 open) / Filipino **draft**;
  G5 T3 W7 English needs_work (2 open) / Filipino needs_work (1 open); G7 T1 W6 English needs_work (7 open) / Filipino
  failed — DeepSeek HTTP 402, balance $0.04. Every built deck passes the OOXML validator and was inspected slide by
  slide after the final render. Renderer fixes from that inspection: choices are measured one box at a time (the old
  estimate warned on every quiz slide and hid a real overflow on a Filipino answer slide), answer boxes grow, and an
  answer slide whose grid and explanation cannot both fit shows only the right answer full-width; the sources line
  ends on a whole reference. The tala-web dev server had to be restarted to load the new contract (Filipino slide
  lines up to 130 characters) — production must deploy the contract with the packs.

## Production deploy — 2026-11-19 06:01 UTC (Luis: "Let's get it up on the website now pls", relayed by Beanie)

- **Release `tala-v1-demo.10`** = commit `87d001ca6` on branch `tala-v1-packs-live` (pushed, no force), built on
  the live tag `tala-v1-demo.9` (`4aa7187c5`) **on purpose**: local `tala-v1` carries 91 undeployed commits after
  demo.9 (the non-Science curriculum harvest) whose live deploy Luis is holding until verified; they are not in
  this release. Same change as `68efab3eb` on `tala-v1-packs` (local). Deployed with the kit:
  `/opt/tala/deploy.sh tala-v1-demo.10` (built on the host, health-checked, current → `releases/tala-v1-demo.10`).
- **Pack data** in `/var/lib/tala/packs` (294 files, `SHA256SUMS` verified on the host): G4 T1 W8 EN+FIL,
  G5 T3 W7 EN+FIL, G7 T1 W6 EN. G7 Filipino not shipped (DeepSeek balance −$0.02; labelled "Not built yet").
- **Settings** added to `/etc/tala/tala.env`: `TALA_PACKS_LIBRARY_DIR`, `TALA_PACKS_ARTIFACTS_DIR`,
  `TALA_PACK_DRAFT_PREVIEW=signed-in` (drafts open to signed-in accounts, still labelled drafts; signed-out
  visitors see counts only). `TALA_PACK_REVIEWERS` unset.
- **Backups before deploy**: `/var/backups/tala/20261119T060057Z/` (SQLite online backup, integrity ok; env file;
  previous release `tala-v1-demo.9`).
- **Rollback**: code — `/opt/tala/deploy.sh tala-v1-demo.9` (or switch `/opt/tala/current` back to
  `releases/tala-v1-demo.9`, write `TALA_BUILD_ID=tala-v1-demo.9` to `/opt/tala/build.env`, restart `tala`). No DB
  migration in this release. Hide drafts without a code rollback: remove `TALA_PACK_DRAFT_PREVIEW` and restart.
  Data: `/var/lib/tala/packs` is ignored by demo.9. **The next deploy from `tala-v1` must merge
  `tala-v1-packs-live` first**, or it will drop the library.
- **Verified from outside** (public URL, own hashes): health reports `tala-v1-demo.10`; signed-out: honest counts,
  no draft content or files (404); signed-in (temporary account, deleted afterwards): all 5 built language versions
  load and say "draft", Filipino packs with 114–118-character slide lines load (contract live), G7 Filipino 404
  with a plain message; all 15 files byte-identical to the builds, PPTX ZIPs intact; browser: library and pack pages
  on desktop (EN) and 390 px phone (FIL) without horizontal overflow, EN/FIL switch, slide previews, "use for my
  class" → five drafts labelled "Drafted by AI", offline in-app navigation shows the no-signal notice and the opened
  pack from the device cache; APK download unchanged (SHA-256 matches its manifest); mobile sync pull works; server
  log since restart: no errors.
- 06:09–07:00 — Luis's decisions (above). G7 T1 W6 Filipino finished from cache ($0.13): **draft**, 3 rounds, no open
  blocker/major. Deck audit for teacher editability: all text was already real text (no flattened slides), but every
  shipped deck typed its list markers ("•", "1") instead of using native lists, and answer choices were a box plus a
  separate text box → native auto-numbering/bullets (teal markers via `buClr`; `startAt` dropped because Impress
  restarted numbering on every line), one text-bearing shape per choice, and the `editability/1` audit, which fails
  all five previously shipped decks and passes all six re-rendered ones. Hiraia watermark added (decision 6),
  inspected on rendered slides (cover, day and content plates). All six sample decks re-rendered and deployed to
  `/var/lib/tala/packs` (data only; the server code is unchanged): 18 files byte-identical when downloaded from
  tala.hiraia.org, all six served decks pass the audit; "use for my class" then "Adapt with AI" on a deployed pack ran
  on production (job done in 8 s, lesson redrafted, marked "Drafted by AI"); temporary accounts deleted.
- 06:51 — priority batch launched: 102 weeks (Term 2 weeks 10–11 first, then Term 3; G5 T3 W7 already built),
  6 workers, `--batch priority-2026-11-19 --cap 90 --off-peak`; waiting for DeepSeek off-peak (10:00 UTC).
