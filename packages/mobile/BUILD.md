# Building Hiraia for Android, ChromeOS and Windows

The automatic three-edition pipeline is `.github/workflows/native-apps.yml`. The
protected Mac runner builds/signs both APKs and exports the shared Windows renderer;
a GitHub Windows runner packages and tests the real Windows executable. A complete
three-platform manifest requires matching source commits and versions plus successful
packaged Windows CPU/voice/UI tests. See [Windows build notes](../desktop/README.md).
`pnpm apk` remains the local paired-APK command described below; `pnpm build` alone
does not produce any native release.

The 12-question exam and saved history are shared requirements for all three editions.
`pnpm --filter @hiraia/mobile qa:exam` and the exam-bank freshness check gate both APKs.
The packaged Windows test completes twelve answers offline, restarts partway through,
checks the saved history, and exercises keyboard input, large text and a small window.
The three-edition manifest rejects Windows evidence without those exam checks.

## Footprint refactor branch (2026-10-02)

`codex/apk-footprint-refactor` combines current `main` at `2c51a4454` (including
0.4.29's exam carousel and Windows support) with the footprint work from `ad2ffd6d2`.
The app version remains 0.4.29 for development. This branch is not a new release or
an OTA for existing 0.4.29 installs; the changed bundled assets require a new native
runtime and a new version before publication.

Both APK editions bundle all three text languages, English voice and the approved
3,070 illustrations. Tagalog voice installs when selected; PH remains implicit.
Windows retains its existing bundled English and Tagalog voices through
`src/voice/bundled.web.ts`. Its native loader accepts the shared installer's versioned
filenames, and its export verifies both voice models before invoking Metro.

Start a fresh devbox checkout with Node 24, pnpm 9.15.9, Python 3 and Git LFS:

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --branch codex/apk-footprint-refactor git@github.com:helloluis/hiraia.git
cd hiraia
git lfs pull --include='packages/mobile/assets/rag/*.bin'
pnpm install --frozen-lockfile
python3 rag/pipeline/build-cards-db.py
python3 packages/mobile/scripts/package-art.py
pnpm --filter @hiraia/mobile type-check
pnpm --filter @hiraia/mobile qa:exam
```

The committed selection, shard inventory and `rag/pipeline/image-pack-layout.json`
reproduce all 61 packs with manifest version `ca57f3d76e889f08`; the original 42
packs keep their identities. Shipping PNG derivatives are tracked. Offloaded image
originals, research archives and retired worktrees are not inputs to this process.
Rebuilding the database changes its generated `dbVersion`; retain the matching index
with any APK built from it.

Git does not contain `assets/voices/en/model.onnx` or `assets/voices/tl/model.onnx`.
Before exporting or building, restore English weights for APKs, and both weights
for Windows, from the provisioned build inputs. Their sizes and SHA-256 pins are in
`assets/voices/catalog.json`; run `node packages/mobile/scripts/verify-voices.mjs`
(add `--include-downloads` for Windows) before proceeding. The protected runner uses
`deploy/restore-native-build-inputs.py` with `HIRAIA_BUILD_INPUTS_DIR`, which also
restores the model-gate inputs and signing credentials. Keep those private inputs
outside Git; a source checkout alone cannot sign a release.

Before shipping, run the normal regression gate and three-edition pipeline, validate
the packaged Windows executable on Windows, measure the new signed APKs, and update
release/catalog versions through the normal release process. The earlier refactor
APK size is not a measurement of this merged 0.4.29 tree.

Integration validation on 2026-10-02 passed both TypeScript configurations, 84 exam
tests, 49 mobile refactor/platform tests, nine desktop tests and eight Python tests.
All image packs rebuilt with identical digests; native staging reproduced 3,070 images
at 39,999,997 bytes. Android prebuild generated and verified the QVAC worker, and the
Android and Windows renderer exports succeeded with their expected voice inventories.
No APK build, signing, release publication or packaged Windows end-to-end run was
performed for this branch handover.


## Standard build: always both platforms

From the repository root or `packages/mobile`, run **`pnpm apk`**. It runs the formal
model regression gate, verifies/builds the pinned QVAC x86_64 port, prebuilds each native
configuration, builds and release-signs **both** Android (ARM64) and ChromeOS
(ARM64 + x86_64). Do not use the historical EAS recipe below for a platform release.

Outputs are isolated under `build/app-releases/<UTC timestamp>/{android,chromeos}/`.
`release.json` and `build/app-releases/latest.json` are written only after both archives,
certificates, versions and distinct OTA fingerprints pass. Each platform retains its
build log and full fingerprint inputs. A source edit during the pair fails the release;
never distribute a partial output or the debug-signed Gradle `app-release.apk`.

`HIRAIA_APK_VARIANT` does **not** narrow `pnpm apk` to one platform. Native troubleshooting
can use `HIRAIA_APK_VARIANT=android` or `chromeos` with prebuild and the internal
`scripts/build-apk-single.sh`; that command does not produce a releasable pair.
`PREFLIGHT_ONLY=1 scripts/build-apk.sh` remains the OTA publisher's content gate.

Publishing a pair (only after release authorization and a new version when bytes change):

```sh
~/.venvs/hiraia-publish/bin/python deploy/publish-release-assets.py \
  --env-file /private/path/.env.cloudflare.local \
  --release build/app-releases/<timestamp>/release.json \
  --output build/app-releases/<timestamp>/platform-releases.json
```

The publisher checks BOTH immutable destinations before writing, uploads and reads back
both files, then emits one website catalog. Copy that verified candidate into
`packages/web/src/config/platform-releases.json`. It drives both the download page and
`/api/app/manifest?platform=android|chromeos`; the legacy URL still selects Android.
ChromeOS never accepts an unlabelled or Android update. Aliases are `hiraia.apk` and
`hiraia-chromeos.apk`; immutable URLs remain versioned. No new version or public upload
is performed by the builder itself.

OTA releases still need **one publish per native runtime**. `publish-ota.py --apk` reads
that APK's embedded distribution and selects the matching config automatically, then
checks its exact fingerprint. Test/promote both runtime channels; do not copy one
channel pointer onto another. The artifact manifest records both runtimes.

`pnpm build` is the monorepo's web/JS compilation; it does not produce native APKs.
The canonical native pipeline is `pnpm apk`. GitHub-hosted CI lacks the ignored voice
weights, local model-gate toolchain and signing key: it must not claim a JS export is
an Android/ChromeOS release. A provisioned native runner is needed for unattended builds.

The mobile app runs the **Hiraia-2B** — our CPT'd + full-parameter-SFT'd Qwen3.5-2B —
**on-device** via the QVAC SDK (a bare-runtime worker embedded through
`react-native-bare-kit`). That means **it cannot run in Expo Go or in a JS-only build** — it
needs a native build with the QVAC config plugin, and per QVAC's docs it runs on a
**physical Android 12+ device only** (not emulators).

The verified build path is a **local release APK** through `pnpm prebuild` and
`pnpm apk`. The EAS configuration below is historical and is not a substitute for
validating native plugins and ignored build inputs in a fresh checkout.

## The content is GENERATED — rebuild it before you build

Neither the feed's cards nor the tutor's fact bank live in the JS bundle any more. Three
artefacts are produced by `rag/pipeline/build-cards-db.py` and shipped as they are:

| file | what it is | ships as |
|---|---|---|
| `src/generated/cardsIndex.generated.json` | ids, terms, slug, cats, topic, domain — everything sequencing reads | bundled (16.7 MB) |
| `assets/data/cards.db` | card text, titles, emphasis, MCQs, the search index, **and the 53,022-fact grounding bank** (`fact` / `fact_token` / `fact_meta`) | asset (144.8 MB on disk, ~47.4 MB deflated in the APK) |
| `assets/data/tokens.bin` | each card's vocabulary as sorted int hashes, for `textJaccard` | asset (8.1 MB) |

The fact bank moved here from `packages/shared/src/rag/facts.generated.ts`, which was a
43.5 MB TypeScript array Metro could not tree-shake — 41.2 MB of Hermes bytecode, STORED
uncompressed in the APK because the React Native gradle plugin puts the bundle extension in
`noCompress`. The same content costs 17.8 MB deflated as SQLite rows.

```bash
python3 rag/pipeline/build-cards-db.py     # ~1 minute
```

**Nothing in the build regenerates these.** `build-apk.sh` compares their mtimes against
their sources and refuses to build if any is older, because a stale one ships silently and
the symptom is nearly unreadable: an edited card shows its OLD text, a re-matched
illustration shows the OLD picture, a newly added card is missing from search results but
present in the feed.

### Rebuild after ANY of these

- `rag/pipeline/cardsPool.app.json` changed — i.e. after `rag/pipeline/wire-app-pool.py`,
  which is itself what applies the editorial pass and the illustration re-match
- **`rag/bank/science-facts.jsonl` changed.** The database carries the grounding bank now,
  and its `ord` column has to line up with the fact-vectors blob, which is POSITIONAL
  (vector i belongs to bank row i). The blob is a DOWNLOADED asset (see the pre-ship step
  below), so a bank edit is three moves in one breath: rebuild the blob
  (`rag/scripts/build-vectors.py`, which also rewrites `vectors-labse.meta.json` and stamps
  the same `bankHash` into `cards.db`), upload it to the mirror under its new
  hash-embedded filename, and repin `REMOTE_ASSETS.vectors` in `src/config/model.ts`.
  Skip any of the three and the tutor retrieves one fact and embeds another — with NO
  symptom at build time, because the runtime guards only compare what travels TOGETHER in
  the repo (the meta's `bankHash` vs the bank stamped in `cards.db`); nothing compares the
  downloaded blob's bytes. That gap is exactly why the blob's filename embeds the bank
  hash and why the pin has to move with it. (`RagStore.attachSemantic` does compare the
  meta's count + `bankHash` against `cards.db` and fails loudly at app start, so a
  repo-internal mismatch — a rebuilt bank without a rebuilt meta — is caught; a stale
  REMOTE blob behind a correct pin is the one that is not.)
- `src/data/cards-questions.json` changed
- **`src/data/cards.ts` changed.** Non-obvious and the easiest to miss: the builder reads the
  `SEARCH_STOP` list out of that file so the index is tokenised exactly the way
  `searchTokens()` will tokenise a query. Editing the stop list without rebuilding leaves the
  index and the app disagreeing about what a token is — it does not crash, it just quietly
  changes what search finds and how `textJaccard` scores near-duplicates.

### Why it is precomputed

`searchCards` used to tokenise all three languages of all 29,737 cards at module init to
build its index — 427 ms of the 742 ms the feed spent starting up, and the one thing that
genuinely required the whole inventory to be resident in memory. Precomputing it took module
init to 102 ms and let the text move to SQLite.

It also changed the algorithm rather than just the storage. The old in-memory index ran the
wrong way (card → tokens), so a query had to scan every card; the database holds the inverted
one, so a query touches only the cards carrying one of its tokens. Measured: `"volcano"` reads
290 cards instead of 29,737, 2.5–16× faster, with identical picks.


## Prerequisites

- **Node ≥ 22.17** (we use 22.22).
- The QVAC mobile deps are already in `package.json`: `react-native-bare-kit`
  (runtime), `bare-pack` + `@qvac/cli` (dev, build the worker bundle), `expo-device`,
  `expo-build-properties`, and the `@qvac/sdk/expo-plugin` in `app.json`.
- **`shamefully-hoist=true`** in the repo-root `.npmrc` — REQUIRED. `bare-pack` does
  flat, npm-style module resolution; pnpm's isolated store hides the bare-* polyfills
  and `@qvac/*` native engines from it. Flattening node_modules fixes this. Don't
  remove it or the worker bundle (and thus prebuild/EAS) fails.
- **`@qvac/rag` is pinned in this package's `dependencies`** even though nothing here
  imports it directly — it is a transitive dep of `@qvac/sdk`. Do not "clean it up".

  It is now belt-and-braces rather than load-bearing: as of the 0.17.1 upgrade BOTH
  workspaces (`packages/mobile` and `packages/server`) are on `@qvac/sdk@^0.17.1`, which
  declares `@qvac/rag@^0.6.4`, so there is exactly ONE `@qvac/rag` in the tree and
  whatever `shamefully-hoist` flattens to the root is already the right one. The pin
  costs nothing and re-arms the guard the moment the two workspaces diverge again.

  What it guards against (the bug it was added for): the workspaces used to pull
  different SDK lines — mobile on `@qvac/sdk@0.13.1` (needs `@qvac/rag@^0.6.x`, imports
  `@qvac/rag/errors.js`) and server on `@qvac/sdk@0.11.0` (pulls `@qvac/rag@0.5.0`,
  which has neither an `exports` map nor an `errors.js`). `shamefully-hoist` flattens
  exactly ONE version of each package to the root and it picked 0.5.0, so bare-pack,
  resolving up from `packages/mobile/node_modules/@qvac/sdk`, found the wrong one and
  died with:

      MODULE_NOT_FOUND: Cannot find module '@qvac/rag/errors.js'
                        imported from '@qvac/sdk/dist/schemas/index.js'

  which failed `expo prebuild` at its QVAC mod BEFORE any config-driven mod ran — so it
  silently emitted a raw, unconfigured template tree (placeholder package name, template
  AndroidManifest) that then failed Gradle in confusing ways much later. Declaring
  `@qvac/rag` here puts the correct version in `packages/mobile/node_modules/`, where it
  shadows any mis-hoisted root copy for anything resolving from this package.

- **Keep `packages/server` on the same `@qvac/sdk` version as this package.** The same
  hoist that decides `@qvac/rag` also decides which `@qvac/{llm,embed}-llamacpp` native
  engine ends up in the APK, and it is NOT necessarily this package's. `bare-link` (see
  `plugins/withQvacAddons.js`) resolves engines from the flattened ROOT, so while the
  workspaces were split the release APK carried the server's engines and stale copies of
  mobile's — both `llm-llamacpp` 0.20.1 AND 0.24.0, both `embed-llamacpp` 0.16.0 AND
  0.19.1, about **14.5 MB of dead native code** pulled in by a Node-only package that
  never runs on a phone. Worse than the size: the worker bundle dlopen()s a
  version-suffixed name (`libqvac__llm-llamacpp.<version>.so`), so if the hoisted engine
  is not the one the bundle was packed against you get
  `AddonError: dlopen failed: library "…" not found` at runtime. Both workspaces on one
  SDK version keeps bundle and linked engine in sync by construction. Verify with:

      python3 -c "import zipfile; z=zipfile.ZipFile('android/app/build/outputs/apk/release/app-release.apk'); \
        print([i for i in z.namelist() if 'libqvac__' in i])"

  (`plugins/withQvacAddons.js` also wipes `android/app/src/main/jniLibs` before linking,
  so stale engine `.so` from a previous SDK version can no longer accumulate in a
  long-lived `android/` tree.)
- A physical **Android 12+** device with **6 GB+ RAM**. That is the single supported
  device target — there is no lighter build. Target ABI is **arm64-v8a only**
  (`reactNativeArchitectures` in `android/gradle.properties`, pinned by post-prebuild).

## Historical EAS configuration (not the release pipeline)

EAS runs `expo prebuild` + Gradle in Expo's cloud and returns a downloadable APK URL.

```bash
cd packages/mobile

# 1. One-time: log in and link the project (creates extra.eas.projectId in app.json)
npx eas-cli login
npx eas-cli init

# 2. Build the installable APK (the `preview` profile in eas.json → release APK,
#    internal distribution = a shareable link + QR)
npx eas-cli build --platform android --profile preview
```

When it finishes, EAS prints an install URL/QR. Open it on the device (or share it) to
download `hiraia.apk` and sideload it. (Android: enable "Install unknown apps".)

> **EAS never runs `scripts/post-prebuild.mjs`.** It is invoked only from `pnpm prebuild`
> and `pnpm apk`, both local. EAS runs its own prebuild in the cloud, eas.json declares no
> `prebuildCommand`, and the npm hooks EAS honours (`eas-build-pre-install` /
> `eas-build-post-install`) both fire BEFORE prebuild, when there is no `android/` to
> patch. So anything a cloud build depends on has to be a **config plugin**:
>
> - `plugins/withGradleProps.js` carries the gradle.properties settings (JVM heap, arm64
>   only, minify, resource shrinking, `expo.useLegacyPackaging` — the −145 MB download
>   win). It must stay FIRST in `app.json`'s `plugins` array: Expo runs the
>   last-registered mod first, so first-registered has the final say over
>   `expo-build-properties`, which writes three of the same keys. Verify the transform
>   without a prebuild: `node scripts/check-gradle-props.mjs`.
> - `plugins/withQvacAddons.js` links the native addons.
>
> The **remaining** post-prebuild patches (build.gradle namespace, light-only
> `styles.xml`, the `colors.xml` `iconBackground` that `processReleaseResources` fails
> without) are still local-only. If a cloud build ever regenerates `android/` from
> scratch, those have to become config plugins too — check an EAS build's resource step
> before trusting it.

## Internal single-platform build details

Only if you want to build without EAS. Requires JDK 17, Android SDK, and **NDK
29.0.14206865** installed (e.g. via Android Studio), with `ANDROID_HOME` set.

```bash
cd packages/mobile
pnpm prebuild                     # generates android/, builds the QVAC worker bundle,
                                  #   then re-applies our native overrides
pnpm apk                          # BOTH signed platforms + build/app-releases/<timestamp>/release.json
```

`android/` and `qvac/` are gitignored — both are regenerated by prebuild.

**Use `pnpm prebuild`, not `npx expo prebuild` on its own.** A clean prebuild silently
reverts settings the build depends on — the ABI list back to all four architectures,
release minification and resource shrinking back to false, the JVM heap back to a size
Hermes OOMs at, and the namespace/applicationId to a template default, which surfaces much
later and much less legibly as `Unresolved reference 'R'` in Kotlin. `scripts/post-prebuild.mjs`
re-pins all of them, plus the light-only theme and two missing colour resources, in
sentinel-wrapped blocks. (The gradle.properties half of that list is ALSO applied by the
`withGradleProps` config plugin, from the same `scripts/gradle-props.cjs`, so it survives a
prebuild this script does not follow — see the EAS note above.) `pnpm prebuild` runs it — and so does `pnpm apk`, on every build,
because `android/` is gitignored and long-lived: the usual edit-JS-and-rebuild loop never
regenerates it and would otherwise never re-apply these. It also pins
`minSdkVersion=29` belt-and-braces: app.json's expo-build-properties plugin already emits
that during prebuild, but a hand-edited tree that drops below react-native-bare-kit's floor
of 29 hard-fails the manifest merger. It is idempotent, so running it by hand
against an existing `android/` tree is always safe:

```bash
node scripts/post-prebuild.mjs
```

Both platform APKs use the same content and tutor model. The app used to ship a second
"kitten" build (Sailor2-1B, CPU-only, 4 GB phones) whose prebuild stripped the Vulkan and
OpenCL backends out of the APK; that tier is retired. Do not re-add jniLibs excludes —
`libqvac-ggml-vulkan.so` is what the shipping model offloads to, and removing it fails
quietly (the APK builds, installs, and runs the 2B slowly on the CPU). post-prebuild
actively deletes those excludes if it finds them in a long-lived tree.

## First run: the downloads

The APK itself is a few hundred MB (app + bare worker + native engines + the **bundled**
card database and engraving art — 3,070 illustrations, 39,999,997 bytes, ship in the APK).
**No generation or embedding model weights are bundled.** English read-aloud is bundled;
the Tagalog voice downloads only when Tagalog is selected. All English, Tagalog, and
Cebuano text stays bundled. The release assumes PH internally and has no country picker.
Language and grade capabilities come from `src/config/edition.ts`; voice identities,
integrity pins, and APK delivery policy come from `assets/voices/catalog.json`.
Windows preserves its two bundled voices through `src/voice/bundled.web.ts`.
On first launch the app downloads, from the mirror
(`https://assets.hiraia.org/models/`, overridable at build time with
`EXPO_PUBLIC_ASSETS_BASE_URL`), everything listed in `src/config/model.ts`
`REMOTE_ASSETS`:

| asset | size | when |
|---|---|---|
| `hiraia-sft-2b-v2.Q4_K_M.gguf` | 1,274,396,160 B (~1.27 GB) | first run, blocking |
| `vectors-labse-90318bad81dd.i8.bin` | 122,162,688 B (~122 MB) | background; retrieval is lexical-only until it lands |
| `labse.Q4_K_M.gguf` | 383,762,048 B (~384 MB) | background; retrieval is lexical-only until it lands |

So a first run costs **~1.27 GB blocking** plus ~500 MB in the background (the fact
vectors and the LaBSE embedder share the readiness bar's semantic band). Separately and
**opt-out-able** (Settings, on by default), the reader's grade-cell art is backfilled
from `https://assets.hiraia.org/models/images/` `.hpak` packs — common plus the selected
grade packs, approximately 293–331 MB depending on grade with the 40 MB core selection.
The approved 3,070 images are pinned in `src/config/bundled-art.selection.json`.
The previous 42 download packs retain their exact filenames and bytes; 19 additional packs
carry the 9,079 images removed from the APK. `rag/pipeline/image-pack-layout.json` preserves
pack membership so later packaging does not reshuffle already downloaded images.

Rebuild illustrations in this order:

```bash
node --import tsx packages/mobile/scripts/build-art-pack.mts
node packages/mobile/scripts/gen-image-map.mjs
node packages/mobile/scripts/stage-bundled-art.mjs
python3 -B packages/mobile/scripts/package-art.py
```

Run those commands from the repository root. Stage the remote voice with
`node packages/mobile/scripts/stage-remote-voices.mjs`. It checks the local weights against
both vocabulary metadata and the delivery catalog, then emits the immutable filename in
`packages/mobile/build/voice-packages/`. Publish those voice files with
`deploy/publish-release-assets.py --asset ...` and the image packs with
`packages/mobile/scripts/publish-image-packs.py`, before distributing the new APK.
Tagalog voice transfer size is 56,346,485 bytes. Existing verified `voices/tl.onnx` files
migrate locally, so upgrades do not require that transfer. Voice downloads have their own
pause control and resume across interruption; speech controls appear when the selected
voice is ready. Cebuano has no trained voice and triggers no voice download.

`build-apk.sh` verifies the actual APK contains the approved image inventory, exactly the
bundled voice weights, and the complete current text database. Voice delivery changes are
part of the OTA runtime fingerprint and require a new APK.

There are **no LoRA adapters** any more. The shipping model is a FULL-PARAMETER SFT —
Tagalog, Cebuano and English all live in the one set of weights (`loraRemote` in
`config/model.ts` is empty BY DESIGN; the `LocalEngine.resolveAdapterPath` contract is
kept for any future adapter-ful model). The old Sailor2-era `assets/models/*.gguf` files
are still on disk only because they are the exact bytes once uploaded to the mirror —
`assets/models/` is in `.easignore` and `metro.config.js` deliberately does NOT register
`gguf` as an asset extension. Do not "restore" either.

Every downloaded byte is checked against a declared size + MD5 before it is installed
(`src/engine/modelDownload.ts`); a captive-portal login page can no longer be cached
forever as the model. RAG grounding is active for every language.

> For a demo where you can't wait on a 1.3 GB download, pre-seed the device once on Wi-Fi.

### ⚠️ Pre-ship step: the REMOTE_ASSETS must be live on the mirror FIRST

An APK whose pinned downloads are missing or stale on the mirror is broken in one of two
ways: a 404 on the base model bricks every launch ("model unavailable"), and a stale
vectors blob behind a current pin makes retrieval silently wrong (the blob is positional;
nothing compares its bytes against the bank at runtime — that is why its FILENAME embeds
the bank hash, and why the pin and the uploaded file must move together). Before every
ship, confirm each row of `REMOTE_ASSETS` against the mirror — name, size, and (for a new
upload) MD5 — and remember the on-device cache keys on FILENAME: changing an asset's
CONTENT requires a NEW filename or existing installs keep the old file forever.

```bash
# name + size (expect HTTP 200 and the exact `bytes` value from REMOTE_ASSETS):
for f in hiraia-sft-2b-v2.Q4_K_M.gguf vectors-labse-90318bad81dd.i8.bin labse.Q4_K_M.gguf; do
  curl -sIL "https://hiraia.org/models/$f" | grep -iE '^HTTP|content-length' | tail -2
done
# after uploading a NEW asset, derive its pin row from the exact bytes on the mirror:
#   stat -f%z <file>; md5 -q <file>; shasum -a 256 <file>
```

The digests the app enforces are pinned in `src/config/model.ts`. The vectors blob's
filename embeds `md5(science-facts.jsonl)[:12]` — after ANY bank edit, rebuild the blob
(`rag/scripts/build-vectors.py`), upload it under the NEW hash-embedded name, and repin
the row, or the tutor silently retrieves one fact and embeds another.

## Why no emulator?

QVAC's native inference does not run on Android emulators (per their docs) — you need a
physical device. On an Apple-Silicon Mac an arm64 emulator *might* load it CPU-only, but
it's unsupported and unverified. Plan to test on the real phone.

## Publishing the download (landing page)

Hiraia isn't on the Play Store, so the landing page proves legitimacy with two published
checksums. The values live in `packages/web/src/config/download.ts`; fill them after a
build and flip `released: true`.

```bash
# Download the APK from the EAS build page (or `eas build:download`), name it hiraia.apk.
# A LOCAL build is signed with the DEBUG keystore by default — re-sign it with the
# release key first (one-time: `npx eas-cli credentials` → download credentials.json):
#   packages/mobile/scripts/sign-apk.sh    # verifies against the pinned cert 40d750d5…
# All values below must be measured from the SIGNED APK.

# 1. APK file hash -> download.ts `sha256`
shasum -a 256 hiraia.apk            # Linux: sha256sum hiraia.apk

# 2. Signing certificate hash -> download.ts `signingCertSha256` (stable across releases)
#    Needs Android build-tools on PATH (apksigner). Look for the "SHA-256" cert digest.
apksigner verify --print-certs hiraia.apk
#    Or, since EAS holds the keystore:
npx eas-cli credentials   # Android > (keystore) > shows SHA-256 fingerprint

# 3. File size in MB -> download.ts `fileSizeMB`
du -m hiraia.apk
```

Then **host** `hiraia.apk` somewhere durable (a GitHub Release asset, or the VPS — the
published URL is `https://hiraia.org/models/hiraia.apk`) and set
`url` to that direct link. Set `version`, `fileSizeMB`, `sha256`, `signingCertSha256`, and
`released: true`. The site then shows the Download button + a "Verify it's the official
app" panel with both checksums and the commands above.

> The **signing-cert** hash is the stronger anchor: Android rejects any update not signed
> by the same key, and it doesn't change between releases — so reuse the same keystore for
> every build (EAS does this by default once credentials are created). That is also why
> the local `sign-apk.sh` path exists: it keeps the published anchor valid for local
> builds, so existing installs upgrade in place.

## Unified worktree build inputs (2026-09-19)

Build the student APK from `hiraia-unified` / `main`, using Node 22 and `pnpm apk`.
This wrapper enables `scripts/metro-static-asset-cache.cjs` only for the release build,
retains native Gradle caches, forces a fresh JS bundle, stages illustrations as native
assets, and verifies APK contents. Do not enable the static cache for `pnpm dev`.

On a fresh worktree, run `pnpm install --frozen-lockfile`, restore ignored
`assets/voices/en/model.onnx` (plus `tl/model.onnx` for Windows or voice publication)
matching each tracked `voice.json` SHA-256,
then run `python3 ../../rag/pipeline/build-cards-db.py`. The database builder records
a new content hash in the resident index; keep that generated change with the build.
The release wrapper rejects missing or mismatched voice weights before Gradle.
The 2026-09-19 verified originals remain in the student-nearby worktree and in
`/Users/luis/Code/hiraia-integration-backups/2026-09-19/voices/`. These local weights
are not downloadable from a new Git clone alone. Do not use an older ONNX export
with the current metadata. `scripts/voice/package-voices.py` is for intentionally
packaging a newly selected export, not for bypassing an existing hash check.

Run `pnpm exec expo prebuild --platform android --no-install` and
`node scripts/post-prebuild.mjs` after changes to native plugins or dependencies.
In particular, student Nearby requires the tracked `modules/hiraia-tala/android`
module, camera permissions, and `withTalaNearby.js`; an old generated Android tree
does not acquire those changes from `pnpm apk` alone. The same goes for the LAN
download mirror (`src/config/assetMirror.ts`): it needs the `modules/hiraia-managed-config`
module, which reads the mirror address the provisioning DPC sets, and
`withAssetMirrorCleartext.js`, which lets release builds fetch from it over plain HTTP.
Without them the app simply never uses a mirror. Do not run a clean prebuild
over locally customized native files without preserving them first.

## OTA JS updates (expo-updates, 0.4.24+)

From 0.4.24 an installed APK can take a **JS-only** update without a new APK: a new
Hermes bundle (plus any small new Metro assets) for the SAME native build. Everything
native — a dependency, a config plugin, `app.json`, the QVAC engines, the bundled art —
still needs an APK, and the runtime version enforces that on the phone (below). 0.4.23
and older have no expo-updates; they reach 0.4.24 through the APK channel only.

How a phone behaves (`src/updates/ota.ts`, `src/store/updateStore.ts`):

- **Cold start on Wi-Fi** (`checkAutomatically: WIFI_ONLY`): the native module asks
  `https://hiraia.org/api/updates/manifest` and downloads a newer update in the
  background. Launch never waits (`fallbackToCacheTimeout: 0`); the update runs from the
  NEXT cold start. Never on mobile data.
- **Settings → Check for updates**: checks and downloads on any network (the reader
  asked), then does the APK check as before. A staged update shows one line —
  "Hiraia will update the next time you open it" — and no banner.
- **Every 6 h in the foreground**, never during a model transfer: the manifest only, and
  only a rollback directive is acted on — so a phone that lives on prepaid data still
  gets pulled back off a bad update.
- JS never calls `reloadAsync()`: reloading with the QVAC worker or ONNX sessions alive
  can orphan a loaded model.
- A crash before first render marks the update failed and relaunches the previous one.
  Anything later (the tutor, sync, a `dlopen` at model load) needs a server-side rollback.
- The sidebar's version row shows the running update's short id next to the build number;
  telemetry can carry `otaTelemetry()` (`ota_update_id`, `ota_runtime`).

### Release order: the server side goes FIRST (0.4.24, Tala 0.4.4)

Every 0.4.24 `session_started` carries `ota_update_id`, and Tala 0.4.4 relays that key.
The collector 0.4.23 talks to rejects any prop key it does not know, and **a rejection is
final**: the phone's outbox deletes the event (logging `queue_dropped`), and Tala marks the
relayed row `rejected` and never retries it. So no 0.4.24 phone or Tala 0.4.4 — **test
devices included** — may sync with hiraia.org until all of this is live:

1. Commit and push `packages/web` (the `ota_update_id` allowlist in
   `src/lib/telemetry/store.ts` and the `/api/updates/manifest` route); run
   `deploy/update.sh` on the VPS.
2. Redeploy the telemetry collector — **`update.sh` does not**. nginx sends
   `/api/telemetry/batch` to the standalone collector (`hiraia-telemetry`, `127.0.0.1:8136`,
   running `/opt/hiraia-telemetry/server.cjs`), a separate bundle of the same `store.ts`.
   From that commit, `bash tools/pilot-telemetry/build-server.sh` (plain JS, so the Mac is
   fine), copy `packages/web/.telemetry/server.cjs` to `/opt/hiraia-telemetry/server.cjs`
   on the VPS, then `systemctl restart hiraia-telemetry` (layout:
   `tools/pilot-telemetry/PILOT-DASHBOARD.md`; `docs/APP-VERSION-REPORTING.md` set the
   same rule for its fields).
3. Check both:
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -H 'expo-protocol-version: 1' https://hiraia.org/api/updates/manifest
   #   400 = the route is live (a 404 = the old web build)
   curl -s https://hiraia.org/api/telemetry/batch -H 'content-type: application/json' -d '{"schema":1,"installation_id":"release-smoke-ota-0p4p24","events":[{"id":"release-smoke-ota-0p4p24-1","name":"session_started","occurred_at":'"$(date +%s000)"',"session_id":"release-smoke-ota-0p4p24-s","props":{"ota_update_id":"embedded"}}]}'
   #   {"acknowledged":["release-smoke-ota-0p4p24-1"],"rejected":[]} — "rejected" = the old collector: STOP
   ```
   The POST records that one designated synthetic event; remove just it from both stores
   afterwards, as `PILOT-DASHBOARD.md` requires. (An old collector's rejection stores nothing.)
4. Only then install 0.4.24 or Tala 0.4.4 on any device, upload the APKs or the
   `hiraia.apk` alias, move the `download.ts` / `tala-download.json` pointers (a second
   commit + `update.sh`), or publish an OTA.

The same rule holds for any later release that adds a telemetry prop key.

### It needs a prebuild

The updates server is ours, not EAS: `app.json` keeps `extra.eas.projectId` for EAS
Build only. Never run `eas update` or `eas update:configure` — they would repoint
`updates.url` at `u.expo.dev`, and the URL is permanent (it scopes every downloaded update).

`app.json`'s `updates` block and `runtimeVersion` are **baked at prebuild**: the URL, the
Wi-Fi-only check, the code-signing certificate and `expo_runtime_version =
file:fingerprint` go into the generated manifest and `strings.xml`. Change any of them —
or `version` / `versionCode` — and `pnpm prebuild` again, or the APK ships the old values
(the same trap as versionCode). `pnpm apk` then refuses an APK that is not OTA-ready:

- `createReleaseUpdatesResources` (expo-updates' gradle task, which writes the embedded
  `assets/app.manifest` and `assets/fingerprint`) has no file inputs, so its output is
  deleted before every build like the JS bundle's, and an `UP-TO-DATE` run of it fails
  the build;
- the finished APK must contain both files, its `assets/fingerprint` must equal
  `npx expo-updates fingerprint:generate --platform android` for this tree, and its
  manifest must say updates enabled, this URL, `WIFI_ONLY`, and `file:fingerprint`.

### The runtime version is a fingerprint

`runtimeVersion: { policy: "fingerprint" }`: a phone only accepts an update whose runtime
equals the hash in its own APK. The default fingerprint covers `app.json`, the config
plugins (and what they `require`), every autolinked native module and React Native's
version. `fingerprint.config.js` adds what reaches the APK another way — the QVAC addon
versions and worker `bundleId` (from `qvac/addons.manifest.json`), the bundled
illustration inventory, `post-prebuild.mjs` / `illustration-assets.gradle` /
`stage-bundled-art.mjs`, `native/`, `qvac.config.json` and `certs/certificate.pem`. It
fails closed: in a tree that never ran prebuild (no `qvac/`) the command errors instead of
producing a fingerprint without those sources.

```bash
cd packages/mobile && npx expo-updates fingerprint:generate --platform android   # {"sources":[…],"hash":"<40 hex>"}
```

That is THIS tree's fingerprint. The runtime the phones run is the one baked into the APK;
wherever a command below takes `--runtime`, take it from the signed APK or
from the `"runtime"` of the `ledger:` line the publish printed — never from
`fingerprint:generate` on a checkout that has moved on since (any `app.json`, plugin or
script change gives another hash):

```bash
unzip -p packages/mobile/android/app/build/outputs/apk/release/hiraia-v0p4p24.apk assets/fingerprint
```

Consequence: **publish an OTA from the tree that built the APK** — tag each release and
cherry-pick JS fixes into a worktree at that tag. A fresh worktree also needs the build
inputs git does not hold (the voice `model.onnx` files, `assets/data/cards.db` and
`tokens.bin`, a prebuilt `qvac/`), with the same bytes, or the guards below refuse.

### Signing key custody

- The **private key** is `~/.hiraia/ota-keys/private-key.pem` (mode 600) on Luis's Mac.
  It never enters the repo (the root `.gitignore` covers `*.key`, **not** `*.pem`) and never
  the server: the route relays manifests signed at publish time.
- **Back it up now** to the password manager, with `public-key.pem` beside it. Losing it
  means no OTA can ever reach the APKs already installed; only a new APK with a new
  certificate recovers, and rotating the key costs the same.
- The **certificate** `certs/certificate.pem` is public and committed (CN=Hiraia, valid to
  2046-09-24). Prebuild inlines it into the APK; an expired certificate makes phones
  reject every update until a new APK ships.

### Publish

`deploy/publish-ota.py` (boto3 venv, same env file as `publish-release-assets.py`) is the
only thing that makes an update: it checks the tree against the SIGNED APK (clean git,
`PREFLIGHT_ONLY=1 scripts/build-apk.sh`, fingerprint equality, Hermes version, QVAC
`bundleId`), runs `expo export`, refuses new assets over 2 MB each / 5 MB total (content
goes by content pack or APK — never `cards.db`, `tokens.bin` or a voice by OTA), uploads
content-addressed objects under `assets.hiraia.org/ota/android/`, signs the manifest, and
flips the ring in `ota/android/<runtime>/channel.json`. Today's JS-only update is the
37.6 MB Hermes bundle (8–11 MB on the wire if the edge compresses it; the script measures).

```bash
PY=~/.venvs/hiraia-publish/bin/python; ENV=--env-file=/Users/luis/Code/hiraia/.env.cloudflare.local
APK=packages/mobile/android/app/build/outputs/apk/release/hiraia-v0p4p24.apk
RT=$(unzip -p $APK assets/fingerprint)                                # the runtime the phones run
$PY deploy/publish-ota.py --dry-run --apk $APK                       # everything local, nothing uploaded
$PY deploy/publish-ota.py $ENV --apk $APK --ring canary --canary-client <EAS-Client-ID>
#   cold-start the canary phone twice: the sidebar shows the new id; no [cardDb] re-copy
finetuning/eval/harness/run-harness.sh | tee /tmp/gate.log            # production needs a GREEN gate
$PY deploy/publish-ota.py $ENV --runtime $RT --ring production --promote --rollout 10 --gate-log /tmp/gate.log
$PY deploy/publish-ota.py $ENV --runtime $RT --ring production --rollout-only --rollout 100
```

A test phone's EAS-Client-ID: tap Check for updates on it, then read the newest
`[ota] … client=<id>` line in `pm2 logs hiraia-web` on the VPS. The same log carries
`[ota] LAUNCH FAILURE … failed=<ids> fatal=<text>` when phones report a failed launch —
**stop widening a rollout when those appear** (`--rollout-only --rollout 0` halts it; phones
that already took it need a rollback, below).

How the rings move (every flip prints what each ring now serves):

- Phones outside a production rollout get the **fallback**: the release it replaced, but
  only if that one had reached 100%. A release held below 100% (halted, or still going
  out) never becomes the fallback, so publishing its fix at 10% leaves everyone else on
  the last release that reached them all — not on the one you held back.
- Whenever production takes a new release (`--promote`, `--republish`, a direct publish,
  `--rollback-to-embedded`), the canary release is cleared and canary phones follow
  production again. Re-sizing (`--rollout-only`) leaves the canary alone.

### Roll back

Phones only move FORWARD (a newer `createdAt`), so pointing the channel back at an older
update does nothing. Either sign something new:

```bash
$PY deploy/publish-ota.py $ENV --runtime <fingerprint> --ring production --republish <last good update id> --rollout 100
$PY deploy/publish-ota.py $ENV --runtime <fingerprint> --ring production --rollback-to-embedded   # back to the APK's bundle
```

`<fingerprint>` is the APK's own (`unzip -p <signed apk> assets/fingerprint`, or the ledger
line — see "The runtime version is a fingerprint"). A rollback aimed at a runtime where no
update was ever published is refused before anything is signed, and the refusal lists the
runtimes that exist on R2: a brake on the wrong runtime would otherwise "succeed" while
every real phone keeps the bad update. Either rollback also clears the canary release, so
canary phones are rolled back with everyone else. Database migrations must stay
additive, because a crash on launch or `--rollback-to-embedded` runs older JS against the
newer database, and in the end that is the APK's embedded bundle, which no OTA can patch: an
OTA may only add tables, and columns that are nullable or have a default. It must never drop,
rename or retype a table or column, or add a constraint older writes could break. Every INSERT
in `src/telemetry/repository.ts` names its columns, so older JS survives added columns
(`tools/pilot-telemetry/repository.test.mts` enforces it).

## Private ChromeOS preview

The resizable large-screen layout uses 3.5 cards when readable, fewer for narrow windows
or enlarged text, and one with a screen reader. A mixed ARM/Intel/AMD fleet also requires
native x86_64 QVAC libraries: the released QVAC npm engines supply only Android ARM64.

```sh
node scripts/build-qvac-android-x64.mjs
HIRAIA_APK_VARIANT=chromeos-preview pnpm prebuild
HIRAIA_APK_VARIANT=chromeos-preview bash scripts/build-apk-single.sh
HIRAIA_APK_VARIANT=chromeos-preview scripts/sign-apk.sh
```

Run the usual regression gate first. The source build requires NDK 29.0.14206865 and
downloads pinned public build dependencies into ignored `build/` directories. Use the
same variant flag for all three app commands. It selects both ARM64 and x86_64, verifies
the actual native binaries, and gives the preview a separate filename and OTA runtime.
The normal build continues to select ARM64. Neither variant changes the release version.

An Android large-screen AVD does not validate ChromeOS ARC or managed-school installation.
QVAC currently documents physical Android ARM64 support; the x86_64 source port is
experimental until exercised on the target runtime. Requirements, evidence and remaining
acceptance work: [ChromeOS adaptation](../../docs/CHROMEOS-20260929.md).

## Image-pack coverage gate

After changing card grade assignments, curriculum tags, bundled art or image shards, run:

```sh
# From packages/mobile; local scripts only, no model/API calls.
python3 scripts/package-art.py
pnpm qa:images
```

The packer audits the candidate before updating `imagePacks.generated.json`.
`pnpm apk` also checks the actual pack hashes and complete Grade 3–10 coverage.
A fresh worktree needs the `.hpak` files in `build/image-packs`; the command above
rebuilds them deterministically from tracked images and shard inventories.
If it changes manifest filenames, publish and verify those immutable packs with
`scripts/publish-image-packs.py --env-file <private-R2-env-file>` before distributing
an APK that references them. Old packs must remain for older installed versions.
See `docs/IMAGE-PACK-COVERAGE-2026-09-19.md` at the repository root for this repair.
