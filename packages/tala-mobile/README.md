# Tala mobile — V1 development client

Expo SDK 54, React Native 0.81.5, Hermes, TypeScript; no navigation framework, UI kit, animation or chart dependency. All code is confined to this package. Public demo packaging is documented in [DEMO-APK.md](./DEMO-APK.md); native reference-phone acceptance remains separate.

## Run and verify

Use pnpm **9.15.9** from the worktree root:

```
pnpm install --filter '@hiraia/tala-mobile...' --ignore-scripts
pnpm --filter @hiraia/tala-mobile type-check
pnpm --filter @hiraia/tala-mobile test
pnpm --filter @hiraia/tala-mobile export
```

The export uses one Metro worker, emits Android Hermes bytecode, then verifies its magic and ≤6,000,000-byte size (aim 4,000,000), exactly one font file, and ≤1,000,000 bytes of exported images. `budget` can rerun the gate against `dist`. The Android JS export does **not** verify native build compatibility, APK/installed size, memory, battery or reference-phone performance. Do not run Gradle on the shared worker host.

`EXPO_PUBLIC_TALA_API_URL` selects the API origin (public configuration, never a secret). Default origin is `https://tala.hiraia.org`; no deploy, OTA/update URL/channel or remote mutation was performed during development. Session tokens and the database key are stored only in SecureStore. Tests use isolated SQLite files/in-memory transports, no production API.

## Android isolation and deliberate future cutover

`app.config.js` obtains the application ID from **one** definition in `config.cjs`: `TALA_ANDROID_APPLICATION_ID`, default **`com.hiraia.tala.next`**. The internal slug is `tala-next`; the visible name is Tala. A regression check protects the default from becoming the live 0.4.x ID. No signing key or existing version-code sequence is configured; no `expo-updates` dependency or OTA channel is present.

Switching to `com.hiraia.tala`, using the pilot signing identity and a version code above the then-current 0.4.x release is a **deliberate cutover decision by Luis (ACT-2)**, not a normal build. Do not obtain or reference the pilot signing material in this development package. The existing Kotlin and student apps remain independent; a future Nearby port copies code into this package.

## Storage and sync

`src/storage/store.ts` implements the complete LocalStore interface, including physical `remove` purges. WAL + FULL synchronous mode and exclusive transactions make record/outbox/cursor writes durable before resolution; a failed batch rolls back. Tests reopen real SQLite files and exercise failed writes, purge and lost-response replay through the real shared engine.

`src/storage/native.ts` uses the expo-sqlite SQLCipher config plugin, a random 256-bit database key in SecureStore, and checks `cipher_version` **before** creating/opening app tables. It fails closed if encryption is absent. **Expo Go cannot run this encrypted configuration**; a native development/release build is required. SQLCipher/WAL encryption, backup policy and key availability after Android restore/uninstall remain device verification gates. The local key is never logged. No silent plaintext fallback exists.

`src/runtime/runtime.ts` wires the actual shared `createSyncEngine` to `createTalaClient`, secure bearer tokens, 60-second request timeouts, durable device identity and approximate weekly application-byte accounting. The foreground scheduler is single-flight and retries with jittered exponential backoff; after five waiting attempts it keeps trying on a background cadence/network events. BackgroundTask is opportunistic, with no persistent wake lock. OS scheduling and permission behavior need real-phone testing. The outbox/cursor resume record transfers; large attachment range/resume is not implemented.

Local sessions are retained for at least 30 offline days; expiry enters readable/exportable rung 4 without deleting records or showing a sign-in wall over them. Different owner IDs cannot be mixed into an existing account store. Sign-out refuses while writes are unsent, then revokes the session and clears account data. Account export/deletion UI is not yet present.

## Screens and design

`src/App.tsx` contains sign-in/register, one-sitting class setup with default weekdays/50-minute timetable and starting competency choice, a one-tap fictional multi-grade sample, exactly four labelled bottom destinations, local timeline/lessons, structured lesson read/edit, explicit lock/unlock confirmations, marks with Undo, no-class previews (absorb/shift/compress) across affected grade tracks, stacked conflict choice, Class and five-item Settings. DLL/per-group/multi-grade content renders as stacked cards. Lessons may use DLP, DLL or multi-grade built-in templates. Shared lock validation and content fingerprint helpers are used.

