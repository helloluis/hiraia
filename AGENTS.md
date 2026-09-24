# AGENTS.md — orientation for a model arriving cold

Hiraia is an **offline, on-device AI science tutor for Filipino grade-schoolers**: a Sailor2-3B
model, Tagalog/Cebuano LoRA adapters, a ~53k-fact grounding bank, a 49,156-card feed with
illustrations, and a quiz bank — all bundled in one Android APK. A companion teacher app,
**Tala**, collects student activity over Nearby. Default language Tagalog; target reading level
Grade 5 even for older students.

The one rule that decides everything else: **factual accuracy ranks above Tagalog/Cebuano
fluency.** A stiff but correct tutor beats a fluent one that misleads a child.

Read `CLAUDE.md` first — it holds the evaluation instruments and the load-bearing conventions.
This file is the map and the pitfall list; it points at deeper docs rather than repeating them.

---

## Working checkout

- Work in `/Users/luis/Code/hiraia`. The development branch is **`hiraia-unified`**; **`main`**
  is what deploys and is kept as a fast-forward of it. Other agents share this checkout —
  check `git status` before editing and preserve unrelated changes.
- The tree routinely carries thousands of uncommitted files from parallel threads (image
  regens, in-flight fixes). That is normal. It is also why a build may contain work that is
  not yet committed — see "Release" below.
- Do not resume work in retired `hiraia-*` worktree directories. The 21 Sept 2026
  consolidation is in `docs/WORKSPACE-CONSOLIDATION-20260921.md`; archived snapshots under
  `/Users/luis/Code/hiraia-worktree-archive/` are recovery material, not build inputs.
- Commit only when asked. Never publish or change release versions without task authorization.

## Where things are

| area | path | what lives there |
|---|---|---|
| Student app | `packages/mobile/` | Expo/React Native. `src/data` (feed, cards), `src/tala` (classroom enrolment), `src/voice` (read-aloud), `src/updates` (asset catalog), `src/generated` (built indexes). `BUILD.md` is required reading before any build. |
| Teacher app | `packages/tala/` | Native Kotlin. Enrolment QR, Nearby collection, roster, class identity. Built with the student app's gradle wrapper. |
| Website + API | `packages/web/` | Next.js landing page, `/api/app/manifest`, the card-feed demo. Release pointers in `src/config/download.ts`, `tala-download.json`, `asset-updates.json`. |
| Shared types | `packages/shared/` | Trilingual string type, RAG facts, language picker. |
| Illustrations | `packages/images/` | `cards-png/`, `assets-png/`, pack builder (`to-card-png.mjs`), quarantine. 12,149 bundled + 22,932 downloadable in 42 packs. |
| Content pipeline | `rag/pipeline/` | Generators (`fw-gen-*`), assemblers, `wire-app-pool.py`, **`build-cards-db.py`**, `gen-cards-questions.py`. The pool is `cardsPool.app.json` (50 MB, one line). |
| Banks | `rag/bank/` | `quiz-bank.jsonl` (32,718 items, 25,751 ship), `science-facts.jsonl`, factoids. |
| Models & eval | `finetuning/` | Training scripts, adapters, the two eval instruments in `finetuning/eval/`. Also where multi-GB artefacts accumulate — see pitfalls. |
| Deploy | `deploy/` | `update.sh` (VPS redeploy, hard-resets to `origin/main`), `publish-release-assets.py` (R2), `vps-monitor/` (admin panel), nginx. |
| Audits & tooling | `tools/` | `cebuano-language-audit/`, `quiz-language-audit/`, `card-language-audit/`, `image-audit/`, `pilot-telemetry/`. Each has a `PLAN.md` or README that logs what was tried and what failed. |
| Docs | `docs/` | Release notes (`RELEASE-*.md`), curriculum audits per grade, `IMAGE-PACKS.md`, `APP-AND-ASSET-UPDATES.md`, `TTS.md`, **`TRANSLATION-LEXICON-DEFECTS.md`**. |
| Root logs | `ENGINEERING-LOG.md`, `README.md` | The chronological engineering record and the public framing. |

## The data flow that bites people

