#!/usr/bin/env bash
set -euo pipefail
# Credentials and keystore are deliberately outside Git; never echo their values.
source "$HOME/.config/hiraia/build-env.sh"
keystore="$HOME/.config/hiraia/tala-next-demo.keystore"
credentials="$HOME/.config/hiraia/tala-next-demo-signing.env"
if [[ ! -f "$keystore" && ! -f "$credentials" ]]; then
  umask 077
  python3 - "$credentials" <<'PY'
import pathlib, secrets, sys
pathlib.Path(sys.argv[1]).write_text('export TALA_DEMO_KEYSTORE_PASSWORD=' + secrets.token_hex(32) + '\n')
PY
fi
[[ -f "$credentials" ]] || { echo 'Missing demo signing credentials' >&2; exit 1; }
source "$credentials"
if [[ ! -f "$keystore" ]]; then
  keytool -genkeypair -keystore "$keystore" -storepass:env TALA_DEMO_KEYSTORE_PASSWORD \
    -keypass:env TALA_DEMO_KEYSTORE_PASSWORD -alias tala-next-demo -keyalg RSA -keysize 2048 \
    -validity 10000 -dname 'CN=Tala Next Demo' >/dev/null 2>&1
  chmod 600 "$keystore"
fi
mkdir -p /tmp/tala-apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" sign --ks "$keystore" --ks-key-alias tala-next-demo \
  --ks-pass env:TALA_DEMO_KEYSTORE_PASSWORD --key-pass env:TALA_DEMO_KEYSTORE_PASSWORD \
  --out /tmp/tala-apk/tala.apk "${1:-android/app/build/outputs/apk/release/app-release.apk}"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify --verbose /tmp/tala-apk/tala.apk

chmod 644 /tmp/tala-apk/tala.apk
