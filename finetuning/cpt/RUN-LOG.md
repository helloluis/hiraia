# Hiraia run log

_Exported 2026-08-24 06:33 UTC from https://hiraia.b11.dev/admin — 21 entries._

Newest first. This file is the durable copy; the dashboard is the capture surface.

### 2026-08-24 06:33 UTC

RISK on the record: the driver caps STEPS, not dollars. If s/it drifts above the canary measurement, spend can exceed $1,105 and clip the $60 drain guard near the end. Worst case is losing the LR-decay tail, not the run -- checkpoints land on the volume every 300 steps.

### 2026-08-24 06:33 UTC

BUDGET: BUDGET_DECISION=$1105 pre-written to /workspace/fullrun/BUDGET_DECISION and confirmed parseable by the driver. At 31.6 s/it -> 4,782 steps = 20.0B tokens (81% of the 24.78B mix); at 26 s/it (if Liger delivers) -> 5,813 steps = 24.4B (98%). Driver derives steps from MEASURED s/it, so faster throughput automatically buys more tokens.

### 2026-08-24 06:33 UTC

AUDIT: ms-swift PackingDataset accepts load_from_cache_file but never uses it, so bin-packing re-runs every launch -- however it works only on the integer lengths column, master-only across 160 procs, so it costs minutes not hours. The expensive Map IS cached (keyed on dataset fingerprint, not max_steps/output_dir).

### 2026-08-24 06:33 UTC

AUDIT: driver does 'sleep 60; terminate' after training, so there is NO in-session eval window. Eval will instead run on a separate 1xH100 in AP-IN-2 with the volume attached (~$2.50/hr vs $26.32/hr) -- cheaper than in-session, and safe because checkpoints are durable on the volume.

### 2026-08-24 06:33 UTC

VERIFIED (not a bug): tie_word_embeddings=true is CORRECT for Qwen3.5-2B-Base -- the base config sets it too and model.safetensors contains NO lm_head tensor (genuinely tied). 1.88B params is the tied count; untied would be 2.39B since lm_head alone is 0.509B. A prior project note claiming 'untied' was wrong and has been corrected.

### 2026-08-24 06:33 UTC

FIX (wastage): guard ceiling hiraia-fullrun raised 40h -> 54h. Projected pod life is 48.9h, so the old 40h ceiling would have terminated a HEALTHY run mid-LR-decay, destroying the very checkpoint the run exists to produce. Also corrected stale expected_total_steps 1225 -> 4782.

### 2026-08-24 06:33 UTC

FIX (wastage): armed Guard 2 liveness during preprocessing via a kind=preprocess heartbeat sidecar with a 5s respawn wrapper. Before this the driver's first heartbeat came only AFTER the canary, leaving Guard 2 inert -- a wedged Map would have billed to the 40h ceiling = $1,053 unattended. Exposure now bounded to ~45 min (~$20).

### 2026-08-24 06:33 UTC

DECISION: do NOT restart to fix preprocessing. Remaining Map = $127; a perfect 10x fix saves ~$114 minus ~$40 of discarded Map progress = net ~$74, against the risk of a third failed restart and of losing a DC-locked 8xH100 found only after probing 8 datacenters. Map cache IS reused by the full run, so it is paid once.

### 2026-08-24 06:33 UTC

MEASURED preprocessing bottleneck: HF datasets map with num_proc=160 delivers ~930 ex/s -- SLOWER than a single core (1,973 ex/s batched; 9,892 ex/s with rust-parallel tokenizer on 10 cores). Classic num_proc collapse, same failure mode as the SailCraft num_proc=208 incident. Raising 24 -> 160 changed nothing because 24 was already collapsed.

### 2026-08-24 06:33 UTC

2026-08-24 FULL RUN pod 91dvthe56vrrg2 (8xH100 AP-IN-2, vol ump7ia07oh, $26.32/hr). Mix 21,730,569,538 B / 20,558,006 rows verified. Balance $1,335 after +$300 and +$500 top-ups.

