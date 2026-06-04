# RunPod Complete Setup Guide

This document contains all specifications and steps for setting up a RunPod instance for LoRA fine-tuning of Hiraia language models.

> **Base model: `sail/Sailor2-3B-Chat`** (Qwen2.5 arch, best Tagalog+Cebuano in our
> bake-off). Qwen3-1.7B is no longer a candidate. Train with **unsloth** (GPU), then
> convert the PEFT adapter to GGUF with **`--base-model-id sail/Sailor2-3B-Chat`**.

## Pod Configuration

### GPU Selection
- **Recommended**: any 48GB+ GPU (L40 / A100 / H100). Sailor2-3B in 4-bit + ctx-1024 fits comfortably; GPU class barely changes wall-clock for unsloth here.
- **Cost**: ~$0.80 (L40) to ~$2.50/hour (H100)
- **Training time**: ~25–40 min/language for ~2.4k samples, 3 epochs, ctx 1024 (Sailor2-3B is ~2× Qwen3-1.7B, and ctx 1024 > the old 512 benchmark)
- **Total cost per training run**: ~$1–4 per language

### Storage
- **Network Volume**: 25GB standard (not high-performance, not S3-compatible)
- **Cost**: $2.50/month ($0.10/GB)
- **Mount path**: `/workspace`
- **Purpose**: Persistent storage for datasets, scripts, and trained adapters across pod restarts

### Template
- **Use**: RunPod PyTorch 2.2 or RunPod FastAI
- **Container disk**: 50GB (default)
- **Avoid**: Serverless templates (need persistent pod)

### Network Ports
- **Expose port 22** (TCP) for SFTP file transfer
- **Warning**: Changing ports restarts the pod (but `/workspace` data persists)

## Initial Setup Steps

### 1. Deploy Pod
1. Go to RunPod → Pods → Deploy
2. Select **H100** GPU
3. Choose **RunPod PyTorch 2.2** template
4. Set container disk to 50GB
5. Attach 25GB network volume, mount at `/workspace`
6. Expose port 22 (TCP)
7. Click "Deploy On-Demand"

### 2. Install SFTP Support (OhMyRunPod)
SSH into the pod (via web terminal or SSH):
```bash
# Install OhMyRunPod
pip install OhMyRunPod

# Set up SFTP file transfer
OhMyRunPod --file-transfer
```

Choose **SFTP** when prompted. This will:
- Install and configure SSH server
- Set up SSH keys and password
- Display connection details (IP, port, username, password)

**Connection details will be shown on screen** - save them for file transfers.

### 3. Install tmux
```bash
apt update && apt install -y tmux
```

tmux allows you to disconnect from the pod while training continues running.

### 4. Create Virtual Environment and Install Dependencies

All RunPod templates require a virtual environment for Unsloth. Create it once per pod, then activate it whenever you SSH in.

**Important**: PyTorch must be installed in two steps to ensure proper CUDA support.

```bash
cd /workspace

# Create virtual environment (do this ONCE per pod)
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip

# Step 1: Install PyTorch with CUDA 12.4 support (critical for GPU training)
pip install torch==2.6.0 torchvision==0.21.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124

# Step 2: Install remaining dependencies (this will take 5-10 minutes)
pip install -r requirements-unsloth.txt
```

The requirements file includes:
- unsloth[colab-new]
- transformers, datasets, peft, trl
- bitsandbytes, xformers, accelerate
- scipy, sentencepiece, protobuf

**Important**: You must activate the virtual environment every time you SSH in before running any Python commands:
```bash
cd /workspace
source venv/bin/activate
```

## File Transfer

### Using SFTP (Recommended)
From your local machine:

```bash
# Install sshpass if not already installed
brew install sshpass

# Upload files
cd /path/to/your/files
sshpass -p 'YOUR_PASSWORD' scp -P PORT -o StrictHostKeyChecking=no filename root@IP:/workspace/
```

