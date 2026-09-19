# Agent task: student-side Nearby sync for Hiraia Tala

Implement the **student Hiraia Android app** side of the existing Hiraia Tala teacher
companion. This is for a several-month pilot with 35 Grade 6 pupils at Calapacuan
Elementary School, Subic, Zambales. Student devices are Redmi 14C phones; the teacher
phone can be any Android 10+ phone with Google Play services. Assume **no internet on
student phones during normal school days**. The teacher should collect activity once or
twice daily while both apps are open and foregrounded. There is no requirement to sync
when either app is backgrounded, locked, or killed.

## Where to work and what to read

- Implement against the **profile-aware pilot student app**, not the older student code
  on the `question-cards` worktree. As of this handoff it is in
  `/Users/luis/Code/hiraia-unified/packages/mobile` (Expo SDK 54, React Native 0.81,
  Android package `com.hiraia.app`). Recheck the active release branch before editing.
- The teacher implementation and test APK are in
  `/Users/luis/Code/hiraia/packages/tala`. Read `README.md`,
  `android/app/src/main/java/com/hiraia/tala/NearbyCollector.kt`,
  `ClassIdentity.kt`, and `TalaDatabase.kt` there. **Those Kotlin files are the wire
  protocol and validation authority** if this handoff differs from code.
- The teacher debug APK is
  `/Users/luis/Code/hiraia/packages/tala/android/app/build/outputs/apk/debug/app-debug.apk`.
  If absent, build it from `packages/tala` with JDK 17, Android SDK, and `pnpm apk`.
  It is debug-signed; do not mistake it for a school release.
- Student integration points: `src/telemetry/index.ts`, `core.ts`, `repository.ts`,
  `src/profiles/index.ts`, `src/telemetry/TelemetrySettings.tsx`,
  `src/app/(tabs)/sidebar.tsx`, `src/app/_layout.tsx`, `app.json`, and `plugins/`.
  Generated `packages/mobile/android/` is not the sole source of truth: native changes
  must survive Expo prebuild and the APK build script.
- Preserve unrelated work in both worktrees. Do not change the Tala protocol or teacher
  APK silently to make the student implementation pass.

## Required experience

1. Add a clear **Join Hiraia Tala / Scan teacher QR** action plus **Enter code instead**
   for a broken camera. Scan offline with the camera; validate the QR before storing
   anything. A typed code uses the manual Nearby exchange below and ends with the
   exact same validated QR payload. Explain that
   scanning permits **that teacher device** to receive this phone's learning/activity
   telemetry **and locally saved student profile names**. This is separate from the
   existing anonymous mothership telemetry. Make the disclosure understandable to a
   teacher/student and available in the app's supported languages.
2. Persist a single device-level binding to the teacher's `class_id` and public key.
   In Tala `0.4.0`, each **class has one QR and `class_id`**. Classes are the smallest
   roster unit; there are no groups or group assignments. Do not ask the student to
   select a group or treat `class_id` as a school-level ID. Editing class metadata
   does not change its QR identity. Switching the active class changes the advertised
   QR and collection scope.
   All student profiles on that phone are covered; changing the active profile does
   not change the teacher binding. Re-scanning the same QR is idempotent. Rebinding to
   a different teacher needs an explicit confirmation and safe handling of any unsent
   old-teacher events. Provide **Leave class / Stop sharing**; it stops future teacher
   collection and clears unsent teacher-bound data, but must not claim to erase data
   already stored on the teacher phone.
3. When bound and foregrounded, automatically discover Tala once the teacher taps
   **Collect activity**, connect, and sync without Android's individual Bluetooth
   pairing workflow or 35 manual connection approvals. Android's one-time Nearby,
   Bluetooth, camera, and (where applicable) location permission prompts are okay.
   Offer a visible **Sync now / Retry** action and simple states such as searching,
   connected, sending, synced today, and actionable error. Never block lessons because
   the teacher is absent or radios are unavailable. Stop discovery/connections on
   background; no foreground service or background work is required.
