#!/usr/bin/env bash
# resft-pipeline.sh — runs ON THE POD, detached: pull healed-2.4B from HF -> re-SFT tagalog
# adapter -> re-SFT bisaya adapter (conservative recipe) -> push both adapters to HF.
# Markers to pipeline.log; the launcher only polls (no long ssh). Env: HF_TOKEN (write).
set -uo pipefail
cd /workspace
export HF_TOKEN="${HF_TOKEN:-}"
HFREPO="Cryptopop/hiraia-heal-corpus"
echo "=== RESFT PIPELINE START $(date) ==="

echo "=== deps (unsloth + hf) $(date) ==="
pip install -q unsloth huggingface_hub 2>&1 | tail -3
python -c "import torch,unsloth,trl,transformers,peft; print('torch',torch.__version__,'trl',trl.__version__,'tf',transformers.__version__,'peft',peft.__version__)" \
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

echo "=== TRAIN TAGALOG (conservative r16/a16) $(date) ==="
RESFT_MODEL="$HEALED" RESFT_DATASET=/workspace/train-distill-kitten-v7.jsonl \
  RESFT_OUTPUT=/workspace/out-tl RESFT_FORMAT=messages RESFT_MAXSEQ=2048 RESFT_BS=8 RESFT_GA=4 \
  python resft.py || { echo "RESFT_FAIL_TL $(date)"; exit 1; }
echo "TL_DONE $(date)"

echo "=== TRAIN BISAYA (conservative r16/a16) $(date) ==="
RESFT_MODEL="$HEALED" RESFT_DATASET=/workspace/train-bisaya-v5.jsonl \
  RESFT_OUTPUT=/workspace/out-bis RESFT_FORMAT=sharegpt RESFT_MAXSEQ=1024 RESFT_BS=8 RESFT_GA=4 \
  python resft.py || { echo "RESFT_FAIL_BIS $(date)"; exit 1; }
echo "BIS_DONE $(date)"

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
