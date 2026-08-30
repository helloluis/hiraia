#!/usr/bin/env node
/**
 * Re-apply our Android overrides that `expo prebuild` wipes every time it
 * regenerates the native android/ tree. Idempotent — running twice is a no-op,
 * and every patch is wrapped in HIRAIA_KEEP_START / HIRAIA_KEEP_END sentinels so
 * the next run finds and replaces its own block instead of stacking duplicates.
 *
 * There is ONE device target: Sailor2-3B on a 6 GB+ phone with full GPU/Vulkan
 * offload. The old second "kitten" tier (Sailor2-1B, CPU-only, 4 GB devices) is
 * retired, and with it the jniLibs exclude block that stripped the Vulkan/OpenCL
 * backends and the non-armv8.0 CPU variants out of the APK. Do NOT bring those
 * excludes back: `libqvac-ggml-vulkan.so` is load-bearing for the shipping tier.
 * A prebuild now always produces the one supported native configuration, and a
 * surviving backend exclude is a HARD ERROR — this script exits non-zero rather
 * than let a silently CPU-only APK be built.
 *
 * FOUR FILES:
 *
 *   1. android/app/build.gradle  —  namespace + applicationId, read from app.json
 *      (`expo.android.package`). A regenerated tree does not always carry them
 *      over; when it emits a template default instead, every generated Java/Kotlin
 *      reference to the app's own resources fails to compile with the memorable
 *      pair "Unresolved reference 'R'" / "Unresolved reference 'BuildConfig'" —
 *      a package mismatch, wearing a disguise.
 *
 *   2. android/app/src/main/res/values/styles.xml  —  light-only theme.
 *      Hiraia is a LIGHT design (notebook cream + teal). Expo's prebuild emits a
 *      `Theme.AppCompat.DayNight.NoActionBar` parent, which lets OEM auto-dark
 *      (e.g. ColorOS) INVERT our colors — that historically mangled the factoid
 *      card to unreadable light-on-light. We pin the Light parent and add
 *      `forceDarkAllowed=false` + the matching status bar colour.
 *
 *   3. android/gradle.properties  —  the settings a clean prebuild loses:
 *        - org.gradle.jvmargs above Expo's 512m default. Hermes JS compilation
 *          reproducibly OOMs at 512m on this workspace; 6144m gives headroom.
 *        - android.minSdkVersion=29. Belt and braces: app.json's expo-build-properties
 *          plugin already writes this during prebuild, so a clean tree gets 29 — this
 *          pin is what stops a hand-edited or plugin-less tree dropping below the floor
 *          react-native-bare-kit (the QVAC worker runtime) declares, which the manifest
 *          merger hard-fails on. 29 is also exactly the floor Android BlendMode needs for
 *          the card feed's multiply on the greyscale engravings, so there is no reason to
 *          want a lower number.
 *        - reactNativeArchitectures=arm64-v8a. Prebuild reverts this to all four
 *          ABIs (armeabi-v7a,arm64-v8a,x86,x86_64); we ship arm64 only, and the
 *          other three are pure APK weight for a device that cannot run the model.
 *        - android.enableMinifyInReleaseBuilds / enableShrinkResourcesInReleaseBuilds.
 *          Both revert to false, which silently fattens every release APK built
 *          from a fresh tree.
 *        - expo.useLegacyPackaging=true. Prebuild emits false. See MANAGED_PROPS for
 *          the measured trade — it is a DOWNLOAD-size win paid for in on-device
 *          storage, which is the right way round for a child on prepaid data.
 *
 *   4. android/app/src/main/res/values/colors.xml — define iconBackground and
 *      correct splashscreen_background from app.json. Prebuild references the
 *      former without defining it, which fails processReleaseResources.
 *
 * WHERE THIS SCRIPT DOES *NOT* RUN: EAS Build. It is invoked only from `pnpm prebuild`
 * and `scripts/build-apk.sh`, both local. EAS regenerates the gitignored `android/` with
 * its own cloud prebuild, eas.json declares no `prebuildCommand`, and the npm hooks EAS
 * honours (`eas-build-pre-install` / `eas-build-post-install`) fire BEFORE prebuild, when
 * there is no tree to patch. So gradle.properties (3) is ALSO applied by the config
 * plugin `plugins/withGradleProps.js`, which prebuild itself runs, wherever it runs; both
 * read the same list from `scripts/gradle-props.cjs`. Everything else here is still
 * local-only — if a patch below ever becomes load-bearing for a cloud build, it has to
 * become a config plugin too.
 *
 * Usage:
 *   node scripts/post-prebuild.mjs
 *
 * The npm script wires this up:
 *   pnpm prebuild           # = expo prebuild && node scripts/post-prebuild.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import MANAGED_PROPS from './gradle-props.cjs';
import { applyAbiFilters, ABI } from '../plugins/withGradleProps.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..');
const ANDROID = path.join(MOBILE, 'android');
const APP_JSON = path.join(MOBILE, 'app.json');

const log = (...a) => console.log('[post-prebuild]', ...a);

/**
 * app.json is the single source of truth for everything below that names a value
 * (package, colours). Nothing here hardcodes what the config already declares, so
 * a rename or a brand change touches the config once, not once per generated file.
 */
