# Hiraia illustration audit — Qwen 3.8 Omni Flash

Give this directory to the reviewing agent. Start from `/Users/luis/Code/hiraia`.
The scripts use Python's standard library; no package installation is required.

## Receiving agent: API execution runbook

**Task:** run the illustration audit using Alibaba Cloud's Qwen API and return a
reviewable findings report. Do not replace this with a text-only review of image
names. The supplied runner sends the actual image bytes to Qwen. The carabao
replacement is already complete; preserve it and the rejected calibration fixture.

**Current state at handoff:** local tests and image-delivery checks passed; the
snapshot is prepared. The local credential was found and confirmed nonempty, but
Qwen model access has not been tested and no paid audit requests have been sent.
Recount the snapshot's results/attempts before launching in case another operator
has progressed it since this document was written.

**Relevant files:**

- `tools/image-audit/run_qwen.py`: paid, bounded API runner (optional `--workers` concurrency).
- `tools/image-audit/audit_images.py`: free inventory, request, import and report commands.
- `tools/image-audit/rubric.md`: separate visual and lesson-alignment checks.
- `tools/image-audit/carabao-replacement.json`: replacement provenance and affected cards.
- `tools/image-audit/runs/2026-09-21/`: prepared snapshot, then attempts and results.
- `/Users/luis/Code/hiraia/.env.local`: contains `ALIBABACLOUD_API_KEY`.
  **Read it through the runner; do not print, paste, commit or send the key to a model.**

1. Work in the canonical checkout and inspect its instructions and current changes.
   Other agents are editing this repository; preserve unrelated work. The snapshot
   is gitignored local data, so a fresh clone will not contain it automatically.

   ```sh
   cd /Users/luis/Code/hiraia
   git status --short
   python3 -B -m unittest discover -s tools/image-audit -p 'test_*.py'
   python3 -B tools/image-audit/audit_images.py report \
     --out tools/image-audit/runs/2026-09-21
   ```

   Check `lesson_inputs_unchanged`, `stale_image_sources`, pending counts and
   `api_attempts_without_verdict`. Investigate stale inputs or prior attempts before
   spending. Do not rebuild snapshots merely to bypass old attempt records.

2. Start the seven-request pilot with the explicit provider configuration:

   ```sh
   python3 -B tools/image-audit/run_qwen.py \
     --out tools/image-audit/runs/2026-09-21 \
     --env-file /Users/luis/Code/hiraia/.env.local \
     --endpoint https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions \
     --model qwen3.8-omni-flash \
     --slug calf-nursing-from-carabao \
     --limit 7
   ```

   No `source .env.local`, SDK install or key export is needed. Existing environment
   keys take precedence over the file; check variable **names/presence**, without
   displaying values, if authentication uses an unexpected account. An HTTP error
   must be investigated, not worked around by changing providers or blind retries.

3. Inspect the pilot's actual saved evidence. The old image must receive an anatomy
   rejection; a pass or uncertainty keeps the corpus gate closed. Inspect the new
   illustration's visual verdict and all five alignment verdicts; do not force them
   to pass. The gate tests only the known-bad image, so this manual pilot inspection
   remains necessary even if the command exits successfully.

   Results are in `results/JOB_ID.json`. Actual requests, streamed responses and
   error records are in `attempts/JOB_ID/`. Read the returned usage and reconcile
   charges with Alibaba Cloud. `started.json` deliberately retains an unknown-charge
   notice; it is not a settled cost ledger. The scripts do not enforce a dollar cap.

4. Continue against **the same snapshot**, removing `--slug` to include the corpus.
   For example, a bounded chunk of 100 new requests is:

   ```sh
   python3 -B tools/image-audit/run_qwen.py \
     --out tools/image-audit/runs/2026-09-21 \
     --env-file /Users/luis/Code/hiraia/.env.local \
     --endpoint https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions \
     --model qwen3.8-omni-flash \
     --kind visual \
     --workers 96 \
     --limit 40000
   ```

   Scale the chunk to the user's authorized scope and spending limit. Do not inherit
   any old translation-audit budget. The job order is calibration, all visual jobs,
   then all alignment jobs. Completed pilot jobs are skipped. Use `--kind visual`
   or `--kind alignment` to keep the phases separate; omit `--kind` to walk both
   in that order. A failed request is retried once into `attempts/<id>/retry/`.
   A second failure is filed as `results/<id>.json` with `verdict: null` and
   `error` (not a visual judgment) so the run continues. Calibration must still
   anatomy-reject before the corpus opens; a calibration error does not open it.
   `--workers N` runs N concurrent in-process threads that claim jobs with mkdir.
   Retain the same endpoint/model. Never delete attempt markers.

