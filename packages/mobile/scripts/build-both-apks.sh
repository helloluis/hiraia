#!/usr/bin/env bash
# Build BOTH on-device tiers' release APKs (cat 3B + kitten 1B) for sideloading.
#
# Tier-switch is (a) the ACTIVE_MODEL_KEY source constant and (b) the kitten
# jniLibs excludes applied by scripts/post-prebuild.mjs. The android/ native tree
# already exists and our JS-only changes add no native modules, so we SKIP the slow
# `expo prebuild` and just re-patch + rebundle per tier.
#
# Stale-bundle gotcha (hiraia-apk-stale-bundle-gotcha): assembleRelease's Metro
# bundle task can go UP-TO-DATE and ship OLD JS. We rm the bundle outputs before
# each assembleRelease to force a clean rebundle (critical: ACTIVE_MODEL_KEY + the
# new quiz code change between/within builds).
set -euo pipefail

cd "$(dirname "$0")/.."
export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
export ANDROID_HOME="$HOME/Library/Android/sdk"
# JDK isn't on PATH (/usr/bin/java is just the macOS stub); use Homebrew openjdk@17
# (AGP 8.x-compatible). Its real home is under libexec/.
export JAVA_HOME="/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"

MODEL_TS="src/config/model.ts"
OUT="$(pwd)/apk-out"
APK="android/app/build/outputs/apk/release/app-release.apk"
BUNDLE_GEN="android/app/build/generated/assets/createBundleReleaseJsAndAssets"
BUNDLE_RES="android/app/build/generated/res/createBundleReleaseJsAndAssets"
mkdir -p "$OUT"

set_key() { # $1 = sailor2-3b | sailor2-1b
  sed -i '' "s/export const ACTIVE_MODEL_KEY: OnDeviceModelKey = '[^']*';/export const ACTIVE_MODEL_KEY: OnDeviceModelKey = '$1';/" "$MODEL_TS"
  echo "  -> $(grep -m1 'ACTIVE_MODEL_KEY: OnDeviceModelKey =' "$MODEL_TS")"
}

# Always leave the source on the committed default (cat) even if a build fails.
restore() { set_key sailor2-3b >/dev/null 2>&1 || true; }
trap restore EXIT

build() { # $1 = label (cat|kitten)   $2 = model key   $3 = post-prebuild flag ("" | --kitten)
  echo "================ BUILD: $1 ($2) ================"
  set_key "$2"
  node scripts/post-prebuild.mjs $3
  rm -rf "$BUNDLE_GEN" "$BUNDLE_RES"
  ( cd android && ./gradlew assembleRelease --console=plain --no-daemon )
  cp "$APK" "$OUT/hiraia-$1-quiz.apk"
  echo "  built: $(ls -lah "$OUT/hiraia-$1-quiz.apk" | awk '{print $5, $NF}')"
}

echo "##### CAT (3B) — flagship phone (chat + quiz) #####"
build cat sailor2-3b ""

echo "##### KITTEN (1B) — Redmi (quiz only; model won't load on Adreno610) #####"
build kitten sailor2-1b "--kitten"

# restore source + native tree to the committed cat default
set_key sailor2-3b
node scripts/post-prebuild.mjs >/dev/null

echo "================ DONE ================"
ls -lah "$OUT"