const appConfig = () => JSON.parse(readFileSync(APP_JSON, 'utf8')).expo ?? {};

/**
 * Two shapes of sentinel, because the two files need different things from them.
 *
 *   unwrap — remove only the marker COMMENTS and keep what they wrapped. For a patch
 *            that CORRECTS a line prebuild already emitted (build.gradle's namespace):
 *            deleting the block would delete the line itself, and a second run would
 *            then find nothing to fix and leave the file without it.
 *   drop   — remove the marker comments AND their contents. For a patch that INSERTS
 *            lines of its own (styles.xml), which are simply rewritten each run.
 */
const unwrapKeepMarkers = (src) =>
  src.replace(/^[ \t]*\/\/ HIRAIA_KEEP_(?:START|END)[^\n]*\n/gm, '');
const dropKeepBlocks = (src) =>
  src.replace(/[ \t]*<!--\s*HIRAIA_KEEP_START[\s\S]*?HIRAIA_KEEP_END[^\n]*\n?/gm, '');

// ---------------------------------------------------------------- build.gradle
const GRADLE = path.join(ANDROID, 'app', 'build.gradle');

/**
 * Any exclude that would strip a GPU backend out of the APK. `libqvac-ggml-vulkan.so` is
 * what the shipping model offloads its 99 layers to; `libOpenCL.so` is the system loader
 * that backend needs. Excluding either produces an APK that builds, installs and runs the
 * 3B on the CPU with no signal at all, so its presence is a hard error, not a warning.
 */
// A RETIRED exclude names one of ggml's own backends — the kitten tier stripped
// libqvac-ggml-vulkan.so, libqvac-ggml-opencl.so and every CPU variant above armv8.0 so the
// budget Adreno 610 would not try to load them. All of those are wrong for the one shipping
// tier, which offloads all 99 layers to the GPU.
const RETIRED_EXCLUDE = /^[ \t]*excludes\s*\+=.*libqvac-ggml-(?:vulkan|opencl|cpu-android_armv).*$/m;

// NOT retired, and NOT ours: @qvac/sdk's own `withOpenCL` expo plugin
// (node_modules/@qvac/sdk/dist/expo/plugins/withOpenCL.js:72) adds
// `excludes += "/lib/**/libOpenCL.so"` on EVERY prebuild. That is the SYSTEM OpenCL loader,
// which an app must never package — the device supplies its own under /vendor. It is a
// different file from ggml's `libqvac-ggml-opencl.so` backend, which that glob does not
// match. Deleting it made the vendor plugin and this script fight over build.gradle on
// every prebuild, so it is explicitly preserved.
const VENDOR_EXCLUDE = /libOpenCL\.so/;

/**
 * Drop `excludes +=` lines from a jniLibs body, plus the comments that captioned them.
 * Anything else — `def enableLegacyPackaging`, `useLegacyPackaging`, a real future setting —
 * survives, so this can never silently swallow a line it does not understand.
 */
