#!/usr/bin/env bash
# ============================================================================
# backup.sh — encrypted daily backup of the Hiraia CRM database + config.
# Runs on the origin from hiraia-crm-backup.timer (03:00 PHT) as root; any non-zero exit triggers
# hiraia-crm-backup-alert.service (log + e-mail). Also fine to run by hand.
#
#   /opt/hiraia-crm/backup.sh [--force-weekly] [--force-monthly]
#
# Steps
#   1. consistent online snapshot of the SQLite DB (sqlite3 .backup, run as the service user so
#      the WAL/-shm files keep their ownership), PRAGMA integrity_check must say "ok"
#   2. manifest.json: per-table row counts, schema version, sha256 of the snapshot
#   3. config copy: /etc/hiraia-crm/crm.env (key HASHES only), systemd units, nginx snippets —
#      never the backup passphrase or offsite credentials
#   4. tar.gz -> gpg --symmetric AES-256 (passphrase in /etc/hiraia-crm/backup.passphrase) -> the
#      artifact is decrypted and listed again before it counts as produced
#   5. tiers under /var/backups/hiraia-crm/{daily,weekly,monthly} — weekly on Sundays, monthly on
#      the 1st (hard links of the daily artifact) — pruned to 7 / 4 / 6
#   6. offsite: if /etc/hiraia-crm/offsite.env exists, offsite.py pushes the artifact to the R2
#      bucket, reads it back and compares the sha256, then prunes remote tiers the same way
#   7. backup-status.json (read by GET /api/crm/status; last_ok_at only moves on full success)
# ============================================================================
set -euo pipefail
shopt -s nullglob

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DB_PATH=${HIRAIA_CRM_DB_PATH:-/var/lib/hiraia-crm/crm.db}
STATE_DIR=${HIRAIA_CRM_STATE_DIR:-/var/lib/hiraia-crm}
CONF_DIR=${HIRAIA_CRM_CONF_DIR:-/etc/hiraia-crm}
BACKUP_DIR=${HIRAIA_CRM_BACKUP_DIR:-/var/backups/hiraia-crm}
PASSPHRASE_FILE=${HIRAIA_CRM_BACKUP_PASSPHRASE_FILE:-$CONF_DIR/backup.passphrase}
OFFSITE_ENV=${HIRAIA_CRM_OFFSITE_ENV:-$CONF_DIR/offsite.env}
LOG_FILE=${HIRAIA_CRM_BACKUP_LOG:-/var/log/hiraia-crm-backup.log}
STATUS_FILE=${HIRAIA_CRM_BACKUP_STATUS:-$STATE_DIR/backup-status.json}
SERVICE_USER=${HIRAIA_CRM_USER:-hiraia}
KEEP_DAILY=${HIRAIA_CRM_KEEP_DAILY:-7}
KEEP_WEEKLY=${HIRAIA_CRM_KEEP_WEEKLY:-4}
KEEP_MONTHLY=${HIRAIA_CRM_KEEP_MONTHLY:-6}
PYTHON=${HIRAIA_CRM_PYTHON:-$HERE/venv/bin/python}
[ -x "$PYTHON" ] || PYTHON=python3
UNIT_DIR=${HIRAIA_CRM_UNIT_DIR:-/etc/systemd/system}
NGINX_SNIPPETS=${HIRAIA_CRM_NGINX_FILES:-/etc/nginx/conf.d/hiraia-crm-rate.conf}
export GNUPGHOME=${GNUPGHOME:-$BACKUP_DIR/.gnupg}   # root-only; kept out of the service user's state dir

