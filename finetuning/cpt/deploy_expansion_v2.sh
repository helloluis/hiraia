#!/usr/bin/env bash
# ============================================================================
# deploy_expansion_v2.sh — provision a pod in US-NE-1 on the EXPANSION volume
# (hiraia-cpt-expansion 6er6skgoyb, 300GB), set up SailCraft from the validated
# Filipino configs, and launch corpus-v2 DETACHED via driver_v2.sh.
#
# Differences from deploy_sailcraft_scale.sh (the v1 run):
#   - volume 6er6skgoyb (the v1 corpus volume 1atl7503ky is OFF-LIMITS here)
#   - RUNPOD_API_KEY + HF_TOKEN passed as POD ENV so the driver self-terminates
#     (its last act is the DELETE call; never rely on a session loop overnight)
#   - uploads the v2 scripts (pull/prep/harvest/measure/driver) instead of v1's
#
# Usage:  cd finetuning/cpt && ./deploy_expansion_v2.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="6er6skgoyb"; DC_ID="US-NE-1"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB=60; POD_NAME="hiraia-cpt-expansion"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i $KEY"
ENV_LOCAL="$HERE/../../.env.local"
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set}"
: "${HUGGINGFACE_API_KEY:?HUGGINGFACE_API_KEY not set}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
[ -d sailcraft-filipino ] || { echo "ERR: sailcraft-filipino/ missing"; exit 1; }
for f in pull_corpus_v2.py prep_pools_v2.py harvest_bloom.py measure_tokens.py run_sailcraft_stages.sh driver_v2.sh; do
  [ -f "$f" ] || { echo "ERR: $f missing"; exit 1; }
done

# CPU-bound work (SailCraft stages; pull is network-bound) — same shape as the
# proven v1 scale run: H100 SXM pod for its 16+ vCPU / 120GB+ RAM in our DC.
POD_ID=""
for MEM in 160 120 90; do
  echo ">> try H100 SXM in $DC_ID (minMem ${MEM}GB) ..."
  D=$(gql "mutation { podFindAndDeployOnDemand(input: { cloudType: SECURE, gpuCount: 1, gpuTypeId: \\\"NVIDIA H100 80GB HBM3\\\", dataCenterId: \\\"$DC_ID\\\", networkVolumeId: \\\"$VOLUME_ID\\\", volumeMountPath: \\\"/workspace\\\", containerDiskInGb: $DISK_GB, minVcpuCount: 16, minMemoryInGb: $MEM, supportPublicIp: true, imageName: \\\"$IMAGE\\\", ports: \\\"22/tcp\\\", startSsh: true, name: \\\"$POD_NAME\\\", env: [{key: \\\"RUNPOD_API_KEY\\\", value: \\\"$RUNPOD_API_KEY\\\"}, {key: \\\"HF_TOKEN\\\", value: \\\"$HUGGINGFACE_API_KEY\\\"}] }) { id } }")
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

echo ">> uploading configs + v2 scripts ..."
tar czf /tmp/sailcraft-filipino.tgz sailcraft-filipino
scp $SSH -P "$PORT" /tmp/sailcraft-filipino.tgz \
  pull_corpus_v2.py prep_pools_v2.py harvest_bloom.py measure_tokens.py \
  run_sailcraft_stages.sh driver_v2.sh "root@$IP:/root/"

echo ">> remote setup (uv + rustup + sailcraft clone + patches + venvs + LID + pull/measure venv) ..."
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
# pull/harvest/measure venv (on the volume — survives pod replacement)
if [ ! -x /workspace/venv-pull/bin/python ]; then
  uv venv --python 3.11 /workspace/venv-pull
fi
uv pip install -q --python /workspace/venv-pull/bin/python \
  "huggingface_hub[hf_xet]" hf_xet pyarrow wikiextractor "transformers>=5.2"
mkdir -p /workspace/corpus/logs /workspace/corpus/raw
/workspace/venv-pull/bin/python -c \
  "import huggingface_hub, hf_xet, transformers; print('hf_hub', huggingface_hub.__version__, '| hf_xet OK | transformers', transformers.__version__)" || true
echo ">> setup complete"
REMOTE

echo ">> launching corpus-v2 driver DETACHED (self-terminating) ..."
# Pod env (GraphQL env:) does NOT reach SSH sessions on this image — hand the
# driver its env as a root-only file it sources at startup (RUNPOD_POD_ID is
# known locally). `< /dev/null` on the nohup or ssh hangs on the open channel.
ssh $SSH -p "$PORT" "root@$IP" "printf 'RUNPOD_API_KEY=%s\nRUNPOD_POD_ID=%s\nHF_TOKEN=%s\n' \
  '$RUNPOD_API_KEY' '$POD_ID' '$HUGGINGFACE_API_KEY' > /root/.driver-env && chmod 600 /root/.driver-env"
ssh $SSH -p "$PORT" "root@$IP" \
  'nohup bash /root/driver_v2.sh > /workspace/corpus/logs/driver-v2.log 2>&1 < /dev/null & echo "DRIVER PID $!"'

cat <<EOF
============================================================================
Corpus-v2 expansion launched on the EXPANSION volume. The driver
SELF-TERMINATES the pod when done (or on failure) — billing is bounded.
  monitor:   ssh $SSH -p $PORT root@$IP 'tail -f /workspace/corpus/logs/driver-v2.log'
  report:    ssh $SSH -p $PORT root@$IP 'cat /workspace/corpus/EXPANSION-REPORT.md'
  kill now:  curl -X DELETE -H "Authorization: Bearer \$RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/$POD_ID
POD_ID=$POD_ID  IP=$IP  PORT=$PORT
============================================================================
EOF
