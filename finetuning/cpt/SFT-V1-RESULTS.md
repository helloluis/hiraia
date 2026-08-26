# SFT v1 on the CPT flagship — run record

**Result:** `Cryptopop/hiraia-sft-flagship-2b` (PRIVATE). Full-param SFT of the CPT'd
Qwen3.5-2B on 6,687 rows, 3 epochs, 1,254 steps, loss 1.651 → 0.996. **Verified from
`trainer_state.json` on HF, not from the driver's own "done" signal.**

| | |
|---|---|
| Base | `Cryptopop/hiraia-cpt-flagship-2b` (the −79.8% / −82.5% ppl checkpoint) |
| Data | `finetuning/sft-v1/train-merged.jsonl`: tagalog/train-v5 + bisaya/train-v5 + grounded + v5-work counterweights, deduped → 6,873 rows; 186 dropped for > 2048 tokens → **6,687** |
| Mix | tl 56% / **ceb 39%** / en 5% (vs ceb ≈ 1.3% of the CPT corpus) |
| Recipe | full-param, bf16, lr 1e-5 cosine, warmup 3%, bs 4 × ga 4, 3 ep, `--template qwen3` |
| Hardware | 1× A100 80GB PCIe (CA-MTL-3), ~47 min, ~$1.40 |
| Total cost incl. 3 failed attempts | ~$6 |

## What it took four attempts to learn

1. **ms-swift 4.5.2 does not recognise `qwen3_5_text`** and silently falls back to a `dummy`
   template that cannot render a system role. With `truncation_strategy: delete` that
   discarded every row with a system message — **6,521 of 6,873** — and trained 3 epochs on the
   352 that remained, then reported success. The run "completed" in 2 minutes at 66 steps.
2. `--template qwen3_5` renders the system prompt correctly but is registered as an
   **MLLM** template: its collator calls `get_rope_index` (mRoPE for image tokens), which the
   text-only strip does not have. **`--template qwen3`** is the working choice — same ChatML,
   same `<think>\n\n</think>` non-thinking prefix, text-only collator.
3. Two of the 6,873 messages carried a stray `image` key. Arrow inferred a wider struct from
   them and failed to cast the other 20,877. Normalise every message to exactly
   `{role, content}` before feeding swift.
4. **My own guard destroyed a successful run.** The step-count check picked the final
   checkpoint with `sort -t- -k2 -n` on the full path — field 2 was the run-dir timestamp,
   identical across checkpoints, so it chose epoch 2 (836 steps), tripped the `< 1000`
   check, and `die()` deleted the pod with all three checkpoints on it. Fixes: select by
   reading `global_step` from each `trainer_state.json`; and **a tripped guard HOLDS the pod
   and reports — it never deletes.** A checker that fires because the checker is wrong must
   not be able to destroy the evidence.

## Verification discipline that now applies to every run

A "done" heartbeat proves the driver finished, not that it trained on the right data. The
proof is `trainer_state.json` on HF: `global_step` must match the expected step count.
Two of four runs here reported success while being wrong.

## Next

Evaluate: regression gate + 143-probe capability benchmark, and specifically the Cebuano
routing test — does `"Ang tubig"` now answer in Cebuano? That answer decides whether the
synth-ceb corpus (~3,800 docs banked) is worth a CPT refresh or not.
