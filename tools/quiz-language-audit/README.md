# Filipino and Cebuano quiz-language review

`audit.py` checks questions, **all options**, and explanations. It proposes target-language corrections without changing source files, English, option order, answer keys, IDs, or curriculum metadata. Python 3.10+ on macOS/Linux; no third-party dependencies.

## Current workflow — 13 September 2026

Use these pipeline names in status updates and monitoring:

| Pipeline | Purpose | Current output directory |
| --- | --- | --- |
| **Audit-1** | Diagnose existing Filipino and Cebuano quizzes; includes the original Gemini results and active Flex continuation. | `runs/2026-09-12/gemini-auditor-flex-v1/` |
| **Fresh-1** | Translate eligible Audit-1 findings afresh from English using youth-friendly wording. | `runs/2026-09-13/gemini-fresh-queue-v1/` |
| **Audit-2** | Diagnose completed Fresh-1 proposals against their English originals, without seeing prior findings or generator notes. | `runs/2026-09-13/gemini-reaudit-queue-v1/` |

Include the pipeline name when identifying a batch, for example **Fresh-1 batch 17**. These names identify the current pipelines; existing run paths and batch identifiers remain their storage references.

The concurrent flow is **Audit-1 → Fresh-1 → Audit-2**. Audit-1 has finished. Fresh-1 now uses real cloud batches for the 9,811 eligible jobs left untouched after its old two-worker dispatcher drained. The two-card cloud canary is collected and checked before releasing batches of up to 500, with one outstanding batch at a time. Cloud results are polled every 60 seconds; Audit-2 discovers verified proposals every 60 seconds and retains its independent local manifests of 50 Flex requests. See [FRESH-BULK-MIGRATION.md](FRESH-BULK-MIGRATION.md) for the active handover and accounting rules. The legacy dispatcher commands below are historical and must not run alongside the cloud coordinator.

The original Flash audit is stopped. **Audit-1** uses `gemini_flex_auditor.py`; its frozen run files and operating instructions are in `runs/2026-09-12/gemini-auditor-flex-v1/`. The earlier rewrite and fresh-translation trials are separate from **Fresh-1**.

`gemini_rewriter.py` runs bounded trials of up to 50 independent, audit-guided rewrite requests on OpenRouter's Gemini 3.8 Flash Flex route. It accepts a frozen `sample.json` in the existing Qwen sample format and an explicit prompt file. The September 13 trial uses the exact v2 prompt from the earlier fresh comparison; `qwen_rewriter.py`'s current default prompt differs.

```sh
# Offline: validate and freeze the 50-card trial and conservative cost reservations.
python3 tools/quiz-language-audit/gemini_rewriter.py prepare \
  --sample tools/quiz-language-audit/runs/2026-09-13/gemini-rewrites-50-v1/sample.json \
  --prompt-file tools/quiz-language-audit/runs/2026-09-13/gemini-rewrites-50-v1/prompt.txt \
  --out tools/quiz-language-audit/runs/2026-09-13/gemini-rewrites-50-v1
```

With the same arguments, `run --limit 1` submits one paid canary; `run` processes the remaining unattempted cards. Every request with a durable attempt marker is skipped, including interrupted or failed requests. A completed canary is reused. There are no automatic retries or provider fallbacks. `report` only rebuilds exports; the output lock prevents simultaneous writers.

The runner reads `OPENROUTER_API_KEY` from the environment or `.env.local`. Concurrency defaults to two, each request has a 900-second timeout, and the trial has a $2 ceiling checked against conservative reservations for every selected request. Received charges must match Flex pricing and tier; reasoning usage is counted within completion tokens. Billing/authentication errors or three trial errors stop further submission.

Outputs include `summary.json`, `proposals.jsonl`, `review.md`, and raw per-card request/response records. `proposal` means structural validation passed; `held`, `rejected`, and transport errors remain separate. Quality judgments from the September 13 trial are in `quality-review.md`, `quality-review.csv`, and `quality-reviewed-proposals.jsonl` in that run directory. These include independent model-assisted review and distinguish repaired fields from remaining whole-card problems. This trial uses individual Flex requests rather than shared multi-card prompts or the cloud batch endpoint.

