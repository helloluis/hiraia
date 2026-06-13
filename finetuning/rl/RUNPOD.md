# GRPO on RunPod — runbook

Continues the SHIPPING SFT LoRA (Sailor2-3B-Chat, r=32/α=64) with GRPO RL against
`finetuning/rl/reward.py`. Everything below is copy-pasteable. Team rules apply:
`scp` uses `-P` (capital), session logs go to `/workspace/session-*.log`, and the pod is
**NEVER terminated before the in-session eval/convert step** (memory:
hiraia-eval-immediately-after-train).

Files that must exist before launching:

| file | status |
|---|---|
| `finetuning/rl/train-grpo.py` | this repo |
| `finetuning/rl/reward.py` | **written by a sibling task — train-grpo.py imports `grpo_reward` from it and will crash at import if missing. Verify it exists before rsyncing.** |
| `finetuning/rl/prompts/rl-prompts.tagalog.jsonl` / `.bisaya.jsonl` | rows: `{"messages":[system,user], "meta":{required_terms, forbidden_terms, expect_abstain, expect_image}}` |
| init adapters (HF PEFT dirs) | tagalog: `finetuning/adapters/tagalog-sailor-3b-grounded-ttft/final-adapter` (source of the shipping `adapter-tagalog-ttft-f16.gguf`). bisaya: `finetuning/adapters/bisaya-sailor-v3/final-adapter` — provenance VERIFIED 2026-06-11: r=32/α64 on sail/Sailor2-3B-Chat, downloaded Jun 4 11:43, shipping GGUF created Jun 4 14:44 same session, GGUF hash-matches the bundled mobile asset; optional byte-check on pod: re-run convert_lora_to_gguf.py on it and md5 vs `adapter-sailor-bisaya-f16.gguf`. |

Base model is pulled from HF on the pod: **`sail/Sailor2-3B-Chat`** (qwen2 arch — the
on-device product base; NOT the 1B).

## 1. Pod spec

- 1× **H100 80GB** (PCIe or SXM), Secure Cloud, **US-KS-2**, container disk ≥ 50 GB
- Attach persistent volume **`5uwc7qp731`** at `/workspace` — it carries
  `qvac-src-v8828/convert_lora_to_gguf.py` + `qvac-bin-v8828/llama-cli` needed for the
  in-session GGUF step (same volume the SFT pipeline uses, see `deploy_v5.sh`)
- Image: `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04` (we install our own
  torch in a venv, the image only needs to provide CUDA drivers + python3.11)
- Cost note (not-for-profit): H100 80GB ≈ $2.4–3/hr; budget ≈ 3–5 hr per language.

Deploy with the same GraphQL call as `finetuning/deploy_v5.sh` (just change
`GPU_TYPE="NVIDIA H100 80GB HBM3"` / `POD_NAME=hiraia-grpo`), or via console. Get
`$IP`/`$PORT` for SSH as usual; below assume:

```bash
export IP=<pod-ip> PORT=<pod-ssh-port>
SSH_OPTS="-o StrictHostKeyChecking=no -i $HOME/.ssh/id_ed25519"
```

## 2. Upload (rsync the repo subset)

From the repo root on the Mac:

```bash
rsync -avz -e "ssh $SSH_OPTS -p $PORT" \
  finetuning/rl/ root@$IP:/workspace/rl/                       # train-grpo.py + reward.py + prompts/
rsync -avz -e "ssh $SSH_OPTS -p $PORT" \
  finetuning/adapters/tagalog-sailor-3b-grounded-ttft/final-adapter/ \
  root@$IP:/workspace/init-adapter-tagalog/
rsync -avz -e "ssh $SSH_OPTS -p $PORT" \
  finetuning/adapters/bisaya-sailor-v3/final-adapter/ \
  root@$IP:/workspace/init-adapter-bisaya/
```

## 3. Environment (on the pod)

GRPO needs vLLM, which the SFT venv (`/workspace/venv`) does **not** have — and vLLM
pins its own torch. Use a **separate** venv so the SFT environment stays intact:

