#!/usr/bin/env bash
set -euo pipefail
PROBE_ROOT="$(cd "$(dirname "$0")" && pwd)"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export CI=1
# Keep the generated native shell in sync with the versioned probe module.
cp "$PROBE_ROOT/ProbePackage.kt" "$PROBE_ROOT/android/app/src/main/java/com/hiraia/app/ProbePackage.kt"
cd "$PROBE_ROOT/android"
# Don't invoke bare-kit's shared link.mjs: exact addons came from the audited APK.
./gradlew assembleRelease -x :react-native-bare-kit:link --console=plain --max-workers=4 "$@"
cp app/build/outputs/apk/release/app-release.apk "$PROBE_ROOT/build/hiraia-android10-probe.apk"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose "$PROBE_ROOT/build/hiraia-android10-probe.apk"
shasum -a 256 "$PROBE_ROOT/build/hiraia-android10-probe.apk"