Example with actual values:
```bash
cd /Users/luis/Code/hiraia/finetuning

sshpass -p 'JPttv5eAI8XA' scp -P 16554 -o StrictHostKeyChecking=no \
  train-tagalog-unsloth.py \
  requirements-unsloth.txt \
  root@157.66.254.40:/workspace/

sshpass -p 'JPttv5eAI8XA' scp -P 16554 -o StrictHostKeyChecking=no \
  datasets/tagalog/train-v3.jsonl \
  root@157.66.254.40:/workspace/train-tagalog-v3.jsonl
# (Bisaya run: send datasets/bisaya/train-v3.jsonl -> /workspace/train-bisaya-v3.jsonl
#  and scp train-bisaya-unsloth.py instead)
```

### Using GUI SFTP Clients
- **FileZilla**: Host: sftp://IP | Port: PORT | User: root
- **WinSCP**: Host: IP | Port: PORT | Protocol: SFTP | User: root
- **VS Code Remote**: Install "Remote - SSH" extension, connect to ssh root@IP -p PORT

## Training Execution

### Start Training
```bash
# SSH into pod
sshpass -p 'PASSWORD' ssh -p PORT root@IP

# Create persistent tmux session
tmux new -s training

# Activate virtual environment (MUST do this every time)
cd /workspace
source venv/bin/activate

# Run training
python train-tagalog-unsloth.py
```

### Monitor Training
The script will display:
- GPU info and VRAM usage
- Model loading progress
- Dataset size and split
- Training progress with loss values every 10 steps
- Expected training time: ~25–40 minutes per language (Sailor2-3B, ctx 1024, ~2.4k samples)

### Disconnect While Training Continues
In tmux:
- Press `Ctrl+B`, then press `D` to detach
- Training continues running in the background
- You can safely close your terminal or disconnect

### Reconnect to Check Progress
```bash
# SSH back into pod
sshpass -p 'PASSWORD' ssh -p PORT root@IP

# Reattach to training session
tmux attach -t training
```

### tmux Quick Reference
- `tmux new -s name` — Create new session
- `Ctrl+B, D` — Detach (leave running)
- `tmux attach -t name` — Reconnect to session
- `tmux ls` — List all sessions
- `Ctrl+B, [` — Enter scroll mode (use arrows, press `q` to exit)
- `exit` — End session (only after training completes)

## Output Files

Training produces two outputs in `/workspace/output/tagalog-unsloth/`:

1. **final-adapter/** (~500MB)
   - LoRA adapter weights
   - Can be loaded with PEFT/transformers
   - Smaller, faster to download

2. **merged-model/** (~3.4GB)
   - Base model + adapter merged into single model
   - Ready for inference
   - Larger, optional to download

### Download Results
```bash
# From your local machine
cd /path/to/save/results

# Download adapter (recommended, smaller)
sshpass -p 'PASSWORD' scp -P PORT -o StrictHostKeyChecking=no \
  -r root@IP:/workspace/output/tagalog-unsloth/final-adapter ./

# Download merged model (optional, larger)
sshpass -p 'PASSWORD' scp -P PORT -o StrictHostKeyChecking=no \
  -r root@IP:/workspace/output/tagalog-unsloth/merged-model ./
```

## Cost Management

### During Training
- Pod costs ~$2.00-2.50/hour while running
- Training takes ~25–40 minutes per language
- Expected cost per run: ~$1–4 per language

### After Training
**Important**: Stop or terminate the pod when done to avoid ongoing charges.

- **Stop pod**: Pauses billing but keeps volume attached (~$0.20-0.40/hour idle)
- **Terminate pod**: Completely deletes pod (but network volume persists at $2.50/month)

### Volume Costs
- Network volume: $2.50/month regardless of pod status
- Only deleted if you explicitly delete the volume
- Safe to leave attached across multiple training runs

## Troubleshooting

### SSH Connection Issues
**Problem**: "Connection refused"
- Verify port 22 is exposed in pod settings
- Check pod is in "Running" state
- Try web terminal as fallback

**Problem**: "Permission denied"
- Verify password from OhMyRunPod setup
- Check username is `root`
- Ensure you're using correct port (not default 22)

### Training Issues
**Problem**: "CUDA out of memory"
- Reduce batch size in training script:
  ```python
  BATCH_SIZE = 2  # Instead of 4
  ```

**Problem**: Loss not decreasing after 100 steps
- Stop training (Ctrl+C)
- Check dataset format
- Verify learning rate and hyperparameters

**Problem**: Training hangs or crashes
- Check GPU utilization: `watch -n 1 nvidia-smi`
- Should see 80-100% GPU usage during training
- If low, something is blocking (likely CPU or I/O bottleneck)

### File Transfer Issues
**Problem**: SFTP connection fails
- Re-run `OhMyRunPod --file-transfer` to regenerate credentials
- Verify port 22 is exposed
- Check firewall allows outbound connections to RunPod IP range

## Quick Reference

### Essential Commands
```bash
# Activate virtual environment (required before any Python commands)
cd /workspace
source venv/bin/activate

# Start training in persistent session
tmux new -s training
python train-tagalog-unsloth.py

# Detach from session
Ctrl+B, D

# Reconnect to session
tmux attach -t training

# Check GPU usage
nvidia-smi

# Check disk space
df -h /workspace
```

### File Locations
- Training script: `/workspace/train-tagalog-unsloth.py`
- Dataset: `/workspace/train-tagalog-v3.jsonl` (v2 + image-tagged; Bisaya: `train-bisaya-v3.jsonl`)
- Requirements: `/workspace/requirements-unsloth.txt`
- Output: `/workspace/output/tagalog-unsloth/`

### Expected Training Output
```
🚀 Starting Tagalog LoRA training with Unsloth...

✓ Using GPU: NVIDIA H100 80GB HBM3
✓ VRAM: 80.0 GB

Loading Sailor2-3B-Chat model...
✓ Model loaded

Applying LoRA configuration...
✓ LoRA applied to 7 modules
  Rank: 32, Alpha: 64
  Trainable parameters: 4.8M (2.8% of total)

Loading dataset from /workspace/train-tagalog-v3.jsonl...
✓ Loaded 2377 samples
✓ Train: 2139, Validation: 238

Formatting dataset...
✓ Dataset formatted

Configuring training...
  Epochs: 3
  Batch size: 4 × 4 = 16
  Learning rate: 0.0001
  Scheduler: cosine
  Warmup ratio: 0.1

Starting training...
================================================================================
Step 10: loss=2.847, lr=0.0000234
Step 20: loss=2.341, lr=0.0000567
...
Step 720: loss=0.892, lr=0.0000123
================================================================================

✓ Training completed!

Training metrics:
  Final train loss: 0.8920
  Training time: 28.5 minutes

Saving LoRA adapter to /workspace/output/tagalog-unsloth/final-adapter...
✓ Adapter saved

Merging adapter with base model...
✓ Merged model saved

🎉 Done!
```

## Pod Lifecycle

### First-Time Setup
1. Deploy pod with H100, 25GB volume, port 22
2. Install OhMyRunPod and set up SFTP
3. Install tmux (`apt update && apt install -y tmux`)
4. Upload training files via SFTP
5. Create virtual environment: `python3 -m venv venv`
6. Activate virtual environment: `source venv/bin/activate`
7. Install Python dependencies: `pip install -r requirements-unsloth.txt`
8. Run training
9. Download results
10. Terminate pod (keep volume)

### Subsequent Runs (Pod Exists)
1. Start pod (if stopped)
2. Upload any updated files via SFTP
3. SSH in, activate venv (`source venv/bin/activate`), start tmux session
4. Run training (dependencies already installed in venv)
5. Download results
6. Stop or terminate pod

### Fresh Start (New Pod)
1. Delete old pod
2. Deploy new pod with same configuration
3. Re-attach existing network volume (your files are still there!)
4. Re-expose port 22
5. Re-install OhMyRunPod and tmux
6. Create virtual environment: `python3 -m venv venv`
7. Activate virtual environment: `source venv/bin/activate`
8. Install Python dependencies: `pip install -r requirements-unsloth.txt`
9. Run training

The network volume persists across pod deletions, so your datasets, scripts, and trained adapters remain available.