```bash
ssh $SSH_OPTS -p $PORT root@$IP
cd /workspace
python3 -m venv venv-grpo && source venv-grpo/bin/activate
pip install --upgrade pip

# Working set (verified the hard way on the pod, 2026-06-11 — the originally
# researched pins were WRONG; what actually constrains the resolve):
#  - unsloth 2026.6.2 caps trl<=0.24.0 (NOT 1.x), transformers<=5.5.0, torch<2.11
#  - vllm 0.22.1 pins torch==2.11.0 and EXCLUDES transformers 5.0–5.5.0 →
#    incompatible with unsloth; vllm must stay <0.22 (0.21.x = torch 2.10 era)
#  - transformers intersection = 4.56–4.x (unsloth != 4.57.0/.4/.5)
# Resolved working set (SMOKE-OK on the pod 2026-06-11): unsloth 2026.6.2 +
# trl 0.24.0 + vllm 0.19.1 + transformers 4.57.6 + torch 2.10.0+cu128.
# Install in ONE joint resolve — installing vllm first then pinning the rest
# deadlocks (ResolutionImpossible) or silently downgrades torch under vllm:
pip install "unsloth==2026.6.2" "trl==0.24.0" "vllm<0.22" \
  "transformers>=4.56,!=4.57.0,!=4.57.4,!=4.57.5,<5.0" \
  datasets peft safetensors sentencepiece protobuf

# smoke test BEFORE burning GPU hours — all four must import together:
python -c "import unsloth, trl, vllm, torch; \
  print('unsloth', unsloth.__version__, '| trl', trl.__version__, \
        '| vllm', vllm.__version__, '| torch', torch.__version__, \
        '| cuda', torch.cuda.is_available())"
```

> **Disk quota:** the network volume is ~50GB and a vllm venv alone is ~15–20G.
> Before installing, clear rebuildable bulk (old SFT venv, `merged-model/` and
> `checkpoint-*` dirs under /workspace/output — AFTER confirming final adapters
> are downloaded locally). `Disk quota exceeded` mid-install leaves a corrupt
> venv: `rm -rf` it and rebuild, don't resume.

