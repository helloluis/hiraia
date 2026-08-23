# Building the Hiraia Android APK

The mobile app runs the Sailor2 model **on-device** via the QVAC SDK (a bare-runtime
worker embedded through `react-native-bare-kit`). That means **it cannot run in Expo
Go or in a JS-only build** — it needs a native build with the QVAC config plugin, and
per QVAC's docs it runs on a **physical Android 12+ device only** (not emulators).

This doc covers producing a **shareable release APK** via EAS (cloud build — no local
Android toolchain needed).

## The card inventory is GENERATED — rebuild it before you build

The feed's content no longer lives in the JS bundle. Three artefacts are produced by
`rag/pipeline/build-cards-db.py` and shipped as they are:

| file | what it is | ships as |
|---|---|---|
| `src/generated/cardsIndex.generated.json` | ids, terms, slug, cats, topic, domain — everything sequencing reads | bundled (9.5 MB) |
| `assets/data/cards.db` | card text, titles, emphasis, MCQs, and the 46,177-token search index | asset (~16 MB in the APK, 51 MB once copied out) |
| `assets/data/tokens.bin` | each card's vocabulary as sorted int hashes, for `textJaccard` | asset (4.8 MB) |

```bash
python3 rag/pipeline/build-cards-db.py     # ~1 minute
```

**Nothing in the build regenerates these.** `build-apk.sh` compares their mtimes against
their sources and refuses to build if any is older, because a stale one ships silently and
the symptom is nearly unreadable: an edited card shows its OLD text, a re-matched
illustration shows the OLD picture, a newly added card is missing from search results but
present in the feed.

### Rebuild after ANY of these

- `src/generated/cardsPool.generated.json` changed — i.e. after `rag/pipeline/wire-app-pool.py`,
  which is itself what applies the editorial pass and the illustration re-match
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
- A physical **Android 12+** device with **6 GB+ RAM** (for Sailor2-3B). Target ABI is
  **arm64-v8a only** (the plugin strips other ABIs to shrink the APK).

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

## Local build (alternative — needs the full Android toolchain)

Only if you want to build without EAS. Requires JDK 17, Android SDK, and **NDK
29.0.14206865** installed (e.g. via Android Studio), with `ANDROID_HOME` set.

```bash
cd packages/mobile
npx expo prebuild -p android      # generates android/, builds the QVAC worker bundle
cd android
./gradlew assembleRelease         # APK at app/build/outputs/apk/release/app-release.apk
```

`android/` and `qvac/` are gitignored — both are regenerated by prebuild.

## First run: the model download

The APK itself is ~tens of MB (app + bare worker + native engines). The **LLM weights
are not bundled** — on first launch the app downloads the model set in
`src/config/model.ts` (`ACTIVE_MODEL`) and caches it:

- **Sailor2-3B (default):** ~3.2 GB, one-time, over Wi-Fi. Best quality.
- **Sailor2-1B (fallback):** ~739 MB — flip `ACTIVE_MODEL_KEY` to `'sailor2-1b'` in
  `config/model.ts` for a much lighter first-run download (4 GB phones / quick demos).

> For a demo where you can't wait on a 3.2 GB download, either pre-seed the device once
> on Wi-Fi, or ship the 1B build.

The fine-tuned Tagalog/Bisaya **LoRA adapter is not wired yet** (`loraSrc: null`), so the
**base** Sailor2 runs until we host the adapter GGUF and set its on-device path. RAG
grounding (the 305-fact bank) is active for both.

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

Then **host** `hiraia.apk` somewhere durable (a GitHub Release asset, or the VPS) and set
`url` to that direct link. Set `version`, `fileSizeMB`, `sha256`, `signingCertSha256`, and
`released: true`. The site then shows the Download button + a "Verify it's the official
app" panel with both checksums and the commands above.

> The **signing-cert** hash is the stronger anchor: Android rejects any update not signed
> by the same key, and it doesn't change between releases — so reuse the same keystore for
> every build (EAS does this by default once credentials are created).
