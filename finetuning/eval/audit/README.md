# Structured audit log — one demo run

`run-audit-demo.mjs` boots the **device-equivalent** engine (the same base GGUF +
bundled LoRA the regression gate uses — `llama-server -m BASE --lora ADAPTER`), runs a
handful of representative tutor prompts, and writes a structured JSON audit log to
the repo root as `AUDIT_LOG.demo-run.json` (a human-readable summary lives in the
root `AUDIT_LOG.md`).

It captures exactly what an auditable on-device run needs:

- **Model load / unload** events (with load time and the backend device used).
- **Per inference call:** the full prompt, prompt + completion **token** counts,
  **TTFT** (time to first token), and **tokens/sec**.

These mirror the metrics the shipped app logs on-device via the QVAC SDK
(`packages/mobile/src/engine/LocalEngine.ts` — `timeToFirstToken` / `promptTokens` /
`tokensPerSecond` / `backendDevice`). The app currently emits them to the device console;
this tool persists the same measurements to a file for an auditable, reproducible run.

## Run it

```bash
# default: cat tier (3B base + bundled Tagalog LoRA, GPU offload), writes demo-audit-log.json
BASE=/path/to/Sailor2-3B-Chat.Q4_K_M.gguf node finetuning/eval/audit/run-audit-demo.mjs

# kitten tier (CPU-only, 1B):
NGL=0 BASE=/path/to/Sailor2-1B-Chat.Q4_K_M.gguf node finetuning/eval/audit/run-audit-demo.mjs

# override port / adapter / output:
PORT=8099 ADAPTER=/path/to/adapter.gguf OUT=/path/to/log.json node .../run-audit-demo.mjs
```

The base GGUF is not committed (it is downloaded on-device); point `BASE=` at a local copy
(e.g. `deploy/models/Sailor2-3B-Chat.Q4_K_M.gguf`). The adapter defaults to the bundled APK
asset `packages/mobile/assets/models/adapter-tagalog.gguf`.

## Schema (`AUDIT_LOG.demo-run.json`)

- `run` — engine config (binary, backend device, gpuLayers, ctxSize, temp), the exact
  model + adapter (filename + bytes), and the host.
- `events[]` — time-ordered: `model_load_start` → `model_load_complete` (with `loadMs`) →
  one `inference` per call → `model_unload`.
- Each `inference.metrics` has client-measured `ttftMs`, `decodeMs`, `totalMs`,
  `promptTokens`, `completionTokens`, `tokensPerSec`, plus a `server` block with
  llama.cpp's own `timings` (ground-truth prefill/decode ms and tok/s).
- `summary` — call count, model load time, average TTFT, average tok/s, total tokens.

### Reading the numbers

- **TTFT** is high on the first call (cold prefill) and drops sharply afterwards — the
  static system prompt's KV cache is reused (`cache_prompt`), which is the device's
  real per-turn TTFT win.
- Because of that cache reuse, on warm calls `metrics.promptTokens` (full prompt, from the
  OpenAI `usage` block) is larger than `server.promptTokens` (only the *newly* processed
  tokens after the cache hit). Both are reported intentionally — the gap is the cache
  working, not an inconsistency.
- `response.text` is the model's **raw** output and may include a `<think>…</think>` block;
  the app strips this before display.
