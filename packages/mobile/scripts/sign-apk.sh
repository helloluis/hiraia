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
APK_OUT="android/app/build/outputs/apk/release/hiraia-signed.apk"
CREDS="credentials.json"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
APKSIGNER="$(ls "$HOME"/Library/Android/sdk/build-tools/*/apksigner 2>/dev/null | tail -1)"
[ -x "$APKSIGNER" ] || { echo "!! apksigner not found under ~/Library/Android/sdk/build-tools"; exit 1; }
[ -f "$CREDS" ] || { echo "!! $CREDS missing — run the eas-cli credentials download first (see header)"; exit 1; }
[ -f "$APK_IN" ] || { echo "!! $APK_IN missing — build the APK first"; exit 1; }

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
echo "== cert matches the pinned anchor ($PINNED)"
echo "== signed APK: $APK_OUT"
echo "== size bytes: $(stat -f%z "$APK_OUT")"
echo "== sha256:     $(shasum -a 256 "$APK_OUT" | awk '{print $1}')"
echo "Next: paste the sha256 + size into packages/web/src/config/download.ts (fileSizeMB, sha256)."
