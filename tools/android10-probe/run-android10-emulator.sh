#!/usr/bin/env bash
set -euo pipefail
PROBE_ROOT="$(cd "$(dirname "$0")" && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_AVD_HOME="$PROBE_ROOT/build/avds"
if [ ! -f "$ANDROID_AVD_HOME/hiraia-probe29.avd/config.ini" ]; then
  echo "The prepared Android10 AVD is missing. See EMULATOR-RESULTS.md and build/android29-image-provenance.json."
  exit 1
fi
# Isolated AVD, not the connected phone or the user's original emulator.
# Its model files persist so subsequent tests need no downloads/transfers.
exec "$ANDROID_HOME/emulator/emulator" -avd hiraia-probe29 \
  -no-snapshot -no-window -no-audio -port 5582 "$@"
