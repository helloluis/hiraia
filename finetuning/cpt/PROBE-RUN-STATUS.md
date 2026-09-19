# Probe CPT run status (live file — babysitter appends below)

**Run committed 2026-08-22 ~12:57 GMT+8** on trainer pod `vazmv3sl7e0u3r` (8×H100, any-DC).
Config: bs2 × ga16 × 8 ranks × 4096 = 1.05M-token global batch, 4,900 steps ≈ 5.1B tokens,
cosine LR 8e-5, checkpoints every 500 steps (`save_only_model`, limit 12) synced to helper pod
`5pjlozwn7fbcrt` → volume `hiraia-cpt-corpus:/workspace/probe-cpt-run1/` every 15 min.
Canary: variant C PASSED (3.81 s/it @ bs2 ga8; ~17.2k tok/s/GPU global-normalized).
Projected: ~10.3h → completion ~23:15 GMT+8 2026-08-22, ≈$273 trainer cost.
Safety layers: driver self-termination (creds baked) + on-pod watchdog (5-min checks, terminates
on driver-death-without-completion) + helper 36h TTL + this babysitter schedule (2h cadence).

Next after completion: go/no-go evaluation per PROBE-CPT-CONFIG.md §5 — held-out ppl
trajectories (tl/ceb/en) across checkpoints, generation battery vs the garbled base, GGUF
conversion check on llama.cpp ≥ b10152.

## Heartbeats (babysitter appends)
- 2026-08-22 14:00 GMT+8 — HEARTBEAT: global_step 383/4900 (8%), 7.53 s/it, ~9h25m remaining, ETA ~23:15 GMT+8. Trainer RUNNING ($26.32/hr), helper RUNNING.
- 2026-08-22 16:00 GMT+8 — HEARTBEAT: global_step 1338/4900 (27%), loss 2.499, token_acc 0.51, 7.52 s/it, ~7h26m remaining, ETA ~23:30 GMT+8. Trainer RUNNING, helper RUNNING (within TTL).
- 2026-08-22 18:00 GMT+8 — HEARTBEAT: global_step 2293/4900 (47%), loss 2.458, token_acc 0.5149, 7.52 s/it, ~5h27m remaining, ETA ~23:27 GMT+8. Trainer RUNNING ($26.32/hr), helper RUNNING (~8h old, within 36h TTL).
- 2026-08-22 20:00 GMT+8 — HEARTBEAT: global_step 3245/4900 (66%), loss 2.435, token_acc 0.5187, 7.52 s/it, ~3h28m remaining, ETA ~23:30 GMT+8. Trainer RUNNING ($26.32/hr), helper RUNNING (~10h old, within 36h TTL).
- 2026-08-22 22:00 GMT+8 — HEARTBEAT: global_step 4194/4900 (86%), loss 2.422, token_acc 0.5206, epoch 1.02, 7.56 s/it, ~1h29m remaining, ETA ~23:30 GMT+8. Trainer RUNNING ($26.32/hr), helper RUNNING (~12h old, within 36h TTL).

## SUCCESS — 2026-08-23 00:00 GMT+8 (2026-08-22 16:00 UTC)
Trainer pod `vazmv3sl7e0u3r` is GONE from the pod list (self-terminated as designed).
Helper log `/workspace/corpus/logs/probe-cpt.log` confirms clean completion:

```
{'train_runtime': '3.707e+04', 'train_samples_per_second': '33.84', 'train_steps_per_second': '0.132', 'train_loss': '2.493', 'epoch': '1.198', 'global_step/max_steps': '4900/4900', 'elapsed_time': '10h 17m 46s', 'remaining_time': '0s', 'memory(GiB)': '76.36', 'train_speed(s/it)': '7.565'}
[INFO:swift] last_model_checkpoint: /root/probe-out/v0-20260822-045637/checkpoint-4900
[INFO:swift] End time of running main: 2026-08-22 15:29:53.237148
=== PROBE TRAIN COMPLETE 2026-08-22T15:29:58Z ===
>> final sync + self-terminate 2026-08-22T15:30:58Z
```

