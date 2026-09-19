# Building the Hiraia Android APK

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

## Build a shareable APK with EAS (recommended)

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

## Local build (alternative — needs the full Android toolchain)

Only if you want to build without EAS. Requires JDK 17, Android SDK, and **NDK
29.0.14206865** installed (e.g. via Android Studio), with `ANDROID_HOME` set.

```bash
cd packages/mobile
pnpm prebuild                     # generates android/, builds the QVAC worker bundle,
                                  #   then re-applies our native overrides
pnpm apk                          # APK at android/app/build/outputs/apk/release/app-release.apk
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

There is **one** native configuration and **one** APK. The app used to ship a second
"kitten" build (Sailor2-1B, CPU-only, 4 GB phones) whose prebuild stripped the Vulkan and
OpenCL backends out of the APK; that tier is retired. Do not re-add jniLibs excludes —
`libqvac-ggml-vulkan.so` is what the shipping model offloads to, and removing it fails
quietly (the APK builds, installs, and runs the 2B slowly on the CPU). post-prebuild
actively deletes those excludes if it finds them in a long-lived tree.

## First run: the downloads

The APK itself is a few hundred MB (app + bare worker + native engines + the **bundled**
card database and engraving art — the 12,374-illustration art pack ships in the APK).
**No generation or embedding model weights are bundled.** The English and Filipino ONNX read-aloud voices **are** bundled. On first launch the app downloads, from the mirror
(`https://hiraia.org/models/`, overridable at build time with
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
from `https://assets.hiraia.org/models/images/` `.hpak` packs — common (~222 MB) plus the
one grade cell (7–20 MB), ~230–240 MB total.

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

On a fresh worktree, run `pnpm install --frozen-lockfile`, restore the two ignored
`assets/voices/{en,tl}/model.onnx` files matching each tracked `voice.json` SHA-256,
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
does not acquire those changes from `pnpm apk` alone. Do not run a clean prebuild
over locally customized native files without preserving them first.
