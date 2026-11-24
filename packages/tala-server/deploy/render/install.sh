#!/usr/bin/env bash
# Install, update or remove the sandboxed drawing service for teachers' own slides. Run as root ON THE HOST, from
# the release's tree (the same files that were tested):
#
#   packages/tala-server/deploy/render/install.sh [--web-group tala] [--no-packages] [--dry-run]
#   packages/tala-server/deploy/render/install.sh --remove
#
# It installs the packages drawing needs, makes the user `tala-render` (no home, no shell, in no other group),
# copies render-job.mjs to /usr/local/lib/tala-render/ and the three units to /etc/systemd/system/, starts the
# socket, and asks the service for its own report and a first drawing. It changes nothing of the web app:
# pictures stay OFF until TALA_DECKS_PREVIEW_SOCKET=/run/tala-render/render.sock is in /etc/tala/tala.env and the
# web app is restarted, which is the release owner's step. README.md in this folder has the whole procedure, the
# full check (verify.mjs) and what each line of the units is for.
#
# --dry-run prints every command instead of running it (and needs no root).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_GROUP=tala
PACKAGES=1
DRY=0
REMOVE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --web-group) WEB_GROUP="$2"; shift 2 ;;
    --no-packages) PACKAGES=0; shift ;;
    --dry-run) DRY=1; shift ;;
    --remove) REMOVE=1; shift ;;
    *) echo "install.sh: unknown option $1" >&2; exit 2 ;;
  esac
done
die() { echo "install.sh: $*" >&2; exit 1; }
# Something the host must have. A dry run only says so and goes on.
need() { if [ "$DRY" = 1 ]; then echo "! on this machine it would stop here: $*"; else die "$*"; fi; }
run() { if [ "$DRY" = 1 ]; then printf '+'; printf ' %q' "$@"; printf '\n'; else "$@"; fi; }
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || die "run as root (or with --dry-run to see what it would do)"

LIB=/usr/local/lib/tala-render
UNITS=(tala-render.socket "tala-render@.service" talarender.slice)
DEBS=(libreoffice-impress-nogui poppler-utils fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation fonts-dejavu-core)

if [ "$REMOVE" = 1 ]; then
  # Pictures go off at once: the web app answers "no pictures here" and the editor works on the words.
  run systemctl disable --now tala-render.socket || true
  run systemctl stop 'tala-render@*.service' || true
  for u in "${UNITS[@]}"; do run rm -f "/etc/systemd/system/$u"; done
  run systemctl daemon-reload
  run rm -rf "$LIB"
  if getent passwd tala-render >/dev/null; then run userdel tala-render || true; fi
  echo "Removed. Left in place: the packages (${DEBS[*]}) and TALA_DECKS_PREVIEW_SOCKET in /etc/tala/tala.env, which now does nothing."
  exit 0
fi

# ---- what must be true of the host
for f in render-job.mjs tala-render.socket "tala-render@.service" talarender.slice verify.mjs units.mjs; do [ -f "$HERE/$f" ] || die "missing $HERE/$f"; done
command -v systemctl >/dev/null || die "no systemd on this host"
SYSTEMD=$(systemctl --version | awk 'NR==1{print $2}')
[ "$SYSTEMD" -ge 252 ] || need "systemd $SYSTEMD: the units were tested on 252 and written for 255; an older one may not apply every line (the job would refuse to draw)"
[ "$(stat -fc %T /sys/fs/cgroup)" = cgroup2fs ] || need "this host does not use the unified control-group hierarchy (cgroup v2): the ceilings would not be enforced"
for c in memory pids cpu; do grep -qw "$c" /sys/fs/cgroup/cgroup.controllers || need "control-group controller '$c' is not available: a ceiling would not be enforced"; done
getent group "$WEB_GROUP" >/dev/null || need "no group '$WEB_GROUP' (the group of the web app, which may open the socket). Give --web-group."
NODE=$(command -v node || true)
[ "$NODE" = /usr/bin/node ] || need "node must be /usr/bin/node (found: ${NODE:-none}): the job runs with only /usr in sight"
NODE_MAJOR=$("${NODE:-/usr/bin/node}" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 20 ] || need "node $NODE_MAJOR: 20 or newer is needed"

