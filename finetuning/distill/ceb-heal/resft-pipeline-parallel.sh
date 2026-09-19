#!/usr/bin/env bash
# resft-pipeline-parallel.sh — runs ON THE POD (2 GPUs), detached. Deps + healed-model pull ONCE,
# then trains the tagalog adapter on GPU0 and the bisaya adapter on GPU1 CONCURRENTLY (wall-clock
# ~= the slower single train, not the sum), then pushes both adapters to HF.
# Per-train stdout -> tl.log / bis.log; markers -> pipeline.log (what the guard polls).
# Env: HF_TOKEN (write). Recipe via RESFT_RANK/RESFT_ALPHA/RESFT_EPOCHS (resft.py defaults r32/a32/3ep).
set -uo pipefail
cd /workspace
export HF_TOKEN="${HF_TOKEN:-}"
HFREPO="Cryptopop/hiraia-heal-corpus"
echo "=== RESFT PARALLEL PIPELINE START $(date) ==="

echo "=== deps (unsloth + hf) $(date) ==="
pip install -q unsloth huggingface_hub 2>&1 | tail -3
python -c "import torch,unsloth,trl,transformers,peft; print('torch',torch.__version__,'trl',trl.__version__,'tf',transformers.__version__,'peft',peft.__version__,'ngpu',torch.cuda.device_count())" \
  || { echo "RESFT_FAIL_DEPS $(date)"; exit 1; }

echo "=== pull healed-2b4 from HF $(date) ==="
python -c "
from huggingface_hub import snapshot_download
import os
snapshot_download(repo_id='$HFREPO', repo_type='dataset', allow_patterns='healed-2b4/*',
                  local_dir='/workspace/hf', token=os.environ['HF_TOKEN'])
print('pulled healed-2b4')
" || { echo "RESFT_FAIL_PULL $(date)"; exit 1; }
HEALED=/workspace/hf/healed-2b4
ls -la "$HEALED"

echo "=== TRAIN TAGALOG (GPU0) + BISAYA (GPU1) IN PARALLEL $(date) ==="
CUDA_VISIBLE_DEVICES=0 RESFT_MODEL="$HEALED" RESFT_DATASET=/workspace/train-distill-kitten-v7.jsonl \
  RESFT_OUTPUT=/workspace/out-tl RESFT_FORMAT=messages RESFT_MAXSEQ=2048 RESFT_BS=8 RESFT_GA=4 \
  python resft.py > /workspace/tl.log 2>&1 &
PID_TL=$!
CUDA_VISIBLE_DEVICES=1 RESFT_MODEL="$HEALED" RESFT_DATASET=/workspace/train-bisaya-v5.jsonl \
  RESFT_OUTPUT=/workspace/out-bis RESFT_FORMAT=sharegpt RESFT_MAXSEQ=1024 RESFT_BS=8 RESFT_GA=4 \
  python resft.py > /workspace/bis.log 2>&1 &
PID_BIS=$!
echo "launched TL pid=$PID_TL (GPU0) BIS pid=$PID_BIS (GPU1)"

wait $PID_TL; RC_TL=$?
[ "$RC_TL" -eq 0 ] && echo "TL_DONE $(date)" || { echo "RESFT_FAIL_TL $(date)"; tail -15 /workspace/tl.log; }
wait $PID_BIS; RC_BIS=$?
[ "$RC_BIS" -eq 0 ] && echo "BIS_DONE $(date)" || { echo "RESFT_FAIL_BIS $(date)"; tail -15 /workspace/bis.log; }
[ "$RC_TL" -eq 0 ] && [ "$RC_BIS" -eq 0 ] || { echo "RESFT_FAIL_TRAIN $(date)"; exit 1; }

echo "=== PUSH both adapters to HF $(date) ==="
python -c "
from huggingface_hub import HfApi
import os
api=HfApi(token=os.environ['HF_TOKEN'])
api.upload_folder(folder_path='/workspace/out-tl/final-adapter',  path_in_repo='resft-tl-adapter',  repo_id='$HFREPO', repo_type='dataset')
api.upload_folder(folder_path='/workspace/out-bis/final-adapter', path_in_repo='resft-bis-adapter', repo_id='$HFREPO', repo_type='dataset')
print('ADAPTERS_PUSHED')
" || { echo "RESFT_FAIL_PUSH $(date)"; exit 1; }

echo "=== RESFT_PIPELINE_DONE $(date) ==="
