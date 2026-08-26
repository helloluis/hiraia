# pod-eval — evaluate a merged Qwen3.5 GGUF on a throwaway pod

```
finetuning/eval/pod-eval/launch.sh <hf-repo> <gguf-path-in-repo> <label>
# e.g. launch.sh Cryptopop/hiraia-sft-flagship-2b-v2 gguf/hiraia-sft-2b-v2-Q4_K_M.gguf sft-v2
```

Provisions the cheapest 24GB+ single GPU in any datacenter (~$0.33–0.53/hr), stages the kit, and
runs `eval_driver.sh` detached. The driver: CPU llama-server → routing (12) + capability (129) +
gate (42) probes over `/v1/chat/completions` → answers to `<repo>/eval/<label>-eval-answers.json`
→ self-terminate. If the repo has no GGUF at that path it converts from the safetensors
(`--no-mtp`, Q4_K_M, `block_count==24` check) and uploads the GGUF back.

Reports to hiraia.b11.dev/admin. **A failure HOLDS the pod** (phase `held`, reason in the note)
so the log survives — terminate it by hand after reading. Dead-man 2h; VPS guard ceiling
`hiraia-eval` 2h.

The routing set is the synth-ceb decision instrument: 8 Cebuano-mode prompts, half
Cebuano-worded, half language-neutral. The driver prints `[route] SCORE: n/8` and puts it in the
`done` heartbeat. v1 scored 4/8 (4/4 worded, 0/4 neutral).

Verified 2026-08-26: a dry run against an empty repo provisioned, resolved `HF_TOKEN` on the pod,
picked 21 threads from the cgroup quota (nproc said 112), built llama.cpp on CPU, took the
convert branch, and held with `convert produced no file` — the expected outcome for an empty
repo. Every launcher path except a real conversion is exercised; conversion itself is the same
`--no-mtp` path Gate 4 passed.

Gotchas this encodes are in `eval_driver.sh`'s header and in memory
(`hiraia-gguf-eval-gotchas`). Do not hand-roll the pod again.
