# Standalone QVAC lock graph

14 November 2026. Implementation commit `97afd5f7a`; integration base `71dfb8318`.

Chosen option: a **standalone build island**, `qvac-build/`, outside the root workspace's `packages/*` glob. The parent standard app no longer declares SDK, Fabric, Bare kit, bare-pack, bare-process or QVAC-only expo-build-properties. Forcing the older shipping apps' Bare peers onto SDK 0.23.0 was avoided: that would make compatibility assumptions instead of isolating the experiment.

The island has its own package manifest, empty workspace boundary, `.npmrc`, virtual store and frozen nested lockfile. Shared global pnpm package-cache bytes do not imply a shared lock/peer-resolution graph. Its dependencies include matching Expo/RN tools for standalone verification. It is not referenced as a dependency of the parent/root workspace. No other package's source/config or root workspace configuration was edited.

## Required acceptance check

Ran the exact orchestrator-provided command against the final standard manifest:

```sh
/tmp/tala-orch/lock-check.sh /home/b11/code/tala-wt/e/packages/tala-mobile/package.json
```

Exit **0**, output:

```text
other importers changed: none
```

This covers the remaining standard dependencies too, including expo-device and expo-constants. The script temporarily regenerates/restores its full-checkout lockfile as designed. No commit or other edit was made there. The root lockfile in this worker checkout is unchanged; no manual root lockfile regeneration was performed. Only the **nested standalone lockfile** is added, as required by option (a).

## Resolution and build wiring

- Standard dependencies remain ordinary workspace dependencies; standard config never loads the QVAC plugins or engine adapter. Its TypeScript check excludes the optional adapter/island and checks shared core source explicitly.
- QVAC app config resolves build properties from the island. The pinned SDK's native helpers are composed without its root-relative device-info lookup (expo-device is a declared app dependency, so that step was a no-op).
- React Native config and the generated Gradle autolinking command explicitly select the island's Bare kit/search path, avoiding the shipping app's hoisted 0.12.3 kit.
- Metro resolves SDK/Bare imports from the island only when QVAC is enabled. Shared Tala core still resolves as live monorepo source.
- Worker bundling and native addon discovery use the private process map. The native-link entry lives in the island so SDK imports resolve locally. SDK mobile worker output and notices are also resolved through the island. Installed SDK import maps are unchanged.
- `qvac-build/prepare-tools.cjs` is an optional verification bootstrap after the workspace dependencies were deleted. It exposes only standard-manifest dependencies locally, never writes root node_modules, and does not add SDK/Bare to the parent dependency list.

See [qvac-build/README.md](qvac-build/README.md) for frozen-install and build commands. Updating SDK/native peers requires updating this private lockfile, not root peers.

## Checks so far

- Standalone `pnpm install --ignore-workspace --frozen-lockfile`: PASS, lockfile up to date, resolution skipped, pnpm 9.15.9.
- Standard type-check: PASS, using live shared-core source.
- Optional engine adapter type-check: PASS against isolated SDK 0.23.0.
- With the island installed: **86 tests PASS**, none skipped.
- Standard export/budget: **2,971,086 bytes** Hermes, PASS (6 MB gate / 4 MB aim); images 39,238 bytes.
- QVAC prebuild and worker verification: PASS; 38 native addon files linked from the standalone closure. No model weights bundled.
- Prettier and shell syntax: PASS.

The worker and dependency paths/closure changed, so the QVAC APK was rebuilt; final artifact details follow below. No local completion success is claimed by build checks; existing physical-phone inference verification remains outstanding.

Standard-only verification temporarily hid all seven QVAC/Bare/build-property direct packages. Standard type-check, export/budget, prebuild and native autolinking passed: no Bare dependency or Tala AI native package. Tests were **85 PASS plus one explicit optional SDK-map integration skip**. The island-installed run passes all 86. Build-tool resolver checks refuse ancestor fallback (including builtin process); config identity remains inspectable without the island. SDK generation, manifests, native-link entry and SDK verification all use the island project/dependency root, not the app/root workspace.

## Final replacement APK

`/tmp/tala-apk/tala-with-qvac.apk` and `/tmp/tala-apk/tala-with-qvac-apk.json`: **98186648 bytes**, SHA256 `d1a98a53ec2b1900a8cb4b7103b261c7af4328e99585fa1eaa8b97a8b305b2ff`, build date `2026-11-14T07:15:26Z`. Version 1.0.0-demo.1 / code 1, application ID com.hiraia.tala.next.qvac, minSdk 31 / target 36, ARM64 only, same stable external demo signer. Signature (v3), zip alignment and badging PASS. No GGUF model bundled. Exported Hermes is **24,807,889 bytes**; Gradle-embedded optimized Hermes is **22,853,788 bytes**. The two pipelines optimize differently; the export is the conservative budget/diagnostics measurement.

The original standard APK/manifest remain untouched. Generated app Android output and native-module Gradle/CMake output are deleted after verification to recover disk space. No persistent Gradle daemon remains. No deployment or push was performed.

After all checks, the worker’s optional-island dependency cache and verification bootstrap links were also removed to conserve this shared disk. Reinstall the nested frozen lockfile for the next QVAC build. Standard workspace installs do not install the island; the standard-only gate above proves that mode.