```
rag/pipeline/cardsPool.app.json ──┐
rag/bank/quiz-bank.jsonl ──► gen-cards-questions.py ──► packages/mobile/src/data/cards-questions.json
                                  └──► build-cards-db.py ──► packages/mobile/assets/data/cards.db  (gitignored)
                                                              packages/mobile/src/generated/cardsIndex.generated.json
                                                              packages/tala/android/app/src/main/assets/card-catalog.tsv
                                                    └──────► the APK (build-apk.sh refuses a stale cards.db)
```

- **Nothing regenerates `cards.db` for you.** After touching the pool, the quiz bank, or
  `src/data/cards.ts`, run `python3 rag/pipeline/build-cards-db.py`. It is gitignored, so a
  clean `git status` says nothing about whether it is present or current.
- **Tala's `card-catalog.tsv`** (card/quiz id → the subcategory pills) is written by that same
  run and is **append-only**: a card retired from the pool keeps its entry, because old student
  installs still report it. Tala's Gradle build runs `packages/tala/scripts/build-card-catalog.py
  --check` and refuses a stale catalog; never hand-edit or prune it. Card ids must never be
  re-used — the catalog relies on it.
- Inside the APK, resource shrinking renames it: **`cards.db` ships as `res/gG.db`**. A check
  that greps the zip for `cards.db` will report it missing when it is not.
- The pool is a single 50 MB line. Re-serialise it with `json.dumps(doc, ensure_ascii=False)`
  and default separators; `indent=1` turns a one-line diff into a 2,070,923-line one.

## Build and release — the checklist, with why

1. **Regression gate green first.** `finetuning/eval/harness/run-harness.sh`. Hard rule, not
   advisory. Run it *before* other threads' changes land so a red result is attributable.
2. **Version bump ⇒ `pnpm prebuild`** in `packages/mobile`. It bakes `versionCode` into
   `android/app/build.gradle` (and, since 0.4.24, the OTA config: updates URL, code-signing
   certificate, `expo_runtime_version`). Skip it and the APK ships the *old* versionCode;
   `sign-apk.sh` then refuses with "APK says N, app.json says N+1".
3. **`packages/mobile/scripts/build-apk.sh`.** It clears the stale-bundle trap itself: gradle
   skips the Metro re-bundle when only a workspace dep changed, so a suspiciously fast build
   showing `createBundleReleaseJsAndAssets UP-TO-DATE` is running the *previous* JS.
4. **`packages/mobile/scripts/sign-apk.sh`.** Gradle's `app-release.apk` is signed with the
   Android *debug* key — never install or publish it; only `sign-apk.sh`'s output ships.
   The script needs `credentials.json` + `keystores/release.jks` (gitignored; fetched
   interactively via `eas-cli credentials`). Pinned cert `40d750d5…`; re-keying would stop
   every existing install from upgrading.
5. **Tala** builds with `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and
   `ANDROID_HOME=~/Library/Android/sdk` via `../mobile/android/gradlew -p android
   assembleRelease`. Its release variant is **deliberately signed with the Android debug
   certificate** (`50dcc69a…`) — that is the established pilot key. Do not "fix" it.
   `/opt/homebrew/opt/openjdk` points at JDK 26 and fails with "class file major version 70".
   The build needs `python3` on `PATH` (the card-catalog check). Tests: `testDebugUnitTest`
   (JVM) and `connectedDebugAndroidTest` — run the latter on an **emulator only**: it deletes
   `hiraia-tala.db`, which on a teacher's phone is the class's real data.
6. **Server side FIRST** (since 0.4.24): deploy `packages/web` *and* the standalone telemetry
   collector (`/opt/hiraia-telemetry/server.cjs` — `update.sh` does **not** redeploy it) before
   any 0.4.24 phone or Tala 0.4.4 syncs, test devices included: the old collector permanently
   rejects events carrying a prop key it doesn't know. Exact steps + smoke checks:
   `packages/mobile/BUILD.md` → "Release order".
7. **Publish** with `~/.venvs/hiraia-publish/bin/python deploy/publish-release-assets.py
   --env-file .env.cloudflare.local`. `--apk` handles the student APK (versioned key +
   `hiraia.apk` alias + purge); Tala and image packs go through `--asset` as
   `models/<basename>`. It reads bytes back and does a public HEAD; trust that, not the log.
