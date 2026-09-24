# Hiraia and Tala update delivery

The apps check `https://hiraia.org/api/app/manifest` after launch and at six-hour
foreground intervals. Offline checks fail quietly and can retry after 15 minutes.
Settings includes an explicit APK check. APK notices can be dismissed for seven days
per release; a new release can notify again. APK downloads and installation require
user action. Compatible asset updates download automatically while the app is active,
with progress in Settings rather than a notification bar above the feed.
From 0.4.24, Hiraia also takes JS-only OTA updates from `/api/updates/manifest`; they
need no user action and apply the next time the app is opened (below).

## Release channels

* Hiraia APK: existing `packages/web/src/config/download.ts` and verified resumable
  APK downloader. Android confirms installation.
* Tala APK: `?app=tala`, with `applicationId=com.hiraia.tala` and the measured `app`
  block from `packages/web/src/config/tala-download.json`. Download occurs on tap;
  size, streaming SHA-256, package ID, version code and signing identity must match.
  Android's per-app installation permission and installer remain user-confirmed.
* Hiraia data: `assets` in the same schema-1 response, sourced from
  `packages/web/src/config/asset-updates.json`. Old APKs ignore this additional field.
  Compatible tutor-model weights and illustrations update automatically. User-requested
  APK downloads pause automatic model replacements and take priority.
* Hiraia JS (OTA, 0.4.24+): expo-updates against `https://hiraia.org/api/updates/manifest`,
  a relay of manifests signed on the publisher's Mac (`deploy/publish-ota.py`) and stored
  on R2 under `ota/android/`. JS only, within one APK's runtime; see below.

These checks require a new APK containing the updater and a website deployment.
The checked-in Tala channel is empty until a signed, published release is measured.
The initial asset channel is empty: it must not invent improved weights or illustrations.
Publishing files alone does not announce them; publishing metadata alone must never
point phones at files that are not available yet.

## OTA JS updates

The third channel ships a new JS bundle to phones already running a given APK, without
reinstalling. It is deliberately narrow:

* **Scope.** One APK build = one runtime version (a fingerprint of everything native,
  `packages/mobile/fingerprint.config.js`). A phone accepts only updates for its own
  runtime, so native changes, new dependencies, `@qvac/sdk` changes and bundled-art
  changes still need an APK. Card data, voices and models never travel this way: the
  publisher refuses new assets over 2 MB each / 5 MB total, because a changed `cards.db`
  (146 MB) would be downloaded in full and duplicated on disk. Content goes by the data
  channel above, or an APK.
* **When phones check.** At every cold start on Wi-Fi (never on mobile data), in the
  background; the update runs from the next cold start and launch never waits for it. The
  Settings check also asks, on any network, because the reader asked. A foreground look at
  most every 6 hours fetches the manifest only and acts only on a rollback. Nothing ever
  reloads the running app.
* **What the reader sees.** Nothing to accept: at most "Hiraia will update the next time
  you open it" under Settings → Check for updates, and the running update's short id next
  to the build number. The APK banner is unchanged and never announces an OTA.
* **Trust.** Every manifest and rollback directive is signed with a key that exists only
  on the publisher's Mac; the APK carries the certificate and rejects anything else. The
  website only relays signed bytes, so it cannot create or alter an update.
* **Rings.** A canary allowlist of install ids, then production with a rollout
  percentage. Phones outside it keep the previous release only if that release had
  reached 100%; one held back (halted for a bug, or still going out) never reaches the
  rest through the back door. Every new production release hands the canary phones back
  to production, so a rollback reaches them too. Launch failures that phones report are
  logged by the route and are the signal to halt a rollout. A flood of requests for
  made-up runtimes is budgeted and cannot keep real phones from their channel.
* **Rollback.** Phones only move forward, so rolling back means publishing something new:
  the last good update re-signed as a new one, or a directive back to the APK's own bundle.
  A crash before first render rolls back on the phone by itself. The runtime to roll back
  is the one inside the shipped APK (`unzip -p <apk> assets/fingerprint`) or the publish's
  ledger line; the publisher refuses a runtime where no update was ever published.
* **Coexistence.** A newer APK always wins over any OTA of the older runtime. The
  `/api/app/manifest` channels (APK, Tala, data) are unchanged by OTA.

### Release order for 0.4.24 and Tala 0.4.4: server side first

0.4.24 adds `ota_update_id` to every `session_started`, and Tala 0.4.4 relays it. The
0.4.23 collector rejects unknown prop keys, and a rejection is final (the phone deletes the
event; Tala marks the relayed row rejected and never retries). So, in this order:

1. Deploy `packages/web` (the `store.ts` allowlist and `/api/updates/manifest`) with
   `deploy/update.sh`.
2. Redeploy the standalone telemetry collector that actually serves
   `/api/telemetry/batch` (`hiraia-telemetry`, `/opt/hiraia-telemetry/server.cjs`, rebuilt
   with `tools/pilot-telemetry/build-server.sh`). `update.sh` does not touch it.
