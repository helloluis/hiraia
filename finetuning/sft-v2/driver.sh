#!/usr/bin/env bash
# ============================================================================
# driver.sh — SFT v2 of the CPT flagship (Cryptopop/hiraia-cpt-flagship-2b).
#
# PREPARED, NOT LAUNCHED. Launch is the parent's call. This runs ON the pod, detached.
#
# WHAT IT DOES
#   1. installs ms-swift + deps (pinned), pulls the base from HF
#   2. trains full-param bf16 on /workspace/train-v2.jsonl (the v1 recipe verbatim:
#      lr 1e-5 cosine, warmup 3%, bs 4 × ga 4, 3 epochs, --template qwen3)
#   3. picks the final checkpoint by READING global_step from each trainer_state.json
#      (v1 lesson: never sort paths — that guard destroyed a good run)
#   4. uploads weights to HF Cryptopop/hiraia-sft-flagship-2b on BRANCH `v2`
#      (branch, not subdir: `from_pretrained(..., revision="v2")` works unmodified and
#      main stays v1 until an explicit promotion — documented in DATA-CARD.md)
#   5. converts to GGUF f16 + Q4_K_M (with the transformers-5 tokenizer_config
#      extra_special_tokens overlay fix) and uploads those to the same branch
#   6. VERIFIES trainer_state.json ON HF (global_step == expected) — the driver's own
#      "done" beat proves nothing (two of four v1 runs reported success while wrong)
#   7. self-terminates ONLY on full success; ANY tripped guard HOLDS the pod and reports
#
# RECOMMENDED POD (prefer speed — H100-series):
#   1× H100 80GB PCIe/SXM, on-demand, supportPublicIp:true, a volume IN THE POD'S OWN DC
#   mounted at /workspace. Estimate: v1 trained 6,687 chat rows in ~47 min on an A100
#   ($1.40); v2 rows are card-short (median assistant ~20 words, prompts ~300-500 tok),
#   so expect ~25-45 min train + ~10 min convert/upload on an H100.
#   WALL-CLOCK ESTIMATE: under 1.5 h end-to-end.  COST ESTIMATE: ~$3-5.
#
# LAUNCH CHECKLIST (parent runs these, not this script):
#   scp -P <port> finetuning/sft-v2/out/train-v2.jsonl root@<pod>:/workspace/train-v2.jsonl
#   scp -P <port> finetuning/sft-v2/driver.sh          root@<pod>:/root/driver.sh
#   printf 'HF_TOKEN=%s\nRUNPOD_API_KEY=%s\nRUNPOD_POD_ID=%s\n' ... > .driver-env  # scp a real
#   scp -P <port> .driver-env root@<pod>:/root/.driver-env   # FILE — never a heredoc over ssh
#   ssh -p <port> root@<pod> 'nohup bash /root/driver.sh > /workspace/driver.log 2>&1 &'
# ============================================================================
set -uo pipefail
[ -f /root/.driver-env ] && { set -a; . /root/.driver-env; set +a; }
# ms-swift defaults to the ModelScope hub and 404s on our PRIVATE HF repos (measured on the
# first v2 attempt: modelscope.cn 'record not found' on Cryptopop/hiraia-cpt-flagship-2b).
# USE_HF=1 is swift's switch to the HuggingFace hub. Without it the run dies at download.
export USE_HF=1
# And this build of ms-swift 4.5.2 names the tuner flag `--tuner_type` (choices include
# 'full'; DEFAULT IS 'lora'). `--train_type full` is rejected as remaining_argv — and
# omitting the flag would silently train a LoRA while reporting success. Measured on
# attempt 2 of this run; verified against SftArguments' dataclass on the pod.

BASE_MODEL="Cryptopop/hiraia-cpt-flagship-2b"
TARGET_REPO="Cryptopop/hiraia-sft-flagship-2b"
TARGET_BRANCH="v2"
DATA=/workspace/train-v2.jsonl
RUN=/workspace/sft-v2-run
LOG=/workspace/sft-v2-driver.log
STATUS="FAILED (driver died mid-run)"

