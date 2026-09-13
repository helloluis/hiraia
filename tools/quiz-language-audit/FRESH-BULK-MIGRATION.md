# Fresh-1 cloud batch migration

## Current deployment: schema v2, September 13

The corrected coordinator is `gemini_fresh_bulk_queue_v2.py`, using the same
Fresh-1 output and a separate `bulk-v2/` namespace. The v1 records below are
historical. Uploads contain up to 500 cards, with up to four outstanding cloud
jobs subject to the existing $30 Fresh-1 and $250 combined budget reservations.
The coordinator polls each accepted job every 60 seconds and feeds verified
proposals into Audit-2 without waiting for older cloud jobs to finish.

The provider rejected the old nullable `proposed` schema. The v2 wire schema
uses `type: ["object", "null"]` on the same constrained object. Original messages,
vocabulary guidance, option constraints and content validation remain unchanged.
The failed v1 probe remains preserved; its two failed cards were not retried.
Verified explicit zero-usage receipts reconcile their charges to $0.

The v2 probe (43838 and 43839) completed with two valid proposals, no failures,
and $0.001509375 actual aggregate cost. Both proposals passed provenance checks
and were durably queued in Audit-2. The verified `bulk-v2/CANARY-REVIEWED.json`
released the handover gate. Batches `bulk-v2/000002` (500 cards) and `000003`
(405 cards) were then accepted concurrently. Consult their current status files
for completion.

An immediate GET initially returned 404 for the accepted v2 probe; a later
GET-only read proved the same ID was processing. The original config and
`bulk-v2/BLOCKED.json` remain intact. `bulk-v2/recovery/authorization.json` binds
the archived runner, exact visibility evidence and corrected runner hash.
The one-use `--resume-known-batches` launch collected that existing ID without
resubmitting it; newly accepted jobs now wait 60 seconds before their first GET.
Do not replay this recovery or clear its evidence. Current launch argv is saved
under `bulk-v2/recovery/`; ordinary v2 launch records remain historical.

Audit-2's original configuration is preserved through the chained
`migration-fresh-batch-v2.json` dependency attestation. Audit-2 and the free
reference watcher are resumed. Nothing is applied to quiz sources.

## Historical v1 migration

Status: active cloud canary, 13 September 2026. The user approved the graceful
pause and migration. Fresh-1, Audit-2 and the reference watcher drained cleanly
with zero interrupted requests, and the resumed processes are recorded in their
monitoring files. Cloud batch 1 contains two untouched canary cards and has been
accepted. Larger batches await validated output and downstream handover.

The existing OpenRouter key works. The verified model catalog maps
`google/gemini-3.8-flash` to `google/gemini-3.8-flash-20260902`; its batch prices
are $0.375 input / $1.875 completion per million tokens. Retain the existing
$30 Fresh-1 and $250 overall usage ceilings, including prior spending and
uncertain reservations. No further funding or Google key is required by this
OpenRouter route.

## Prepared behavior

- `gemini_fresh_bulk_queue.py` replaces Fresh-1's local request dispatcher with
  real `POST /api/beta/batches` jobs. It first uses two untouched cards as a
  format canary, then submits up to 500 requests per batch with at most one
  batch outstanding. The canary is counted and consumed exactly once.
- Every Google batch has one identical response schema. Cards are grouped by
  schema; the last group or a group limited by conservative budget admission
  can be smaller than 500. Existing local manifests of 50 stay unchanged.
- Keep the same English-only messages, youth-friendly prompt, model, low
  reasoning, temperature zero, 8,000-token maximum and content validator.
  Actual batch requests omit Flex-only routing fields. Raw batch responses
  and aggregate provider billing remain intact; no Flex metadata is invented.
- Poll known batch IDs every 60 seconds. A completed GET includes results;
  validate exact custom-ID coverage, model, non-BYOK billing and price caps,
  then import individual results and make proposals available to Audit-2.
  Audit-2 discovers them on its existing 60-second cadence.
- Before the first 500-card submission, the coordinator stays alive at a local
  handover gate. After contract/billing validation and confirmed Audit-2 queue
  ingestion of at least one actual proposal, monitoring creates
  `bulk/CANARY-REVIEWED.json` with the verified terminal hash and selected IDs.
  This requires no further user permission or paid review. Valid holds alone
  cannot release the gate. Later batches proceed automatically within limits.
- Preparation freezes only untouched eligible Fresh-1 cards after the old
  worker drains. Started, failed, held and completed jobs are never resubmitted.
  The original prompt/config/queue and all existing results remain unchanged.
- Batch manifests, submission intent, acceptance, terminal response, billing,
  and per-card origin/receipt records provide provenance. Actual aggregate
  charges are counted once; per-card allocations are labeled as allocations.
- Unknown submission outcomes and billing/schema failures stop spending.
  `collect` can GET and import an already accepted batch after the coordinator
  exits; it cannot POST or retry requests. A failed coordinator writes a
  `bulk/BLOCKED.json` marker that requires explicit reconciliation.
- No translation proposals are applied to quiz sources. No builds or deploys.

## Handover, after explicit graceful-pause permission

1. Verify exact process IDs/commands and frozen code hashes. Signal the original
   Fresh-1 and Audit-2 runners to stop admission and drain active requests.
   Stop the free watcher after its atomic export. Verify all three exited and
   no request was abandoned. Archive their process records and launch argv.
2. Apply the staged selector/Audit-2 changes from
   `runs/pipeline-monitoring/fresh-bulk-migration/staged/`. Create the exact
   `migration-fresh-batch-v1.json` attestation described by the staged helper:
   original config hash, exact old/new hashes for the two changed files and
   the new batch contract. Never replace or loosen the original config.
3. Run `gemini_fresh_bulk_queue.py prepare` to freeze the final untouched set
   and legacy accounting, then run the offline tests. Save the launch argv.
4. Launch the coordinator persistently, then resume Audit-2 with its existing
   saved argv and new verified migration attestation. Restart the free watcher.
   These are intentional migration launches, not retries of failed API jobs.
5. Verify the small cloud canary and the first real 500-card batch acceptance.
   Confirm collected proposals enter Audit-2 with intact provenance. If the
   provider rejects the schema, stop and investigate; do not send the bulk queue.
6. Update the five-minute heartbeat for the active batch mode: distinguish
   prepared local groups, submitted cloud jobs, pending provider work and
   downloaded results. Cloud import bursts must not produce a throughput ETA.

The handover and integration installation are complete; the original config,
prompt and legacy results remain intact. The active heartbeat runs every five
minutes and distinguishes cloud submission/collection from local manifests.
105 offline checks passed before launch. Use current cloud status files for
progress; the provider supplies no reliable early completion ETA.