8. **Point the site**: `download.ts` (student), `tala-download.json` (teacher),
   `asset-updates.json` (packs). Then commit, push `main`, and run `deploy/update.sh` on the
   VPS (`root@45.76.180.229`, repo at `/root/hiraia`). Verify `https://hiraia.org/api/app/manifest`.
9. **Asset catalog bounds are pinned to the exact `versionCode`** (`minAppVersionCode` /
   `maxAppVersionCode`), and the app rejects the whole catalog on a single `imageBaseline`
   mismatch. The catalog sat stranded at code 17 through two releases with an empty
   `imagePacks` array — asset updates were silently inert. **Move the bounds with every
   release**, and validate with the app's own `parseAssetCatalog` before deploying.
10. Write `docs/RELEASE-<versions>.md` with bytes, digests and cert fingerprints for both APKs.
11. **OTA (0.4.24+)**: JS-only fixes ship as signed over-the-air updates with
    `deploy/publish-ota.py` (canary → `--promote` → `--rollout-only`), from the tree that built
    the APK. The signing key lives only at `~/.hiraia/ota-keys/private-key.pem`; losing it means
    no OTA can reach installed phones until the next APK. Runbook: `BUILD.md` → "OTA JS updates".

Device testing: `adb devices` counts a running emulator as a device, so bare `adb install`
fails with "more than one device" — use `-s`. MIUI blocks adb installs until *Install via
USB* and *USB debugging (Security settings)* are on; the fallback is `adb push` to
`/sdcard/Download/` and installing from the Files app. Read `ro.product.marketname` before
naming a device; model numbers are not marketing names.

## Language pitfalls — read these before touching any Tagalog or Cebuano

These were each learned the expensive way in September 2026. Full method and evidence:
`tools/cebuano-language-audit/PLAN.md` and `runs/2026-09-20-scope/REPORT.md`;
`tools/quiz-language-audit/TL-AUDIT-PLAN.md`; `docs/TRANSLATION-LEXICON-DEFECTS.md`.

- **Never trust an LLM's ear for Cebuano or Tagalog, including your own.** The corpus is the
  authority: `tools/cebuano-language-audit/ceb_usage.py --bis <word>` shows what 47,056 cards
  actually use a word *for* (bodies only, so a defective title cannot vouch for itself). The
  audit's own false-friend list was refuted **three separate times** — `bakal`, `lana`, `bulok`,
  `kagang`, `pako`, `mopalta`, `gasolina`, `sanga` all looked wrong and were correct. Where the
  corpus is ambiguous, a dictionary (Wolff, binisaya.com) outranks it; the corpus is
  machine-translated and can be wrong in bulk.
- **Inconsistent ≠ ungrammatical.** Corpus statistics tell you a form is *rare relative to the
  corpus*, not that it is wrong. `naglalangoy` is a 1% outlier against `lumalangoy` *and*
  attested fluent Tagalog. Flag consistency deviations; do not call them grammar errors.
- **Tagalog `mag-` vs `-um-` is often a transitivity pair, and both are correct**: `tumaas`
  = rise / `magtaas` = raise; `bumigay` = give way / `magbigay` = give. A frequency imbalance
  is *expected*. 124 of 170 flagged roots were not defects.
- **The target Cebuano is Cebu Cebuano, not Hiligaynon.** `naga-` was normalised to `nag-`
  corpus-wide (2,423 tokens) on that ruling. But `magamit` is *ma-gamit*, not `maga-`: only
  rewrite a prefix when the corpus already attests the target form.
- **Emphasis spans match by exact substring at render time** (`cards.ts`). An edit that moves
  or rewords a span does not error — the card just silently loses its bolding. Every card edit
  goes through a per-language emphasis guard; 27,263 `bis` spans are in scope.
- **Repair only what is provable from the card's own English.** Register, idiom and dialect
  are out of scope. Anything else goes to a native speaker; **33 Cebuano cards** still do.
- **English science vocabulary left in English is correct** in a Philippine classroom.
  Quiz options that are byte-identical across `en`/`tl` are almost always proper nouns,
  formulas or terms, not untranslated prose.
