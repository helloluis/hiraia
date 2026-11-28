# Tala desktop build and verification

This package displays `https://tala.hiraia.org` in a sandboxed Electron app. It does not
bundle a backend, add an offline sync system, or fork the web UI. The existing website
updates when Tala is deployed. **The installed Electron binary does not auto-update**;
install a newer build from the download page when one is released.

## Rebuild

Node 24 and npm; dependencies are pinned in the package's own `package-lock.json`.
The workspace exclusion prevents changes to the web/Android dependency lock.

```
cd packages/tala-desktop
npm ci --workspaces=false --no-audit --no-fund
node node_modules/electron/install.js
npm test
npm run test:electron
TALA_RELEASE_TAG=tala-v1-demo.N npm run build -- win32 x64
TALA_RELEASE_TAG=tala-v1-demo.N npm run build -- darwin arm64
TALA_RELEASE_TAG=tala-v1-demo.N npm run build -- darwin x64
```

Run Mac builds on Mac. Prefer native Windows for Windows packaging/testing (Linux
NSIS cross-packaging additionally requires Wine and is not native test evidence).
On a headless Linux test host: `node scripts/headless.cjs test/electron.cjs`.
No certificate discovery or upload happens in the build. Windows is unsigned; Mac
is explicitly ad-hoc signed, **not Developer ID signed or notarized**.

Release-tag versions are `0.1.N`, matching `tala-v1-demo.N`; preview versions are 0.1.0.
Each installer manifest records release tag, full source commit, dirty flag, platform,
architecture, Electron version, bytes and SHA256. CI refuses dirty package sources.

## Pipeline and failure behavior

`.github/workflows/tala-desktop.yml` builds on `tala-v1-demo.*` release tags, plus
`tala-desktop-preview-*` for reviewed previews. It does not run on feature branches or
pull requests. Every architecture installs its actual produced installer, launches and
relaunches that copy for shell tests, and uninstalls it from the temporary runner directory.
The complete-set job requires all three native jobs and independently checks hashes,
metadata agreement and native shell-test records before collecting artifacts.

Artifacts are named **unsigned preview, not for distribution**, expire after three days,
and require a signed-in GitHub user to download. The repo is public; these are unlisted,
not private. No GitHub Release, latest pointer or production download changes are made.

For a controlled missing-platform failure, the release owner can push a reviewed
`tala-desktop-preview-failure-N` tag. The Intel Mac job deliberately fails; the complete-set
job must remain skipped. Existing web releases/downloads are untouched. Retry by rerunning
the failed job only after fixing its cause, or use a new preview tag for a changed commit.
Never reuse a production artifact URL for different bytes.

Publication/rollback tooling and hosting are still being prepared. Proposed layout:
one immutable directory per release tag/full source commit, with all three artifacts and
`desktop-release.json`; a single atomic `desktop-latest.json` points at the whole set.
Promotion must verify downloaded bytes first and happen only by the release owner after
Luis approves. Rollback selects the previous complete manifest without deleting artifacts
or touching teacher data. This proposal is **not an installed publication pipeline**.

## Installation notes (candidate guidance)

- Windows: run the NSIS installer for your user. Unsigned builds may show an unknown
  publisher or SmartScreen warning. Verify the source and hash before choosing the
  per-app “More info” / “Run anyway” option, if your policy permits it.
- macOS: choose Apple silicon or Intel, mount the DMG, and drag Tala to Applications.
  An unsigned/unnotarized app may be blocked. After verifying its source/hash, use the
  specific app's “Open Anyway” control in System Settings → Privacy & Security if permitted.
  Do not disable Gatekeeper globally. Ad-hoc signing only makes the binary structurally
  valid for local execution; it is not Apple approval.
- Uninstall the Windows app using Installed apps, or remove Tala.app on macOS. Neither
  action deletes the teacher's cloud account. The installer deliberately preserves the
  local profile, so sign out before sharing the computer.

## Security and verification boundaries

No preload/IPC API is exposed. Node integration is off in every renderer; context isolation,
sandbox, web security, HTTPS and normal certificate validation remain enabled. Only Tala
may navigate in-app; same-origin popups inherit protections. Other HTTPS destinations
require a native confirmation and open in the system browser. Other schemes are denied.
Downloads accept same-origin/blob documents with an allowlisted extension, prompt for the
save location, and never automatically execute/open bytes. Print is the existing web print
iframe/native dialog, not a filesystem bridge. Sessions use a separate persistent partition.

`test/electron.cjs` uses a synthetic page intercepted inside Playwright; it is not a
claim of Tala feature parity. `STATUS.md` is the explicit outstanding acceptance matrix.
No test may use real teacher data, copy the production database, or regenerate the library.

Tool verification on 28 November 2026: Electron 45.5.0, electron-builder 26.18.0,
Playwright 1.65.1 and @electron/fuses 2.1.3 from the npm registry.
References: [Electron releases](https://releases.electronjs.org/),
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
Brand icon is copied byte-for-byte from `packages/tala-mobile/assets/tala-icon.svg`
at demo.20, rendered to 1024px PNG using pinned @resvg/resvg-js 2.6.2.