step(){ echo; echo "=== [$(date -u +%FT%TZ)] $* ==="; }

# A tripped guard HOLDS the pod — it NEVER deletes. Self-terminate only on success.
hold(){ STATUS="HELD: $*"; echo "GUARD TRIPPED — POD HELD: $*"; echo "$STATUS" > /workspace/HELD; exit 1; }

finish(){
  rc=$?
  step "driver exiting rc=$rc status=$STATUS"
  if [ "$STATUS" = "SUCCESS" ] && [ "${SELF_TERMINATE:-1}" = 1 ] \
     && [ -n "${RUNPOD_API_KEY:-}" ] && [ -n "${RUNPOD_POD_ID:-}" ]; then
    echo ">> self-terminating pod $RUNPOD_POD_ID"
    curl -s --max-time 30 -X DELETE -H "Authorization: Bearer $RUNPOD_API_KEY" \
      "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" -w "terminate: HTTP %{http_code}\n" || true
  else
    echo ">> NOT terminating (status: $STATUS) — pod holds for inspection"
  fi
}
trap finish EXIT

step "0/7 preflight"
[ -f "$DATA" ] || hold "no $DATA on the volume"
ROWS=$(wc -l < "$DATA" | tr -d ' ')
[ "$ROWS" -ge 4000 ] || hold "train file has only $ROWS rows — wrong/truncated upload?"
[ -n "${HF_TOKEN:-}" ] || hold "HF_TOKEN missing from /root/.driver-env"
# v1 lesson #3: every message must be exactly {role, content} — assert before spending GPU time.
python3 - "$DATA" <<'PY' || hold "message-shape assertion failed"
import json, sys
for i, line in enumerate(open(sys.argv[1])):
    row = json.loads(line)
    assert set(row.keys()) == {"messages"}, f"row {i}: extra top-level keys {set(row)-{'messages'}}"
    for m in row["messages"]:
        assert set(m.keys()) == {"role", "content"}, f"row {i}: message keys {set(m.keys())}"
    assert "[image:" not in line, f"row {i}: [image:] tag"
print("shape OK:", i + 1, "rows")
PY

step "1/7 install (pinned)"
# transformers 5.x for TRAINING: the CPT checkpoint is model_type qwen3_5_text, which 4.57.6
# does not know (attempt-3 failure). The 4.x pin was for GGUF CONVERSION — but the convert
# step uses llama.cpp's own script + the tokenizer_config overlay and installs its own
# requirements AFTER training, so the two never share a constraint. 5.16.1 = attempt-4 resolve.
pip install -q "ms-swift==4.5.2" "transformers==5.16.1" "huggingface_hub" "deepspeed" 2>&1 | tail -2 || hold "pip install failed"
export HF_HOME=/workspace/hf-cache
huggingface-cli login --token "$HF_TOKEN" >/dev/null 2>&1 || hold "HF login failed"

# num_proc from the CGROUP QUOTA, never nproc (nproc lies about host cores; measured:
# oversubscribed datasets.map collapses to a flat floor SLOWER than one core).
QUOTA=$(cut -d' ' -f1 /sys/fs/cgroup/cpu.max 2>/dev/null || echo max)
PERIOD=$(cut -d' ' -f2 /sys/fs/cgroup/cpu.max 2>/dev/null || echo 100000)
if [ "$QUOTA" = "max" ]; then NUM_PROC=8; else NUM_PROC=$(( QUOTA / PERIOD )); fi
[ "$NUM_PROC" -ge 1 ] || NUM_PROC=1
[ "$NUM_PROC" -gt 16 ] && NUM_PROC=16
echo ">> num_proc=$NUM_PROC (cgroup cpu.max: $QUOTA/$PERIOD)"

