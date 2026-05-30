#!/bin/bash
# Upload dataset and training script to RunPod
# Usage: ./upload-to-runpod.sh <pod-ip> <ssh-port>

set -e

if [ $# -ne 2 ]; then
    echo "Usage: $0 <pod-ip> <ssh-port>"
    echo "Example: $0 123.45.67.89 12345"
    exit 1
fi

POD_IP=$1
SSH_PORT=$2
SSH_TARGET="root@${POD_IP}"

echo "🚀 Uploading files to RunPod pod ${POD_IP}..."

# Upload dataset
echo "📦 Uploading dataset (science-chat-v2.jsonl)..."
scp -P "$SSH_PORT" datasets/tagalog/science-chat-v2.jsonl "${SSH_TARGET}:/workspace/"
echo "✓ Dataset uploaded"

# Upload training script
echo "📝 Uploading training script (train-tagalog-unsloth.py)..."
scp -P "$SSH_PORT" train-tagalog-unsloth.py "${SSH_TARGET}:/workspace/train.py"
echo "✓ Training script uploaded"

# Upload requirements
echo "📋 Uploading requirements..."
scp -P "$SSH_PORT" requirements-unsloth.txt "${SSH_TARGET}:/workspace/requirements.txt"
echo "✓ Requirements uploaded"

echo ""
echo "✅ Upload complete!"
echo ""
echo "Next steps:"
echo "1. SSH into the pod:"
echo "   ssh -p ${SSH_PORT} ${SSH_TARGET}"
echo ""
echo "2. Install dependencies:"
echo "   pip install -r requirements.txt"
echo ""
echo "3. Run training:"
echo "   python train.py"
echo ""
echo "4. Monitor GPU usage:"
echo "   watch -n 1 nvidia-smi"
echo ""
echo "5. After training, download results:"
echo "   scp -P ${SSH_PORT} ${SSH_TARGET}:/workspace/output/tagalog-unsloth/final-adapter.tar.gz ."
