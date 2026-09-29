#!/usr/bin/env bash
# Run as root on the disposable Ubuntu 24.04 Intel VM only.
# Creates no cloud resources and does not install/upload the Hiraia APK itself.
set -euo pipefail
test "$(id -u)" = 0 || { echo 'Run this script with sudo on the test VM.' >&2; exit 1; }
test "$(uname -m)" = x86_64 || { echo 'An x86_64 host is required.' >&2; exit 1; }
modprobe kvm_intel
test -e /dev/kvm || { echo 'Nested KVM is unavailable; refusing software CPU emulation.' >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  openjdk-17-jre-headless ca-certificates curl unzip python3 \
  libpulse0 libnss3 libx11-6 libxcb1 libxcomposite1 libxcursor1 libxi6 \
  libxtst6 libxrandr2 libxkbcommon0 libasound2t64 libglu1-mesa

HIRAIA_TEST_ROOT=/opt/hiraia-desktop-test
export ANDROID_HOME="$HIRAIA_TEST_ROOT/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export ANDROID_AVD_HOME="$HIRAIA_TEST_ROOT/avds"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
mkdir -p "$ANDROID_HOME/cmdline-tools" "$ANDROID_AVD_HOME" "$HIRAIA_TEST_ROOT/evidence"

# Pin Google's Linux command-line tools from repository2-1.xml, checked 2026-09-29.
# Verify its published size/checksum; record SHA-256 in the resulting provenance.
python3 - "$ANDROID_HOME" "$HIRAIA_TEST_ROOT/evidence" <<'PY'
import hashlib,json,sys,urllib.request,zipfile
from pathlib import Path
sdk,evidence=map(Path,sys.argv[1:])
url='https://dl.google.com/android/repository/commandlinetools-linux-16111833_latest.zip'
archive=sdk/'commandlinetools.zip'
expected='e025545c62a8e64c7559119566a569fb1dec5f60'
if not archive.exists():
    with urllib.request.urlopen(url,timeout=60) as source, archive.open('wb') as target:
        while chunk:=source.read(1024*1024): target.write(chunk)
with archive.open('rb') as stream: sha1=hashlib.file_digest(stream,'sha1').hexdigest()
assert archive.stat().st_size==181052239 and sha1==expected,'SDK archive integrity check failed'
with archive.open('rb') as stream: sha256=hashlib.file_digest(stream,'sha256').hexdigest()
latest=sdk/'cmdline-tools/latest'
if not latest.exists():
    with zipfile.ZipFile(archive) as z: z.extractall(sdk/'cmdline-tools/unpack')
    (sdk/'cmdline-tools/unpack/cmdline-tools').rename(latest)
for executable in (latest/'bin').iterdir(): executable.chmod(0o755)
(evidence/'sdk-tools.json').write_text(json.dumps({'url':url,'revision':'23.0','sha1':sha1,'sha256':sha256},indent=2)+'\n')
PY

export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
# SDK packages use the same Android SDK license already used for the local AVD.
set +o pipefail
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses > "$HIRAIA_TEST_ROOT/evidence/licenses.log" 2>&1
HIRAIA_LICENSE_STATUS=${PIPESTATUS[1]}
set -o pipefail
test "$HIRAIA_LICENSE_STATUS" = 0
sdkmanager --sdk_root="$ANDROID_HOME" 'platform-tools' 'emulator' \
  'system-images;android-34;android-desktop;x86_64'

if [ ! -f "$ANDROID_AVD_HOME/hiraia-desktop-x86.ini" ]; then
  avdmanager create avd --name hiraia-desktop-x86 --device desktop_medium \
    --package 'system-images;android-34;android-desktop;x86_64' <<< 'no'
fi
python3 - "$ANDROID_AVD_HOME/hiraia-desktop-x86.avd/config.ini" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);settings={}
for line in p.read_text().splitlines():
    if '=' in line:
        key,value=line.split('=',1);settings[key]=value
settings.update({'hw.lcd.width':'1366','hw.lcd.height':'768','hw.lcd.density':'160',
    'hw.ramSize':'6144','hw.cpu.ncore':'4','hw.keyboard':'yes','hw.mainKeys':'no',
    'hw.gpu.enabled':'yes','hw.gpu.mode':'swiftshader','hw.initialOrientation':'landscape',
    'disk.dataPartition.size':'16G','showDeviceFrame':'no','skin.dynamic':'yes',
    'skin.name':'1366x768'})
p.write_text(''.join(f'{key}={value}\n' for key,value in settings.items()))
PY

cat > "$HIRAIA_TEST_ROOT/env" <<'ENV'
export ANDROID_HOME=/opt/hiraia-desktop-test/sdk
export ANDROID_SDK_ROOT=/opt/hiraia-desktop-test/sdk
export ANDROID_AVD_HOME=/opt/hiraia-desktop-test/avds
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
ENV

emulator -accel-check > "$HIRAIA_TEST_ROOT/evidence/acceleration.txt" 2>&1
lscpu > "$HIRAIA_TEST_ROOT/evidence/host-cpu.txt"
uname -a > "$HIRAIA_TEST_ROOT/evidence/host-kernel.txt"
cp "$ANDROID_HOME/system-images/android-34/android-desktop/x86_64/source.properties" \
  "$HIRAIA_TEST_ROOT/evidence/image-source.properties"

# systemd owns the emulator after SSH exits. ADB stays on host loopback; use SSH
# to execute it. No VNC, ADB or emulator-console port is opened by this script.
cat > /etc/systemd/system/hiraia-desktop-emulator.service <<'UNIT'
[Unit]
Description=Disposable Hiraia Android Desktop x86 emulator
After=network-online.target

[Service]
Type=simple
Environment=ANDROID_AVD_HOME=/opt/hiraia-desktop-test/avds
Environment=ANDROID_HOME=/opt/hiraia-desktop-test/sdk
WorkingDirectory=/opt/hiraia-desktop-test
ExecStart=/opt/hiraia-desktop-test/sdk/emulator/emulator -avd hiraia-desktop-x86 -port 5554 -accel on -gpu swiftshader -no-window -no-audio -no-snapshot -no-boot-anim
Restart=no
TimeoutStopSec=30
StandardOutput=append:/opt/hiraia-desktop-test/evidence/emulator.log
StandardError=append:/opt/hiraia-desktop-test/evidence/emulator.log

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl start hiraia-desktop-emulator
timeout 300 adb -s emulator-5554 wait-for-device
HIRAIA_BOOT_DEADLINE=$((SECONDS + 300))
until [ "$(adb -s emulator-5554 shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do
  test "$SECONDS" -lt "$HIRAIA_BOOT_DEADLINE" || { echo 'Desktop guest boot timed out.' >&2; exit 1; }
  sleep 2
done
adb -s emulator-5554 root
timeout 30 adb -s emulator-5554 wait-for-device
adb -s emulator-5554 shell getprop > "$HIRAIA_TEST_ROOT/evidence/guest-properties.txt"
adb -s emulator-5554 shell pm list features > "$HIRAIA_TEST_ROOT/evidence/guest-features.txt"
echo 'Desktop x86 guest booted with KVM; ready for signed APK and model transfer.'
