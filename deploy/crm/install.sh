#!/usr/bin/env bash
# ============================================================================
# install.sh — deploy the Hiraia CRM API + encrypted backups to the hiraia.org origin
# (b11-apps, 10.77.0.20 on the OVH private network; deploy/README.md → Hosts). Same shape as
# deploy/vps-monitor/install.sh: files, systemd, nginx, verify. Additive, idempotent, reversible.
#
#   deploy/crm/install.sh [root@10.77.0.20] [--offsite-env FILE] [--rotate-keys] [--skip-backup]
#
#   --offsite-env FILE   copy an R2 credential file (R2_ENDPOINT / R2_ACCESS_KEY_ID /
#                        R2_SECRET_ACCESS_KEY, optional HIRAIA_CRM_BACKUP_BUCKET/PREFIX) to
#                        /etc/hiraia-crm/offsite.env (mode 600). Without it backups stay local
#                        and GET /api/crm/status reports offsite "unconfigured".
#   --rotate-keys        regenerate both client keys (mbp-harvestd write, beaniebot read)
#   --skip-backup        do not run the first backup at the end
#
# Installs:  /opt/hiraia-crm/{server.cjs,db.cjs,migrate.cjs,migrations/,backup.sh,restore.sh,
#            offsite.py,alert.py,keygen.sh,node_modules/,venv/}   /etc/hiraia-crm/{crm.env,
#            backup.passphrase[,offsite.env]}   /var/lib/hiraia-crm/crm.db (service user hiraia)
#            systemd: hiraia-crm.service, hiraia-crm-backup.{service,timer}, hiraia-crm-backup-alert.service
#            nginx: conf.d/hiraia-crm-rate.conf + `location /api/crm/` in sites-available/hiraia.org
#
# Uninstall: systemctl disable --now hiraia-crm.service hiraia-crm-backup.timer
#            rm -rf /opt/hiraia-crm /etc/systemd/system/hiraia-crm*; systemctl daemon-reload
#            remove the location block + conf.d/hiraia-crm-rate.conf; nginx -t && systemctl reload nginx
#            (keep /var/lib/hiraia-crm, /var/backups/hiraia-crm and /etc/hiraia-crm until you have
#            confirmed you no longer need the data or the passphrase)
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
V="root@10.77.0.20"; OFFSITE_ENV=""; ROTATE=0; SKIP_BACKUP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --offsite-env) OFFSITE_ENV=$2; shift 2;;
    --rotate-keys) ROTATE=1; shift;;
    --skip-backup) SKIP_BACKUP=1; shift;;
    -*) echo "unknown flag $1" >&2; exit 2;;
    *) V=$1; shift;;
  esac
