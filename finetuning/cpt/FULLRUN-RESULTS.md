# Full CPT run — Qwen3.5-2B-Base → Tagalog/Cebuano

**Verdict: the recipe works at scale.** Every probe gate cleared by a wide margin, and English
improved rather than degrading. The raw checkpoint is a *base* LM and behaves like one — see
the caveats before treating it as shippable.

## The run

| | |
|---|---|
| Base | `Qwen/Qwen3.5-2B-Base` (1.88B text params, hybrid Gated DeltaNet) |
| Steps | **3,273 / 3,273**, rc=0, self-terminated cleanly |
| Tokens | **~13.7B** (3,273 × 4.19M) |
| Mix | tl-dominant + ceb + en/zh anchors, 24.78B-token pool, 2.63 epochs of the tl slice |
| Schedule | WSD, LR 8e-5, 200 warmup, 490 decay steps (15%), min_lr_ratio 0.1 |
| Loss | **4.144 → 1.756** (min 1.753 @ step 3220) |
| Hardware | 8×H100 SXM, EUR-IS-3, ~35.5h, 39.2 s/it, Liger on, zero errors |
| Cost | ~$972 (budget $1,000) |
| Weights | `Cryptopop/hiraia-cpt-flagship-2b` (PRIVATE) + volume `0kt4j6h85v` |

Loss on the 8e-5 plateau: 2.102 (400) → 1.945 (1200) → 1.864 (2000) → 1.855 (2400).
The decay phase moved it 1.801 → 1.756, so annealing bought a real final gain rather than
just flattening.

## Held-out perplexity

400 docs × 1024 tokens per language, identical settings for both models. Held-out sets are
reproduced bit-for-bit from `verify_carve_heldout.py` (`random.Random(42)`, 1,000-draw before
the 5,000-draw — the RNG is shared, so draw order matters) and, for English, the first 2,000
docs of the reserved last `sample/10BT` shard (`014_00000.parquet`).

| lang | base | **cpt-3273** | delta | probe ckpt-125 |
|---|---|---|---|---|
| tl | 22.639 | **4.570** | **−79.8%** | −63.2% |
| ceb | 25.416 | **4.448** | **−82.5%** | −63.0% |
| en | 15.568 | **14.968** | **−3.9%** | +1.5% |

Sanity check on the methodology: base English came out 15.568 here vs 15.567 in the probe.

**English improved.** The anchor mix did more than prevent catastrophic forgetting.

## Generation — what actually changed

Greedy, 45 new tokens, same prompts as the probe.

- `"Ang photosynthesis ay"` — base degenerates into `"___ at ___"` filler. CPT: *"isang proseso
  na nangyayari sa mga halaman, algae, at ilang mga bakterya"* — fluent and scientifically correct.
- `"Ang adlaw mao ang"` — base answers in **Tagalog** and loops. CPT answers in correct Cebuano
  *and* fixes the probe's semantic error: ckpt-125 read *adlaw* as "day"; this reads it as the sun
  (*"ang sentro sa atong solar nga sistema… usa ka bituon"*).

## Caveats — do not gloss these

1. **Greedy decoding degenerates.** `"Bakit umuulan?"` returns the prompt on repeat. The base
   model does this too; it is ordinary base-LM behaviour, but it means the raw checkpoint is not
   usable for generation without SFT.
2. **Cebuano leaks to Tagalog.** `"Ang tubig"` was answered in fluent *Tagalog*. Cebuano is a
   small share of the mix against a tl-dominant remainder, so the model defaults to Tagalog on
   ambiguous prompts. This is the failure mode that would hurt Bisaya users specifically —
   worth a targeted Cebuano bucket in SFT, and worth re-checking once synth-ceb is folded in.
3. **Held-out overlap, unchanged from the probe.** tl/ceb held-outs are carve-outs of the *same*
   cleaned pools as training, so part of the ppl drop is domain adaptation, not pure language
   acquisition. The generation change (degenerate → fluent, correct) is the stronger evidence.
   The English number is free of this critique (reserved shard, never trained on).

## Gate 4 — GGUF ship path: PASS (with a required flag)

Converted, quantized and generated from `checkpoint-3273`. Two traps, both now understood.

**1. `--no-mtp` is REQUIRED, or the GGUF is unloadable.** The base model carries a
Multi-Token-Prediction head. Stripping the vision tower and saving `language_model` drops the
MTP weights, but `mtp_num_hidden_layers: 1` survives in the config — so the converter stamps
`block_count = num_hidden_layers + mtp = 25` while writing only 24 blocks. The file converts
and quantizes to exactly the right size, then dies at load:

    check_tensor_dims: tensor 'blk.24.attn_norm.weight' not found

Setting `mtp_num_hidden_layers: 0` does NOT work (`assert self.opt_num_mtp_layers != 0` in
`conversion/qwen.py`). Pass `--no-mtp` instead. This is not a llama.cpp regression — b10603 and
b10630 behave identically; the earlier ckpt-125 pass simply had no MTP field to trip over.

    convert_hf_to_gguf.py <ckpt> --no-mtp --outfile f16.gguf --outtype f16
    -> block_count 24, blk.0..blk.23  CONSISTENT

**2. `nproc` lies again.** `llama-server -t $(nproc)` used 160 threads against a 17-core cgroup
quota and produced **0.05 tok/s**, which reads as a hang. With `-t 16` on the same machine:

| | |
|---|---|
| prefill | **97.1 tok/s** |
| decode | **44.5 tok/s** |
| Q4_K_M size | 1.56 GB |

Q4_K_M output is correct in both languages:
- `"Ang photosynthesis ay"` -> *"ang proseso kung saan ang mga halaman ay gumagawa ng kan..."*
- `"Ang adlaw mao ang"` -> *"sentro sa atong solar nga sistema, nga adunay daghang mga"*

(x86 with 16 cores is not the Redmi; this proves the arch converts and runs on CPU, it is not
an on-device speed estimate.)

**Artifacts** — `Cryptopop/hiraia-cpt-flagship-2b` (PRIVATE): `model.safetensors` + tokenizer +
config, and `gguf/hiraia-cpt-2b-Q4_K_M.gguf`.

## Next

SFT/KD on this base → grounded → DPO, then GGUF for on-device. Gate 4 (GGUF convert/load/
generate) passed on a CPT'd checkpoint already; re-run it on this one before shipping.
