#!/usr/bin/env bash
# ============================================================================
# build-apk.sh — release APK, with the stale-bundle trap disarmed.
#
# Gradle treats `createBundleReleaseJsAndAssets` as up-to-date when only a
# WORKSPACE dependency changed (packages/shared, packages/images, the generated
# pool). The APK then builds fast, installs clean, and runs the PREVIOUS JS —
# which reads as "my change did nothing" and has cost hours before. The
# tell-tale is a suspiciously quick build plus:
#
#     > Task :app:createBundleReleaseJsAndAssets UP-TO-DATE
#
# Deleting the bundle outputs first makes the task unskippable. This lives in
# the repo rather than /tmp precisely because the /tmp copy went missing and the
# trap came back.
#
#   packages/mobile/scripts/build-apk.sh            # build
#   INSTALL=1 packages/mobile/scripts/build-apk.sh  # build + adb install
# ============================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MOBILE="$(cd "$HERE/.." && pwd)"
AND="$MOBILE/android"
APK="$AND/app/build/outputs/apk/release/app-release.apk"

# The Android Gradle Plugin needs a JDK 17. brew installs openjdk keg-only, so it is on disk
# but invisible to /usr/libexec/java_home — which is how a build fails with "Unable to locate
# a Java Runtime" on a machine that has two JDKs installed.
if [ -z "${JAVA_HOME:-}" ] && ! /usr/libexec/java_home >/dev/null 2>&1; then
  for v in 17 21; do
    CAND="$(brew --prefix "openjdk@$v" 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
    if [ -x "$CAND/bin/java" ]; then
      export JAVA_HOME="$CAND"
      echo ">> JAVA_HOME=$JAVA_HOME (brew openjdk@$v)"
      break
    fi
  done
fi
if [ -z "${JAVA_HOME:-}" ] && ! /usr/libexec/java_home >/dev/null 2>&1; then
  echo "!! no JDK found — try: brew install openjdk@17"
  exit 1
fi

# local.properties is gitignored (it holds a machine-specific path), so a fresh clone or a
# new worktree has no sdk.dir and gradle stops before it does anything. ANDROID_HOME is the
# portable way to say the same thing.
if [ -z "${ANDROID_HOME:-}" ]; then
  for CAND in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk" /usr/local/share/android-sdk; do
    if [ -d "$CAND/platform-tools" ]; then
      export ANDROID_HOME="$CAND"
      echo ">> ANDROID_HOME=$ANDROID_HOME"
      break
    fi
  done
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  echo "!! no Android SDK found — set ANDROID_HOME"
  exit 1
fi
export ANDROID_SDK_ROOT="$ANDROID_HOME"

cd "$MOBILE"
echo ">> clearing bundle outputs so Metro cannot be skipped"
rm -rf "$AND/app/build/generated/assets/createBundleReleaseJsAndAssets" \
       "$AND/app/build/generated/res/createBundleReleaseJsAndAssets" \
       "$AND/app/build/intermediates/assets/release" 2>/dev/null || true

echo ">> assembleRelease"
cd "$AND"
# The APK from the LAST build sits at this path and will happily outlive a failed one, so
# note when it was made. A build that "succeeds" while leaving a day-old file behind is the
# same lie as a skipped bundle, one level up. (Learned the hard way: a missing JDK made
# gradle fail, `| grep ... || true` swallowed the exit code, and a 21-hour-old APK was
# reported as a fresh build.)
BEFORE=0
[ -f "$APK" ] && BEFORE=$(stat -f %m "$APK")

set +e
./gradlew --console=plain assembleRelease "$@" 2>&1 | tee /tmp/apk-build.log
STATUS=${PIPESTATUS[0]}
set -e
grep -E "^> Task :app:(createBundle|package|assemble)|BUILD |FAILURE|error:" /tmp/apk-build.log | tail -12 || true

if [ "$STATUS" -ne 0 ]; then
  echo "!! gradle exited $STATUS — see /tmp/apk-build.log"
  exit "$STATUS"
fi
if [ ! -f "$APK" ]; then
  echo "!! no APK at $APK — see /tmp/apk-build.log"
  exit 1
fi
AFTER=$(stat -f %m "$APK")
if [ "$AFTER" -le "$BEFORE" ]; then
  echo "!! the APK was NOT rewritten — this is the previous build, not yours"
  exit 1
fi

# If Gradle still skipped the bundle, the APK is a lie. Say so loudly.
if grep -q "createBundleReleaseJsAndAssets UP-TO-DATE" /tmp/apk-build.log; then
  echo "!! WARNING: the JS bundle was SKIPPED — this APK may run old code"
fi

echo
echo "APK: $APK"
ls -lh "$APK" | awk '{print "     " $5}'
unzip -l "$APK" 2>/dev/null | awk '/assets\/|res\/drawable/ {n++} END {print "     " n " asset entries"}'

if [ "${INSTALL:-0}" = "1" ]; then
  echo ">> installing"
  adb install -r "$APK"
fi