function stripExcludeLines(body) {
  const isExclude = (l) => /^[ \t]*excludes\s*\+=/.test(l) && !VENDOR_EXCLUDE.test(l);
  const isComment = (l) => /^[ \t]*\/\//.test(l);
  const isBlank = (l) => /^[ \t]*$/.test(l);

  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (isExclude(lines[i])) continue;
    if (isComment(lines[i])) {
      // A comment is only dropped when it captions an exclude: skip past any further
      // comments/blanks and look at the next real line.
      let j = i + 1;
      while (j < lines.length && (isComment(lines[j]) || isBlank(lines[j]))) j++;
      if (j < lines.length && isExclude(lines[j])) continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

/**
 * SELF-HEAL: evict the retired kitten tier's jniLibs excludes.
 *
 * android/ is gitignored and long-lived, so a machine that last built the kitten APK
 * still has a build.gradle that excludes libqvac-ggml-vulkan.so, libqvac-ggml-opencl.so
 * and every CPU backend above armv8.0. Those excludes are now actively wrong — the one
 * shipping tier offloads all 99 layers to Vulkan — and they fail QUIETLY: the APK builds,
 * installs, and runs the 3B on the CPU at a fraction of the prefill speed. So remove the
 * block, and any orphan exclude line a partially-stripped tree left behind, rather than
 * assuming a fresh prebuild.
 *
 * Three layers, because a SILENT no-op here reproduces exactly the failure it exists to
 * prevent: strip the sentinel block, strip loose excludes out of the jniLibs body, then
 * re-scan the WHOLE file and hard-fail if a backend exclude survived anywhere.
 */
function evictRetiredBackendExcludes(src) {
  const before = src;

  // The sentinel-wrapped block this script used to write for the kitten tier…
  src = src.replace(/[ \t]*\/\/ HIRAIA_KEEP_START[^\n]*kitten[\s\S]*?\/\/ HIRAIA_KEEP_END[ \t]*\n?/g, '');

  // …and any hand-added backend excludes left loose outside a sentinel, which a
  // block-based strip cannot see. The vendor's libOpenCL.so line is preserved (see
  // VENDOR_EXCLUDE above).
  //
  // Match on `jniLibs {` itself rather than on the exact `useLegacyPackaging …` line the
  // Expo 54 template happens to emit: an anchor that precise stops matching the day the
  // template is reworded, and would then do nothing at all, quietly.
  const JNILIBS = /(jniLibs\s*\{[ \t]*\n)([\s\S]*?)(^[ \t]*\}[ \t]*\n)/m;
  if (!JNILIBS.test(src)) {
    log('WARN: build.gradle has no jniLibs block; retired-exclude eviction did NOT run');
  } else {
    src = src.replace(JNILIBS, (_whole, open, body, close) => open + stripExcludeLines(body) + close);
  }

  if (src !== before) log('build.gradle  ← evicted retired kitten jniLibs excludes (GPU backends restored)');

  // Backstop, independent of every pattern above: if a backend exclude is still anywhere in
  // the file, stop the build rather than let it produce a CPU-only APK.
  const orphan = src.match(RETIRED_EXCLUDE);
  if (orphan) {
    log(`FATAL: build.gradle still strips a GPU backend — ${orphan[0].trim()}`);
    log('       The shipping tier offloads all 99 layers to Vulkan. An APK built with this');
    log('       line installs and runs, on the CPU, with no other symptom. Delete it by hand.');
    process.exit(1);
  }
  return src;
}

/**
 * Pin `namespace` and `applicationId` to app.json's `expo.android.package`.
 *
 * Both already exist in a well-generated tree, so this is a CORRECTION rather than
 * an insertion: rewrite the line in place, keeping its indentation, wrapped in
 * sentinels so a later run replaces its own work. If prebuild wrote the right
 * value the file is unchanged; if it wrote a template default this is what stops
 * the build failing later, and much less legibly, in Kotlin.
 */
function patchGradle() {
  if (!existsSync(GRADLE)) { log('SKIP build.gradle — not present'); return; }
  let src = unwrapKeepMarkers(evictRetiredBackendExcludes(readFileSync(GRADLE, 'utf8')));

  // ndk.abiFilters — the packaging-time ABI filter, shared with the config plugin so the
  // two surfaces cannot drift. See plugins/withGradleProps.js for why it is not a
  // gradle.property and why reactNativeArchitectures does not cover it.
  const beforeAbi = src;
  src = applyAbiFilters(src);
  if (src !== beforeAbi) log(`build.gradle  \u2190 pinned ndk abiFilters "${ABI}"`);

  const pkg = appConfig().android?.package;
  if (!pkg) {
    log('SKIP build.gradle — expo.android.package not set in app.json');
    writeFileSync(GRADLE, src);
    return;
  }

  const applied = [];
  for (const key of ['namespace', 'applicationId']) {
    const line = new RegExp(`^([ \\t]*)${key}\\s+['"][^'"]*['"][ \\t]*$`, 'm');
    if (!line.test(src)) {
      log(`WARN: build.gradle has no ${key} line; NOT applied`);
      continue;
    }
    src = src.replace(line, (_m, indent) => [
      `${indent}// HIRAIA_KEEP_START — ${key} from app.json (a regenerated tree can emit a template default)`,
      `${indent}${key} '${pkg}'`,
      `${indent}// HIRAIA_KEEP_END`,
    ].join('\n'));
    applied.push(key);
  }

  writeFileSync(GRADLE, src);
  log('build.gradle  ←', applied.length ? `${applied.join(' + ')} = ${pkg}` : 'nothing to pin');
}

// ---------------------------------------------------------------- styles.xml
const STYLES = path.join(ANDROID, 'app', 'src', 'main', 'res', 'values', 'styles.xml');

/** Every <item> patchStyles owns. Anything here is removed before being re-written. */
const MANAGED_ITEMS = [
  'android:forceDarkAllowed',
  'android:enforceNavigationBarContrast',
  'android:statusBarColor',
];

/**
 * The status bar colour is declared in app.json (androidStatusBar.backgroundColor) like
 * every other themed colour, so read it from there rather than repeating the literal.
 * A brand change should touch the config once, not once per file that names a colour —
 * the same reason patchColors() below reads iconBackground and splashscreen_background
 * from app.json instead of hardcoding them.
 */
function styleOverrides() {
  const bar = appConfig().androidStatusBar?.backgroundColor;
  if (!bar) log('SKIP styles.xml/statusBarColor — androidStatusBar not set in app.json');
  return [
    '    <!-- HIRAIA_KEEP_START — light-only design; block OEM auto-dark inversion -->',
    '    <item name="android:forceDarkAllowed" tools:targetApi="29">false</item>',
    '    <item name="android:enforceNavigationBarContrast" tools:targetApi="29">true</item>',
    ...(bar ? [`    <item name="android:statusBarColor">${bar}</item>`] : []),
    '    <!-- HIRAIA_KEEP_END -->',
  ].join('\n');
}

function patchStyles() {
  if (!existsSync(STYLES)) { log('SKIP styles.xml — not present'); return; }
  let src = readFileSync(STYLES, 'utf8');

  // Strip prior managed state — ALL of it, not just the marker block.
  //
  // android/ is gitignored and long-lived, so styles.xml survives every prebuild and each
  // run appends to it. An older version of this script inserted these items WITHOUT the
  // KEEP markers, so those copies were never stripped and piled up: a real tree had 18
  // <item name="android:statusBarColor"> entries in one <style>, 16 of them a stale colour.
  // aapt takes the LAST duplicate, so the oldest value silently won and a colour change in
  // app.json appeared to do nothing. Remove every item we manage — by name, wherever it
  // sits — so the block below is the only one left and the file self-heals.
  src = dropKeepBlocks(src);
  for (const name of MANAGED_ITEMS) {
    src = src.replace(
      new RegExp(`^[ \\t]*<item name="${name}"[^>]*>[\\s\\S]*?</item>[ \\t]*\\n?`, 'gm'), '');
  }

  // Pin the Light theme parent (Expo prebuild emits DayNight).
  src = src.replace(
    /(<style\s+name="AppTheme"\s+parent=)"Theme\.AppCompat\.DayNight\.NoActionBar"/,
    '$1"Theme.AppCompat.Light.NoActionBar"',
  );

  // Ensure xmlns:tools is declared on <resources> (needed for tools:targetApi).
  if (!/xmlns:tools=/.test(src)) {
    src = src.replace(
      /<resources(\s[^>]*)?>/,
      (m, attrs) => `<resources${attrs ?? ''} xmlns:tools="http://schemas.android.com/tools">`,
    );
  }

  // Insert overrides right after the <style name="AppTheme" …> open tag.
  const APPTHEME_OPEN = /(<style\s+name="AppTheme"[^>]*>)\n?/;
  if (!APPTHEME_OPEN.test(src)) {
    log('WARN: styles.xml missing AppTheme style; overrides NOT applied');
    writeFileSync(STYLES, src);
    return;
  }
  src = src.replace(APPTHEME_OPEN, `$1\n${styleOverrides()}\n`);
  writeFileSync(STYLES, src);
  log('styles.xml    ← light theme + force-dark off + status bar colour');
}

// ---------------------------------------------------------------- gradle.properties
const GRADLE_PROPS = path.join(ANDROID, 'gradle.properties');

/**
 * The properties we own live in `gradle-props.cjs`, shared with the config plugin
 * `plugins/withGradleProps.js`. TWO mechanisms apply them and they must not drift:
 * the plugin runs inside every prebuild (including EAS Build's cloud one, which never
 * invokes this script), and this script re-pins them in a long-lived local `android/`
 * tree that no longer gets prebuilt. Each entry is [key, value, why]; a properties file
 * is read last-wins, and we strip any unmanaged copy before appending, so the block we
 * write is the value gradle sees.
 */

function patchGradleProps() {
  if (!existsSync(GRADLE_PROPS)) { log('SKIP gradle.properties — not present'); return; }
  let src = readFileSync(GRADLE_PROPS, 'utf8');

  // Strip prior managed block…
  src = src.replace(/\n?# HIRAIA_KEEP_START[\s\S]*?# HIRAIA_KEEP_END\n?/m, '\n');
  // …and any unmanaged copy of a property we own, so it cannot shadow ours.
  for (const [key] of MANAGED_PROPS) {
    src = src.replace(new RegExp(`^${key.replace(/\./g, '\\.')}=.*$\\n?`, 'gm'), '');
  }

  const block = [
    '# HIRAIA_KEEP_START — settings a clean `expo prebuild` loses; see scripts/post-prebuild.mjs',
    ...MANAGED_PROPS.flatMap(([key, value, why]) => [`# ${why}`, `${key}=${value}`]),
    '# HIRAIA_KEEP_END',
  ].join('\n');

  // Collapse the trailing whitespace the strip leaves behind before appending, so the
  // file is byte-identical run over run instead of growing a blank line each time.
  src = src.replace(/\s*$/, '\n');
  src += '\n' + block + '\n';
  writeFileSync(GRADLE_PROPS, src);
  log('gradle.properties ←', MANAGED_PROPS.map(([k, v]) => `${k}=${v}`).join(', '));
}

// ---------------------------------------------------------------- colors.xml
const COLORS = path.join(ANDROID, 'app/src/main/res/values/colors.xml');

/**
 * Expo 54's prebuild emits mipmap-anydpi-v26/ic_launcher.xml referencing
 * `@color/iconBackground` but does NOT emit the colour itself, and it writes
 * splashscreen_background as #FFFFFF regardless of the configured splash colour.
 * processReleaseResources then hard-fails:
 *
 *     AAPT: error: resource color/iconBackground ... not found
 *
 * Both values ARE declared in app.json (android.adaptiveIcon.backgroundColor and
 * splash.backgroundColor), so read them from there rather than hardcoding — the
 * config stays the single source of truth and these cannot drift from it.
 *
 * Like minSdk, this had only ever been fixed by hand in a long-lived android/
 * tree, so it survived there and only surfaced on a fresh regeneration.
 */
function patchColors() {
  if (!existsSync(COLORS)) { log('SKIP colors.xml — not present'); return; }
  const cfg = appConfig();
  const wanted = {
    iconBackground: cfg.android?.adaptiveIcon?.backgroundColor,
    splashscreen_background: cfg.splash?.backgroundColor,
  };

  let src = readFileSync(COLORS, 'utf8');
  for (const [name, value] of Object.entries(wanted)) {
    if (!value) { log(`SKIP colors.xml/${name} — not set in app.json`); continue; }
    const row = `  <color name="${name}">${value}</color>`;
    const existing = new RegExp(`^[ \\t]*<color name="${name}">.*</color>[ \\t]*$`, 'm');
    src = existing.test(src)
      ? src.replace(existing, row)                       // correct a wrong value
      : src.replace('</resources>', `${row}\n</resources>`); // or add the missing one
  }
  writeFileSync(COLORS, src);
  const shown = Object.entries(wanted).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  log('colors.xml    ←', shown.join(', '));
}

patchGradle();
patchStyles();
patchGradleProps();
patchColors();
log('done');
