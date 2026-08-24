#!/usr/bin/env bash
# ============================================================================
# install.sh — deploy hiraia-monitor + mission control to the Vultr VPS.
#
# Installs, on hiraia.b11.dev:
#   * /opt/hiraia-monitor/{monitor.py,admin_app.py,config.json}
#   * systemd: hiraia-monitor.timer (guard, every 5 min) + hiraia-admin.service
#   * nginx: `location /admin` -> 127.0.0.1:8135 in the existing 443 block
#
# Additive and reversible. Does NOT touch nginx's other sites, pm2, or
# llama-server. The nginx edit is backed up and gated on `nginx -t`.
#
#   cd ~/Code/hiraia && set -a && . ./.env.local && set +a    # leading ./ (zsh)
#   ADMIN_PASSWORD='...' ./deploy/vps-monitor/install.sh [root@host]
#
# Uninstall:
#   systemctl disable --now hiraia-admin.service hiraia-monitor.timer
#   rm -rf /opt/hiraia-monitor /var/lib/hiraia-monitor
#   # remove the `location /admin` block from the site file, then: nginx -t && systemctl reload nginx
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
V="${1:-root@45.76.180.229}"
SSH="-o StrictHostKeyChecking=no -o ConnectTimeout=15"
SITE="${SITE:-/etc/nginx/sites-enabled/hiraia.b11.dev}"
: "${RUNPOD_API_KEY:?set RUNPOD_API_KEY (source ./.env.local first)}"
ADMIN_EMAIL="${ADMIN_EMAIL:-lbuenaventura2@gmail.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:?set ADMIN_PASSWORD}"

# Build config LOCALLY with real JSON encoding. The PBKDF2 hash contains '$',
# which shell heredocs happily mangle into empty positional params.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
python3 - "$TMP/config.json" <<PY
import json, os, secrets, sys
sys.path.insert(0, "$HERE")
from admin_app import hash_password, verify_password
h = hash_password(os.environ["ADMIN_PASSWORD"])
assert verify_password(os.environ["ADMIN_PASSWORD"], h), "hash self-check failed"
json.dump({
  "runpod_api_key": os.environ["RUNPOD_API_KEY"],
  "admin_email": os.environ.get("ADMIN_EMAIL"),
  "admin_password_hash": h,
  "session_secret": secrets.token_hex(32),
  "hb_token": os.environ.get("HB_TOKEN") or secrets.token_urlsafe(24),
  "notify_email": os.environ.get("ADMIN_EMAIL"),
  "default_max_pod_hours": 6,
  "max_pod_hours": {"hiraia-probe-cpt": 14, "hiraia-full-cpt": 30,
                    "hiraia-probe-helper": 48, "hiraia-eval-*": 3, "hiraia-*inspect*": 1},
  "heartbeat_stale_minutes": 20, "step_stall_minutes": 45,
  "balance_floor_usd": 60, "drain_pods_below_floor": True,
  "expected_total_steps": 1225,
}, open(sys.argv[1], "w"), indent=2)
print("config built")
PY

echo ">> [1/4] files ..."
ssh $SSH "$V" 'mkdir -p /opt/hiraia-monitor /var/lib/hiraia-monitor'
scp $SSH "$HERE/monitor.py" "$HERE/admin_app.py" "$V:/opt/hiraia-monitor/"
scp $SSH "$TMP/config.json" "$V:/opt/hiraia-monitor/config.json"
ssh $SSH "$V" 'chmod 600 /opt/hiraia-monitor/config.json; chmod 755 /opt/hiraia-monitor/*.py
  touch /var/log/hiraia-monitor.log; chmod 640 /var/log/hiraia-monitor.log'

echo ">> [2/4] systemd ..."
ssh $SSH "$V" 'bash -s' <<'REMOTE'
set -e
printf '%s\n' '[Unit]' 'Description=hiraia RunPod guard (cost ceiling + liveness)' \
  'After=network-online.target' '[Service]' 'Type=oneshot' \
  'ExecStart=/usr/bin/python3 /opt/hiraia-monitor/monitor.py' \
  > /etc/systemd/system/hiraia-monitor.service
printf '%s\n' '[Unit]' 'Description=hiraia guard every 5 minutes' '[Timer]' \
  'OnBootSec=2min' 'OnUnitActiveSec=5min' 'AccuracySec=30s' 'Persistent=true' \
  '[Install]' 'WantedBy=timers.target' > /etc/systemd/system/hiraia-monitor.timer
printf '%s\n' '[Unit]' 'Description=hiraia mission control (admin panel)' \
  'After=network-online.target' '[Service]' 'Environment=ADMIN_PORT=8135' \
  'ExecStart=/usr/bin/python3 /opt/hiraia-monitor/admin_app.py' 'Restart=always' \
  'RestartSec=5' '[Install]' 'WantedBy=multi-user.target' \
  > /etc/systemd/system/hiraia-admin.service
systemctl daemon-reload
systemctl enable --now hiraia-admin.service >/dev/null 2>&1
systemctl enable --now hiraia-monitor.timer >/dev/null 2>&1
sleep 2
echo -n "  admin: "; systemctl is-active hiraia-admin.service
echo -n "  timer: "; systemctl is-active hiraia-monitor.timer
REMOTE

echo ">> [3/4] nginx route ..."
ssh $SSH "$V" "SITE='$SITE' bash -s" <<'REMOTE'
set -e
BK="/root/nginx-hiraia.bak.$(date +%s)"; cp "$SITE" "$BK"; echo "  backup: $BK"
if grep -q "location /admin" "$SITE"; then echo "  already routed"; else
python3 - "$SITE" <<'PY'
import sys
f = sys.argv[1]; s = open(f).read()
block = """    location /admin {
        proxy_pass http://127.0.0.1:8135;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

"""
i = s.index("    location / {")   # /admin is a longer prefix, so it wins regardless
open(f, "w").write(s[:i] + block + s[i:])
print("  inserted /admin")
PY
fi
if nginx -t >/dev/null 2>&1; then systemctl reload nginx; echo "  nginx reloaded"
else echo "  CONFIG TEST FAILED — restoring"; cp "$BK" "$SITE"; nginx -t; exit 1; fi
REMOTE

echo ">> [4/4] verify ..."
ssh $SSH "$V" 'python3 /opt/hiraia-monitor/monitor.py --dry-run | tail -4'
HOSTNAME_PUB="$(echo "$V" | sed 's/.*@//')"
for p in /admin/health /admin/login; do
  printf "  %-16s %s\n" "$p" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "https://hiraia.b11.dev$p" || echo ERR)"
done
HB=$(ssh $SSH "$V" "python3 -c \"import json;print(json.load(open('/opt/hiraia-monitor/config.json'))['hb_token'])\"")
cat <<EOF

============================================================================
 MISSION CONTROL LIVE →  https://hiraia.b11.dev/admin
   sign in: $ADMIN_EMAIL
   guard:   every 5 min (systemd timer, Persistent=true — survives reboot)
   HB_TOKEN=$HB
     pods post telemetry to https://hiraia.b11.dev/admin/api/hb  (header X-Token)
   logs:    ssh $V 'tail -f /var/log/hiraia-monitor.log'
============================================================================
EOF
