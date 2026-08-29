#!/bin/bash
# check_runpod.sh — local helper: query RunPod API for my pods + network volumes.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
set -a; . "$HERE/../../.env.local"; set +a
: "${RUNPOD_API_KEY:?}"
API="https://api.runpod.io/graphql?api_key=${RUNPOD_API_KEY}"
gql(){ curl -s --max-time 60 "$API" -H 'Content-Type: application/json' -d "{\"query\":\"$1\"}"; }
gql "query { myself { pods { id name desiredStatus machineType costPerHr } networkVolumes { id name size dataCenterId } } }" | python3 -m json.tool