- **Generator defects recur on every content build** unless fixed at source. Known ones and
  their fixes: `docs/TRANSLATION-LEXICON-DEFECTS.md`. The 20-character title cap that severed
  words in all three languages is fixed in `rag/pipeline/fw-gen-*-titles.py` (`_fit`).

## Tooling pitfalls — measurement and process

- **A normaliser that "cleans" text destroys the distinctions under test.** A probe using
  `re.sub(r'[^a-z0-9 ]','',s.lower())` flagged 29 correct quiz items as duplicates because it
  ate `×` vs `+`, `9.8` vs `98`, `π` vs `α`, and `cm`/`Cm`/`cM` (deliberate case distractors).
  Compare exactly; normalise only what you can prove is noise.
- **Count the right unit.** An attestation gate that counted *surface forms* blocked
  `pagkasinaw` (1 use) whose root `sinaw` has 59. In an affixing language, check the root.
- **Deterministic enumeration wins on closed classes and loses on open ones.** `gawa ng`
  was 23/23 by grep and 0/2 by model; "rare word" detection was the reverse (6.8% recall).
- **Every candidate list gets triaged before anything is written.** In the Tagalog card pass
  952 of 1,017 grep hits were fine; blind application would have corrupted 952 cards to fix 61.
- **Spike your controls.** Insert known-bad items into any sweep. A 15/15 catch rate is what
  makes a null result a real null; a sweep once reported "the corpus is clean" at recall 0.33.
- **Report precision and recall separately, never averaged.** A model once posted recall 1.00
  by flagging almost everything and looked like the best in the table.
- **A verifier that accepts 100% is not verifying.** Gate mechanically as well as by model. A
  proposer that returns zero HOLDs was not applying its constraints.
- **Workflows: return flags only, never every row** — 30,151 rows blew the 4,096-item VM
  boundary after the work was done. Results are recoverable from the run's `journal.jsonl`.
- **Session, weekly and monthly usage limits truncate long workflows.** Resume with
  `resumeFromRunId`; completed agents replay from cache. Use smaller batches so a limit
  truncates less. The monthly cap needs raising in account settings; nothing clears it locally.
- **The AUP classifier false-positives on Tagalog/Bisaya child body/biology content**; prefilter
  with `finetuning/eval/capability/aup-denylist.json` and judge that slice locally, never on a
  hosted classifier.

## Git and shell pitfalls

- **Never `git add -A` on this tree.** It swept 48 GB of model weights and a 6.5 GB TTS corpus
  (`finetuning/teacher/omni-bank`, 15,286 files) into a release commit. GitHub LFS rejects
  objects over 2 GB and packs over 2 GiB. Those paths are now in `.gitignore`; add new
  artefact directories there *before* they exist.
- **Push large histories in chunks** (`git push origin <sha>:main`, oldest first, in ancestor
  order — picking every Nth commit in a DAG is not ancestor order).
- **zsh expands `:r` in `$s:refs/heads/main` as a history modifier.** Write `"${s}:main"`.
- `main` deploys via `git reset --hard origin/main` on the VPS — keep no local edits there.
- `scp` uses `-P`. Heredocs inside `ssh "..."` unescape twice; use `ssh host 'bash -s' <<'EOF'`.
- `RUNPOD_API_KEY` lives in `.env.local`; Cloudflare creds in `.env.cloudflare.local`. Both
  gitignored. Never commit either; never pass secrets to `sendfile`.

## Open items (as of 23 Sept 2026)

- **33 Cebuano cards** need a native speaker: idiom and lexical-authority questions where
  dictionary and corpus disagree. 13 more are held on thinly attested roots.
- **Narration pacing** (punctuation-guided pauses, `docs/TTS.md`) is shipped but untuned by ear.
- **Asset catalog bounds** are pinned to versionCode 22 — must move with the next release.
- The class-name field in the Tala QR is new (0.4.3): older teacher builds send none, and the
  student falls back to a generic heading. Both apps are 0.4.22 / 0.4.3 as of this writing;
  the canonical record is `docs/RELEASE-0.4.22-TALA-0.4.3.md`.