4. Send current profile names and queued telemetry via the exact protocol below.
   The Tala dashboard must show a student's animal tile as connected on `intro`,
   transferring during `batch`, and synced today after a successful `batch`. Send an
   **empty batch after `ready`** when there are no events so Tala can mark today's
   check-in. A device with multiple profiles should appear as multiple roster rows,
   with each event attributed to the profile active when the event occurred.
5. Keep a **separate durable teacher-sync journal/outbox**. The current mothership
   `outbox` is deleted after server acknowledgement and is bounded by age/size;
   reusing it would lose offline teacher data, especially on the weekly internet
   update day. Capture the same safe telemetry events into a teacher-specific queue
   once binding is active, independent of mothership upload/ACK. Do not backfill
   pre-binding events or invent historical names. Store pending data across app
   restarts, updates, and weeks without connectivity. Use atomic writes with the
   existing telemetry repository where practical; do not slow the learning path on
   radio failures. Bound storage with an explicit overflow/loss signal rather than
   silently dropping months of data.
6. Honour the existing telemetry-off setting: do not send or newly collect
   teacher-bound events while telemetry is disabled, and clear pending teacher
   events on opt-out. Make the Settings wording precise: the mothership does not
   receive names, **but a QR-bound teacher does**. Do not send question/answer text,
   exception strings, passwords, or raw user content; only existing approved event
   names/props and the explicitly disclosed profile names.

## Exact Tala protocol, version 1

All messages are UTF-8 JSON in Nearby `BYTES` payloads. Tala advertises; student
discovers and requests a connection. Use service ID `com.hiraia.classroom.v1` and
`Strategy.P2P_STAR` on both sides, with `play-services-nearby:19.4.0` for compatibility
with the teacher build. Both sides may auto-accept the Nearby transport connection.
Do **not** advertise the student's name, profile ID, or event data as the Nearby
endpoint name. Nearby may select Bluetooth, BLE, or local Wi-Fi; no internet is
required, but do not promise Bluetooth-only operation without real-device testing.
Declare `ACCESS_WIFI_STATE` and `CHANGE_WIFI_STATE` without an Android-version cap
on both APKs. Nearby advertising on an Android 14 test emulator failed with missing
Wi-Fi-state permission code `8032` when the teacher manifest capped them at API 31.

Teacher QR text:

```json
{"v":1,"kind":"hiraia-tala","class_id":"teacher-class-uuid","public_key":"base64url-DER-SPKI-RSA-public-key"}
```

Validate version, kind, class UUID, key encoding and RSA key type/length; reject
malformed, oversized, or unrelated QR codes. Persist the exact teacher public key.
No secret is in the QR. Tala's private RSA-2048 key stays in Android Keystore.
Teacher/class/grade/year/school are displayed on the teacher QR screen. These labels are **not** added
to the QR JSON, preserving the existing scanner format.

### Typed-code alternative to scanning

The current Tala APK shows a **temporary 12-character** `XXXX-XXXX-XXXX` code on the
QR screen. This is shorter than a permanent 16-character key, but it expires after
one hour or when the teacher taps **Refresh QR Code**, switches class, or restarts. It is not
the RSA key encoded in 12 characters. The student must be near the teacher and both
apps foregrounded; Tala must be collecting. Normalize the code to uppercase, strip
hyphens/spaces, and allow exactly 12 characters from
`ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0`, `1`, `I`, `L`, or `O`). Do not store the
code as the class binding or log it.

After receiving Tala's normal `challenge`, send one `BYTES` message (max 2,048 bytes):

```json
{"v":1,"type":"manual_enroll","client_nonce":"base64url-16-random-bytes","proof":"base64url-HMAC-SHA256"}
```

Calculate these bytes exactly:

```text
secret       = SHA256(UTF8("hiraia-tala-manual-v1:") || ASCII(code))
proof        = HMAC-SHA256(secret, 0x01 || UTF8(challenge) || client_nonce_bytes)
response_key = HMAC-SHA256(secret, 0x02 || UTF8(challenge) || client_nonce_bytes)
response_AAD = 0x03 || UTF8(challenge) || client_nonce_bytes
```