5. Rebuild the free report after each chunk or stopped/error exit:

   ```sh
   python3 -B tools/image-audit/audit_images.py report \
     --out tools/image-audit/runs/2026-09-21
   ```

   A fully received response that failed local import can be investigated and
   passed to `record` without another POST. Partial/missing responses remain
   unresolved, with unknown charges preserved. Do not fabricate a verdict.

**Acceptance criteria / final return:** provide visual and alignment pass/reject/
uncertain/pending counts separately, technical or unresolved attempts, received
usage and reconciled cost (clearly distinguish unknown charges), and links to
`report.json`, `review-queue.json`, `pass-spot-check.json` and representative raw
results. Include every affected card for an asset-level defect. Inspect some model
passes as well as rejects. If scope or budget stops the run, explicitly report the
unaudited remainder; do not describe a partial audit as complete.

This is an audit handoff. Do not automatically apply judgments, regenerate further
images, edit card text, rebuild/install APKs, publish assets or commit unrelated work.

The goal is to catch malformed or scientifically misleading drawings, **separately
from** whether a drawing fits its card. The original headless/double-tailed carabao
is preserved as a blinded image-only calibration request. Do not edit its judgment
to open the gate: the actual reviewer must reject its anatomy with visual evidence.
One calibration failure caught is only a smoke check, not a measured accuracy claim.

## Existing prepared snapshot

`tools/image-audit/runs/2026-09-21` contains a free local snapshot:

- 35,645 unique images, including bundled illustrations and the full downloadable tail.
- 40,983 image–card relationships with actual English, Filipino and Cebuano text.
- 8,173 text-only cards intentionally excluded from image checks.
- One extra known-bad calibration image, outside the shipping image inventory.

No Qwen requests have been sent as part of preparing this handoff. Inventory counts
are tied to that snapshot, not a promise that the repository never changes.
Unreferenced but delivered assets still receive the image-only review. Each image's
visual defects propagate to **all** cards using it in `review-queue.json`.

The corrected `calf-nursing-from-carabao` has five uses. It is a bundled image,
so replacing the PNG repairs the input for the next APK build; this does not update
an already installed APK or publish anything. No card text was changed.

## Free preparation / inspection

First validate download delivery independently:

```sh
python3 -B packages/mobile/scripts/audit-image-packs.py --check
```

To create a fresh snapshot after asset/card changes, choose an unused directory:

```sh
python3 -B tools/image-audit/audit_images.py prepare \
  --out tools/image-audit/runs/NEW-SNAPSHOT
```

Preparation reads the generated image registry, bundled inventory, downloadable
shards, `cardsIndex.generated.json` and `assets/data/cards.db`. It refuses missing
images/text, inconsistent inventories and stale downloadable sources. It does not
regenerate manifests, edit assets, submit API calls or build APKs. Image bytes,
card text and the rubric are bound to immutable job IDs. Original artwork is
reviewed one image at a time, never as a tiny contact-sheet thumbnail.

Inspect the next work item:

```sh
python3 -B tools/image-audit/audit_images.py next \
  --out tools/image-audit/runs/2026-09-21 --limit 1
```

This prints a JSON line containing the image path, exact prompt and job identity.
For an agent with image-viewing tools, open that image, follow the supplied prompt,
and save the exact verdict JSON. A filename alone is not a visual inspection.

## Alibaba Cloud runner (paid only when explicitly invoked)

`run_qwen.py` reads `ALIBABACLOUD_API_KEY` (or `DASHSCOPE_API_KEY`) from the environment,
then the repository's `.env.local`. It does not print or save the key. The default
endpoint matches the existing repository Qwen tooling:
`https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions`.
Use `--endpoint` if this account requires a different regional/workspace endpoint.
It must be an Alibaba HTTPS endpoint; HTTP redirects are refused.