force_weekly=0; force_monthly=0
for a in "$@"; do case "$a" in --force-weekly) force_weekly=1;; --force-monthly) force_monthly=1;; *) echo "unknown flag $a" >&2; exit 2;; esac; done

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
NAME="hiraia-crm-$STAMP.tar.gpg"
STATUS_PHASE=start

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG_FILE" >&2; }
write_status() {  # write_status ok|failed <message> [artifact] [sha256] [size] [counts-json] [offsite-json]
  python3 - "$STATUS_FILE" "$@" <<'PY'
import json, os, sys, datetime
path, state, message = sys.argv[1], sys.argv[2], sys.argv[3]
artifact, sha, size = (sys.argv[4:7] + [None, None, None])[:3]
counts = json.loads(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else None
offsite = json.loads(sys.argv[8]) if len(sys.argv) > 8 and sys.argv[8] else None
now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
try: prev = json.load(open(path))
except Exception: prev = {}
cur = {"last_run_at": now, "last_state": state, "last_message": message, "configured": True}
if state == "ok":
    cur.update({"last_ok_at": now, "last_error": None, "artifact": artifact, "sha256": sha, "bytes": int(size or 0), "counts": counts, "offsite": offsite})
else:
    cur.update({"last_ok_at": prev.get("last_ok_at"), "artifact": prev.get("artifact"), "sha256": prev.get("sha256"), "bytes": prev.get("bytes"), "counts": prev.get("counts"), "offsite": prev.get("offsite"), "last_error": message})
tmp = path + ".tmp"
with open(tmp, "w") as f: json.dump(cur, f, indent=2)
os.chmod(tmp, 0o644); os.replace(tmp, path)
PY
}
REPORTED=0
fail() { REPORTED=1; log "ERROR [$STATUS_PHASE] $*"; write_status failed "[$STATUS_PHASE] $*" || true; exit 1; }
# set -e aborts that never went through fail() still get logged, a status record and the alert.
trap 'rc=$?; [ -n "${WORK:-}" ] && rm -rf "$WORK"; if [ $rc -ne 0 ] && [ "$REPORTED" = 0 ]; then REPORTED=1; log "ERROR [$STATUS_PHASE] aborted (exit $rc)"; write_status failed "[$STATUS_PHASE] aborted (exit $rc)" || true; fi; exit $rc' EXIT

for bin in sqlite3 gpg tar sha256sum python3; do command -v "$bin" >/dev/null || fail "missing tool: $bin"; done
[ -r "$PASSPHRASE_FILE" ] || fail "passphrase file $PASSPHRASE_FILE missing"
[ -f "$DB_PATH" ] || fail "database $DB_PATH missing"
mkdir -p "$BACKUP_DIR"/{daily,weekly,monthly} "$GNUPGHOME"; chmod 700 "$BACKUP_DIR" "$GNUPGHOME"
touch "$LOG_FILE"; chmod 640 "$LOG_FILE"

WORK=$(mktemp -d "$STATE_DIR/backup-tmp.XXXXXX"); chmod 750 "$WORK"
# The snapshot runs as the service user so the WAL/-shm files keep their ownership; as root we
# drop to it with runuser, as any other user (local tests) we just run sqlite3 directly.
as_service_user() { if [ "$(id -u)" = 0 ] && [ "$SERVICE_USER" != root ]; then runuser -u "$SERVICE_USER" -- "$@"; else "$@"; fi; }
[ "$(id -u)" = 0 ] && chown "$SERVICE_USER" "$WORK"
log "backup $STAMP starting (db=$DB_PATH)"

STATUS_PHASE=snapshot
as_service_user sqlite3 "$DB_PATH" ".backup '$WORK/crm.db'" || fail "sqlite3 .backup failed"
ic=$(sqlite3 "$WORK/crm.db" 'PRAGMA integrity_check;')
[ "$ic" = ok ] || fail "integrity_check: $ic"

STATUS_PHASE=manifest
COUNTS=$(python3 - "$WORK/crm.db" <<'PY'
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
print(json.dumps({t: db.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0] for t in tables}, separators=(",", ":")))
PY
) || fail "row counts failed"
DB_SHA=$(sha256sum "$WORK/crm.db" | cut -d' ' -f1)
python3 - "$WORK/manifest.json" "$STAMP" "$DB_SHA" "$COUNTS" "$DB_PATH" <<'PY'
import json, socket, sys
path, stamp, sha, counts, db = sys.argv[1:6]
json.dump({"schema": 1, "kind": "hiraia-crm-backup", "stamp": stamp, "host": socket.gethostname(), "source_db": db,
           "db_sha256": sha, "counts": json.loads(counts)}, open(path, "w"), indent=2)
PY

