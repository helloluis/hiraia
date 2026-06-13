# Hiraia — project notes

Offline, on-device AI Science tutor for Filipino grade-school students (QVAC; Sailor2-3B + RAG,
Tagalog/Bisaya LoRA adapters bundled in the APK). Default language: Tagalog. Not-for-profit —
keep direct costs controlled. **If forced to choose, factual accuracy ranks ABOVE perfect
Tagalog/Bisaya fluency.**

## Evaluation — two instruments

There are two separate eval harnesses. Know which one you want.

### 1. Regression gate (green/red) — `finetuning/eval/harness/run-harness.sh`
The **formal pre-flight gate**. Boots a local `llama-server` (device-equivalent: base GGUF +
adapter GGUF), runs retrieval stress tests + behavioral assertions, exits non-zero on any
failure. It is green *by construction* (tuned to current model behavior).

> **Hard rule:** this gate MUST be green BEFORE building an APK or asking a human to test
> on-device. It is a formal step, not optional — run it and confirm green first.

### 2. Capability benchmark (scored 0–5) — `finetuning/eval/capability/run-capability.sh`
The **A/B instrument** for model changes (SFT rebalance, distillation). NOT a regression gate
— it's a ~100-probe, LLM-judged, 0–5 scored test deliberately seeded with hard items the
current model fails (esp. over-abstention), so improvement is a measurable delta. Expected to
score mediocre on purpose; headroom is the point.

```bash
# boot the device-equivalent LLM + collect answers (two adapter passes, tl/en then bis):
finetuning/eval/capability/run-capability.sh
SAMPLES=3 finetuning/eval/capability/run-capability.sh          # worst-of-3 per probe
ADAPTER=path/to/candidate.gguf finetuning/eval/capability/run-capability.sh   # A/B a candidate

# default judging is on the Claude SUBSCRIPTION (no API key): score the answers with a
# judging workflow → capability-scores.<tag>.json, then merge both passes into one score:
PHASE=report node_modules/.bin/tsx finetuning/eval/capability/run-capability.mts
# (or JUDGE_ENDPOINT=... for an inline local/API judge)
```

Defaults to the **bundled APK assets directly** (`packages/mobile/assets/models/*.gguf`) —
both eval harnesses reference the bundle so the "shipping" default can never drift from it.

- Design + scoring: `finetuning/eval/capability/README.md`, `rubric.md`
- Probe set: `finetuning/eval/capability/probes.json` (134 probes, 10 tiers; helpfulness-floor
  heaviest; `multi-turn` tier = scripted dialogues judged on repetition/state-tracking)
- It measures the **holistic** device path (retrieval + model). A retrieval miss is a real
  capability failure and is allowed to score low — see `FINDINGS.md` (e.g. F1: retrieval
  hijacks the photosynthesis probe). Fix those alongside a new-model benchmark, not before.

## Conventions (load-bearing)
- Use the Claude **subscription**, not the API, for assisted work (incl. the benchmark judge).
- Adapters + images are **bundled in the APK** (the core offline value).
- `RUNPOD_API_KEY` lives in `.env.local` (gitignored) — never commit it.
- `scp` uses `-P` (capital). On the default branch, branch first. Commit only when asked.
- Avoid heuristic intent-detection; prefer principled retrieval/grounding.
