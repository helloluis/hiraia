#!/usr/bin/env bash
#
# Sign the locally built release APK with the EAS-managed release keystore.
#
# WHY: the gradle release build signs with the DEBUG keystore (build.gradle's RN default),
# but the published June v0.1 APK — and the signingCertSha256 pinned on the website — use
# the EAS-managed release key (cert sha256 40d750d5…). Signing with that key keeps the
# published trust anchor valid and lets existing installs upgrade in place.
#
# ONE-TIME PREREQ (interactive, fetches key material — run it yourself):
#   cd packages/mobile && npx eas-cli credentials -p android
#     → pick the build profile
#     → "credentials.json: Upload/Download credentials between EAS servers and your local json"
#     → "Download credentials from EAS to credentials.json"
#   (credentials.json + keystore land in packages/mobile/, both gitignored — verify!)
#
# Then:  ./scripts/sign-apk.sh
#
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PINNED="40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35"
APK_IN="android/app/build/outputs/apk/release/app-release.apk"
VERSION_NAME="$(python3 -c 'import json; print(json.load(open("app.json"))["expo"]["version"])')"
BUILD_PLATFORM="$(node -p 'require("./scripts/build-platform.cjs").buildPlatform()')"
VERSION_FILE="$(python3 - "$VERSION_NAME" "$BUILD_PLATFORM" <<'PYNAME'
import sys
sys.path.insert(0, '../../deploy')
from app_artifacts import filename
print(filename(sys.argv[1], sys.argv[2]))
PYNAME
)"
APK_OUT="android/app/build/outputs/apk/release/$VERSION_FILE"
CREDS="credentials.json"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
APKSIGNER="$(ls "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | tail -1)"
[ -x "$APKSIGNER" ] || { echo "!! apksigner not found under ~/Library/Android/sdk/build-tools"; exit 1; }
[ -f "$CREDS" ] || { echo "!! $CREDS missing — run the eas-cli credentials download first (see header)"; exit 1; }
[ -f "$APK_IN" ] || { echo "!! $APK_IN missing — build the APK first"; exit 1; }

# Check before reading credentials or copying anything. In particular, signing a private
# APK without its build flag must fail instead of overwriting the public release filename.
APK_RUNTIME="$(unzip -p "$APK_IN" assets/fingerprint)"
EXPECTED_RUNTIME="$(npx expo-updates fingerprint:generate --platform android | python3 -c 'import json,sys; print(json.load(sys.stdin)["hash"])')"
[ "$APK_RUNTIME" = "$EXPECTED_RUNTIME" ] || {
  echo "!! APK runtime differs from this tree/build flags — rebuild and sign with the same HIRAIA_APK_VARIANT value."
  exit 1
}

# Never echo secrets: parse credentials.json into env vars consumed via --ks-pass env:.
eval "$(python3 - <<'PY'
import json, shlex
c = json.load(open('credentials.json'))['android']
ks = c['keystore']
print(f"export KS_PATH={shlex.quote(ks['keystorePath'])}")
print(f"export KS_PASS={shlex.quote(ks['keystorePassword'])}")
print(f"export KEY_ALIAS={shlex.quote(ks['keyAlias'])}")
print(f"export KEY_PASS={shlex.quote(ks['keyPassword'])}")
PY
)"
[ -f "$KS_PATH" ] || { echo "!! keystore $KS_PATH (from credentials.json) not found"; exit 1; }

cp "$APK_IN" "$APK_OUT"
"$APKSIGNER" sign \
  --ks "$KS_PATH" --ks-pass env:KS_PASS \
  --ks-key-alias "$KEY_ALIAS" --key-pass env:KEY_PASS \
  "$APK_OUT"

GOT="$("$APKSIGNER" verify --print-certs "$APK_OUT" 2>/dev/null | sed -n 's/.*SHA-256 digest: //p' | head -1)"
if [ "$GOT" != "$PINNED" ]; then
  echo "!! cert mismatch: got $GOT, pinned $PINNED — wrong keystore? NOT shipping this."
  exit 1
fi
BYTES="$(python3 -c 'import os,sys; print(os.path.getsize(sys.argv[1]))' "$APK_OUT")"
SHA256="$(shasum -a 256 "$APK_OUT" | awk '{print $1}')"
MD5="$(python3 -c 'import hashlib,sys; print(hashlib.file_digest(open(sys.argv[1], "rb"), "md5").hexdigest())' "$APK_OUT")"
# The versionCode the installed app will compare against the manifest's. Read from the
# SIGNED APK itself (aapt) so it is the number actually baked into the build, and cross-
# checked against app.json — the two must agree or the manifest lies to installed phones.
APP_JSON_VC="$(python3 -c 'import json; print(json.load(open("app.json"))["expo"]["android"]["versionCode"])')"
APP_JSON_VN="$(python3 -c 'import json; print(json.load(open("app.json"))["expo"]["version"])')"
AAPT="$(ls "$ANDROID_HOME"/build-tools/*/aapt 2>/dev/null | tail -1)"
APK_VC="$APP_JSON_VC"
if [ -x "$AAPT" ]; then
  APK_VC="$("$AAPT" dump badging "$APK_OUT" 2>/dev/null | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
  if [ -z "$APK_VC" ]; then APK_VC="$APP_JSON_VC"; fi
  if [ "$APK_VC" != "$APP_JSON_VC" ]; then
    echo "!! versionCode mismatch: APK says $APK_VC, app.json says $APP_JSON_VC — rebuild after prebuild, NOT shipping this."
    exit 1
  fi
fi
MB="$(python3 -c "print(round($BYTES / 1048576))")"

APK_VN="$("$AAPT" dump badging "$APK_OUT" 2>/dev/null | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
[ "$APK_VN" = "$VERSION_NAME" ] || { echo "!! APK versionName does not match its filename"; exit 1; }

echo "== cert matches the pinned anchor ($PINNED)"
echo "== signed APK:  $APK_OUT"
echo "== versionCode: $APK_VC (app.json version $APP_JSON_VN)"
echo "== size bytes:  $BYTES"
echo "== sha256:      $SHA256"
echo "== md5:         $MD5"
echo
echo "== platform:    $BUILD_PLATFORM"
echo "== runtime:     $APK_RUNTIME"
echo "Publish complete pairs with deploy/publish-release-assets.py --release <release.json>."