`gemini_translator.py` runs separate fresh-translation trials of up to 50 cards on the same Flex route. Each request contains only the English question, ordered options, explanation, English source context, grades, and requested language; existing translations, audit findings, and answer keys are excluded. Every field can be translated, and results are full-card proposals or holds. Use `prepare`, `run`, or `report` with `--sample`, `--prompt-file`, and `--out`; the September 13 inputs are `runs/2026-09-13/gemini-fresh-50-v1/sample.json` and `prompt.txt`. The default limits are `--budget 2 --concurrency 2`; `run --limit 1` permits a canary, and subsequent `run` skips every previously attempted request. It never applies translations to source files.

`gemini_translation_queue.py` runs **Fresh-1** in `runs/2026-09-13/gemini-fresh-queue-v1/`. Its youth-friendly prompt permits familiar English terms when an obscure translation would make comprehension harder. `translation_queue_selection.py` selects validated `flagged` diagnoses from **Audit-1** with a confirmed answer and no source/uncertainty issue; the generation request contains English only. A source issue in either language holds both versions of that English quiz, including already-queued work. Known source concerns from the trial are also held. Old target-only defects such as duplicate translated options can enter fresh translation when the English itself is valid.

The queue discovers new finalized audit records every 60 seconds and groups them in immutable manifests of 50 independent Flex requests. It uses two workers, a $30 translation ceiling, conservative reservations for active/unknown charges, and a supplementary $250 combined audit/translation admission guard. The latter reads the audit's latest usage log; the separate audit does not share this queue's budget ledger, so monitoring must check both. Billing/auth/rate failures, three consecutive failures, or ten failures among the latest 100 outcomes stop new submissions. Requests with durable attempt artifacts are never retried automatically. `STOP` in the output directory drains in-flight work and stops submission.

Use the saved `run-command.txt` in the queue directory for its frozen inputs and flags. `prepare` discovers and seals work without API calls; `run --limit 4` supports a canary; `run` continues untouched work and watches new audit results; `report` rebuilds exports only while the queue is stopped (exclusive lock). Read `summary.json`, `discovery.json`, and `process.log` during execution. `proposals.jsonl` contains private selection provenance and source references for later review; `proposal` means structural checks passed, not language approval. A later source hold marks completed outputs `requires_source_review` without altering raw results. No quiz edits, builds, or deployments occur.

**Audit-2** uses `gemini_reaudit_queue.py` with `fresh_result_selection.py`. It verifies each Fresh-1 proposal against its saved request, raw response, billing, and immutable source identity before selecting it. It uses the exact Audit-1 diagnosis prompt, schema and validator, substituting the new translation as the target. The answer key stays private for checking the auditor's inferred answer. Audit-1 findings, Fresh-1 notes, and the old target text are excluded from the request. Fresh-1 source holds are refreshed before dispatch and applied as an overlay to completed results without altering raw artifacts. Audit-2 has two workers, a $30 local ceiling, and an admission guard using current Audit-1 and Fresh-1 usage against the $250 combined ceiling.

Monitoring reports **model-assessed findings**, not verified linguistic error rates. API failures and invalid responses have their own attempt denominator; they are not translation errors. Reports distinguish passes, confirmed findings, uncertain judgments, source issues, and late source holds, with explicit denominators and language breakdowns. Compare fixed cohorts assigned before their outcomes, and label incomplete cohorts. The matched conversion metric asks how many previously flagged cards now pass Audit-2. Audit-1's overall flag rate and Audit-2's selected-sample rate are not directly comparable. Using the same model for translation and checking can leave shared errors undetected; a falling flag rate alone does not establish improving translation quality.

The Paseo heartbeat **Audit-1 · Fresh-1 · Audit-2 progress** reports all three stages every 5 minutes during the Fresh-1 cloud-batch migration. Its instructions and schedule metadata are in `runs/pipeline-monitoring/`. Collect a current table without invoking the active runners' report writers:

```sh
python3 -B tools/quiz-language-audit/pipeline_status.py \
  --out tools/quiz-language-audit/runs/pipeline-monitoring
```

The collector writes `latest.md`, `latest.json`, and timestamped snapshots only in that separate directory. It verifies process commands, reads live result artifacts, and shows fixed Audit-2 cohorts, language breakdowns, matched pass conversion, and combined received/reserved spending. Fresh-1 cloud batches are counted separately from its older local manifests. Accepted cloud jobs remain queued or active beyond the synchronous 900-second timeout, including when the local coordinator stops; unconfirmed submissions and completed batches awaiting import are shown separately. Cloud costs use allocations of actual aggregate batch receipts without inventing per-response usage. Synchronous backlog ETAs require a measured recent window and exclude work upstream has not selected; cloud import bursts do not support an ETA. All three budget ledgers remain separate, so the heartbeat also monitors their combined exposure against $250.