Lesson text is written through a serial durable save queue on every change; pending local drafts overlay background refreshes. History snapshots precede edits/restores/conflict choices. Retention keeps ten **synced** previous versions per section and never prunes unsent snapshots. The four-rung state machine covers data saver, metered/slow/server-down/offline, full storage, expired sessions and incompatible format. Low storage pauses reference downloads; low-memory mode disables image policy while keeping text.

All palette, font and size values use core tokens; only Fraunces SemiBold is bundled as a font, with its OFL license. Body text uses the system font. The copied Hiraia PNG supplies a labelled glyph in the app; the existing Tala SVG launcher artwork is preserved locally for the native packaging step. Native launcher raster/adaptive icon integration remains to verify. No decorative motion. Controls are 48 dp minimum with 8 dp gaps. Timeline, lesson, Community, import-review and manual learner lists are virtualised. KeyboardAvoidingView and scrollable forms preserve access to fields/actions; 320 dp and 200% font-scale behavior still requires real-device checks.

Filipino is the default; every interface key is paired in `src/i18n/fil.ts` / `en.ts`. Native review is requested for “I-lock/I-unlock”, “palugit” (buffer), “competency”, “Ipinapalagay na naituro”, “Pangkat”, “Mas detalyado”, and the realignment phrases. No unverified official curriculum text is invented: sample calendar/objectives/roster are explicitly fictional. Real packs/presets are downloaded and cached by version; calendars must retain upstream provisional labels.

## PDF

`src/runtime/print.ts` now calls **the real shared** `renderPlanHtml` / `renderPlanText`; Expo Print uses shared `printPageSize` for paper/orientation. Header context, draft watermark, lock fingerprint, font embedding, glyph and signature lines come from the common renderer. Export waits for acknowledged local saves, then snapshots the plan/sections. Fallback order is on-device PDF → no-images retry → shared printable text share → explicit server PDF offer while online. Cancel suppresses subsequent share/fallback results; the native Expo Print call itself exposes no cancellation primitive and may finish in the background. Native visual equivalence, accented glyphs, PDF size and ≤10 s reference-device timing are unverified.

## Remaining work / release gates

- The public demo Android build and smoke-test receipt are recorded in DEMO-APK.md / DEMO-VERIFICATION.md. All physical reference-device hard budgets and five-teacher unaided usability gates remain open. No deployment is performed by this worker.
- Setup, creation, generated drafts/revisions, roster saves, realignment and Undo use the shared atomic batch. Incompatible multi-grade plan moves block Apply rather than silently choosing dates.
- First-run curriculum area is Science; subject text is editable but does not select another pack area. Add proper learning-area selection, timetable editing, complete starting-position browse (beyond the first 20 quick picks), school-year editing and class Advanced controls.
- Month view is a summary, not the complete lower-resolution per-subject month browser. At-risk and behind counts exist; superseded-pack notifications, older-plan pinning and realignment recomputation after remote pacing conflicts need UI completion.
- Shared `section_revision` history is stored; restore currently restores the newest previous section from the plan, not a full section-by-section history browser. Roster conflicts need their row-choice UI.
- Format-blocked and OS Data Saver conditions are supported by the ladder but need config/native signal wiring; cellular metering and measured slow responses are wired. Low-memory drops image policy, but full retained-screen/cache eviction and reference-phone editor profiling remain open.
- Generation, roster import and Community are implemented (WAVE2.md). Only Class activity remains a later-wave placeholder. Offline Community copies retain lineage but do not yet register a server copy-count event on reconnect.
- No resumable attachment transport, image resizer, Wi-Fi OTA mechanism, account export/delete/reset/verification UI, or end-to-end server sync/real-phone test is claimed.

Generation uses durable idempotency keys, resumable polling/cancellation, prefilled offline/failure templates and explicit reviewed application. Roster parsing is local for TXT/CSV, with cloud-route consent, five review actions, partial atomic saves and frozen confirm retries. Community uses cached offline details, exact shared publish cleaning, local detectors and a durable post queue. All use the real typed client and shared helpers; test network transports are isolated fixtures.

For the optional, side-by-side on-device AI build, see [QVAC-IMPLEMENTATION.md](QVAC-IMPLEMENTATION.md). `TALA_QVAC=1` is a native build choice; changing an environment value in an installed standard APK cannot enable QVAC. Always use the variant build script with a clean prebuild. The existing public standard APK is not overwritten by that script.

The current worker dependency isolation fix, combined mobile/web clean-install proof and replacement QVAC APK measurements are in [QVAC-ISOLATION.md](QVAC-ISOLATION.md).