3. Confirm the route answers 400, not 404, and a synthetic `session_started` carrying
   `ota_update_id` is acknowledged, not rejected.
4. Only then install 0.4.24 or Tala 0.4.4 on any device (test devices included), upload the
   APKs or the `hiraia.apk` alias, or move the download pointers.

Commands: `packages/mobile/BUILD.md` → "Release order". Any later release that adds a
telemetry prop key follows the same order.

Runbook (prebuild requirement, key custody, publish, promote, rollback):
`packages/mobile/BUILD.md` → "OTA JS updates".

## Compatible data updates

`format=1`, increasing `revision`, and explicit `minAppVersionCode` and
`maxAppVersionCode` pin each catalog to tested APKs. `imageBaseline` must match that
APK's bundled image catalog version. Reject stale/reused revisions, untrusted asset
origins, unsafe filenames, invalid sizes/digests and unknown runtime contracts.
Every catalog is cumulative: retain prior corrections unless an APK supersedes them.

The `base` model slot accepts only `hiraia-2b-qwen35-v1`: the existing 2B Qwen3.5
GGUF runtime, prompt, tokenizer and memory envelope (at most 2 GB of weights).
New model architectures, tokenizer changes, embedder/vector-bank changes and bundled
English/Filipino voice-runtime changes require an APK. Voice ONNX models are currently
bundled; this release does not silently replace their vocabulary/sample-rate contracts.

Model downloads use the existing resumable downloader plus a final size/MD5 check,
including cached files. Only then is the receipt saved. The running model is never
overwritten; activation happens on the next app launch. Previous files stay intact.
A runtime load failure rolls back the receipt and suppresses that failed revision;
the next model-load attempt uses the previous model. A newer tested revision may be offered.
Model replacements retain the existing memory/storage eligibility checks; unsupported
LaBSE-only phones do not download an LLM replacement. Transfers pause when the app
backgrounds or the engine starts initialization, and resume automatically when eligible.
Failed transfers back off for 15 minutes. Settings retains model download/verification
progress and the ready-for-next-launch indicator. Old asset-consent snoozes are ignored. Settings has a persistent AI-download pause/resume
switch covering first-time LaBSE, vectors, tutor weights and model replacements. Manual
pause preserves partial files, prevents new model transfers across launches, and keeps
already installed models usable. APK downloads are independent of this switch.

Image catalogs contain sparse replacements identified by stable pack `id`; unchanged
packs do not download again. New `patch-*` packs may override even APK-bundled images
by slug. Keep these patches small when correcting one illustration. Each replacement
uses a new checksum-bearing filename. Common packs and the current grade alone are
selected. On receiving a compatible catalog, it is saved automatically and the existing
illustration installer handles downloads, progress and retries independently of model
updates. A paused illustration preference stays paused; resume from Settings. Files are extracted
into a staging directory; only a complete verified pack is promoted. Old receipts/images
are replayed first on launch, keeping images available during interrupted replacements.
Prior versions are retained for recovery (no destructive automatic history cleanup yet).

## Publishing

1. Test the artifact against the APK version range. For a model, check real-device
   loading, output quality, memory and prompt compatibility before labeling that runtime.
2. Publish immutable files using the existing R2 publisher (`--asset` for model files;
   image-pack publisher for `.hpak`). For Tala, publish the signed APK with the exact
   versioned filename, e.g. `tala-v0p7p6.apk` for version `0.7.6`.
   Keep Tala's existing signing key; a differently signed APK cannot update an installation.
3. Run `deploy/prepare-app-update.py` to measure local files AND stream/hash CDN read-back.
   It writes a new candidate, never publishes or overwrites an active catalog.

```sh
python3 deploy/prepare-app-update.py model /release/hiraia-sft-2b-v3.Q4_K_M.gguf \
  --min-app 17 --max-app 17 --notes 'Clearer science explanations' --output /tmp/model-update.json
python3 deploy/prepare-app-update.py images /release/images/manifest.json \
  --min-app 17 --max-app 17 --output /tmp/image-update.json
python3 deploy/prepare-app-update.py tala /release/tala-signed.apk \
  --aapt /path/to/android/build-tools/36.0.0/aapt --output /tmp/tala-update.json
```

4. Review the candidate, copy it into the respective website config, commit and deploy
   the website. If preparing several updates together, pass `--catalog` pointing to the
   previous candidate so changes remain cumulative. Do not edit generated mobile baseline
   metadata merely to announce corrections for existing APKs.
5. Fetch both manifest variants, verify no-store caching, test a newer notice on a device,
   and exercise download failure, low storage, app restart and Android installer cancellation.

Validation: run the asset policy, model recovery and image installer tests, plus
mobile/web type checks and the Tala Android build:

```sh
pnpm --dir packages/mobile exec tsx --test scripts/asset-updates.test.mts scripts/model-updates.test.mjs scripts/image-installer.test.mjs
```
