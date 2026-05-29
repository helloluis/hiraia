# Training Hiraia LoRA Adapters on a Mac (Apple Silicon)

This is the practical brief for running QVAC LoRA fine-tuning on a **MacBook Pro (M1/M2/M3, 16GB+ RAM)**. It's the recommended machine for **iterating** on the Tagalog and Cebuano adapters, because macOS arm64 gets clean QVAC native prebuilds — none of the Windows workarounds (OpenSSL DLL copying, `MAX_PATH`, manual Bare-runtime install) are needed.

> The trainer, worker, datasets, and adapter-loading are all cross-platform and already in the repo. On a Mac the only setup is: install Node + pnpm, `pnpm install`, and run. The Qwen3-1.7B base model (~1 GB) auto-downloads on the first run.

---

## 1. Why the Mac is nicer for this

| | Windows desktop (RTX 3080) | MacBook Pro (Apple Silicon) |
|---|---|---|
| Training speed | Fastest (dedicated GPU) | Good (Metal GPU, unified memory) |
| Setup | Needs OpenSSL DLLs, `MAX_PATH` worker, `supportedArchitectures`, `pnpm install --force` | **Clean** — prebuilt `.bare` addons, `pnpm install` just works |
| Frees up | — | Lets you keep the Windows desktop for other work |

Bottom line: the RTX 3080 is faster per run, but the Mac is the better *iteration* box — clean setup, and it's otherwise idle.

---

## 2. One-time setup

### Prerequisites

```bash
# 1) Xcode Command Line Tools (for git + toolchain). Skip if already installed.
xcode-select --install

# 2) Node 20+  (Homebrew shown; nvm is fine too)
brew install node@20            # or: brew install node

# 3) pnpm 9 via corepack (matches the repo's pinned packageManager)
corepack enable
corepack prepare pnpm@9.15.9 --activate

# verify
node -v        # >= 20
pnpm -v        # 9.15.x
```

### Clone + install

```bash
git clone <your-repo-url> hiraia
cd hiraia
pnpm install
```

`pnpm install` will:

- pull the **darwin-arm64** QVAC native prebuilds (the root `package.json`
  `pnpm.supportedArchitectures` now includes `arm64` + `current`, so the Apple-Silicon
  binaries are installed);
- run the `postinstall` script, which **no-ops on macOS** (it only does Windows DLL work).

> **If macOS Gatekeeper blocks an unsigned native addon** (rare): clear the quarantine
> attribute once with `xattr -dr com.apple.quarantine node_modules` and retry.

---

## 3. Run a training job

The trainer is `packages/server/src/train.mjs`. Run it from `packages/server`:

```bash
cd packages/server

# Tagalog (current best dataset)
node src/train.mjs --lang tagalog \
  --dataset ../../finetuning/datasets/tagalog/science-chat-v2.jsonl \
  --ctx 1024 --epochs 3 --device gpu

# Cebuano / Bisaya
node src/train.mjs --lang cebuano \
  --dataset ../../finetuning/datasets/cebuano/science-chat.jsonl \
  --ctx 1024 --epochs 3 --device gpu
```

- `--device gpu` uses the **Metal** backend on Apple Silicon.
- The first run downloads `Qwen3-1.7B-Q4_0.gguf` (~1 GB) to `~/.qvac/models/` and reuses it after.
- Live per-step `loss` / `accuracy` / `eta` is printed; checkpoints land in
  `finetuning/output/<lang>/checkpoints/` every 50 steps.
- On completion, the **GGUF adapter** is written to `finetuning/output/<lang>/` and its
  path + size are printed. (QVAC outputs GGUF directly — no conversion needed.)

### Quick smoke test (verify the toolchain in ~1 min)

```bash
node src/train.mjs --quick --device cpu        # 1 epoch, tiny dataset
```

### All flags

| Flag | Default | Notes |
|---|---|---|
| `--lang` | `tagalog` | also sets default dataset/output paths |
| `--dataset <path>` | `…/<lang>/science-chat.jsonl` | training JSONL |
| `--out <dir>` | `finetuning/output/<lang>` | adapter output dir |
| `--epochs <n>` | `3` | |
| `--device gpu\|cpu` | `gpu` | `gpu` = Metal on Apple Silicon |
| `--ctx <n>` | `2048` | **must be ≥ your longest conversation** |
| `--lr <n>` | `1e-4` | learning rate |
| `--lr-min <n>` | `1e-8` | **must be > 0** (see gotchas) |
| `--scheduler <s>` | `cosine` | `constant` \| `cosine` \| `linear` |
| `--warmup <r>` | `0.1` | warmup ratio (0–1) |
| `--batch <n>` | `512` | **token** count, not example count |
| `--micro-batch <n>` | `128` | **token** count |
| `--lora-rank <n>` | `16` | |
| `--lora-alpha <n>` | `32` | |
| `--quick` | off | 1 epoch, no validation split (smoke test) |