### 2026-08-24 02:54 UTC

FULL MIX BUILT (mix-v1, volume 1atl7503ky /workspace/fullmix/mix-v1/). One 6.19B-token mix epoch x4 trainer epochs = 24.78B trained: tl 17.19B (69.4%, 4 ep), ceb 1.39B (5.6%, 8 ep), en 4.12B, zh 2.08B. Held-outs re-carved from consolidated pools (5k/5k/2k), leak check = 0 exact duplicates. ceb share fell 12%->5.6% because consolidation measured only 0.178B distinct ceb (<half the June estimate). ~5,900 steps at 4.19M global batch. Also freed 310GB of stale SailCraft intermediates from the volume.

### 2026-08-24 02:30 UTC

GATE 4 = PASS (delegated session). Full-param CPT'd checkpoint converts + quantizes + loads + generates. llama.cpp b10603, qwen35.block_count=24 (issue #24737 does NOT affect us), tokenizer overlay not needed. Conversion is NOT lossy — GGUF generations match the safetensors readout exactly. WATCH-OUT: Q4_K_M = 1.56GB vs base 1.27GB (+23%); the 248,320 vocab makes token_embd+output 45% of the file — try --output-tensor-type q4_K at ship time. ckpt-125 backed up to HF. Cost ~$0.15.

### 2026-08-24 02:29 UTC

CORPUS CONSOLIDATION DONE. tl: 20,772,130 docs across v1+v3+v2 -> 17,860,407 after cross-version dedup (14.0%) = 4.309B distinct Qwen tokens. ceb: 350,341 -> 349,713 (0.18%) = 0.178B tokens. Per-source tl dup: v1 0.34%, v3 15.6%, v2 24.8% (later sources overlap earlier ones, as expected). KEY: ceb is 0.178B — LESS THAN HALF the June inventory estimate of 0.37B. The full-run ceb ratio must drop or its epoch count rises.

### 2026-08-24 00:59 UTC

CHECKPOINT-125 EVAL = STRONG GO. Held-out ppl at just 525M tokens (10% of probe): tl 21.30->7.84 (-63%), ceb 25.02->9.25 (-63%), en 15.57->15.80 (+1.5%, retained). Base's degenerate 'mga puno mga puno' became fluent, scientifically-correct Tagalog. The corpus teaches; a re-run is about scale, not validity.

### 2026-08-23 23:24 UTC

Mission control + guard deployed on this VPS. Cost ceiling is unconditional and needs zero cooperation from the pod. No LLM in the path.

### 2026-08-23 22:24 UTC

ROOT CAUSE: driver refused to self-terminate on failed sync (by design), watchdog stood down on that same marker (by design), and the off-pod babysitter died on Claude usage credits. Composed guards = nothing fired.

### 2026-08-23 21:54 UTC

Probe run 2: trained cleanly to >=92% (step 1125/1225), loss 3.89 -> 1.968. But cross-DC checkpoint sync fell behind; only checkpoint-125 survived. Pod's local disk lost when the account drained.

### 2026-08-23 19:54 UTC

7-agent adversarial pre-flight before run 2: found ZeRO-2 required (full-param OOMs on plain DDP), LR regime wrong at 1.05M batch, and 8 other blocking issues.

### 2026-08-23 18:54 UTC

Probe run 1 FAILED: ms-swift `swift pt` defaults to tuner_type=lora — trained a rank-8 adapter, not full-param. Fix: --tuner_type full + a checkpoint-size assertion.

### 2026-08-23 17:54 UTC

Corpus v2+v3 (expansion session): +1.49B and +1.65B tl tokens. DCAD/OPUS/DepEd LR (24,975 modules). Running total ~4.6-5.1B tl → full 25B run at <=4 epochs is viable.

### 2026-08-23 16:54 UTC

Corpus v1 built: SailCraft at scale — tl 3,487,659 docs (1.53B tokens), ceb 340,960 (167M). Cebuano is data-starved everywhere; upsampling + Tagalog transfer is the only lever.