step "2/7 train (full-param bf16 — the v1 recipe)"
# --template qwen3: NOT qwen3_5 (registered as an MLLM template, its collator calls
# get_rope_index which the text-only strip lacks) and NOT the default (a `dummy` template
# that cannot render roles and silently DELETES rows under truncation_strategy delete —
# v1 attempt #1 trained on 5% of its data and reported success).
swift sft \
  --model "$BASE_MODEL" \
  --template qwen3 \
  --tuner_type full \
  --dataset "$DATA" \
  --torch_dtype bfloat16 \
  --learning_rate 1e-5 \
  --lr_scheduler_type cosine \
  --warmup_ratio 0.03 \
  --num_train_epochs 3 \
  --per_device_train_batch_size 4 \
  --gradient_accumulation_steps 4 \
  --max_length 2048 \
  --truncation_strategy delete \
  --dataset_num_proc "$NUM_PROC" \
  --save_strategy epoch \
  --save_total_limit 3 \
  --logging_steps 10 \
  --output_dir "$RUN" \
  2>&1 | tail -40 || hold "swift sft exited non-zero"

step "3/7 pick final checkpoint by global_step (NEVER by path sort — the v1 guard lesson)"
CKPT=$(python3 - "$RUN" <<'PY'
import glob, json, sys
best, best_step = None, -1
for ts in glob.glob(f"{sys.argv[1]}/**/trainer_state.json", recursive=True):
    step = json.load(open(ts)).get("global_step", -1)
    if step > best_step: best, best_step = ts.rsplit("/", 1)[0], step
print(best or ""); print(best_step, file=sys.stderr)
PY
) || hold "checkpoint scan failed"
[ -n "$CKPT" ] || hold "no trainer_state.json under $RUN"
GLOBAL_STEP=$(python3 -c "import json;print(json.load(open('$CKPT/trainer_state.json'))['global_step'])")
# expected steps: ceil(rows_kept/16) * 3 epochs; rows_kept <= ROWS (truncation deletes).
# Sanity floor: at least 60% of the naive count — below that the template ate the data.
EXPECT=$(( (ROWS / 16 + 1) * 3 ))
FLOOR=$(( EXPECT * 60 / 100 ))
echo ">> checkpoint $CKPT at global_step=$GLOBAL_STEP (naive expect ~$EXPECT, floor $FLOOR)"
[ "$GLOBAL_STEP" -ge "$FLOOR" ] || hold "global_step $GLOBAL_STEP < floor $FLOOR — template/data drop suspected (v1 attempt-1 signature)"
# full-param assertion (v1 probe lesson: swift can silently fall back to a LoRA adapter)
SAFE_BYTES=$(du -cb "$CKPT"/*.safetensors 2>/dev/null | tail -1 | cut -f1)
[ "${SAFE_BYTES:-0}" -ge 3000000000 ] || hold "checkpoint only ${SAFE_BYTES:-0} bytes — not a full-param 2B save"

step "4/7 upload weights to HF ($TARGET_REPO @ $TARGET_BRANCH)"
# WEIGHTS + tokenizer + trainer_state only. A full-param epoch checkpoint also carries
# optimizer.pt (~16 GB of AdamW moments for a 2B), rng/scheduler state and any deepspeed
# global_step* shards — tripling the upload on an hourly pod, bloating the branch every
# from_pretrained consumer clones around, and widening the window for a network flake to
# trip the "HF upload failed" hold. Resume state stays ON THE VOLUME, where resume happens.
python3 - "$CKPT" <<PY || hold "HF upload failed"
import sys
from huggingface_hub import HfApi
api = HfApi()
api.create_branch("$TARGET_REPO", branch="$TARGET_BRANCH", exist_ok=True)
api.upload_folder(folder_path=sys.argv[1], repo_id="$TARGET_REPO", revision="$TARGET_BRANCH",
                  commit_message="SFT v2 (card-writer mix, ${ROWS} rows)",
                  ignore_patterns=["optimizer*", "rng_state*", "scheduler*", "global_step*",
                                   "latest", "zero_to_fp32.py"])
print("uploaded")
PY

step "5/7 GGUF convert (f16 + Q4_K_M)"
# transformers-5 gotcha: a 5.x-saved tokenizer_config crashes convert_hf_to_gguf in the 4.x
# convert env (extra_special_tokens list-vs-dict). We pin transformers 4.57.6 above, but the
# CPT base may carry a 5.x config — normalise the field either way before converting.
python3 - "$CKPT" <<'PY' || hold "tokenizer_config overlay failed"
import json, sys, os
p = os.path.join(sys.argv[1], "tokenizer_config.json")
cfg = json.load(open(p))
est = cfg.get("extra_special_tokens")
if isinstance(est, dict):
    cfg["extra_special_tokens"] = list(est.values())
    json.dump(cfg, open(p, "w"), indent=2)
    print("overlaid extra_special_tokens dict -> list")
else:
    print("tokenizer_config already convert-safe")
PY
# cmake is NOT in the runpod/pytorch image (the v2 run tripped its final step on this).
pip install -q cmake 2>&1 | tail -1
if [ ! -d /workspace/llama.cpp ]; then
  # PINNED, not master: the v2 run's master-of-the-day converter wrote qwen35 metadata for an
  # MTP layer the checkpoint does not carry (block_count 25, nextn_predict_layers 1 against
  # 320 actual tensors) and the GGUF would not load anywhere. Fixed post-hoc by patching two
  # u32s; a pinned tag makes the conversion reproducible instead.
  git clone --branch b6301 --depth 1 https://github.com/ggml-org/llama.cpp /workspace/llama.cpp ||   git clone --depth 1 https://github.com/ggml-org/llama.cpp /workspace/llama.cpp || hold "llama.cpp clone failed" 
  pip install -q -r /workspace/llama.cpp/requirements/requirements-convert_hf_to_gguf.txt 2>&1 | tail -1
  cmake -S /workspace/llama.cpp -B /workspace/llama.cpp/build -DGGML_CUDA=OFF >/dev/null 2>&1 \
    && cmake --build /workspace/llama.cpp/build -t llama-quantize -j "$NUM_PROC" >/dev/null 2>&1 \
    || hold "llama-quantize build failed"
fi
python3 /workspace/llama.cpp/convert_hf_to_gguf.py "$CKPT" \
  --outfile /workspace/hiraia-sft-v2-f16.gguf --outtype f16 2>&1 | tail -3 || hold "GGUF convert failed"
/workspace/llama.cpp/build/bin/llama-quantize \
  /workspace/hiraia-sft-v2-f16.gguf /workspace/hiraia-sft-v2-Q4_K_M.gguf Q4_K_M 2>&1 | tail -2 \
  || hold "quantize failed"

step "6/7 upload GGUFs"
python3 - <<PY || hold "GGUF upload failed"
from huggingface_hub import HfApi
api = HfApi()
for f in ["/workspace/hiraia-sft-v2-f16.gguf", "/workspace/hiraia-sft-v2-Q4_K_M.gguf"]:
    api.upload_file(path_or_fileobj=f, path_in_repo=f.split("/")[-1],
                    repo_id="$TARGET_REPO", revision="$TARGET_BRANCH")
print("uploaded")
PY

step "7/7 VERIFY trainer_state.json ON HF (the only proof that counts)"
python3 - <<PY || hold "HF verification failed — do NOT trust this run until resolved"
from huggingface_hub import hf_hub_download
import json
p = hf_hub_download("$TARGET_REPO", "trainer_state.json", revision="$TARGET_BRANCH")
gs = json.load(open(p))["global_step"]
assert gs == $GLOBAL_STEP, f"HF global_step {gs} != local $GLOBAL_STEP"
print("VERIFIED on HF: global_step", gs)
PY

STATUS="SUCCESS"
echo "DONE — $TARGET_REPO@$TARGET_BRANCH global_step=$GLOBAL_STEP rows=$ROWS"
