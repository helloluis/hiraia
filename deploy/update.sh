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

# Materialize any changed LFS adapters/blobs so the adapter-change check below sees REAL
# content (git reset smudges when lfs is configured, but be explicit — this hash is what
# decides whether the generation server gets restarted).
git lfs pull --include="packages/mobile/assets/models/*.gguf,packages/mobile/assets/rag/*.bin" 2>/dev/null || true

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

# --- Restart the GENERATION server (hiraia-llm) IFF its loaded adapters are now stale ---
# The model server loads the LoRA adapters INTO MEMORY at startup and does NOT pick up a new
# adapter file until restarted — a `git pull` of the adapter does nothing on its own. Skipping
# this silently served a stale pre-v10 adapter on the public demo for ~3 days (2026-06-20). So:
# hash the bundled adapters, compare to what the running server last loaded (MARKER, kept
# OUTSIDE the repo so the hard reset never touches it), and restart only when they differ
# (or the server is down). Idempotent: unchanged adapters → no restart, no downtime.
echo "==> Checking generation server (hiraia-llm) adapter freshness"
MARKER="${HOME}/.hiraia-llm-adapter.md5"
cur_hash="$(cd "$REPO/packages/mobile/assets/models" && md5sum adapter-tagalog.gguf adapter-bisaya.gguf 2>/dev/null | md5sum | cut -d' ' -f1)"
prev_hash="$(cat "$MARKER" 2>/dev/null || true)"

need_llm=0
if ! pgrep -f 'llama-server.*port 8080' >/dev/null 2>&1; then
  echo "==> hiraia-llm not running — (re)starting it"; need_llm=1
elif [ "$cur_hash" != "$prev_hash" ]; then
  echo "==> Adapter changed (${prev_hash:-none} -> $cur_hash) — restarting hiraia-llm"; need_llm=1
else
  echo "==> Adapter unchanged ($cur_hash) — hiraia-llm left running"
fi

if [ "$need_llm" = 1 ]; then
  pm2 restart hiraia-llm --update-env
  echo -n "==> waiting for hiraia-llm :8080 health "
  for i in $(seq 1 40); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:8080/health || true)" = "200" ]; then
      echo " UP (${i}x2s)"; break
    fi
    echo -n "."; sleep 2
  done
  echo "$cur_hash" > "$MARKER"
  echo "==> hiraia-llm now serving adapter $cur_hash"
fi
