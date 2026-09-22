# gpt-image-2 regen of Qwen visual reject / uncertain

Worklist of unique illustrations the 2026-09-21 Qwen audit marked visual
**reject** or **uncertain**, for OpenAI Batch `gpt-image-2` (low, 1024², opaque).
Split into two jobs so output files stay downloadable.

Do not reuse `packages/images/qwen-queue/worklist.jsonl` or `submitted-ids.txt`.

```sh
cd /Users/luis/Code/hiraia
set -a; source ./.env.local; set +a
python3 packages/images/qwen-queue/audit-regen/submit.py
```

`submit.py` uploads `batch-requests-1.jsonl` and `batch-requests-2.jsonl` and
writes `batches.json`. It does not wait for completion.

Jobs 1–2 finished; outputs are in the repo root as
`batch_6ab1b6ac31e48190996ed524acd2ac8a_output.jsonl` and
`batch_6ab1b6b03bdc8190bf6c90a7e3fa7b75_output.jsonl`.

Job 3 (`batch-requests-3.jsonl`) is leftover reject/uncertain/error images that
now have prompts (depth-fill + art-QA `qa-*`) plus salvaged visual errors not
already in jobs 1–2. Do not resubmit 1–2.
