#!/usr/bin/env bash
# ============================================================================
# install.sh — deploy the public Hiraia voice demo (POST hiraia.org/api/voice/synthesize) to the
# hiraia.org origin (b11-apps, 10.77.0.20). Same shape as deploy/crm/install.sh: files, venv,
# systemd, nginx, verify. Additive, idempotent, reversible. Run from a checkout that has the
# Expanded Mini weights restored (voice-models/README.md → Verify or restore).
#
#   [VOICE_RELEASE=/path/to/voice-models/expanded-mini/1.0.0-preview.1] deploy/voice-demo/install.sh [root@10.77.0.20]
#
# Installs:  /opt/hiraia-voice-demo/{server.py,brand-lexicon.json,bundle/,venv/}   (service user hiraia-voice)
#            systemd: hiraia-voice-demo.service (loopback :8139, MemoryMax=1G, CPUQuota=200%)
#            nginx: conf.d/hiraia-voice-rate.conf + the BEGIN/END hiraia-voice-demo block before
#            `location /` in sites-available/hiraia.org (backed up next to it first)
#
# Uninstall: systemctl disable --now hiraia-voice-demo.service
#            rm -rf /opt/hiraia-voice-demo /etc/systemd/system/hiraia-voice-demo.service
#            remove the BEGIN/END block + conf.d/hiraia-voice-rate.conf; nginx -t && systemctl reload nginx
#            (the website then shows "voice demo unavailable" on submit; samples still play)
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
V="${1:-root@10.77.0.20}"
RELEASE="${VOICE_RELEASE:-$ROOT/voice-models/expanded-mini/1.0.0-preview.1}"   # weights are git-ignored
BUNDLE="$RELEASE/bundle"
SSH_KEY="${HIRAIA_PROD_SSH_KEY:-$HOME/.ssh/prod_ed25519}"
KNOWN="${HIRAIA_PROD_KNOWN_HOSTS:-$HOME/.ssh/known_hosts_ovh_guests}"
SSH_OPTS=(-o ConnectTimeout=15)
[ -f "$SSH_KEY" ] && SSH_OPTS+=(-i "$SSH_KEY")
[ -f "$KNOWN" ] && SSH_OPTS+=(-o UserKnownHostsFile="$KNOWN")
rssh() { ssh "${SSH_OPTS[@]}" "$V" "$@"; }
SITE="${SITE:-/etc/nginx/sites-available/hiraia.org}"

echo ">> [0/5] verify the local voice release"
python3 -B -c 'import sys, pathlib; sys.path.insert(0, sys.argv[1]); import synthesize; synthesize.verify_bundle(pathlib.Path(sys.argv[1]))' "$BUNDLE"
echo "  bundle verified: $BUNDLE"
python3 -B -m unittest "$HERE/test_server.py" 2>&1 | tail -1

