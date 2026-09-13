#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
node_modules/.bin/esbuild packages/web/scripts/telemetry-server.ts \
  --bundle --platform=node --target=node22 --format=cjs --packages=external \
  --outfile=packages/web/.telemetry/server.cjs