# ---- 1. programs and fonts
if [ "$PACKAGES" = 1 ]; then
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${DEBS[@]}"
fi
if [ "$DRY" = 0 ]; then
  for f in /usr/lib/libreoffice/program/soffice.bin /usr/bin/pdftoppm /usr/bin/pdfinfo; do [ -x "$f" ] || die "$f is not there after installing the packages"; done
  [ -f /etc/libreoffice/registry/main.xcd ] || die "/etc/libreoffice/registry/main.xcd is not there: LibreOffice's own install step did not finish"
fi
# The fonts' index, so that a job does not have to build it every time.
run fc-cache -s

# ---- 2. the user drawing runs as: owns nothing, logs in nowhere, is in no group but its own
if ! getent passwd tala-render >/dev/null; then
  run useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --comment "Tala slide pictures (sandboxed jobs)" tala-render
fi
if [ "$DRY" = 0 ]; then
  [ "$(id -u tala-render)" != 0 ] || die "tala-render must not be root"
  [ "$(id -nG tala-render)" = tala-render ] || die "tala-render is in other groups ($(id -nG tala-render)): it must be in none, least of all '$WEB_GROUP'"
fi

# ---- 3. the job and the units
run install -d -m 0755 -o root -g root "$LIB"
run install -m 0644 -o root -g root "$HERE/render-job.mjs" "$LIB/render-job.mjs"
for u in "tala-render@.service" talarender.slice; do run install -m 0644 -o root -g root "$HERE/$u" "/etc/systemd/system/$u"; done
if [ "$WEB_GROUP" = tala ]; then
  run install -m 0644 -o root -g root "$HERE/tala-render.socket" /etc/systemd/system/tala-render.socket
elif [ "$DRY" = 1 ]; then
  echo "+ sed 's/^SocketGroup=.*/SocketGroup=$WEB_GROUP/' $HERE/tala-render.socket > /etc/systemd/system/tala-render.socket"
else
  sed "s/^SocketGroup=.*/SocketGroup=$WEB_GROUP/" "$HERE/tala-render.socket" > /etc/systemd/system/tala-render.socket
  chmod 0644 /etc/systemd/system/tala-render.socket
fi
run systemctl daemon-reload
run systemd-analyze verify /etc/systemd/system/tala-render.socket "/etc/systemd/system/tala-render@.service" /etc/systemd/system/talarender.slice || true
run systemctl enable tala-render.socket
# A job that is running finishes under the unit it started with; the next one uses the new files.
run systemctl restart tala-render.socket

# ---- 4. the first check: the job's own report, and ordinary drawings
if [ "$DRY" = 0 ]; then
  /usr/bin/node "$HERE/verify.mjs" --socket /run/tala-render/render.sock --only probe,draw || die "the service is installed but did not pass its first check. Pictures stay off (the web app has not been told about the socket). See: journalctl -t tala-render -n 30"
fi
if [ "$DRY" = 1 ]; then echo; echo "Dry run: nothing was changed. After a real run it says:"; fi
cat <<EOF

Installed. Pictures are still OFF for teachers. To finish:
  1. the whole check (about two minutes, add --slow for the real time ceilings):
       /usr/bin/node $HERE/verify.mjs --socket /run/tala-render/render.sock --out /var/tmp/tala-render-verify
  2. add to /etc/tala/tala.env:   TALA_DECKS_PREVIEW_SOCKET=/run/tala-render/render.sock
     and restart the web app in the release window.
Turn pictures off again at any time: systemctl stop tala-render.socket (the editor keeps working on the words).
Remove everything: $HERE/install.sh --remove
EOF
