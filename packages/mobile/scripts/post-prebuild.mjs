#!/usr/bin/env node
/**
 * Re-apply our Android overrides that `expo prebuild` wipes every time it
 * regenerates the native android/ tree. Idempotent — running twice is a no-op,
 * and every patch is wrapped in HIRAIA_KEEP_START / HIRAIA_KEEP_END sentinels so
 * the next run finds and replaces its own block instead of stacking duplicates.
 *
 * FIVE OVERRIDES (four files):
 *
 *   1. android/app/build.gradle  —  packagingOptions.jniLibs excludes for the
 *      KITTEN tier (budget-Adreno-610 / armv8.0 phones). See the existing inline
 *      comment in build.gradle and `hiraia-adreno610-qvac-vulkan-fail` memory:
 *        - Adreno 610 fails ggml-vulkan's 16-bit-storage gate at load
 *          (libqvac-ggml-vulkan.so must be excluded so the loader doesn't try it).
 *        - The same GPU has no OpenCL support (libqvac-ggml-opencl.so excluded).
 *        - ggml_backend_load_best picks the HIGHEST-scoring CPU .so, but
 *          Snapdragon 685 = Cortex-A73/A53 = ARMv8.0 (no i8mm/dotprod); the
 *          armv8.2/8.6/9.x variants fail to load and ggml does NOT fall back.
 *          So we keep ONLY the armv8.0 build by excluding the others.
 *      CAT tier (3B + Adreno 800+) needs NONE of these excludes — it benefits
 *      from Vulkan offload + higher-ISA CPU paths. Gating is via env or flag:
 *        - HIRAIA_TIER=kitten   (recommended for CI / build scripts)
 *        - --kitten             (positional flag for ad-hoc runs)
 *      Default is cat; an unflagged run produces a cat-ready tree.
 *
 *   2. android/app/src/main/res/values/styles.xml  —  light-only theme.
 *      Hiraia is a LIGHT design (notebook cream + teal). Expo's prebuild emits a
 *      `Theme.AppCompat.DayNight.NoActionBar` parent, which lets OEM auto-dark
 *      (e.g. ColorOS) INVERT our colors — that historically mangled the factoid
 *      card to unreadable light-on-light. We pin the Light parent and add
 *      `forceDarkAllowed=false` + the matching status bar colour.
 *
 *   4. android/app/src/main/res/values/colors.xml — define iconBackground and
 *      correct splashscreen_background from app.json. Prebuild references the
 *      former without defining it, which fails processReleaseResources.
 *
 *   3. android/gradle.properties  —  bump org.gradle.jvmargs above Expo's
 *      512m default. Hermes JS compilation reproducibly OOMs at 512m on this
 *      workspace; 6144m gives headroom. ALSO pins android.minSdkVersion=29:
 *      react-native-bare-kit (the QVAC worker runtime) declares minSdk 29 while
 *      prebuild emits 24, and the manifest merger hard-fails on the mismatch.
 *      This was previously only ever set by hand, so it survived in a long-lived
 *      android/ tree but broke the first time anyone regenerated one.
 *
 * Usage:
 *   node scripts/post-prebuild.mjs                   # cat tier (default)
 *   node scripts/post-prebuild.mjs --kitten          # kitten tier (flag form)
 *   HIRAIA_TIER=kitten node scripts/post-prebuild.mjs# kitten tier (env form)
 *
 * The npm scripts wire this up:
 *   pnpm prebuild           # = expo prebuild && node scripts/post-prebuild.mjs
 *   pnpm prebuild:kitten    # = expo prebuild && HIRAIA_TIER=kitten node scripts/post-prebuild.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..');
const ANDROID = path.join(MOBILE, 'android');

const isKitten = process.env.HIRAIA_TIER === 'kitten' || process.argv.includes('--kitten');
const log = (...a) => console.log('[post-prebuild]', ...a);

// ---------------------------------------------------------------- build.gradle
const GRADLE = path.join(ANDROID, 'app', 'build.gradle');

// Eight-space indent matches the existing jniLibs block; keep it consistent
// so the generated file reads as if it were authored by hand.
const KITTEN_EXCLUDES = [
  '            // HIRAIA_KEEP_START — kitten tier (Adreno 6xx / armv8.0) jniLibs excludes',
  '            // Drops the GPU ggml backends (Adreno 610 fails ggml-vulkan',
  '            // 16-bit-storage gate; OpenCL is also unsupported on this GPU) and',
  '            // the higher-ISA CPU variants (ggml picks the highest-scoring .so;',
  '            // armv8.6 fails to load on Cortex-A73/A53 → "no backends are loaded").',
  '            excludes += "/lib/**/libOpenCL.so"',
  '            excludes += "/lib/**/libqvac-ggml-vulkan.so"',
  '            excludes += "/lib/**/libqvac-ggml-opencl.so"',
  '            excludes += "/lib/**/libqvac-ggml-cpu-android_armv8.2_1.so"',
  '            excludes += "/lib/**/libqvac-ggml-cpu-android_armv8.2_2.so"',
  '            excludes += "/lib/**/libqvac-ggml-cpu-android_armv8.6_1.so"',
  '            excludes += "/lib/**/libqvac-ggml-cpu-android_armv9.0_1.so"',
  '            excludes += "/lib/**/libqvac-ggml-cpu-android_armv9.2_1.so"',
  '            excludes += "/lib/**/libqvac-ggml-cpu-android_armv9.2_2.so"',
  '            // HIRAIA_KEEP_END',
].join('\n');

