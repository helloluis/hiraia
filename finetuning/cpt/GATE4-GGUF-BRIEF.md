# Gate 4 brief — can a CPT'd Qwen3.5-2B actually ship on-device?

**For:** a separate agent session. **Written 2026-08-24** by the main CPT session.
Context: `PROBE-CPT-CONFIG.md` §5 gate 4, `PROBE-RUN-STATUS.md`, memory
`hiraia-cpt-flagship-plan`, `hiraia-gguf-convert-tokenizer-gotcha`.

## Why this matters (read this before anything)

The probe thesis is now **validated** — checkpoint-125 (525M tokens) cut held-out
perplexity 63% in both Tagalog and Cebuano while keeping English. The next step is a
**~$700–850 full run at 20–25B tokens**.

Gate 4 is the one remaining way that money could be wasted entirely: **if a
full-parameter-trained Qwen3.5-2B checkpoint cannot be converted to GGUF and run on
the device, the entire run's output is unusable.** llama.cpp has an OPEN hybrid-arch
conversion bug ([ggml-org#24737](https://github.com/ggml-org/llama.cpp/issues/24737):
wrong `block_count` metadata) and Qwen3.5 is a hybrid Gated-DeltaNet + attention model.
The base model converted fine in June — but a *CPT'd* checkpoint has never been tested.

**Answer one question: does a CPT'd checkpoint convert, quantize, load, and generate
coherent text? YES or NO, with evidence.** A NO is just as valuable as a YES — it is
far cheaper to learn now than after the full run.

## Your input artifact

`checkpoint-125` — full-param, 4,780,810,864 bytes of `model.safetensors` + config +
tokenizer, at `/workspace/probe-cpt-run2/checkpoint-125` on RunPod network volume
**`1atl7503ky`** (`hiraia-cpt-corpus`, US-NE-1).

### STEP 1 (do this first — it is also a real deliverable)

**Back it up to HuggingFace.** It is the ONLY surviving trained artifact from run 2 and
it exists in exactly one place. Push it to the private repo
**`Cryptopop/hiraia-adapters-archive`** under `probe-run2/checkpoint-125/`
(HF token = `HUGGINGFACE_API_KEY` in `.env.local`; account `Cryptopop`; see memory
`hiraia-hf-archives`). Use `huggingface_hub.upload_folder`.

This also **decouples you from the main session**: once it is on HF, pull the checkpoint
from HF and you never need volume `1atl7503ky` again — the other workstream (corpus
consolidation) can then have that volume to itself.

## The actual test

1. **Convert.** llama.cpp **≥ b10152** (a July fix corrected GDN layer counting; older
   builds silently mis-handle it). `convert_hf_to_gguf.py` → f16 GGUF. Omit `--mmproj`;
   add `--no-mtp`. Watch for the #24737 symptom: wrong `block_count` in metadata → the
   loader later demands a `blk.N` that doesn't exist. The model has **24 layers** —
   verify the GGUF metadata says 24.
2. **Quantize** → `Q4_K_M` (expect ~1.2GB, matching the base model's June conversion).
3. **Load + generate.** Use `llama-server` + `/completion`, NOT `llama-cli -no-cnv`
   (that hangs — memory `hiraia-gguf-convert-tokenizer-gotcha`). Greedy, ~60 tokens.
4. **Judge the output.** This checkpoint should produce **fluent Tagalog** — that is the
   whole point. Reference prompts and what the un-converted checkpoint produced:
   - `"Ang araw ay"` → coherent prose (the BASE model degenerates into
     "mga puno, mga puno, mga puno" — if you see that, something is wrong)
   - `"Ang photosynthesis ay isang proseso kung saan"` → correct science in Tagalog
   - `"Ang adlaw mao ang"` → grammatical Cebuano
   If the GGUF output is garbled where the safetensors output was fluent, **the
   conversion is lossy and that is a gate FAILURE** — this is the real risk, not just a
   crash.
5. **Known adjacent trap:** transformers-5.x-saved models crash the 4.57.6 convert venv
   over `tokenizer_config` (`extra_special_tokens` list-vs-dict). Fix by overlaying a
   4.x `tokenizer_config.json`. This checkpoint was saved by transformers 5.15.1.

## Rules

- **Cost ceiling:** this is a <$15 job. A CPU pod or a cheap GPU pod is plenty
  (conversion is CPU work; you only need a GPU to run llama-server quickly, and even
  that can be CPU). **Always set a TTL self-destruct on any pod you create** —
  `setsid` a script that sleeps then calls
  `curl -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/<id>`.
- **Do NOT touch:** volume `6er6skgoyb` (the other workstream's), the `synth-ceb`
  service on the VPS, or anything under `/opt/hiraia-monitor`.
- **The VPS guard is watching.** Pods are auto-terminated past their name-based ceiling
  (`hiraia-*inspect*` = 1h, `hiraia-eval-*` = 3h, unnamed default = 6h). Name your pod
  accordingly and it will be cleaned up even if you crash. You can watch it at
  https://hiraia.b11.dev/admin.
- **Verify before believing.** Four separate eval launches in this project reported
  "running" while doing nothing — always check that a log is actually *growing* and use
  non-self-matching patterns (`pgrep -f "[e]val"` not `pgrep -f "eval"`).
- Env: `set -a; . ./.env.local; set +a` — the leading `./` matters in zsh.

## Definition of done

Append a **Results** section to this file (and commit) with: the verdict (GATE 4
PASS/FAIL), llama.cpp build used, GGUF file sizes, the metadata layer count, the actual
generations for all three prompts, and — if it failed — the precise failure mode and
whether a workaround exists. Confirm the HF backup path. Confirm your pods are gone.

## Results

**GATE 4 PASS.** A full-param CPT'd Qwen3.5-2B checkpoint converts, quantizes, loads, and generates. The conversion is not lossy relative to the safetensors readout in `PROBE-RUN-STATUS.md` (fluent Tagalog, correct photosynthesis science, Cebuano still looping at 525M tokens). The full ~20–25B run is not blocked on the ship path.

| | |
|---|---|
| Date | 2026-08-24 |
| Checkpoint | `/workspace/probe-cpt-run2/checkpoint-125` on volume `1atl7503ky` — `model.safetensors` **4,780,810,864 B** (exact match) |
| Arch | `Qwen3_5ForCausalLM` / `qwen3_5_text`, 24 layers, hidden 2048, vocab 248,320, transformers 5.15.1 |
| llama.cpp | **b10603** (`c060ca974`), CPU build (`GGML_CUDA=OFF`) |
| Convert | `convert_hf_to_gguf.py --outtype f16 --no-mtp` (no `--mmproj`) |
| Tokenizer overlay | **not needed** — `extra_special_tokens` was `null`; convert on transformers 4.57.6 succeeded |
| GGUF metadata | `general.architecture=qwen35`, **`qwen35.block_count=24`** (no #24737 `blk.N` miss). Tensors 321. Last block is `blk.23`. |
| f16 GGUF | **4,792,827,392 B** (4.46 GiB) |
| Q4_K_M | **1,560,460,800 B** (1.45 GiB / 1477.72 MiB @ 5.19 BPW). Larger than the ~1.2 GB June-base estimate because the 248,320-wide embedding+head dominate (token_embd q4_K 273 MiB + output q6_K 398 MiB). |
| Load | `llama-server` loaded Q4_K_M, health 200, `/completion` served. No missing-block crash. |
| HF backup | **`Cryptopop/hiraia-adapters-archive/probe-run2/checkpoint-125/`** — all 9 sidecar files + safetensors at the same 4,780,810,864 B. Confirmed via HF tree API. |
| Pod | `hiraia-eval-gguf` (`pchco6nwkddk15`), 1× RTX PRO 6000 Blackwell MIG 1g.24gb, US-NE-1, **$0.59/hr**, ~15 min. Self-TTL 2h + VPS `hiraia-eval-*` 3h ceiling + local 2h DELETE. **Terminated 2026-08-24 02:17 UTC.** Did not touch volume `6er6skgoyb` or `/opt/hiraia-monitor`. |

### Generations (greedy, `n_predict=60`, `temperature=0`, via `/completion`)

**1. `"Ang araw ay"`** — fluent Tagalog prose, **not** the base's `"mga puno, mga puno, mga puno"` degeneration.

> Ang araw ay nagsisimula na sa 12:00 ng hapon.
> Ang mga bagong kasapi ng 2022 ay nagpapakita ng kanilang mga talento sa isang bagong paraan.
> Ang mga bagong kasapi ng 20

(Content drifts — expected at 525M tokens; the conversion bar is fluency vs degeneration.)

**2. `"Ang photosynthesis ay isang proseso kung saan"`** — correct science in Tagalog (plants use sunlight to make glucose).

> Ang photosynthesis ay isang proseso kung saan ang mga halaman ay gumagamit ng enerhiya ng araw upang makagawa ng glucose. Ang glucose ay isang uri ng enerhiya na maaaring gamitin ng mga halaman upang makagawa ng iba pang mga sustansya.
> Ang proseso ng photos

**3. `"Ang adlaw mao ang"`** — grammatical Cebuano that loops. This **matches** the safetensors readout ("one completion loops — expected at 525M tokens"), so it is not conversion loss.

> Ang adlaw mao ang usa ka adlaw nga adlaw, ug ang adlaw mao ang usa ka adlaw nga adlaw.
> Ang adlaw mao ang usa ka adlaw nga adlaw, ug ang adlaw mao ang usa ka adlaw nga adlaw.
> Ang adlaw mao ang

### Notes / residual

- CPU decode of this hybrid on the MIG box was slow (~0.4 tok/s) — a test-harness cost, not a ship-path failure. Device QVAC already measured Qwen3.5-2B Q4_K_M on the Redmi (CPT-FLAGSHIP-PLAN §5b).
- `cmake` was missing on the pytorch image; install `cmake build-essential` before building llama.cpp. The original driver died on a missing `bc` after convert; quantize + server were run by hand on the same pod.
- A mistaken empty REST `POST /v1/pods` spawned an unnamed EUR-NO-1 4090 for ~seconds; it was deleted immediately (not attached to our volume).

**Pods gone:** eval pod `pchco6nwkddk15` is terminated. Live at write-up: only `hiraia-consolidate` (the other workstream — left alone).
