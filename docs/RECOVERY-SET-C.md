# Hiraia recovery set C

You own **2,836 facts** in partition `external_c`. Work in `/Users/luis/Code/hiraia-unified`, branch `unified`.

Read [the full workflow](SECOND-PASS-PARALLEL-HANDOFF.md) before starting. It describes the existing work, exact review requirements, file schema, and centralized validation. Also read `tools/curriculum-recovery/SECOND-PASS.md`.

## Your exclusive files

- Inventory: key `external_c` in `tools/curriculum-recovery/second-pass-partitions.json` (read-only).
- Your ledger: `tools/curriculum-recovery/external_c-second-pass-state.json`.
- Your packet range: `batch-30000` through `batch-39999`.
- You may write your numbered `.packet.json`, `.review.jsonl`, and notes files only, plus your ledger.

Inspect existing packets and resume unfinished assignments. Export a first packet using:

```sh
cd /Users/luis/Code/hiraia-unified
python3 tools/curriculum-recovery/second-pass-batch.py --owner external_c --limit 96 --out tools/curriculum-recovery/batch-30000.packet.json
```

Increment packet numbers within your range. Each packet reserves all its facts immediately. Export sequentially before dispatching reviewers. Choose fewer than96 when needed for careful review or rate limits; do not count unseen facts. Any child reviewers must operate only inside your assigned set and write their owned packet decisions.

Read complete English, exact competency requirements across grades, all current admitted facets, both source-pool variants, and all Tagalog/Cebuano for approvals. Use primary sources for uncertainty. Record recoveries or precise holds with potential destinations. Keyword matches alone do not qualify. Save complete reviews atomically and run `apply.py` without `--apply`.

**Do not apply tags, mutate authoring/generated content, compile manifests, update shared checkpoints, commit, push, build or deploy.** The local coordinator integrates all four sets after reviewing decisions and validating compiled membership/reach/tests. Your completed proposals remain pending until then.

Report packet paths, reviewed/proposed-recovery/hold counts, dry-run result and notable issues. Maintain your ledger. Your scheduling/runtime constraints come from your own user/session; do not alter the local coordinator's heartbeat. Stop when all2,836 assigned IDs have decisions, leaving a clear handoff for integration.
