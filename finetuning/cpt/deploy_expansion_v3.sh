#!/usr/bin/env bash
# ============================================================================
# deploy_expansion_v3.sh — provision a pod in US-NE-1 on the EXPANSION volume
# (6er6skgoyb) and launch corpus-v3 DETACHED via driver_v3.sh.
#
# Reuses the v2 on-volume setup (sailcraft-run clone + venvs survive on the
# volume — setup is check-and-skip). v2 lessons baked in: /root/.driver-env
# for creds (pod env doesn't reach SSH), nohup < /dev/null, self-terminating
# driver. New in v3: poppler-utils for the DepEd pdftotext crawl.
#
# Usage:  cd finetuning/cpt && ./deploy_expansion_v3.sh
# ============================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
VOLUME_ID="6er6skgoyb"; DC_ID="US-NE-1"
IMAGE="${IMAGE:-runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04}"
DISK_GB=60; POD_NAME="hiraia-cpt-expansion-v3"
KEY="$HOME/.ssh/id_ed25519"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=20 -o ServerAliveInterval=30 -o ServerAliveCountMax=6 -i $KEY"
ENV_LOCAL="$HERE/../../.env.local"
set -a; . "$ENV_LOCAL"; set +a
: "${RUNPOD_API_KEY:?RUNPOD_API_KEY not set}"
: "${HUGGINGFACE_API_KEY:?HUGGINGFACE_API_KEY not set}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
for f in pull_corpus_v3.py prep_pools_v3.py harvest_opus.py crawl_deped.py measure_tokens.py run_sailcraft_stages.sh driver_v3.sh; do
  [ -f "$f" ] || { echo "ERR: $f missing"; exit 1; }
done

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

echo ">> uploading v3 scripts ..."
scp $SSH -P "$PORT" pull_corpus_v3.py prep_pools_v3.py harvest_opus.py crawl_deped.py \
  measure_tokens.py run_sailcraft_stages.sh driver_v3.sh "root@$IP:/root/"

echo ">> remote setup (check-and-skip: sailcraft + venvs already on the volume from v2) ..."
ssh $SSH -p "$PORT" "root@$IP" 'bash -s' <<'REMOTE'
set -e
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
# sailcraft clone + venvs + lid model persist on the volume from v2 — verify only
[ -x /workspace/sailcraft-run/.venv/bin/python ] || { echo "ERR: sailcraft venv missing on volume"; exit 1; }
[ -x /workspace/venv-pull/bin/python ] || { echo "ERR: venv-pull missing on volume"; exit 1; }
[ -s /workspace/sailcraft-run/lm_resource/lid.176.bin ] || { echo "ERR: lid model missing"; exit 1; }
# rustup lives in /root (container disk), NOT on the volume — reinstall on every
# fresh pod or run_sailcraft_stages.sh aborts at source ~/.cargo/env (v3 lesson)
[ -f "$HOME/.cargo/env" ] || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
command -v pdftotext >/dev/null || { apt-get update -qq && apt-get install -y -qq poppler-utils; }
pdftotext -v 2>&1 | head -1
mkdir -p /workspace/corpus/logs /workspace/corpus/raw
echo ">> setup verified"
REMOTE

echo ">> writing driver env + launching corpus-v3 driver DETACHED ..."
ssh $SSH -p "$PORT" "root@$IP" "printf 'RUNPOD_API_KEY=%s\nRUNPOD_POD_ID=%s\nHF_TOKEN=%s\n' \
  '$RUNPOD_API_KEY' '$POD_ID' '$HUGGINGFACE_API_KEY' > /root/.driver-env && chmod 600 /root/.driver-env"
ssh $SSH -p "$PORT" "root@$IP" \
  'nohup bash /root/driver_v3.sh > /workspace/corpus/logs/driver-v3.log 2>&1 < /dev/null & echo "DRIVER PID $!"'

cat <<EOF
============================================================================
Corpus-v3 expansion launched on the EXPANSION volume. The driver
SELF-TERMINATES the pod when done (or on failure) — billing is bounded.
  monitor:   ssh $SSH -p $PORT root@$IP 'tail -f /workspace/corpus/logs/driver-v3.log'
  report:    ssh $SSH -p $PORT root@$IP 'cat /workspace/corpus/EXPANSION-REPORT-v3.md'
  kill now:  curl -X DELETE -H "Authorization: Bearer \$RUNPOD_API_KEY" https://rest.runpod.io/v1/pods/$POD_ID
POD_ID=$POD_ID  IP=$IP  PORT=$PORT
============================================================================
EOF
