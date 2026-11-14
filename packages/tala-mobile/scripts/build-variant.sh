#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source "$HOME/.config/hiraia/build-env.sh"
export TALA_QVAC="${TALA_QVAC:-0}"
export EXPO_PUBLIC_TALA_API_URL=https://tala.hiraia.org
export TALA_BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export CI=1
if [[ "$TALA_QVAC" == 1 ]]; then
  if [[ ! -f qvac-build/node_modules/.modules.yaml ]]; then
    echo "Install qvac-build separately with --ignore-workspace --frozen-lockfile first." >&2
    exit 1
  fi
  variant=with-qvac
  architectures=arm64-v8a
  pnpm exec expo prebuild --platform android --no-install --clean
  pnpm exec expo export --platform android --max-workers 1 --output-dir dist-qvac
  exportDir=dist-qvac
else
  variant=standard-check
  architectures=arm64-v8a,armeabi-v7a
  pnpm export
  exportDir=dist
fi
export TALA_BUNDLE_BYTES="$(node -e 'const fs=require("fs");const p=process.argv[1]+"/_expo/static/js/android";console.log(fs.statSync(p+"/"+fs.readdirSync(p).find(f=>f.endsWith(".hbc"))).size)' "$exportDir")"
# Native generated output is disposable; clean is required when switching variants.
pnpm exec expo prebuild --platform android --no-install --clean
if [[ "$TALA_QVAC" == 1 ]]; then node scripts/qvac-notices.cjs; fi
(cd android && ./gradlew :app:assembleRelease --no-daemon --max-workers 2 \
  "-PreactNativeArchitectures=$architectures" -Pexpo.useLegacyPackaging=true --console plain)
bash scripts/sign-demo.sh android/app/build/outputs/apk/release/app-release.apk "/tmp/tala-apk/tala-$variant.apk"
node scripts/variant-manifest.cjs "$variant"
