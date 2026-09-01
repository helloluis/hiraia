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
REPO="$(cd "$MOBILE/../.." && pwd)"
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

# ---------------------------------------------------------------------------------------
# The card inventory AND the tutor's fact bank are GENERATED. Since they moved out of the JS
# bundle, three artefacts are built by rag/pipeline/build-cards-db.py and shipped as-is:
#
#   src/generated/cardsIndex.generated.json  the resident index (bundled)
#   assets/data/cards.db                     card text, MCQs, the search index, the fact bank
#   assets/data/tokens.bin                   per-card vocabularies for textJaccard
#
# Nothing in the build regenerates them, so a stale one ships silently and is very hard to
# read back from the symptom: an edited card still shows its OLD text, a re-matched
# illustration still shows the OLD picture, a new card is missing from search. Worse, the
# database's tokeniser reads the stop list out of src/data/cards.ts, so editing THAT quietly
# desynchronises the search index from the app that queries it.
#
# science-facts.jsonl is in the SRC list for the same reason and one more: cards.db now holds
# the grounding fact bank, and its ordinals must line up with assets/rag/vectors-labse.i8.bin,
# which is positional. A bank edited after the database was built means the tutor retrieves
# one fact and embeds another — a failure with no symptom at build time at all.
#
# So compare mtimes and refuse rather than warn. Regenerating costs about a minute.
# ---------------------------------------------------------------------------------------
GEN=(
  "$MOBILE/src/generated/cardsIndex.generated.json"
  "$MOBILE/assets/data/cards.db"
  "$MOBILE/assets/data/tokens.bin"
)
SRC=(
  "$REPO/rag/pipeline/cardsPool.app.json"
  "$REPO/rag/bank/science-facts.jsonl"
  "$MOBILE/src/data/cards-questions.json"
)
# cards.ts is NOT in SRC. It is a CONSUMER of cards.db, not an input to it, so mtime-ing the
# whole file failed every time anyone edited the feed's logic — which is most days — and a
# guard that cries wolf on every edit is one people learn to bypass. The real dependency is
# narrow and exact: build-cards-db.py reads TWO declarations out of this file — the stop list
# `const SEARCH_STOP = new Set([...])` and the token pattern inside `function searchTokens` —
# and builds the index with them. Change either and the index desynchronises from the app
# querying it, which shows up as words that cannot be searched. (The pattern is in here because
# it silently drifted once already: the builder matched `[a-z0-9]+` while the app matched
# `[a-z0-9ñ]+`, so `piñatubo`, `el niño` and `la niña` were permanently unsearchable.) So hash
# exactly those two blocks and compare against the hash recorded when the database was built.
STOPSIG="$MOBILE/assets/data/.search-stop.sha256"
STOPBLOCK="$(sed -n '/const SEARCH_STOP = new Set(\[/,/\]);/p' "$MOBILE/src/data/cards.ts")"
TOKBLOCK="$(sed -n '/^function searchTokens(/,/^}/p' "$MOBILE/src/data/cards.ts")"
STOPNOW="$(printf '%s\n%s\n' "$STOPBLOCK" "$TOKBLOCK" | shasum -a 256 | cut -d' ' -f1)"
if [ -z "$STOPBLOCK" ] || [ -z "$TOKBLOCK" ]; then
  echo "!! could not find \`const SEARCH_STOP = new Set([\` and/or \`function searchTokens(\` in"
  echo "   cards.ts — the guard cannot check the token index against them. If a declaration was"
  echo "   renamed, update this check AND rag/pipeline/build-cards-db.py, which parses both by"
  echo "   that exact text."
  exit 1
elif [ ! -f "$STOPSIG" ]; then
  echo "!! no $(basename "$STOPSIG") — cannot tell whether the token index matches the tokeniser."
  echo "   If the database is current: printf '%s' \"$STOPNOW\" > \"$STOPSIG\""
  exit 1
elif [ "$STOPNOW" != "$(cat "$STOPSIG")" ]; then
  echo "!! SEARCH_STOP / searchTokens in cards.ts have changed since cards.db was built — the"
  echo "   token index and the app's tokeniser now disagree, which shows up as words that"
  echo "   cannot be searched."
  echo "   Rebuild: python3 rag/pipeline/build-cards-db.py   (then refresh $(basename "$STOPSIG"))"
  exit 1
fi
STALE=0
for g in "${GEN[@]}"; do
  if [ ! -f "$g" ]; then
    echo "!! missing $(basename "$g")"
    STALE=1
    continue
  fi
  for s in "${SRC[@]}"; do
    [ -f "$s" ] || continue
    if [ "$s" -nt "$g" ]; then
      echo "!! $(basename "$g") is OLDER than $(basename "$s")"
      STALE=1
    fi
  done
done
if [ "$STALE" = 1 ]; then
  echo
  echo "   The card inventory is out of date. Rebuild it, then run this again:"
  echo "     python3 rag/pipeline/build-cards-db.py"
  exit 1
fi
echo ">> card inventory is current"

cd "$MOBILE"

# ---------------------------------------------------------------------------------------
# Re-apply the native overrides BEFORE gradle runs. `pnpm prebuild` also calls this, but
# android/ is gitignored and long-lived, so the common fast loop — edit JS, `pnpm apk` — never
# regenerates it and never re-runs the patcher. A machine whose tree last built the retired
# kitten APK still carries that tier's jniLibs excludes, and shipping them now strips
# libqvac-ggml-vulkan.so out of an APK that asks for gpuLayers 99: it builds, installs and
# runs the 3B on the CPU, with no signal anywhere. post-prebuild.mjs evicts them, and is
# idempotent, so running it on every build costs nothing and closes the hole.
# ---------------------------------------------------------------------------------------
echo ">> re-applying native overrides (post-prebuild)"
node "$MOBILE/scripts/post-prebuild.mjs"

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

# Belt and braces on the same failure the post-prebuild call above prevents: assert the GPU
# backend actually made it into the archive. Without it the 3B silently falls back to CPU.
#
# NOTE `grep -c`, not `grep -q`. Under `set -o pipefail` (line 20) `grep -q` exits the moment
# it matches, `unzip` then dies of SIGPIPE, and the PIPELINE reports 141 — so the guard fired
# on every build even though the library was there (measured: status=141 with the .so present
# at 88,609,816 bytes). `grep -c` drains the stream, so the status is grep's own.
VULKAN_SO_COUNT="$(unzip -l "$APK" 2>/dev/null | grep -c "libqvac-ggml-vulkan\.so" || true)"
if [ "$VULKAN_SO_COUNT" -eq 0 ]; then
  echo "!! Vulkan backend missing from the APK — the 3B would run on CPU. Check jniLibs"
  echo "   excludes in android/app/build.gradle (see scripts/post-prebuild.mjs)."
  exit 1
fi

echo
echo "APK: $APK"
ls -lh "$APK" | awk '{print "     " $5}'
unzip -l "$APK" 2>/dev/null | awk '/assets\/|res\/drawable/ {n++} END {print "     " n " asset entries"}'

if [ "${INSTALL:-0}" = "1" ]; then
  echo ">> installing"
  adb install -r "$APK"
fi
