# QVAC worker dependency isolation

14 November 2026. Fix commit `f4e4aed23`; integrates tala-v1 through `84a1bb366`.

The package-level `process: npm:bare-process@4.4.1` alias was a defect. With shameful hoisting it exposed Bare's process module to unrelated browser bundlers. It is removed; `bare-process@4.4.1` is now installed under its real name. No mobile dependency or devDependency uses a Node builtin's name, and no root/Metro-wide alias was added.

`plugins/with-qvac-worker.cjs` composes the pinned SDK 0.23.0 native plugins and scopes the two process specifiers to a worker-only import map. The ignored generated SDK view copies the upstream map and adds absolute Bare-process URLs. It changes neither installed SDK import maps nor package-manager resolution. Both bare-pack and bare-link receive the overrides; overriding only bare-pack still leaves native addon traversal unable to resolve process. Native SDK/plugin version changes require rechecking this adapter.

## Clean-install evidence

Moved root and every present packages/\*/node_modules directory out of this worktree into a temporary generated-dependency backup, then ran:

```sh
pnpm install --filter '@hiraia/tala-mobile...' --filter '@hiraia/tala-web...'
node -e "console.log(require.resolve('process/package.json'))"
pnpm --filter @hiraia/tala-web build
pnpm --filter @hiraia/tala-mobile type-check
pnpm --filter @hiraia/tala-mobile test
```

Install: PASS, pnpm 9.15.9. Root process resolution: **MODULE_NOT_FOUND**, expected. Web production build: **PASS**, Compiled successfully, no `bare-*`, Critical dependency or Compiled with warnings in the build log. The unrelated Browserslist data-age notice remains. Mobile type-check: PASS. Mobile tests: **85 PASS**, none skipped. The added regression test rejects all builtin-named direct dependencies, checks both worker overrides, and checks that the installed SDK map remains byte-for-byte unchanged. The config test explicitly rejects the QVAC worker plugin in the standard variant.

QVAC prebuild: PASS. Worker bundle verification: PASS, 46 native addon files linked using the scoped map. The generated worker differs from the previous alias-based worker, so a new QVAC APK is required. The cloud path, model choice/download protocol and teacher-facing feature code were not changed by this fix. Existing physical-device inference limitations remain; this task does not establish inference success.

## Native build commands

Run serially, with build-env.sh sourced by the script, two Gradle workers and single-use daemons:

```sh
TALA_QVAC=0 bash scripts/build-variant.sh
TALA_QVAC=1 bash scripts/build-variant.sh
```

The standard check output and QVAC output have separate filenames. The original standard `tala.apk` and `tala-apk.json` are preserved. Final measurements are recorded below after the builds complete.

## Separate existing student-app alias

Read-only `git show HEAD:packages/mobile/package.json` also finds `"process": "npm:bare-process@4.4.1"` (line 81 at this integration commit). That belongs to the student app and was not edited. The combined filtered Tala-mobile/web installation proven above excludes that package. A truly full-workspace install including the student app can therefore still hoist its alias; its owner must apply equivalent worker-scoped resolution before claiming workspace-wide elimination. This is a separate remaining source of the same issue, not a dependency still declared by tala-mobile.

## Final artifacts and gates

- Standard native build: PASS, minSdk 24 / target 36, ARM64 + ARMv7. Manifest and all 30 library entries match the preserved original; no QVAC/Bare. Standard check APK 22,826,798 bytes. Hermes **2,971,326 bytes**, budget PASS.
- QVAC native build: PASS, minSdk 31 / target 36, ARM64, same stable demo signer; alignment/badging/signature verification PASS. **102565921 bytes**, SHA256 `5220a5a94f8f4c22d4d7c7e0ed37c3129b0a966e63f55a9a34e3174a9e6f25fd`, build date `2026-11-14T06:35:03Z`. QVAC Hermes **26,898,872 bytes** (reported separately). New artifact is 270,417 bytes smaller than its predecessor. No GGUF weights bundled.
- Replacement files: `/tmp/tala-apk/tala-with-qvac.apk` and `/tmp/tala-apk/tala-with-qvac-apk.json`. Original standard APK/manifest untouched; previous QVAC artifact retained under `tala-with-qvac-before-process-fix*` for comparison.
- Root process resolution checked again after worker/native builds: MODULE_NOT_FOUND. No source changes outside tala-mobile, no lockfile commit and no deployment.

Native library filename comparison against the preceding QVAC artifact: removed `lib/arm64-v8a/libbare-pipe.4.4.0.so`; added `(none)`. The SDK worker and native verification pass with the resulting dependency graph. No runtime inference is claimed by these build checks.