done
SSH_KEY="${HIRAIA_PROD_SSH_KEY:-$HOME/.ssh/prod_ed25519}"
KNOWN="${HIRAIA_PROD_KNOWN_HOSTS:-$HOME/.ssh/known_hosts_ovh_guests}"
SSH_OPTS=(-o ConnectTimeout=15)
[ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
[ -f "$KNOWN" ] && SSH_OPTS+=(-o UserKnownHostsFile="$KNOWN")
rssh() { ssh "${SSH_OPTS[@]}" "$V" "$@"; }
SITE="${SITE:-/etc/nginx/sites-available/hiraia.org}"
PUBLIC="${HIRAIA_CRM_PUBLIC:-https://hiraia.org}"

echo ">> [1/6] files -> /opt/hiraia-crm"
rssh 'mkdir -p /opt/hiraia-crm/migrations /etc/hiraia-crm; id -u hiraia >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hiraia
  for b in node npm sqlite3 gpg python3; do command -v $b >/dev/null || { echo "missing $b on target" >&2; exit 1; }; done'
tar -C "$HERE" -cf - server.cjs db.cjs migrate.cjs migrations backup.sh restore.sh offsite.py alert.py keygen.sh package.json package-lock.json \
  | rssh 'tar -C /opt/hiraia-crm -xf - && chmod 755 /opt/hiraia-crm/*.sh /opt/hiraia-crm/*.py /opt/hiraia-crm/migrate.cjs && chmod 644 /opt/hiraia-crm/server.cjs /opt/hiraia-crm/db.cjs /opt/hiraia-crm/migrations/*.sql'
rssh 'set -e; cd /opt/hiraia-crm && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null && node -e "require(\"better-sqlite3\")" && echo "  node runtime ok ($(node --version))"'
# boto3 is only needed for the offsite push; a venv failure is reported, not fatal.
rssh 'if [ ! -x /opt/hiraia-crm/venv/bin/python ]; then python3 -m venv /opt/hiraia-crm/venv >/dev/null 2>&1 || true; fi
  if [ -x /opt/hiraia-crm/venv/bin/python ]; then
    /opt/hiraia-crm/venv/bin/python -c "import boto3" 2>/dev/null || /opt/hiraia-crm/venv/bin/pip install -q "boto3==1.43.107" >/dev/null 2>&1 || true
    /opt/hiraia-crm/venv/bin/python -c "import boto3;print(\"  python venv ok (boto3 \" + boto3.__version__ + \")\")" 2>/dev/null || echo "  WARNING: boto3 venv not ready — offsite push unavailable until fixed"
  else echo "  WARNING: python3 -m venv failed (apt install python3-venv) — offsite push unavailable until fixed"; fi'

echo ">> [2/6] config, passphrase, client keys"
rssh 'set -e; umask 077
  chmod 750 /etc/hiraia-crm; chgrp hiraia /etc/hiraia-crm
  if [ ! -f /etc/hiraia-crm/crm.env ]; then printf "HIRAIA_CRM_PORT=8137\nHIRAIA_CRM_DB_PATH=/var/lib/hiraia-crm/crm.db\n" > /etc/hiraia-crm/crm.env; fi
  chown root:hiraia /etc/hiraia-crm/crm.env; chmod 640 /etc/hiraia-crm/crm.env
  if [ ! -f /etc/hiraia-crm/backup.passphrase ]; then head -c 48 /dev/urandom | base64 -w0 > /etc/hiraia-crm/backup.passphrase; echo "  backup passphrase generated -> /etc/hiraia-crm/backup.passphrase (copy it to the password manager!)"; else echo "  backup passphrase kept"; fi
  chmod 600 /etc/hiraia-crm/backup.passphrase; chown root:root /etc/hiraia-crm/backup.passphrase'
if [ -n "$OFFSITE_ENV" ]; then
  [ -f "$OFFSITE_ENV" ] || { echo "offsite env $OFFSITE_ENV not found" >&2; exit 1; }
  scp "${SSH_OPTS[@]}" -q "$OFFSITE_ENV" "$V:/etc/hiraia-crm/offsite.env"
  rssh 'chmod 600 /etc/hiraia-crm/offsite.env; chown root:root /etc/hiraia-crm/offsite.env; echo "  offsite.env installed"'
fi
ROT=""; [ "$ROTATE" = 1 ] && ROT="--rotate"
rssh "/opt/hiraia-crm/keygen.sh mbp-harvestd write $ROT; /opt/hiraia-crm/keygen.sh beaniebot read $ROT" | sed 's/^/  /'

echo ">> [3/6] systemd"
tar -C "$HERE/systemd" -cf - . | rssh 'set -e; mkdir -p /tmp/hiraia-crm-units && tar -C /tmp/hiraia-crm-units -xf -
  install -m 644 /tmp/hiraia-crm-units/hiraia-crm.service /tmp/hiraia-crm-units/hiraia-crm-backup.service /tmp/hiraia-crm-units/hiraia-crm-backup.timer /tmp/hiraia-crm-units/hiraia-crm-backup-alert.service /etc/systemd/system/
  for u in hiraia-crm.service hiraia-crm-backup.service hiraia-crm-backup.timer; do mkdir -p /etc/systemd/system/$u.d; install -m 644 /tmp/hiraia-crm-units/99-ovh-hiraia-target-authority.conf /etc/systemd/system/$u.d/; done
  rm -rf /tmp/hiraia-crm-units
  mkdir -p /var/lib/hiraia-crm; chown hiraia:hiraia /var/lib/hiraia-crm; chmod 750 /var/lib/hiraia-crm
  systemctl daemon-reload
  systemctl enable --now hiraia-crm.service >/dev/null 2>&1; systemctl restart hiraia-crm.service
  systemctl enable --now hiraia-crm-backup.timer >/dev/null 2>&1
  sleep 2
  echo -n "  hiraia-crm.service: "; systemctl is-active hiraia-crm.service
  echo -n "  backup timer:       "; systemctl is-active hiraia-crm-backup.timer
  echo -n "  loopback health:    "; curl -s -m 5 http://127.0.0.1:8137/api/crm/health; echo'

echo ">> [4/6] nginx"
scp "${SSH_OPTS[@]}" -q "$HERE/nginx/hiraia-crm-rate.conf" "$V:/etc/nginx/conf.d/hiraia-crm-rate.conf"
scp "${SSH_OPTS[@]}" -q "$HERE/nginx/hiraia-crm-location.conf" "$V:/tmp/hiraia-crm-location.conf"
rssh "SITE='$SITE' bash -s" <<'REMOTE'
set -e
BK="/root/nginx-hiraia.bak.$(date +%s)"; cp "$SITE" "$BK"; echo "  backup: $BK"
if grep -q "location /api/crm/" "$SITE"; then echo "  location /api/crm/ already present"; else
python3 - "$SITE" /tmp/hiraia-crm-location.conf <<'PY'
import sys
site, snippet = sys.argv[1], sys.argv[2]
s = open(site).read(); block = open(snippet).read()
i = s.index("    location / {")   # longest-prefix match: /api/crm/ wins over / regardless of order
open(site, "w").write(s[:i] + block + s[i:])
print("  inserted location /api/crm/ before location /")
PY
fi
rm -f /tmp/hiraia-crm-location.conf
if nginx -t >/dev/null 2>&1; then systemctl reload nginx; echo "  nginx reloaded"
else echo "  CONFIG TEST FAILED — restoring"; cp "$BK" "$SITE"; rm -f /etc/nginx/conf.d/hiraia-crm-rate.conf; nginx -t; exit 1; fi
REMOTE

if [ "$SKIP_BACKUP" = 0 ]; then
  echo ">> [5/6] first backup"
  rssh 'systemctl start hiraia-crm-backup.service && tail -n 3 /var/log/hiraia-crm-backup.log | sed "s/^/  /"' || { echo "  first backup FAILED — check: journalctl -u hiraia-crm-backup.service"; exit 1; }
else
  echo ">> [5/6] first backup skipped"
fi

echo ">> [6/6] verify over HTTPS ($PUBLIC)"
for probe in "/api/crm/health:200" "/api/crm/contacts:401"; do
  p=${probe%%:*}; want=${probe##*:}
  got=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$PUBLIC$p" || echo ERR)
  printf "  %-22s %s (want %s)\n" "$p" "$got" "$want"
  [ "$got" = "$want" ] || { echo "  verification FAILED" >&2; exit 1; }
done
cat <<EOT

============================================================================
 HIRAIA CRM API LIVE → $PUBLIC/api/crm/   (service: hiraia-crm, backups: hiraia-crm-backup.timer)
   client keys:  ssh $V cat /root/hiraia-crm-secrets/mbp-harvestd.key   (MBP: HIRAIA_CRM_API_KEY)
                 ssh $V cat /root/hiraia-crm-secrets/beaniebot.key      (bot: HIRAIA_CRM_API_KEY)
                 shred -u them after pickup; rotate with /opt/hiraia-crm/keygen.sh <client> <scope> --rotate
   passphrase:   /etc/hiraia-crm/backup.passphrase — store a copy in the password manager
   logs:         journalctl -u hiraia-crm -f      /var/log/hiraia-crm-backup.log
   docs:         deploy/crm/README.md   docs/mbp-crm-integration.md
============================================================================
EOT
