#!/usr/bin/env bash
# resft-pipeline-tl.sh — TL-ONLY re-SFT on the healed 2.4B with the augmented v8 dataset.
# (bisaya adapter from iter-2 already passes the gate; reuse it.) Pushes resft-tl-v8-adapter to HF.
set -uo pipefail
cd /workspace
export HF_TOKEN="${HF_TOKEN:-}"
HFREPO="Cryptopop/hiraia-heal-corpus"
echo "=== RESFT-TL(v8) PIPELINE START $(date) ==="

echo "=== deps $(date) ==="
pip install -q unsloth huggingface_hub 2>&1 | tail -3
python -c "import torch,unsloth,trl,transformers,peft; print('ok ngpu',torch.cuda.device_count())" || { echo "RESFT_FAIL_DEPS $(date)"; exit 1; }

echo "=== pull healed-2b4 $(date) ==="
python -c "
from huggingface_hub import snapshot_download
import os
snapshot_download(repo_id='$HFREPO', repo_type='dataset', allow_patterns='healed-2b4/*', local_dir='/workspace/hf', token=os.environ['HF_TOKEN'])
print('pulled healed-2b4')
" || { echo "RESFT_FAIL_PULL $(date)"; exit 1; }
HEALED=/workspace/hf/healed-2b4

echo "=== TRAIN TAGALOG v8 (r32/a32/3ep) $(date) ==="
RESFT_MODEL="$HEALED" RESFT_DATASET=/workspace/train-distill-kitten-v8.jsonl \
  RESFT_OUTPUT=/workspace/out-tl RESFT_FORMAT=messages RESFT_MAXSEQ=2048 RESFT_BS=8 RESFT_GA=4 \
  python resft.py || { echo "RESFT_FAIL_TL $(date)"; exit 1; }
echo "TL_DONE $(date)"

echo "=== PUSH tl-v8 adapter to HF $(date) ==="
python -c "
from huggingface_hub import HfApi
import os
HfApi(token=os.environ['HF_TOKEN']).upload_folder(folder_path='/workspace/out-tl/final-adapter', path_in_repo='resft-tl-v8-adapter', repo_id='$HFREPO', repo_type='dataset')
print('ADAPTER_PUSHED')
" || { echo "RESFT_FAIL_PUSH $(date)"; exit 1; }

echo "=== RESFT_PIPELINE_DONE $(date) ==="