STATUS_PHASE=config
mkdir -p "$WORK/config/systemd" "$WORK/config/nginx"
[ -f "$CONF_DIR/crm.env" ] && cp "$CONF_DIR/crm.env" "$WORK/config/"       # hashes + ports only
for u in "$UNIT_DIR"/hiraia-crm*.service "$UNIT_DIR"/hiraia-crm*.timer; do [ -f "$u" ] && cp "$u" "$WORK/config/systemd/"; done
for n in $NGINX_SNIPPETS; do [ -f "$n" ] && cp "$n" "$WORK/config/nginx/"; done
if [ -f /etc/nginx/sites-available/hiraia.org ]; then
  awk '/location \/api\/crm\//,/^    }/' /etc/nginx/sites-available/hiraia.org > "$WORK/config/nginx/hiraia.org.crm-location.conf" || true
fi

STATUS_PHASE=encrypt
tar -C "$WORK" -czf "$WORK/payload.tar.gz" crm.db manifest.json config
gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" \
    --symmetric --cipher-algo AES256 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65011712 \
    --compress-algo none --output "$WORK/$NAME" "$WORK/payload.tar.gz" || fail "gpg encryption failed"
# prove the artifact decrypts and lists before it counts
gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSPHRASE_FILE" --decrypt "$WORK/$NAME" 2>/dev/null | tar -tzf - >/dev/null || fail "round-trip decrypt failed"
SHA=$(sha256sum "$WORK/$NAME" | cut -d' ' -f1)
SIZE=$(stat -c %s "$WORK/$NAME")
rm -f "$WORK/crm.db" "$WORK/payload.tar.gz"

STATUS_PHASE=store
install -m 600 "$WORK/$NAME" "$BACKUP_DIR/daily/$NAME"
printf '%s  %s\n' "$SHA" "$NAME" > "$BACKUP_DIR/daily/$NAME.sha256"
TIERS=daily
if [ "$(date -u +%u)" = 7 ] || [ "$force_weekly" = 1 ]; then ln -f "$BACKUP_DIR/daily/$NAME" "$BACKUP_DIR/weekly/$NAME"; cp "$BACKUP_DIR/daily/$NAME.sha256" "$BACKUP_DIR/weekly/"; TIERS="$TIERS,weekly"; fi
if [ "$(date -u +%d)" = 01 ] || [ "$force_monthly" = 1 ]; then ln -f "$BACKUP_DIR/daily/$NAME" "$BACKUP_DIR/monthly/$NAME"; cp "$BACKUP_DIR/daily/$NAME.sha256" "$BACKUP_DIR/monthly/"; TIERS="$TIERS,monthly"; fi
prune() {  # prune <tier> <keep> — globs expand sorted, and the UTC stamp in the name sorts chronologically
  local dir="$BACKUP_DIR/$1" keep=$2 i
  local files=( "$dir"/hiraia-crm-*.tar.gpg )
  for (( i = 0; i < ${#files[@]} - keep; i++ )); do rm -f "${files[i]}" "${files[i]}.sha256"; log "pruned $1/$(basename "${files[i]}")"; done
}
prune daily "$KEEP_DAILY"; prune weekly "$KEEP_WEEKLY"; prune monthly "$KEEP_MONTHLY"
log "stored $NAME ($SIZE bytes, sha256 $SHA, tiers $TIERS, counts $COUNTS)"

STATUS_PHASE=offsite
OFFSITE='{"state":"unconfigured"}'
if [ -f "$OFFSITE_ENV" ]; then
  OFFSITE=$("$PYTHON" "$HERE/offsite.py" push --env "$OFFSITE_ENV" --file "$BACKUP_DIR/daily/$NAME" --sha256 "$SHA" --tiers "$TIERS" \
            --keep "daily=$KEEP_DAILY,weekly=$KEEP_WEEKLY,monthly=$KEEP_MONTHLY") || fail "offsite push failed (see log)"
  log "offsite ok: $OFFSITE"
else
  log "offsite: NOT configured ($OFFSITE_ENV missing) — local tiers only"
fi

STATUS_PHASE=done
write_status ok "backup $NAME complete" "$BACKUP_DIR/daily/$NAME" "$SHA" "$SIZE" "$COUNTS" "$OFFSITE"
log "backup $STAMP OK"
