#!/usr/bin/env bash
# Deploy one tagged commit of tala-v1 on the apps host. Run as root ON THE HOST:
#   /opt/tala/deploy.sh <tag>
# Layout: /opt/tala/repo (sparse partial clone) · /opt/tala/releases/<tag> (git worktree) · /opt/tala/current -> release
#         /etc/tala/tala.env (secrets, 600) · /var/lib/tala (SQLite + download dir) · systemd unit `tala`
# Builds the new release beside the running one, switches the symlink, restarts, checks health, and
# switches back automatically if the new release does not come up.
set -euo pipefail
TAG="${1:?usage: deploy.sh <tag>}"
ROOT=/opt/tala
REL="$ROOT/releases/$TAG"
PREV="$(readlink -f "$ROOT/current" 2>/dev/null || true)"

git -C "$ROOT/repo" fetch --quiet --force origin "refs/tags/$TAG:refs/tags/$TAG"
if [ ! -d "$REL" ]; then
  GIT_LFS_SKIP_SMUDGE=1 git -C "$ROOT/repo" worktree add --quiet --detach "$REL" "$TAG"
fi
cd "$REL"
echo "==> $(git log --oneline -1)"
CI=true pnpm install --frozen-lockfile --filter "@hiraia/tala-web..."
( cd packages/tala-web && NODE_ENV=production pnpm build )
mkdir -p packages/tala-web/.next/cache && chown -R tala:tala packages/tala-web/.next/cache
chmod -R o+rX "$REL" 2>/dev/null || true

ln -sfn "$REL" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
printf 'TALA_BUILD_ID=%s\n' "$TAG" > "$ROOT/build.env"
systemctl restart tala
for i in $(seq 1 30); do
  if curl -fsS -m 3 http://127.0.0.1:3220/api/v1/health >/dev/null 2>&1; then
    echo "==> healthy on $TAG"; exit 0
  fi
  sleep 1
done
echo "!! $TAG did not become healthy" >&2
journalctl -u tala -n 30 --no-pager >&2 || true
if [ -n "$PREV" ] && [ -d "$PREV" ] && [ "$PREV" != "$REL" ]; then
  ln -sfn "$PREV" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
  systemctl restart tala
  echo "!! rolled back to $PREV" >&2
fi
exit 1