Tala verifies the proof against the selected class's active code. On success it
returns `{"v":1,"type":"manual_key","nonce":"base64url-12-random-bytes","ciphertext":"base64url-AES-GCM"}`.
Decrypt with AES-256-GCM using `response_key` and `response_AAD`. Its plaintext is
the same QR JSON the camera would scan. Validate it, persist that class binding,
then send the ordinary encrypted `intro` and `batch` on the **same connection and
challenge**. Invalid/expired codes are disconnected; show a simple retry message.
Do not send the code or username in plaintext. See `ManualEnrollment.kt` in Tala.

**Handshake, in order:**

1. Student discovers Tala, calls `requestConnection`, and accepts the connection.
   Tala accepts automatically. Handle connection failure/timeout/retry; do not assume
   35 simultaneous connections are supported. Use bounded, randomized backoff so the
   class does not stampede the teacher's phone.
2. Tala sends plaintext
   `{"v":1,"type":"challenge","challenge":"base64url-24-random-bytes"}`.
3. For the request, generate a fresh cryptographically random **32-byte AES key** and
   **12-byte GCM nonce**. RSA-wrap the AES key with the QR public key using **OAEP
   SHA-256 with MGF1-SHA1** (explicit parameters; MGF1-SHA256 will not interoperate).
   Encrypt the inner JSON using **AES-256-GCM, 128-bit tag**, with the challenge's
   UTF-8 bytes as AAD. Base64url-encode binary fields without padding or line breaks.
4. First send an `intro` outer envelope, with an **empty `events` array** and the
   current profile list. Tala saves the roster and responds with encrypted `ready`.
   Verify/decrypt it with the intro AES key and challenge before claiming connection.
5. Send serial `batch` envelopes with up to **50 events** and **50 profiles** each.
   Use a fresh AES key and nonce per envelope and retain that key until its ACK is
   verified. Include the current profile list on connection and after name changes;
   chunk it if necessary rather than silently omitting profiles. Wait for each `ack`
   before sending the next batch. Send one empty batch if there are no pending events.
6. Tala replies with encrypted `ack` **after SQLite commit**. Validate `v`, `type`,
   challenge, GCM authentication, and every ID in `accepted`/`rejected` against the
   outstanding batch. Delete only explicitly acknowledged IDs from the teacher queue.
   Treat `rejected` as terminal but surface/count the loss; retry unmentioned IDs.
   On timeout/disconnect, retain the full unacknowledged batch. Tala deduplicates by
   `(installation_id,event_id)`, so retry after a lost ACK is safe.

Inner `intro`/`batch` JSON (same shape, with `events:[]` for `intro`):

```json
{
  "schema": 1,
  "class_id": "teacher-class-uuid",
  "installation_id": "existing-student-installation-id",
  "challenge": "challenge-from-tala",
  "profiles": [{"id":"existing-profile-id","name":"Student One"}],
  "events": [{
    "id":"existing-event-id",
    "name":"quiz_graded",
    "occurred_at": 1780000000000,
    "session_id":"existing-session-id",
    "props":{"profile_kind":"student","profile_id":"existing-profile-id","correct":true}
  }]
}
```

Outer request JSON (set `type` to `intro` or `batch`):

```json
{"v":1,"type":"batch","wrapped_key":"base64url-RSA-OAEP-ciphertext","nonce":"base64url-12-byte-nonce","ciphertext":"base64url-GCM-output-including-tag"}
```

Tala responses omit `wrapped_key` and use the request's AES key and challenge as AAD:

```json
{"v":1,"type":"ack","nonce":"base64url-12-byte-nonce","ciphertext":"base64url-GCM-output-including-tag"}
```