If the smoke test fails on a version clash, the unsloth-documented recovery is
`pip install --upgrade --no-cache-dir --force-reinstall unsloth_zoo unsloth vllm`
(GRPO release notes: https://github.com/unslothai/unsloth/releases/tag/2025-02).

## 4. Train (detached, session log — one language at a time)

Tagalog:

```bash
ssh $SSH_OPTS -p $PORT root@$IP '
  source /workspace/venv-grpo/bin/activate
  cd /workspace/rl
  rm -f /workspace/session-grpo-tagalog.log
  LANG_TAG=tagalog \
  INIT_ADAPTER=/workspace/init-adapter-tagalog \
  PROMPTS=/workspace/rl/prompts/rl-prompts.tagalog.jsonl \
  OUT_DIR=/workspace/output/tagalog-sailor-3b-grpo \
  MAX_STEPS=600 GROUP_SIZE=6 LR=5e-6 KL_BETA=0.04 MAX_NEW_TOKENS=256 SEED=42 \
  setsid nohup python -u train-grpo.py > /workspace/session-grpo-tagalog.log 2>&1 < /dev/null &
  echo launched'
ssh $SSH_OPTS -p $PORT root@$IP 'tail -f /workspace/session-grpo-tagalog.log'
```

Bisaya (after tagalog finishes — single GPU):

```bash
ssh $SSH_OPTS -p $PORT root@$IP '
  source /workspace/venv-grpo/bin/activate
  cd /workspace/rl
  rm -f /workspace/session-grpo-bisaya.log
  LANG_TAG=bisaya \
  INIT_ADAPTER=/workspace/init-adapter-bisaya \
  PROMPTS=/workspace/rl/prompts/rl-prompts.bisaya.jsonl \
  OUT_DIR=/workspace/output/bisaya-sailor-3b-grpo \
  MAX_STEPS=600 GROUP_SIZE=6 LR=5e-6 KL_BETA=0.04 MAX_NEW_TOKENS=256 SEED=42 \
  setsid nohup python -u train-grpo.py > /workspace/session-grpo-bisaya.log 2>&1 < /dev/null &
  echo launched'
```

**Expected wall-clock:** ~2–4 hr per language (600 optimizer steps × 2 prompt-groups/step
× 6 completions × ≤256 tokens on the colocated vLLM engine; H100, 3B model). Watch the
`[reward] ...` lines — flat mean reward after ~150 steps means the reward is saturated or
broken; kill early rather than burn hours. Checkpoints land every 100 steps under
`$OUT_DIR/checkpoint-*` (last 3 kept), final adapter at `$OUT_DIR/final-adapter`.

Memory: a 3B in bf16 + LoRA + colocated vLLM at `gpu_memory_utilization=0.7` uses well
under half of 80 GB. If OOM anyway, lower `GPU_MEM_UTIL=0.5` (env, see `--gpu-mem-util`)
— that's the unsloth-documented knob.

## 5. IN-SESSION eval + convert — BEFORE terminating (hard team rule)

### 5a. Convert each GRPO adapter to GGUF f16 (same converter as the SFT pipeline)

```bash
ssh $SSH_OPTS -p $PORT root@$IP '
  source /workspace/venv-grpo/bin/activate
  cd /workspace/qvac-src-v8828
  python convert_lora_to_gguf.py /workspace/output/tagalog-sailor-3b-grpo/final-adapter \
    --base-model-id sail/Sailor2-3B-Chat --outtype f16 \
    --outfile /workspace/output/tagalog-sailor-3b-grpo/adapter-tagalog-grpo-f16.gguf
  python convert_lora_to_gguf.py /workspace/output/bisaya-sailor-3b-grpo/final-adapter \
    --base-model-id sail/Sailor2-3B-Chat --outtype f16 \
    --outfile /workspace/output/bisaya-sailor-3b-grpo/adapter-bisaya-grpo-f16.gguf'
```

(Exact flow as `session_runner_v5.sh` step 2 — this is what produces the
`adapter-*-f16.gguf` files the device/harness consume. Optional pod-side sanity:
`LD_LIBRARY_PATH=/workspace/qvac-bin-v8828 /workspace/qvac-bin-v8828/llama-cli -m
/workspace/models/sailor2-3b-chat-f16.gguf --lora <adapter.gguf> -p "..." -n 64`.)

### 5b. Download adapters + GGUFs to the Mac

```bash
scp $SSH_OPTS -P $PORT -r root@$IP:/workspace/output/tagalog-sailor-3b-grpo/final-adapter \
  finetuning/adapters/tagalog-sailor-3b-grpo/
scp $SSH_OPTS -P $PORT -r root@$IP:/workspace/output/bisaya-sailor-3b-grpo/final-adapter \
  finetuning/adapters/bisaya-sailor-3b-grpo/
scp $SSH_OPTS -P $PORT root@$IP:/workspace/output/tagalog-sailor-3b-grpo/adapter-tagalog-grpo-f16.gguf \
  finetuning/adapters/
scp $SSH_OPTS -P $PORT root@$IP:/workspace/output/bisaya-sailor-3b-grpo/adapter-bisaya-grpo-f16.gguf \
  finetuning/adapters/
```

### 5c. Run the local regression gate (must be green before any APK / human test)

```bash
ADAPTER=finetuning/adapters/adapter-tagalog-grpo-f16.gguf \
BIS_ADAPTER=finetuning/adapters/adapter-bisaya-grpo-f16.gguf \
finetuning/eval/harness/run-harness.sh
```

Then A/B the capability delta (the whole point of the RL run):

```bash
ADAPTER=finetuning/adapters/adapter-tagalog-grpo-f16.gguf \
finetuning/eval/capability/run-capability.sh
```

## 6. Terminate (only after 5a–5b are confirmed on disk locally)

```bash
source .env.local
curl -s "https://api.runpod.io/graphql?api_key=$RUNPOD_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation { podTerminate(input: {podId: \"<POD_ID>\"}) }"}'
```

Volume `5uwc7qp731` persists.

## Knobs reference (`train-grpo.py` — env var = CLI flag)

| env | default | meaning |
|---|---|---|
| `LANG_TAG` | `tagalog` | `tagalog` \| `bisaya` |
| `INIT_ADAPTER` | *(required)* | HF PEFT dir to continue from |
| `PROMPTS` | `rl/prompts/rl-prompts.<lang>.jsonl` | RL prompt JSONL |
| `OUT_DIR` | `/workspace/output/<lang>-sailor-3b-grpo` | output |
| `MAX_STEPS` | 600 | optimizer steps |
| `GROUP_SIZE` | 6 | GRPO group G (TRL `num_generations`) |
| `LR` | 5e-6 | learning rate (RL-scale, ~20× below the SFT 1e-4) |
| `KL_BETA` | 0.04 | KL anchor to the SFT policy (TRL default 0.0 = off) |
| `MAX_NEW_TOKENS` | 256 | rollout completion cap |
| `MAX_PROMPT_LEN` | 1536 | grounded prompts reach ~1.2k tokens |
| `GRAD_ACCUM` | 2 | unique prompts per optimizer step |
| `TEMP` | 0.8 | rollout temperature (matches harness GROUND_TEMP) |
| `SEED` | 42 | |
| `GPU_MEM_UTIL` | 0.7 | vLLM VRAM share |
| `LOAD_IN_4BIT` | 0 | keep 0: bf16 base matches the f16-adapter-on-GGUF device path |

## API references used (verified mid-2026)

- TRL GRPOTrainer/GRPOConfig + reward-function contract (dataset columns →
  reward kwargs; `beta` default 0.0; `use_vllm` colocate mode):
  https://huggingface.co/docs/trl/main/en/grpo_trainer
- Unsloth RL guide (`fast_inference=True`, vLLM rollouts):
  https://unsloth.ai/docs/get-started/reinforcement-learning-rl-guide
- Worked unsloth GRPO recipe (`max_lora_rank`, `gpu_memory_utilization`,
  GRPOConfig values): https://huggingface.co/learn/llm-course/en/chapter12/6
- Continuing-from-LoRA caveat (why we state-dict-load instead of passing the
  adapter dir as `model_name`): https://github.com/unslothai/unsloth/issues/1877
