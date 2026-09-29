#!/usr/bin/env bash
# Canonical student-app build: both signed platforms, one validated release manifest.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ "${PREFLIGHT_ONLY:-0}" = "1" ]; then
  exec bash "$HERE/build-apk-single.sh" "$@"
fi
exec python3 "$HERE/build-apps.py" "$@"