The decrypted `ready`/`ack` content is
`{"challenge":"same-challenge","accepted":["event-id"],"rejected":[]}`;
`ready` has empty arrays. Tala's hard limits: outer payload **180,000 bytes**,
decrypted JSON text **150,000 characters**, at most 50 profiles and 50 events,
profile names 1–40 characters, IDs matching `[A-Za-z0-9_-]{16,80}`, and serialized
event `props` no more than 1,600 characters. Keep batches comfortably below limits,
including UTF-8 expansion. `occurred_at` is Unix epoch milliseconds; send the existing
event ID/name/time/props unchanged so retry deduplication and per-profile attribution
work. Teacher accepts `first_open`, `profile_updated`, `session_started`,
`card_viewed`, `quiz_shown`, `quiz_answer_submitted`, `quiz_graded`,
`download_started`, `download_resumed`, `download_failed`,
`download_cancelled`, `download_installed`, `asset_available`,
`model_load_started`, `model_ready`, `model_load_failed`,
`generation_started`, `generation_completed`, `generation_failed`, and
`queue_dropped`. Unknown names are rejected. Check `TalaDatabase.kt` before release.

## Native/Expo implementation constraints

- A web-only or Expo Go implementation is insufficient; Nearby Connections needs an
  Android native bridge. Prefer a small Expo module or persistent React Native native
  module plus an Expo config plugin. Native source, Gradle dependency, desugaring,
  permissions, and manifest changes must survive `expo prebuild` and
  `packages/mobile/scripts/build-apk.sh`. Do not rely on editing generated Android
  files alone.
- Nearby 19.4.0 requires core-library desugaring; the teacher uses
  `com.android.tools:desugar_jdk_libs:2.1.5`. Request runtime permissions appropriate
  to Android 10–15, including legacy fine location where required, Bluetooth scan/
  connect on Android 12+, and Nearby Wi-Fi devices where required. Request camera
  permission for QR scanning. Check Google Play services availability and show a
  usable error if absent. Do not request a background location permission or build
  a background service for this pilot.
- Keep RSA/AES operations off the JS/UI thread if they can stall it. Avoid logging
  profile names, plaintext telemetry, QR content, or session keys. Do not mark a
  teacher as trusted merely because a Nearby endpoint has the right display name;
  successful decryption/authentication of `ready` proves possession of the scanned
  teacher key. A captured QR is a classroom enrollment capability, so explain to
  the teacher that it should only be shown to the intended class.

## Acceptance tests and delivery

- Add automated tests for QR validation, typed-code proof/key interop, exact RSA-OAEP/GCM interop, ACK validation,
  queue persistence and independence from mothership ACK, retries/deduplication,
  empty check-in, profile rename/switch/multiple profiles, opt-out/unbind, and app
  foreground/background transitions. Teacher-side crypto/storage instrumentation
  tests are in `packages/tala/android/app/src/androidTest/`.
- Build a student APK from the current pilot app, install it on a Redmi 14C, and
  install the **exact Tala test APK above** on a separate teacher phone. With the
  teacher phone offline and both apps foregrounded, first enter the teacher name in
  Tala Settings, then open **Class QR** or tap **Collect activity** on Tala and wait
  for **Nearby ready** before scanning on the Redmi. Verify the
  animal tile/name appears, changes through connected/transferring/synced, and shows
  card/quiz/error counts. Repeat with a second Redmi 14C and an Android 10+ teacher
  phone. Test with internet unavailable but Bluetooth and Wi-Fi radios on; separately
  test Bluetooth-only if feasible. Repeat enrollment by typing the temporary code
  with the camera permission denied. Create a second class in Tala, activate it from
  Settings, and swipe between classes. Verify the QR changes with the active class
  and the rosters and activity counts never mix. No Bluetooth Settings pairing
  should be needed.
- Force a disconnect before an ACK, restart each app, sync again, and verify exactly
  one card/quiz count per event. Verify pending events survive a mothership upload,
  a student app restart, and a week with no internet. Test no-events check-in,
  teacher pause/resume, rejected/invalid QR, permission denial/recovery, profile
  rename, different-teacher rebind, and telemetry opt-out.
- Deliver code, tests, an installable student APK, and concise setup/test notes. State
  explicitly which physical-device scenarios were and were not verified. Do not mark
  this feature complete from emulator-only tests: Nearby radio behavior and 35-phone
  contention require real-device trials. Teacher issue-draft sharing and automatic
  mothership issue upload are **not** student-side tasks.