The default model ID is `qwen3.8-omni-flash`. It uses text output, image input,
and streaming Chat Completions with usage requested and **thinking disabled**
(`enable_thinking: false`). The model thinks at `xhigh` by default; anatomy
notes in `reasoning_content` were tripping DashScope output inspection. Follow
the [official Alibaba Qwen-Omni documentation](https://help.aliyun.com/en/model-studio/qwen-omni).
Account/model access is not established merely because a local key exists.
There is no fallback to another model/provider.

Start with the known-bad image plus the replacement and its five card relationships
(**at most seven requests**, NOT the entire collection):

```sh
python3 -B tools/image-audit/run_qwen.py \
  --out tools/image-audit/runs/2026-09-21 \
  --slug calf-nursing-from-carabao --limit 7
```

This command incurs provider charges. `--limit` caps new requests, not dollars.
Before commissioning the full audit, inspect this pilot's raw outcomes and provider
usage/cost, agree the full-run spending limit, and decide how many images to review.
There is intentionally no unlimited default or automatically launched full audit.
Both checks across the full snapshot would require up to 76,629 requests including
calibration; review visual defects first and investigate rejects before a full
claim-alignment sweep. This script does not estimate prices or silently inherit a
budget from previous text audits.

Each POST has a durable attempt record written first. It saves the raw streamed
response, including any returned usage. A provider error, truncated stream or
invalid JSON is retried **once** (new files under `attempts/<id>/retry/`). If the
retry also fails, the job is filed as an `error` result and the runner continues.
Never delete attempt markers or assume failed/unknown requests cost zero.
`--limit` counts finished jobs this invocation, including filed errors. A later
invocation skips jobs that already have a result, and will retry an attempt that
failed only once. `--workers` may be greater than 1; do not start a second parent
process against the same snapshot while one is still running. For a 12-hour pass
over ~76k remaining jobs, size workers from observed latency (about 40–110s in
the pilot): roughly `remaining * seconds_per_job / 43200`. qwen3.8-omni-flash
International is listed at 30,000 RPM; TPM is dynamic.

To run without the supplied API runner, export one portable request body:

```sh
python3 -B tools/image-audit/audit_images.py request \
  --out tools/image-audit/runs/2026-09-21 --id JOB_ID --file /tmp/qwen-image-request.json
```

It embeds the actual PNG bytes as a data URI. The calling agent must track its own
external request/charge ledger and avoid duplicate submissions. Prefer the supplied
runner, which does this automatically. Save the full response before importing it.

## Record and report

For an in-session review or an externally executed request:

```sh
python3 -B tools/image-audit/audit_images.py record \
  --out tools/image-audit/runs/2026-09-21 --id JOB_ID \
  --response /path/to/response.json --reviewer qwen3.8-omni-flash
python3 -B tools/image-audit/audit_images.py report \
  --out tools/image-audit/runs/2026-09-21
```

`record` accepts direct verdict JSON, Chat Completions JSON, or a saved SSE stream.
Missing checks, unexpected values, wrong image/job identity, truncated responses
and empty evidence are errors with **no quality verdict**, never an implicit pass.
Existing results are never overwritten. Edited images require a new snapshot;
old judgments are not reused for new pixels.

Outputs:
- `report.json`: separate visual/alignment/calibration counts, pending jobs,
  attempted requests without verdicts, stale image sources and changed lesson inputs.
- `review-queue.json`: rejected/uncertain/stale images, affected card IDs and
  references to the exact judgments and evidence in `results/`.
- `pass-spot-check.json`: deterministic 5% sample (rounded up) of fully model-passed
  assets for human inspection. Until all pair checks for an image finish, it is not
  included among fully passed images. Counts describe this frozen snapshot.

For visual-only spot checks before the second phase, inspect a random sample of
`results/` visual passes as well. Do not equate model passes with certification.
No command applies decisions, hides images, rewrites translations or regenerates
art. Bring the review queue back for decisions and replacements. Preserve source
art and generation history; apply a confirmed asset rejection to every use, while
an alignment-only rejection affects that specific image/card pairing.

## Local verification

```sh
python3 -B -m unittest discover -s tools/image-audit -p 'test_*.py'
```

Tests cover inventory scope, stale bytes, malformed verdicts, uncertainty, the
calibration gate, streaming truncation, identity changes, and bounded API execution
with a mocked transport. They do not assert that Qwen will catch every bad image.
