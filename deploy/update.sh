#!/usr/bin/env bash
#
# Redeploy the latest `main` to this VPS:
#   sync repo (hard reset to origin/main) -> install -> build web -> restart pm2.
#
# `main` is the single source of truth: this hard-resets the working tree, so do
# NOT keep local edits on the server — commit them to the repo instead. Untracked
# files (downloaded models, adapters, the SQLite DB outside the repo) are left alone.
#
# Usage (on the VPS, from anywhere):
#   /root/hiraia/deploy/update.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "==> Syncing to origin/main"
git fetch origin --quiet
git reset --hard origin/main
git log --oneline -1

echo "==> Installing + building web"
cd packages/web
pnpm install --frozen-lockfile
pnpm build   # bakes NEXT_PUBLIC_QVAC_URL from .env.production

echo "==> Restarting web (pm2: hiraia-web)"
pm2 restart hiraia-web --update-env

sleep 3
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:3005 || true)"
if [ "$code" = "200" ]; then
  echo "==> Deploy OK (hiraia-web http $code)"
else
  echo "==> WARNING: hiraia-web returned '$code' — check: pm2 logs hiraia-web"
  exit 1
fi

# Note: the model server (pm2: hiraia-llm) is NOT restarted here — it only needs a
# restart when the model/adapters or run-llama-server.sh change. To restart it:
#   pm2 restart hiraia-llm
