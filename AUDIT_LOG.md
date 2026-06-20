# Audit Log — one on-device demo run

Hiraia runs **all inference on-device** (QVAC / llama.cpp). This is a structured audit
log of one demo run on the **device-equivalent engine** — the exact base GGUF + bundled
Filipino LoRA the regression gate uses (`llama-server -m BASE --lora ADAPTER`, full GPU
offload, the **cat / 3B** tier).

- **Machine-readable artifact (source of truth):** [`AUDIT_LOG.demo-run.json`](./AUDIT_LOG.demo-run.json)
- **Generator (reproducible):** [`finetuning/eval/audit/run-audit-demo.mjs`](./finetuning/eval/audit/run-audit-demo.mjs) — see [`finetuning/eval/audit/README.md`](./finetuning/eval/audit/README.md)
- **Remote APIs used by the app:** [`REMOTE_APIS.md`](./REMOTE_APIS.md)

The JSON records time-ordered events — `model_load_start → model_load_complete →
inference ×N → model_unload` — and, for each inference call, the prompt, prompt/completion
**token** counts, **TTFT** (time to first token), and **tokens/sec**. These mirror the
metrics the shipped app already measures on-device via the QVAC SDK
(`packages/mobile/src/engine/LocalEngine.ts`: `timeToFirstToken` / `promptTokens` /
`tokensPerSecond` / `backendDevice`); this run persists them to a file.

## Run summary

_Generated 2026-06-20 against the shipped **v0.2.6** cat adapter (`adapter-tagalog.gguf`, the v10 LoRA)._

| | |
|---|---|
| Engine | `llama-server` · backend **gpu (Metal)** · gpuLayers 99 · ctx 4096 · temp 0.5 |
| Model | `Sailor2-3B-Chat.Q4_K_M.gguf` (base) + `adapter-tagalog.gguf` (bundled LoRA) |
| Tier | cat (3B / GPU offload) |
| **Model load** | **3,055 ms** |
| Inference calls | 5 |
| Avg TTFT | 239 ms (538 ms cold → ~165 ms warm) |
| Avg decode | 36.8 tok/s |
| Tokens | 371 prompt / 322 completion |

## Per-call metrics

| # | Probe | Prompt tok | Out tok | TTFT (ms) | tok/s | Total (ms) |
|---|-------|-----------:|--------:|----------:|------:|-----------:|
| 1 | tl-photosynthesis (cold) | 73 | 88 | 538 | 36.88 | 2897 |
| 2 | tl-water-cycle | 76 | 82 | 166 | 36.39 | 2392 |
| 3 | tl-why-sky-blue | 75 | 102 | 171 | 36.86 | 2911 |
| 4 | en-states-of-matter | 75 | 21 | 166 | 36.76 | 710 |
| 5 | chitchat-greeting | 72 | 29 | 153 | 36.84 | 913 |

**Reading the TTFT drop:** the first call pays the cold system-prompt prefill (~538 ms);
every call after reuses that prefix's KV cache (`cache_prompt`) and lands at ~165 ms — the
device's real per-turn TTFT win. (In the JSON, warm calls therefore show `server.promptTokens`
≈ 10–14 — only the *new* tokens processed — while `metrics.promptTokens` reports the full
prompt; the gap is the cache working.)

## Regenerate

```bash
BASE=/path/to/Sailor2-3B-Chat.Q4_K_M.gguf node finetuning/eval/audit/run-audit-demo.mjs
# kitten (CPU/1B) tier:
NGL=0 BASE=/path/to/Sailor2-1B-Chat.Q4_K_M.gguf node finetuning/eval/audit/run-audit-demo.mjs
```