Final metrics: 4900/4900 steps, train_loss 2.493 (last-step loss 2.425), token_acc 0.5198,
epoch 1.198, runtime 10h17m46s (7.56 s/it — right on the canary projection).
Checkpoints on helper `/workspace/probe-cpt-run1/v0-20260822-045637/`: **10 checkpoints**
(500…4500 every 500 + final 4900), 348M total, plus logging.jsonl / args.json / runs.
Verified intact: LoRA-CPT checkpoints — each contains adapter_model.safetensors (33M) +
adapter_config.json + trainer_state.json (35M/ckpt is the expected full size, not a partial sync).
Helper `5pjlozwn7fbcrt` still RUNNING, ~14h old — within its 36h TTL (expires ~2026-08-23
14:05 UTC / 22:05 GMT+8), left alone for the go/no-go eval work.

**BABYSITTER: run complete, safe to delete this schedule.**
- 2026-08-23 02:00 GMT+8 (2026-08-22 18:00 UTC) — post-completion check: trainer still absent (confirmed self-terminated), helper log tail unchanged (`PROBE TRAIN COMPLETE`), 10 checkpoints / 348M intact on helper, helper ~16h old (within 36h TTL, expires ~22:05 GMT+8 tonight). No action taken; delete this schedule.
- 2026-08-23 04:00 GMT+8 (2026-08-22 20:00 UTC) — post-completion check: trainer still absent, helper log tail unchanged (`PROBE TRAIN COMPLETE 2026-08-22T15:29:58Z`), 10 checkpoints / 348M intact on helper, helper ~18h old (within 36h TTL, expires ~22:05 GMT+8 tonight). No action taken; this schedule is redundant — safe to delete.
- 2026-08-23 06:03 GMT+8 (2026-08-22 22:03 UTC) — post-completion check: trainer still absent, helper log tail unchanged (`PROBE TRAIN COMPLETE 2026-08-22T15:29:58Z`), 10 checkpoints (500…4500 + 4900, 346M du) intact on helper, helper ~20h old (within 36h TTL, expires ~22:05 GMT+8 tonight). No action taken; schedule remains redundant — safe to delete.
- 2026-08-23 08:00 GMT+8 (2026-08-23 00:00 UTC) — post-completion check: trainer still absent, helper log tail unchanged (`PROBE TRAIN COMPLETE 2026-08-22T15:29:58Z`), 10 checkpoints / 348M intact on helper, helper ~22h old (within 36h TTL, expires ~22:05 GMT+8 tonight). No action taken; this schedule is redundant — safe to delete.
Next (human/eval session, per PROBE-CPT-CONFIG.md §5): held-out ppl trajectories across
checkpoints, generation battery vs the garbled base, GGUF conversion check.

---

# RUN 2 (full-param — run 1 was inadvertent LoRA, see PROBE-CPT-CONFIG changelog)

**Committed 2026-08-23 14:35 GMT+8** on trainer `fzi92l969pui56` (8×H100, 213.181.105.225:17086).
Config: `--tuner_type full` + ZeRO-2, physically vision-stripped base (/root/qwen35-2b-text),
bs2×ga64×8×4096 = 4.19M global batch, 1,225 steps ≈ 5.13B tok, WSD (decay last 185 → 0.1×),
save every 125 steps → helper `7ewpl5u6qe0g51` → volume `probe-cpt-run2/`. Gates at commit:
mem 70.04GiB, 30.9 s/it (→10.5h ≈ $278), loss 3.89→1.99 on canary. Watchdog + 36h babysitter armed.
Attempts 1–7 forensics: LoRA default, env-injection gap, vision assertion (config→index→graph→
saved-tensors), awk scientific notation, zombie GPU workers, dir-total vs per-ckpt, gate parser
KeyError — every one now encoded as a guard. Debug cost ≈ $55 total.

## Run-2 heartbeats (babysitter appends)
- 2026-08-23 16:00 GMT+8 — HEARTBEAT: global_step 110/1225 (9%), loss 2.361, token_acc 0.5238, 31.7 s/it, ~9h49m remaining, ETA ~01:50 GMT+8 (2026-08-24). Trainer RUNNING, helper RUNNING (~7h old, within 48h TTL).
- 2026-08-23 18:00 GMT+8 — HEARTBEAT: global_step 340/1225 (28%), loss 2.146, token_acc 0.5552, 31.71 s/it, ~7h48m remaining, ETA ~01:48 GMT+8 (2026-08-24). Progress healthy (110→340 in 2h, on pace). Trainer RUNNING, helper RUNNING (~9h old, within 48h TTL).
- 2026-08-23 20:00 GMT+8 — HEARTBEAT: global_step 565/1225 (46%), loss 2.057, token_acc 0.5685, 31.66 s/it, ~5h48m remaining, ETA ~01:48 GMT+8 (2026-08-24). Progress healthy (340→565 in 2h, on pace). Trainer RUNNING, helper RUNNING (~11h old, within 48h TTL).
- 2026-08-23 22:00 GMT+8 — HEARTBEAT: global_step 795/1225 (65%), loss 2.019, token_acc 0.5738, 31.63 s/it, ~3h47m remaining, ETA ~01:47 GMT+8 (2026-08-24). Progress healthy (565→795 in 2h, on pace). Trainer RUNNING ($26.32/hr), helper RUNNING (~13h old, within 48h TTL).
- 2026-08-24 00:00 GMT+8 — HEARTBEAT: global_step 1025/1225 (84%), loss 1.968, token_acc 0.5817, epoch 1.002, 31.6 s/it, ~1h45m remaining, ETA ~01:45 GMT+8. Progress healthy (795→1025 in 2h, on pace); checkpoint-1000 saved. Trainer RUNNING ($26.32/hr), helper RUNNING (~15h old, within 48h TTL).

