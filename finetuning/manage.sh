#!/bin/bash
# Runpod training management script
# Usage: bash manage.sh [command]

VENV="/workspace/venv/bin/activate"

case "$1" in
    train)
        source $VENV
        cd /workspace
        python -u train-tagalog-unsloth.py 2>&1
        ;;
    install)
        source $VENV
        cd /workspace
        pip install -r requirements-unsloth.txt 2>&1
        ;;
    check-env)
        source $VENV
        python -c "
import torch
import trl
import transformers
import unsloth
print('Torch:', torch.__version__)
print('TRL:', trl.__version__)
print('Transformers:', transformers.__version__)
print('Unsloth:', unsloth.__version__)
print('CUDA available:', torch.cuda.is_available())
if torch.cuda.is_available():
    print('GPU:', torch.cuda.get_device_name(0))
    print('VRAM:', round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1), 'GB')
" 2>&1
        ;;
    gpu)
        nvidia-smi
        ;;
    test-imports)
        source $VENV
        python -c "
print('Testing imports...')
import torch; print('  torch OK:', torch.__version__)
from trl import SFTTrainer, SFTConfig; print('  SFTTrainer, SFTConfig OK')
from unsloth import FastLanguageModel; print('  FastLanguageModel OK')
from unsloth.chat_templates import get_chat_template, standardize_sharegpt; print('  chat_templates OK')
from datasets import load_dataset; print('  datasets OK')
print('All imports successful!')
" 2>&1
        ;;
    *)
        echo "Usage: bash manage.sh [train|install|check-env|gpu|test-imports]"
        ;;
esac
