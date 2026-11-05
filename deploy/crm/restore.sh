#!/usr/bin/env bash
# ============================================================================
# restore.sh — decrypt a hiraia-crm backup artifact, verify it, and (optionally) install it.
#
#   /opt/hiraia-crm/restore.sh <artifact.tar.gpg> [--to DIR] [--verify-against DB] [--install]
#
#   default        decrypts into a temp dir (or --to DIR), checks the .sha256 sidecar if present,
#                  runs PRAGMA integrity_check, prints per-table row counts and compares them to
#                  the manifest frozen at backup time. Exit 0 only when everything matches.
#   --verify-against DB   also prints the live DB's counts next to the restored ones (they only
#                  match when nothing was written since the backup — a smoke check, not a gate)
#   --install      stops hiraia-crm, moves the live DB aside to crm.db.pre-restore-<stamp>
#                  (with its -wal/-shm), copies the restored DB in, runs migrations, starts the
#                  service and checks /api/crm/health. Ask before using this on production.
#
# An artifact that only exists offsite: fetch it first —
#   /opt/hiraia-crm/venv/bin/python /opt/hiraia-crm/offsite.py fetch --env /etc/hiraia-crm/offsite.env \
#       --key hiraia-crm/daily/<name>.tar.gpg --out /tmp/<name>.tar.gpg
# ============================================================================
set -euo pipefail
STATE_DIR=${HIRAIA_CRM_STATE_DIR:-/var/lib/hiraia-crm}
CONF_DIR=${HIRAIA_CRM_CONF_DIR:-/etc/hiraia-crm}
PASSPHRASE_FILE=${HIRAIA_CRM_BACKUP_PASSPHRASE_FILE:-$CONF_DIR/backup.passphrase}
DB_PATH=${HIRAIA_CRM_DB_PATH:-$STATE_DIR/crm.db}
SERVICE_USER=${HIRAIA_CRM_USER:-hiraia}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export GNUPGHOME=${GNUPGHOME:-${HIRAIA_CRM_BACKUP_DIR:-/var/backups/hiraia-crm}/.gnupg}

artifact=${1:-}; shift || true
[ -f "$artifact" ] || { echo "usage: restore.sh <artifact.tar.gpg> [--to DIR] [--verify-against DB] [--install]" >&2; exit 2; }
to=""; against=""; install=0
while [ $# -gt 0 ]; do case "$1" in --to) to=$2; shift 2;; --verify-against) against=$2; shift 2;; --install) install=1; shift;; *) echo "unknown flag $1" >&2; exit 2;; esac; done
[ -r "$PASSPHRASE_FILE" ] || { echo "passphrase file $PASSPHRASE_FILE not readable" >&2; exit 2; }

if [ -n "$to" ]; then mkdir -p "$to"; out=$to; else out=$(mktemp -d /tmp/hiraia-crm-restore.XXXXXX); fi
echo "restore: $artifact -> $out"

if [ -f "$artifact.sha256" ]; then
  (cd "$(dirname "$artifact")" && sha256sum -c --quiet "$(basename "$artifact").sha256") && echo "sha256 sidecar: OK" || { echo "sha256 sidecar MISMATCH" >&2; exit 1; }
else
  echo "sha256 sidecar: none (artifact sha256 $(sha256sum "$artifact" | cut -d' ' -f1))"
fi

gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" --decrypt "$artifact" 2>/dev/null | tar -xzf - -C "$out"
[ -f "$out/crm.db" ] && [ -f "$out/manifest.json" ] || { echo "artifact is missing crm.db or manifest.json" >&2; exit 1; }
ic=$(sqlite3 "$out/crm.db" 'PRAGMA integrity_check;'); echo "integrity_check: $ic"; [ "$ic" = ok ] || exit 1
got=$(sha256sum "$out/crm.db" | cut -d' ' -f1)
exp=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["db_sha256"])' "$out/manifest.json")
[ "$got" = "$exp" ] && echo "db sha256 matches manifest: $got" || { echo "db sha256 MISMATCH (manifest $exp, got $got)" >&2; exit 1; }

python3 - "$out/crm.db" "$out/manifest.json" "$against" <<'PY'
import json, sqlite3, sys
restored, manifest_path, against = sys.argv[1], sys.argv[2], sys.argv[3]
manifest = json.load(open(manifest_path))
def counts(path):
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}
r = counts(restored); m = manifest["counts"]; live = counts(against) if against else None
print(f"{'table':<20}{'restored':>10}{'manifest':>10}" + (f"{'live':>10}" if live else ""))
ok = True
for t in sorted(set(r) | set(m) | set(live or {})):
    line = f"{t:<20}{r.get(t, '-'):>10}{m.get(t, '-'):>10}" + (f"{live.get(t, '-'):>10}" if live else "")
    if r.get(t) != m.get(t): ok = False; line += "   <-- differs from manifest"
    elif live is not None and r.get(t) != live.get(t): line += "   (live differs: written since backup)"
    print(line)
print("manifest stamp:", manifest["stamp"], "host:", manifest.get("host"))
print("RESTORE VERIFIED: row counts match the manifest" if ok else "RESTORE FAILED: counts differ from manifest")
sys.exit(0 if ok else 1)
PY

if [ "$install" = 1 ]; then
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  echo "installing restored DB over $DB_PATH (previous copy kept as crm.db.pre-restore-$stamp)"
  systemctl stop hiraia-crm.service
  for suffix in "" -wal -shm; do [ -f "$DB_PATH$suffix" ] && mv "$DB_PATH$suffix" "$DB_PATH.pre-restore-$stamp$suffix"; done
  install -o "$SERVICE_USER" -g "$SERVICE_USER" -m 640 "$out/crm.db" "$DB_PATH"
  runuser -u "$SERVICE_USER" -- node "$HERE/migrate.cjs" --db "$DB_PATH"
  systemctl start hiraia-crm.service; sleep 2
  curl -fsS "http://127.0.0.1:${HIRAIA_CRM_PORT:-8137}/api/crm/health" && echo && echo "service healthy after restore"
fi