## RUN 2 OUTCOME — 2026-08-24: TRAINED FINE, ARTIFACTS LOST

**Training succeeded**: reached ≥ step 1125/1225 (92%; midnight heartbeat 1025 @ loss 1.968,
token_acc 0.5817, epoch 1.00). Loss curve across the run: 3.89 → 2.50 → 2.15 → 2.06 → 2.02 → 1.968.

**Artifacts did NOT survive.** Volume holds: `checkpoint-125` COMPLETE (4,780,810,864 B),
`checkpoint-250` PARTIAL (4.50/4.78 GB), `checkpoint-375…1125` EMPTY dirs, `v0-*/` tree all empty,
driver log 0 bytes. Cause: cross-DC sidecar rsync (~7.6 MB/s) could not keep up with 3.76GB
checkpoints; final sync failed → driver's R-4 rule refused to self-terminate → watchdog stood down
on the `NOT terminating` marker → pod billed $26.32/hr until the account hit $0 → RunPod terminated
everything, taking the pod's local disk (all 10 checkpoints) with it. The 02:00 babysitter that
would have caught the runaway failed on **Claude usage credits** (unrelated pool).

**Recoverable science**: checkpoint-125 (525M tokens) vs base — one real trajectory point + the
training-loss curve above. Corpus, probe mix, and held-outs (5k tl / 5k ceb / 2k en) all intact.

**Required fixes before any re-run** (all encoded in memory `hiraia-runpod-cgroup-quota`):
1. Trainer writes checkpoints DIRECTLY to a network volume in its own DC — no cross-DC sync.
2. Watchdog gets an unconditional cost ceiling (terminate past N hours of pod age, no exceptions).
3. Fewer/larger-interval saves; final checkpoint also pushed to the HF private archive.

## CHECKPOINT-125 EVALUATION — 2026-08-24: STRONG GO SIGNAL

Only checkpoint-125 survived run 2, i.e. **525M tokens (125 steps x 4.19M) — ~10% of the
intended probe.** Held-out perplexity, 400 docs x 1024 tokens per language, identical settings
for base and checkpoint:

| lang | base | ckpt-125 | delta |
|---|---|---|---|
| **tl**  | 21.299 | **7.835** | **-63.2%** |
| **ceb** | 25.020 | **9.249** | **-63.0%** |
| **en**  | 15.567 | 15.796 | +1.5% |

**Gates 1-3 of PROBE-CPT-CONFIG §5 all pass at 10% of the probe budget:**
1. Tagalog garbled -> fluent: YES. Base completed "Ang araw ay" with degenerate repetition
   ("mga puno, mga puno, mga puno"); ckpt-125 produces coherent prose, and its photosynthesis
   completion is scientifically correct Tagalog.
2. Cebuano forming: YES. -63% ppl and grammatical Cebuano output (content still drifts —
   "adlaw" read as "day" not "sun", and one completion loops — expected at 525M tokens).
3. English retained: YES. +1.5% is negligible; the anchor mix is doing its job.

**Honest caveat:** the held-out sets are carve-outs from the *same* cleaned pools as the
training mix, so part of the ppl drop is domain/style adaptation rather than pure language
acquisition. The generation-quality change (degenerate repetition -> fluent, correct prose) is
independent of that critique and is the stronger evidence.

**Implication:** the corpus teaches. The recipe works. A re-run is about *scale*, not validity —
and if 525M tokens buys this, the full 5.1B probe was likely to clear its gates comfortably.
Gate 4 (GGUF conversion of a CPT'd checkpoint) remains untested.
