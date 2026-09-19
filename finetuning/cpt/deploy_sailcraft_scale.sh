#!/usr/bin/env bash
# ============================================================================
# deploy_sailcraft_scale.sh — provision a high-CPU pod in US-NE-1 on the
# hiraia-cpt-corpus volume, set up SailCraft with the validated Filipino
# configs (finetuning/cpt/sailcraft-filipino/), build the tl/ceb input pools
# from the raw pull, and launch the 4-stage pipeline DETACHED — **ceb first**
# (small/fast → validates the scaled path in <1h) then tl (the long haul).
#
# Prints monitor/terminate commands (no auto-terminate — you control billing).
# Usage:  cd finetuning/cpt && ./deploy_sailcraft_scale.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="1atl7503ky"; DC_ID="US-NE-1"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB=60; POD_NAME="hiraia-sailcraft-scale"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i $KEY"
ENV_LOCAL="$HERE/../../.env.local"
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
[ -d sailcraft-filipino ] || { echo "ERR: sailcraft-filipino/ missing"; exit 1; }
[ -f prep_pools.py ] || { echo "ERR: prep_pools.py missing"; exit 1; }

# SailCraft is CPU-bound (datasets.map across cores; stage-3 suffix array is RAM-
# hungry) — the GPU idles, we're buying the H100 pod's 16+ vCPU / 120GB+ RAM in
# the DC our volume lives in. Speed-first per hiraia-runpod-gpu-pref.
POD_ID=""
for MEM in 160 120 90; do
  echo ">> try H100 SXM in $DC_ID (minMem ${MEM}GB) ..."
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, gpuTypeId: \\\"NVIDIA H100 80GB HBM3\\\", dataCenterId: \\\"$DC_ID\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: $DISK_GB, minVcpuCount: 16, minMemoryInGb: $MEM, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\" }) { id } }")
  POD_ID=$(echo "$D" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$POD_ID" ] && break
  echo "   no: $(echo "$D" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)"
done
[ -n "$POD_ID" ] || { echo "ERR: no H100 capacity in $DC_ID"; exit 1; }
echo ">> POD_ID=$POD_ID"

echo ">> waiting for SSH ..."
IP=""; PORT=""
for i in $(seq 1 40); do
  P=$(gql "query { pod(input:{podId:\\\"$POD_ID\\\"}) { runtime { ports { ip publicPort privatePort } } } }")
  PORT=$(echo "$P" | sed -n 's/.*"ip":"[^"]*","publicPort":\([0-9]*\),"privatePort":22.*/\1/p' | head -1)
  IP=$(echo "$P"   | sed -n 's/.*"ip":"\([^"]*\)","publicPort":[0-9]*,"privatePort":22.*/\1/p' | head -1)
  [ -n "$PORT" ] && { echo ">> ssh root@$IP:$PORT"; break; }; sleep 15
done
[ -n "$PORT" ] || { echo "ERR: no SSH port. POD_ID=$POD_ID — terminate manually."; exit 1; }
for i in $(seq 1 30); do ssh $SSH -p "$PORT" "root@$IP" 'echo ok' 2>/dev/null | grep -q ok && break; sleep 10; done

echo ">> uploading configs ..."
tar czf /tmp/sailcraft-filipino.tgz sailcraft-filipino
scp $SSH -P "$PORT" /tmp/sailcraft-filipino.tgz prep_pools.py "root@$IP:/root/"

echo ">> remote setup (uv + rustup + sailcraft clone + patches + venvs + LID model) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
export SAILCRAFT=/workspace/sailcraft-run
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
cd /root && tar xzf sailcraft-filipino.tgz
command -v uv >/dev/null || (curl -LsSf https://astral.sh/uv/install.sh | sh)
command -v cargo >/dev/null || (curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y)
if [ ! -d "$SAILCRAFT" ]; then
  git clone --depth 1 https://github.com/sail-sg/sailcraft "$SAILCRAFT"
  cd "$SAILCRAFT" && git apply /root/sailcraft-filipino/patches/*.patch
  echo ">> patches applied"
fi
cd "$SAILCRAFT"
[ -x .venv/bin/python ]       || uv venv --python 3.11 .venv
[ -x .venv-dedup/bin/python ] || uv venv --python 3.11 .venv-dedup
uv pip install -q --python .venv/bin/python       -r /root/sailcraft-filipino/requirements-clean.txt
uv pip install -q --python .venv-dedup/bin/python -r /root/sailcraft-filipino/requirements-dedup.txt
mkdir -p lm_resource
[ -s lm_resource/lid.176.bin ] || curl -sL -o lm_resource/lid.176.bin \
  https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin
echo ">> setup complete"
REMOTE

echo ">> building input pools (streams the raw pull -> pool_tl/pool_ceb JSONL) ..."
ssh $SSH -p "$PORT" "root@$IP" \
  'SAILCRAFT=/workspace/sailcraft-run /workspace/sailcraft-run/.venv/bin/python -u /root/prep_pools.py 2>&1 | tee /workspace/corpus/logs/prep-pools.log'

echo ">> launching pipeline DETACHED (ceb first, then tl) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
cd /workspace/sailcraft-run
cp /root/sailcraft-filipino/run_filipino_pipeline.sh /root/run_scale.sh
# ceb-first order: strip the driver's two run_lang lines, re-append swapped
head -n -2 /root/run_scale.sh > /root/run_scale_ordered.sh
{ echo 'run_lang ceb "pool_ceb"'; echo 'run_lang tl  "pool_tl"'; } >> /root/run_scale_ordered.sh
chmod +x /root/run_scale_ordered.sh
# SailCraft's stage scripts call bare `python` — the clean venv MUST be on PATH
# (the June run worked because the venv was shell-activated; without this, stages
# 1/4 crash with ModuleNotFoundError against the system python).
PATH="/workspace/sailcraft-run/.venv/bin:$PATH" SAILCRAFT=/workspace/sailcraft-run \
  nohup bash /root/run_scale_ordered.sh \
  > /workspace/corpus/logs/sailcraft-scale.log 2>&1 &
echo "PID $!"
REMOTE

cat <<EOF
============================================================================
SailCraft scale run launched (ceb first). Pod stays up until YOU terminate.
  monitor:   ssh $SSH -p $PORT root@$IP 'tail -f /workspace/corpus/logs/sailcraft-scale.log'
  counts:    ssh $SSH -p $PORT root@$IP 'grep -A5 "doc counts" /workspace/corpus/logs/sailcraft-scale.log'
  terminate: curl -X DELETE -H "Authorization: Bearer \$RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/$POD_ID
POD_ID=$POD_ID  IP=$IP  PORT=$PORT
============================================================================
EOF