---

## 4. Three gotchas (already handled by defaults — don't undo them)

These cost real debugging time on the first runs; the defaults above are correct:

1. **`batch`/`micro-batch` are token counts**, not number-of-examples (they map to
   llama.cpp's `-b` / `-ub`). Tiny values like `1` make training crawl one token at a
   time and then trip `GGML_ASSERT(opt_pars.adamw.alpha > 0.0f)`. Keep them ≥ ~128.
2. **`lr-min` must be > 0.** With a cosine schedule and `lrMin = 0`, the learning rate
   anneals to exactly 0 on the final step and the AdamW optimizer asserts. `1e-8` is safe.
3. **`ctx` must be ≥ the longest conversation.** Anything longer is silently skipped
   ("too long"); if *all* examples are skipped you get `GGML_ASSERT(ndata > 0)`. Keep
   training answers concise (the `*-v2` datasets average ~175 tokens) and `ctx 1024` fits.

---

## 5. Evaluate an adapter

Point the inference sidecar at the freshly trained adapter and chat with it:

```bash
cd packages/server
HIRAIA_LORA_ADAPTER=../../finetuning/output/tagalog/<adapter>.gguf node src/index.mjs
# GET http://127.0.0.1:8080/health  -> "model": "qwen3-1.7b+lora(<adapter>.gguf)"
```

To compare **base vs. fine-tuned**, run the sidecar once without the env var and once
with it, sending the same Tagalog prompt to `POST /v1/chat/completions`. The mobile app
loads adapters through the identical `modelConfig.lora` path, so web eval reflects device behavior.

---

## 6. The iteration loop (Tagalog + Bisaya until they're good)

This is the workflow you'll repeat:

1. **Edit the dataset** — `finetuning/datasets/<lang>/*.jsonl`. Each line is one
   conversation: `{"messages":[{"role":"system",…},{"role":"user",…},{"role":"assistant",…}]}`.
   Keep answers natural Taglish/Bisaya, on-topic, concise, with a Socratic follow-up
   (see `tagalog/science-chat-v2.jsonl` as the quality bar).
2. **Train** — `node src/train.mjs --lang <lang> --dataset <file> --ctx 1024 --epochs 3`.
3. **Eval** — load the adapter in the sidecar (Section 5) and sanity-check a handful of prompts.
4. **Adjust** — if it's bland/over-fit, change the data first; then tune `--epochs`,
   `--lr`, `--lora-rank`. More/better data usually beats hyperparameter tweaking.
5. Repeat. Name adapters per version (e.g. `--out finetuning/output/tagalog-v3`) so you
   can A/B them.

**Dataset status:** `tagalog/science-chat-v2.jsonl` (49 grounded dialogues) is the current
good Tagalog set and the quality bar to copy. The Cebuano datasets
(`cebuano/science-chat*.jsonl`) have **not** yet had the same hand-authored quality
rebuild — do a `*-v2` pass on Cebuano before relying on its adapter.

---

## 7. Resource expectations (M1, 32GB)

- A training run uses ~2–5 GB RAM (one Bare worker holding the model + optimizer state)
  — trivial on a 16GB+ machine.
- Throughput depends on `ctx`, dataset size, and epochs. The `*-v2` Tagalog set (49 short
  examples, ctx 1024, 3 epochs) is a short run; larger datasets scale roughly linearly.
- Training is GPU+CPU intensive while it runs, but leaves plenty of headroom for the
  Mac to stay responsive.

---

## 8. Quick reference

```bash
# from repo root, once:
corepack enable && corepack prepare pnpm@9.15.9 --activate
pnpm install

# every run:
cd packages/server
node src/train.mjs --lang tagalog --dataset ../../finetuning/datasets/tagalog/science-chat-v2.jsonl --ctx 1024 --epochs 3 --device gpu

# evaluate:
HIRAIA_LORA_ADAPTER=../../finetuning/output/tagalog/<adapter>.gguf node src/index.mjs
```