`audit2_handoff.py watch` feeds the external final-review reference every 60 seconds. Its separate directory is `runs/2026-09-13/audit-2-frontier-handoff/`: `audit-2-flagged.md` is self-contained, `audit-2-flagged.jsonl` supports incremental reading, and `manifest.json` records counts and content hashes. It reads only validated Audit-2 `flagged` results and carries the full English/Fresh-1 card, answer index, diagnosis, source references and provenance. Later source holds mark a record ineligible for language repair and change its revision hash. The reference is generated input; the outside agent should save decisions elsewhere, track `key` + `revision_sha256`, and reload the reference for new cards or changed holds. Uploaded copies are static snapshots. This feeder makes no API calls and does not modify any pipeline or quiz source. It exits after all producers stop and a final export completes; `export` is the one-shot command and refuses a second writer while `watch` holds the output lock.

## Original audit.py reference

Default model: `accounts/fireworks/models/deepseek-v4p1-flash`. Fireworks lists this exact model ID and supports JSON-schema responses:
- https://fireworks.ai/models/deepseek-ai/deepseek-v4p1-flash
- https://docs.fireworks.ai/structured-responses/structured-response-formatting

## Workflow

1. **Freeze and inventory the inputs.** Include the canonical quiz bank, the current app question bank, grade lesson supplements, the legacy bank if present, and web demo variants. Identical language text plus English/context/key share a review. Keep every source reference and full-row hash so later merging cannot overwrite a changed source. Read source-fact context from the science-facts bank. Missing context is allowed and visible in `jobs.jsonl`; the reviewer must flag uncertainty rather than invent context.
2. **Run a balanced pilot: 60 jobs, 30 per language.** Examine all pilot diagnoses and proposals, ideally with fluent Filipino and Cebuano educators. Include known bad cards and valid regional wording in a separate calibration fixture using `--input`; don't assume a low flag rate means good translations. Tune the prompt only against reviewed examples. A prompt/model/script change requires a new run name.
3. **Audit the full snapshot.** One quiz-language per request avoids dropped items and cross-language contamination. Ask for `pass`, `fix`, `source_issue`, or `uncertain`; classify severity. Check mistranslation, calques, tense/aspect, wrong-language phrasing, terminology, negation, units, reading level, clues, ambiguous answers, and distractor meaning. Retain acceptable science loanwords and regional variants. English/scientific errors are escalated separately, not silently translated into new facts.
4. **Verify fixes in a fresh call.** Supply the proposed quiz and English/context, but hide the original answer key and first editor's reasoning. Require a natural, faithful translation with exactly one defensible answer; infer its index and compare locally with the immutable original key. Also recheck a deterministic 10% of passes to estimate misses. These are separate calls to the same model, so errors can still correlate: verification is a filter, not native-speaker certification.
5. **Review the output.** `candidate` means structurally valid and model-verified, **not approved for publication**. Review all candidates and `needs_review` cases. Review critical meaning/key issues first, then major mistranslations, then minor grammar. Sample clean passes by language and topic; if the sample misses serious errors, increase `--pass-sample` in a new run. Fix source issues in a separate editorial task.
6. **Merge only reviewed decisions in a later step.** `candidates.jsonl` contains before/after language text, unchanged English/key, source references/hashes, and `human_approved: false`. This checker intentionally has no automatic apply/publish command. A merge must re-read each referenced source, verify its hash and original language text, update only the approved language fields, then regenerate runtime/demo derivatives through their normal build pipelines. Do not blindly edit all generated copies independently. Verify option counts, single-answer validity, localized layout, stable IDs/keys, and actual app quiz rendering before a release.

## Commands

From the main Hiraia workspace, inspect the **unified** source that ships in Android:

```sh
python3 tools/quiz-language-audit/audit.py prepare \
  --repo /Users/luis/Code/hiraia-unified \
  --out tools/quiz-language-audit/runs/2026-09-12
```

`prepare` is entirely offline. It emits immutable source inventory, `jobs.jsonl`, and `blocked.json`. The initial dry run found **66,000 jobs: 33,000 per language**, including version differences and lesson supplements, and **eight invalid source rows with duplicate English options**. Counts will change with content revisions. Blocked rows are explicitly reported and require source review; they are not classified as clean translations.

Load `FIREWORKS_API_KEY` into your environment using your existing local credentials workflow. The script never reads or prints secret files. Then:

```sh
# Paid pilot: 60 language checks, plus verification of fixes and sampled passes.
python3 tools/quiz-language-audit/audit.py run \
  --out tools/quiz-language-audit/runs/2026-09-12 \
  --run flash-v1 --limit 60 --concurrency 4

# After reviewing the pilot, extend that exact run to the full snapshot.
# Completed stages are reused rather than billed again.
python3 tools/quiz-language-audit/audit.py run \
  --out tools/quiz-language-audit/runs/2026-09-12 \
  --run flash-v1 --concurrency 4

# Rebuild reports without API calls, including after an interrupted run.
python3 tools/quiz-language-audit/audit.py report \
  --out tools/quiz-language-audit/runs/2026-09-12 --run flash-v1
```

Use repeated `--input path` arguments for a calibration set or explicit input inventory. When specifying inputs, automatic discovery is disabled. `--facts` overrides the terminology/context source. `tl` means Filipino/Tagalog; `bis` means Cebuano, consistent with the application's existing data keys.

## Outputs and operations

- `manifest.json`: input hashes, source row counts, language-job counts, blocked count.
- `blocked.json`: invalid English/source structure, with exact source references.
- `jobs.jsonl`: normalized frozen inputs and references; not student or telemetry data.
- `<run>/results/<key>/`: raw responses (including token usage), stage caches, final result or retryable error. No API keys.
- `<run>/review.csv`: side-by-side English, original translation, proposed translation, diagnoses, verification, source references, and pending/error status.
- `<run>/candidates.jsonl`: model-verified suggestions awaiting editorial approval.
- `<run>/summary.json`: complete/pending/error counts, received token usage, estimated cost, blocked-source count.

Concurrency defaults to four and is bounded; requests retry timeouts, rate limits, transient server errors, malformed output with backoff. Authentication/model/schema configuration errors stop the run instead of retrying the whole bank. The OS lock prevents two writers to the same run. Each successful stage is saved atomically; a process crash may replay an in-flight billable request, but completed stage files are reused. Truncation is never a pass and is not retried at an unchanged token limit. Reasoning defaults explicitly to `--reasoning-effort none`: live testing showed the model’s implicit reasoning consuming all 3,000 completion tokens without any JSON. For a deliberate reasoning-enabled comparison use `--reasoning-effort high --max-tokens 8000` in a separate run; this larger limit is a suggested trial, not a tested guarantee. Only `message.content` is parsed; `reasoning_content` is kept separate. Reported reasoning tokens are a subset of completion tokens and are not double-counted in cost estimates.

Estimate cost from **actual pilot usage**, not a guess about translation lengths. Extrapolate audit usage by remaining language jobs, and verification usage by observed fix frequency plus the pass-sample fraction. Defaults are $0.22/M uncached input and $0.66/M output, as listed by Fireworks on 2026-09-12; override `--input-price`/`--output-price` when pricing changes. The estimate includes received usage from invalid/retried responses, ignores cache discounts, and cannot account for requests billed without a received response. It is not a spending cap. `--limit` provides a bounded pilot; the full audit and pilot have not been started. Small live compatibility tests were subsequently performed; see the smoke-test reports below.

```sh
python3 -m unittest discover -s tools/quiz-language-audit -p 'test_*.py' -v
```

## Reasoning compatibility test — 12 September 2026

Live responses using this exact model and the audit schema are summarized in `reasoning-smoke-test.json` (no credentials or reasoning text). Default reasoning with a 3,000-token cap returned `finish_reason=length`, 3,000 reasoning tokens, and empty content. Explicit `reasoning_effort=none` returned schema-valid Cebuano audit JSON, `finish_reason=stop`, 345 completion tokens, and zero reasoning tokens. A deliberate 32-token reasoning request also returned empty content and `length`.

`reasoning-fixed-smoke-test.json` records a subsequent end-to-end audit and verification using the patched code with reasoning disabled. The patched live audit used 277 output tokens and the verification used 18; both finished with `stop`, valid JSON, and zero reasoning tokens. The report also retains the earlier failed reasoning-off request, where repeated diagnosis text exhausted 3,000 tokens. Diagnoses are now constrained to six issues of at most 160 characters, and revised text fields have explicit bounds. A bounded diagnosis can still be poorly worded, so the report needs editorial review. These are transport/schema tests, not evidence that reasoning-off has equal editorial quality; compare quality during the human-reviewed pilot.
