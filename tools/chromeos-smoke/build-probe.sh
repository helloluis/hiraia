#!/usr/bin/env bash
# Build only the generated diagnostic, preserving the shipping app and its output.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
PROBE_ROOT="$REPO_ROOT/build/chromeos-20260929/cloud/probe"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export CI=1
test -f "$PROBE_ROOT/build/provenance.json" || { echo 'Run prepare-probe.py first.' >&2; exit 1; }

# Metro must include the current preparation provenance, even if only JSON changed.
rm -rf "$PROBE_ROOT/android/app/build/generated/assets/createBundleReleaseJsAndAssets" \
       "$PROBE_ROOT/android/app/build/generated/res/createBundleReleaseJsAndAssets"
cd "$PROBE_ROOT/android"
./gradlew assembleRelease -x :react-native-bare-kit:link --console=plain --max-workers=4 "$@"
cp app/build/outputs/apk/release/app-release.apk "$PROBE_ROOT/build/hiraia-chromeos-x86-probe.apk"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose \
  "$PROBE_ROOT/build/hiraia-chromeos-x86-probe.apk"
python3 "$REPO_ROOT/packages/mobile/scripts/audit-native-abis.py" \
  "$PROBE_ROOT/build/hiraia-chromeos-x86-probe.apk" --require x86_64 --linkage
shasum -a 256 "$PROBE_ROOT/build/hiraia-chromeos-x86-probe.apk"
