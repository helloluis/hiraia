/**
 * Pin our gradle.properties settings during PREBUILD, so they survive the one prebuild
 * we do not run ourselves: the one EAS Build performs in its cloud worker.
 *
 * `scripts/post-prebuild.mjs` writes the same values, but only ever on this machine —
 * it is invoked from `pnpm prebuild` and `scripts/build-apk.sh` and from nowhere else.
 * EAS runs neither: `android/` is gitignored so the worker regenerates it from the
 * template, eas.json declares no `prebuildCommand`, and the only npm hooks EAS honours
 * (`eas-build-pre-install` / `eas-build-post-install`) both fire BEFORE prebuild, when
 * there is no `android/` tree to patch. A config plugin is the mechanism that does run
 * there, because prebuild itself applies it. Before it existed, an EAS APK shipped the
 * template's unminified, unshrunk, DEFLATE-packed defaults on a 512m JVM.
 *
 * The property list (and the reasoning for each) lives in `scripts/gradle-props.cjs`,
 * shared with post-prebuild so the two can never disagree.
 *
 * This file also pins `ndk.abiFilters`, which is NOT a gradle.property and so cannot live
 * in that list. `reactNativeArchitectures` only governs what React Native BUILDS; the
 * prebuilt .so files inside third-party AARs (react-native-bare-kit and the QVAC addons
 * ship armeabi-v7a/x86/x86_64 too) are filtered at PACKAGING time by abiFilters alone.
 * Without it the APK carries four ABIs of every vendor library. It had been surviving as
 * an unmanaged hand-edit in the gitignored tree, which a clean prebuild silently drops.
 */
const { withGradleProperties, withAppBuildGradle } = require('@expo/config-plugins');

const MANAGED_PROPS = require('../scripts/gradle-props.cjs');

/**
 * Replace every managed key with ours, appended as one commented block.
 *
 * Existing entries are FILTERED OUT rather than edited in place: a .properties file is
 * read last-wins, so leaving the template's `expo.useLegacyPackaging=false` behind and
 * appending `true` would work by accident today and break the moment something reads the
 * file rather than gradle's merged view. One key, one line.
 *
 * Exported for the smoke test in `scripts/check-gradle-props.mjs`.
 *
 * @param {import('@expo/config-plugins').AndroidConfig.Properties.PropertiesItem[]} items
 */
function applyManagedProps(items) {
  const managed = new Set(MANAGED_PROPS.map(([key]) => key));
  const kept = items.filter((item) => !(item.type === 'property' && managed.has(item.key)));
  /** @type {import('@expo/config-plugins').AndroidConfig.Properties.PropertiesItem[]} */
  const block = [
    { type: 'empty' },
    { type: 'comment', value: 'HIRAIA — settings a clean prebuild loses; see plugins/withGradleProps.js' },
  ];
  for (const [key, value, why] of MANAGED_PROPS) {
    block.push({ type: 'comment', value: `${key}: ${why}` });
    block.push({ type: 'property', key, value });
  }
  return [...kept, ...block];
}

const ABI = 'arm64-v8a';
const ABI_START = '// HIRAIA_ABI_START — packaging ABI filter; see plugins/withGradleProps.js';
const ABI_END = '// HIRAIA_ABI_END';

/**
 * Insert `ndk { abiFilters "arm64-v8a" }` as the first entry of `defaultConfig`.
 *
 * INSERTION, not correction: prebuild emits no `ndk` block at all, so unlike the
 * namespace/applicationId patches this block is dropped WHOLESALE and rewritten each
 * run. Any unmanaged `ndk { abiFilters ... }` (the hand-edit this replaces) is adopted
 * the same way, but only when the block contains nothing but abiFilters — a block that
 * grew a real setting is left alone and reported, rather than silently swallowed.
 *
 * Anchored on `defaultConfig {` because it is the one line in this file guaranteed to
 * exist and to open the right scope; matching a closing brace would need brace counting.
 *
 * Exported for the smoke test in `scripts/check-gradle-props.mjs`.
 *
 * @param {string} src contents of android/app/build.gradle
 */
function applyAbiFilters(src) {
  // 1. drop our own previous block (idempotency)
  let out = src.replace(
    new RegExp(`[ \\t]*${ABI_START}\\n[\\s\\S]*?${ABI_END}[ \\t]*\\n`, 'g'),
    ''
  );
  // 2. adopt an unmanaged abiFilters-only ndk block. `[^{}]*` cannot cross a brace, so a
  //    block with any nested structure never matches and survives untouched.
  out = out.replace(/^[ \t]*ndk\s*\{[^{}]*abiFilters[^{}]*\}[ \t]*\n/gm, '');
  if (/^[ \t]*ndk\s*\{/m.test(out)) {
    // A richer ndk block exists; adding a second one would be a gradle error.
    throw new Error(
      '[withGradleProps] build.gradle already has an ndk { } block with more than abiFilters — ' +
        `merge abiFilters "${ABI}" into it by hand and remove this guard.`
    );
  }
  const anchor = /^([ \t]*)defaultConfig\s*\{[ \t]*$/m;
  if (!anchor.test(out)) {
    throw new Error('[withGradleProps] build.gradle has no `defaultConfig {` line to anchor abiFilters to');
  }
  return out.replace(anchor, (line, indent) => [
    line,
    `${indent}    ${ABI_START}`,
    `${indent}    ndk { abiFilters "${ABI}" }`,
    `${indent}    ${ABI_END}`,
  ].join('\n'));
}

/**
 * MUST stay FIRST in app.json's `plugins` array. Expo composes mods into a chain in which
 * the LAST-registered action runs FIRST and then calls the previously-registered one, so
 * the first-registered plugin has the FINAL say — which is what we need against
 * expo-build-properties, whose own gradle-properties mod writes three of these same keys.
 *
 * @type {import('@expo/config-plugins').ConfigPlugin}
 */
module.exports = function withGradleProps(config) {
  const withProps = withGradleProperties(config, (cfg) => {
    cfg.modResults = applyManagedProps(cfg.modResults);
    return cfg;
  });
  return withAppBuildGradle(withProps, (cfg) => {
    cfg.modResults.contents = applyAbiFilters(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.applyManagedProps = applyManagedProps;
module.exports.applyAbiFilters = applyAbiFilters;
module.exports.ABI = ABI;
