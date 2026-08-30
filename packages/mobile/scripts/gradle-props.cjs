/**
 * THE gradle.properties SETTINGS THIS APP CANNOT SHIP WITHOUT — in one place, because
 * two different mechanisms have to apply them and they must never drift apart:
 *
 *   1. `plugins/withGradleProps.js` — an Expo CONFIG PLUGIN. This is the durable one:
 *      config plugins run inside every `expo prebuild`, including the prebuild EAS Build
 *      runs in its own cloud worker, where nothing of ours is invoked at all. EAS has no
 *      hook that fires between prebuild and Gradle (`eas-build-post-install` runs BEFORE
 *      prebuild), `android/` is gitignored so the cloud regenerates it, and eas.json
 *      declares no `prebuildCommand` — so before this plugin existed, an EAS APK shipped
 *      the TEMPLATE defaults: no minification, no resource shrinking, DEFLATE'd native
 *      libs (+145 MB on the wire) and a 512m JVM that Hermes OOMs at. (The ABI list is
 *      the one setting that survived anyway — @qvac/sdk's plugin pins it.)
 *
 *   2. `scripts/post-prebuild.mjs` — the local safety net. `android/` is gitignored but
 *      LONG-LIVED, and the usual loop (edit JS, `pnpm apk`) never re-runs prebuild, so a
 *      tree generated before a change to this list would keep the old values forever.
 *      It is idempotent and strips any unmanaged copy of these keys before appending.
 *
 * `expo-build-properties` can express four of the five (`useLegacyPackaging`,
 * `enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`, `buildArchs`)
 * but NOT `org.gradle.jvmargs`. Splitting them across two config surfaces would put the
 * reasoning in two places and still need a plugin, so all five live here.
 *
 * Each entry is `[key, value, why]`. `why` is emitted as a comment into the generated
 * file — these are all settings whose absence fails SILENTLY, so the file gradle reads
 * should say why they are there.
 *
 * @type {[string, string, string][]}
 */
module.exports = [
  ['org.gradle.jvmargs', '-Xmx6144m -XX:MaxMetaspaceSize=1024m', "Hermes JS compile OOMs at Expo's 512m default"],
  ['android.minSdkVersion', '29', "belt and braces — app.json's expo-build-properties plugin sets this during prebuild; pinned so a hand-edited tree can't drop below react-native-bare-kit's floor of 29"],
  // @qvac/sdk's own expo-plugin (withAndroidArchitecture) already pins this on every
  // prebuild, so it is the ONE entry here that was never at risk on EAS. Kept anyway:
  // shipping three dead ABIs is not something that should depend on a vendor plugin
  // continuing to do it for us, and the values agree, so it is free.
  ['reactNativeArchitectures', 'arm64-v8a', 'prebuild reverts to all four ABIs; we ship arm64 only (@qvac/sdk pins this too — belt and braces)'],
  ['android.enableMinifyInReleaseBuilds', 'true', 'reverts to false and silently fattens the release APK'],
  ['android.enableShrinkResourcesInReleaseBuilds', 'true', 'same — resource shrinking off by default'],
  // Store the native .so libraries UNCOMPRESSED and page-align them (the pre-API-23
  // "legacy" packaging), instead of leaving them DEFLATE'd inside the APK.
  //
  // MEASURED, both directions — this is a real trade, not a free win:
  //     download  -145,709,154 B   (the APK itself gets that much SMALLER)
  //     on-device  +68,827,142 B   (extracted libs are no longer shared with the APK)
  //
  // We take it because the two costs are not comparable for our users. The download is
  // metered prepaid data on a captive-portal school Wi-Fi, paid by a family, EVERY time
  // the app is installed or updated; the storage is a one-off on a handset that is
  // already committing 3.6 GB to the base model + embedder. 145 MB off the wire is the
  // scarcer resource by a wide margin.
  //
  // Prebuild hardcodes `expo.useLegacyPackaging=false` and app/build.gradle reads the
  // property (`findProperty('expo.useLegacyPackaging') ?: 'false'`), so gradle.properties
  // is the only file that can carry it — but hand-editing that file lasts exactly until
  // the next clean prebuild, which is what the plugin above exists to survive.
  ['expo.useLegacyPackaging', 'true', 'prebuild emits false; uncompressed .so = -145,709,154 B download for +68,827,142 B on-device (metered prepaid data is the scarcer resource)'],
];