function patchGradle() {
  if (!existsSync(GRADLE)) { log('SKIP build.gradle — not present'); return; }
  let src = readFileSync(GRADLE, 'utf8');

  // Strip any prior managed block (supports tier-switching cleanly).
  const stripped = src.replace(/[ \t]*\/\/ HIRAIA_KEEP_START[\s\S]*?\/\/ HIRAIA_KEEP_END[ \t]*\n?/m, '');
  src = stripped;

  if (isKitten) {
    // Anchor inside `jniLibs { … useLegacyPackaging … }` so the excludes apply
    // to the right block; insert right after the useLegacyPackaging line.
    const ANCHOR = /(jniLibs\s*\{\s*[\s\S]*?useLegacyPackaging\s+enableLegacyPackaging\.toBoolean\(\))\n/m;
    if (!ANCHOR.test(src)) {
      log('WARN: build.gradle missing useLegacyPackaging anchor; kitten excludes NOT applied');
      writeFileSync(GRADLE, src);
      return;
    }
    src = src.replace(ANCHOR, `$1\n${KITTEN_EXCLUDES}\n`);
    log('build.gradle  ← kitten excludes block');
  } else {
    log('build.gradle  ← cat tier (no excludes)');
  }
  writeFileSync(GRADLE, src);
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
  const bar = JSON.parse(readFileSync(APP_JSON, 'utf8')).expo?.androidStatusBar?.backgroundColor;
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
  src = src.replace(/[ \t]*<!-- HIRAIA_KEEP_START[\s\S]*?HIRAIA_KEEP_END -->\n?/gm, '');
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

const HEAP_BLOCK = [
  '# HIRAIA_KEEP_START — bump heap past Expo default; Hermes JS compile OOMs at 512m',
  'org.gradle.jvmargs=-Xmx6144m -XX:MaxMetaspaceSize=1024m',
  // react-native-bare-kit (the QVAC worker runtime) declares minSdk 29, and Expo's
  // prebuild emits 24 — the manifest merger then hard-fails processReleaseMainManifest.
  // 29 is also exactly the floor Android BlendMode needs for the card feed's multiply
  // on the greyscale engravings, so there is no reason to want a lower number.
  'android.minSdkVersion=29',
  '# HIRAIA_KEEP_END',
].join('\n');

function patchGradleProps() {
  if (!existsSync(GRADLE_PROPS)) { log('SKIP gradle.properties — not present'); return; }
  let src = readFileSync(GRADLE_PROPS, 'utf8');

  // Strip prior managed block.
  src = src.replace(/\n?# HIRAIA_KEEP_START[\s\S]*?# HIRAIA_KEEP_END\n?/m, '\n');
  // Strip any unmanaged jvmargs / minSdk lines so they can't shadow ours.
  src = src.replace(/^org\.gradle\.jvmargs=.*$\n?/m, '');
  src = src.replace(/^android\.minSdkVersion=.*$\n?/m, '');

  if (!src.endsWith('\n')) src += '\n';
  src += '\n' + HEAP_BLOCK + '\n';
  writeFileSync(GRADLE_PROPS, src);
  log('gradle.properties ← org.gradle.jvmargs=-Xmx6144m, android.minSdkVersion=29');
}

// ---------------------------------------------------------------- colors.xml
const COLORS = path.join(ANDROID, 'app/src/main/res/values/colors.xml');
const APP_JSON = path.join(MOBILE, 'app.json');

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
  const cfg = JSON.parse(readFileSync(APP_JSON, 'utf8')).expo ?? {};
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

log('tier =', isKitten ? 'kitten' : 'cat');
patchGradle();
patchStyles();
patchGradleProps();
patchColors();
log('done');