echo ">> [1/5] files -> /opt/hiraia-voice-demo"
rssh 'set -e; id -u hiraia-voice >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hiraia-voice
  for b in python3.12 ffmpeg nginx; do command -v $b >/dev/null || { echo "missing $b on target" >&2; exit 1; }; done
  mkdir -p /opt/hiraia-voice-demo.new && rm -rf /opt/hiraia-voice-demo.new/*'
tar -C "$BUNDLE" --exclude=__pycache__ -cf - . | rssh 'mkdir -p /opt/hiraia-voice-demo.new/bundle && tar -C /opt/hiraia-voice-demo.new/bundle -xf -'
tar -C "$HERE" -cf - server.py | rssh 'tar -C /opt/hiraia-voice-demo.new -xf -'
tar -C "$ROOT/pronunciation" -cf - brand-lexicon.json | rssh 'tar -C /opt/hiraia-voice-demo.new -xf -'

echo ">> [2/5] python venv (pinned bundle requirements)"
rssh 'set -e; N=/opt/hiraia-voice-demo.new; O=/opt/hiraia-voice-demo
  if [ -x $O/venv/bin/python ] && cmp -s $O/bundle/requirements.txt $N/bundle/requirements.txt; then cp -a $O/venv $N/venv;
  else python3.12 -m venv $N/venv && $N/venv/bin/pip install -q --disable-pip-version-check -r $N/bundle/requirements.txt; fi
  $N/venv/bin/python -B -c "import sys; sys.path[:0]=[\"$N/bundle\"]; import synthesize, pathlib; synthesize.verify_bundle(pathlib.Path(\"$N/bundle\")); print(\"  bundle verified on target\")"
  chown -R root:root $N && chmod -R go-w $N
  if [ -d $O ]; then rm -rf $O.prev && mv $O $O.prev; fi
  mv $N $O'

echo ">> [3/5] systemd"
rssh 'cat > /etc/systemd/system/hiraia-voice-demo.service' < "$HERE/systemd/hiraia-voice-demo.service"
rssh 'set -e; systemctl daemon-reload; systemctl enable -q hiraia-voice-demo.service; systemctl restart hiraia-voice-demo.service
  for i in $(seq 1 60); do curl -sf -o /dev/null http://127.0.0.1:8139/api/voice/health && break; sleep 1; done
  curl -sf http://127.0.0.1:8139/api/voice/health >/dev/null || { journalctl -u hiraia-voice-demo -n 30 --no-pager; exit 1; }
  echo "  service healthy"'

echo ">> [4/5] nginx"
rssh 'cat > /etc/nginx/conf.d/hiraia-voice-rate.conf' < "$HERE/nginx/hiraia-voice-rate.conf"
rssh "cat > /tmp/hiraia-voice-location.conf" < "$HERE/nginx/location.conf"
rssh "set -e; SITE=$SITE; cp -a \$SITE \$SITE.bak-voice-demo-\$(date -u +%Y%m%dT%H%M%SZ)
  python3 - \$SITE /tmp/hiraia-voice-location.conf <<'PY'
import re, sys
site, block = sys.argv[1], open(sys.argv[2]).read()
s = open(site).read()
s = re.sub(r'\n    # BEGIN hiraia-voice-demo.*?# END hiraia-voice-demo\n', '\n', s, flags=re.S)
anchor = '\n    location / {\n        proxy_pass http://127.0.0.1:3005;'
if s.count(anchor) != 1:
    sys.exit('expected exactly one site location / for the web app')
s = s.replace(anchor, '\n' + block.rstrip('\n') + anchor)
open(site, 'w').write(s)
PY
  if nginx -t 2>/tmp/hiraia-voice-nginx-test.log; then systemctl reload nginx; echo '  nginx reloaded';
  else cat /tmp/hiraia-voice-nginx-test.log; cp -a \$(ls -t \$SITE.bak-voice-demo-* | head -1) \$SITE; rm -f /etc/nginx/conf.d/hiraia-voice-rate.conf; nginx -t && systemctl reload nginx; echo 'nginx config rejected; restored' >&2; exit 1; fi"

echo ">> [5/5] verify"
rssh 'curl -s -o /dev/null -w "  local synth %{http_code} %{time_total}s %{size_download}B\n" -H "Content-Type: application/json" -d "{\"text\":\"Kumusta ka?\",\"voice\":\"fil\"}" http://127.0.0.1:8139/api/voice/synthesize
  systemctl show -p MemoryCurrent -p MemoryPeak hiraia-voice-demo | tr "\n" " "; echo'
curl -s -o /dev/null -w "  public health %{http_code}\n" https://hiraia.org/api/voice/health
LEXICON_SHA="$(sha256sum "$ROOT/pronunciation/brand-lexicon.json" | cut -d" " -f1)"
curl -sf https://hiraia.org/api/voice/health | python3 -c 'import json,sys; h=json.load(sys.stdin); p=h.get("pronunciation") or {}; assert h["ok"] and p.get("sha256")==sys.argv[1], h; print("  public brand lexicon", p["brand_lexicon"], p["sha256"][:12])' "$LEXICON_SHA"
