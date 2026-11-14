#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source "$HOME/.config/hiraia/build-env.sh"
export EXPO_PUBLIC_TALA_API_URL=https://tala.hiraia.org
export TALA_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export CI=1
pnpm export
export TALA_BUNDLE_BYTES="$(node -e 'const fs=require("fs");const p="dist/_expo/static/js/android";console.log(fs.statSync(p+"/"+fs.readdirSync(p).find(f=>f.endsWith(".hbc"))).size)')"
pnpm exec expo prebuild --platform android --no-install
# A single-use daemon avoids stopping other workers' Gradle daemons.
(cd android && ./gradlew assembleRelease --no-daemon --max-workers 2 \
  -PreactNativeArchitectures=arm64-v8a,armeabi-v7a --console plain)
bash scripts/sign-demo.sh
node scripts/demo-manifest.cjs
