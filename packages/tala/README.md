# Hiraia Tala

Hiraia Tala is the Android teacher companion for the Calapacuan Grade 6 pilot. It targets
Android 10+ and collects classroom activity locally with Google Nearby Connections.
Both apps must be open in the foreground during collection. The teacher phone does not
need an internet connection.

## Current teacher build

- Shows a three-step, swipeable first-launch tutorial explaining Tala, student QR
  enrollment, and nearby classroom monitoring. It ends at the dashboard and does not
  reappear after the teacher selects **Get Started**.
- Stores editable class, teacher, school, grade and school-year details. Settings opens
  as a full-screen panel with the classes on this phone and reusable teacher and school
  lists. Grade is selected from 1–12 when adding or editing a class. Tap a class to
  activate it, or swipe the dashboard horizontally.
  The active class has its own QR identity and roster. Enter its teacher name before
  showing the QR with **Show QR Code**.
- Displays the selected class's branded QR code with Tala's public key, letting a student
  encrypt telemetry and locally saved profile names for this teacher phone.
  The small central Hiraia glyph uses high QR error correction; decoding is tested at
  full and on-screen sizes, but real-phone camera testing is still needed.
- Shows a temporary 12-character `XXXX-XXXX-XXXX` code for a broken student camera.
  It works only while Tala is collecting that class and expires after one hour. The QR
  payload itself stays stable; **Refresh QR Code** rotates the temporary backup code.
- Advertises a Nearby `P2P_STAR` endpoint while the teacher taps **Collect activity** or
  opens **Class QR**, and Hiraia Tala is foregrounded. Wait for **Nearby ready** before
  scanning on a student phone. Tala shows permission, Bluetooth and advertising errors
  on the dashboard and QR screen. A same-room reminder appears beside collection and
  on the QR screen so teachers do not expect remote collection over the internet.
  There is no per-student Bluetooth pairing screen.
- Accepts encrypted batches, commits them to an app-private SQLite database, then sends
  an acknowledgement. Duplicate event IDs are harmless.
- Starts with an empty roster and adds a tile only after a phone connects. Guests get
  distinct persistent aliases. Duplicate learner names gain stable numeric suffixes.
  Animal and color come from the student's stable installation and profile IDs, so
  the same student phones get the same avatars on a replacement Tala phone even if
  the class or school is entered differently.
  A tile lights up only while connected; after disconnecting, it fades to half opacity.
  Tap a learner to open a near-full-screen carousel and swipe between learners. Each
  card shows a table of totals, activity by type, and every event from the last seven
  days (including older activity Tala received recently). Tap a recent event to see
  its complete stored properties; the timeline loads 50 rows at a time. Card views count every view;
  unique cards count distinct `card_id` values in accepted `card_viewed` events.
  The last nonempty batch's accepted/rejected counts remain visible.
- A student whose phone reports that their profile left the class disappears from the
  tiles and counts; they come back if that profile joins again. **Remove from class** at
  the bottom of a student's page (after a confirmation) deletes that student's activity
  from Tala, including anything not yet uploaded, and hides them everywhere. It is
  permanent: the phone is not told, and whatever it later sends for that student is
  acknowledged and discarded. Other students on the same phone are unaffected. The one
  exception is a `Guest-…` placeholder that a student build up to 0.4.23 left without
  naming anyone: removing it does not stop that phone's Guest from later joining the
  class, which then appears as a new Guest under a new alias.
- **Share XLSX** beside Classroom exports the active class only, with class details,
  each learner's totals, and all stored event rows. Students who left stay in it with a
  `Left <date>` status; removed students do not. Tala creates the workbook offline
  and opens Android's share sheet. It contains student names and event properties, so
  share it only with trusted recipients. The export is a snapshot, not automatic upload.
- Saves issue reports offline with up to three JPG, PNG, WebP or MP4 attachments
  totaling at most 10 MB. No teacher upload-key setup is required. Android queues delivery for
  the next internet connection and retries failures; **Send pending reports** can
  be used while online. **Share report text** is a text-only fallback. Reports and
  media arrive in the protected admin page; Resend emails a link, not student media.

The student implementation is developed separately from Tala. Verify the installed
student APK against this teacher build before the pilot. The current student build
keeps a separate teacher queue. The next build pages all retained card and quiz
history when joining (the v0.4.17 APK restores only seven days). Delivery ACKs
are scoped to the current class/public key; a new pairing resets them atomically. This does not
modify the mothership outbox. While foregrounded, Hiraia keeps looking for Tala
at 10–15 minute intervals, backing off to 30 minutes after repeated misses.

See [activity relay and recovery](../../docs/TALA-ACTIVITY-RECOVERY.md) for the
next build’s teacher upload labels, offline queue, and reinstall recovery.

## Build

The September 20 public pilot release is **v0.4.1, Android versionCode 16**.
This intentionally renumbers the display version after v0.7.5 (code 15); Android
uses the increasing code for upgrades. The release variant retains the existing
pilot signing identity so teachers can update without uninstalling or losing data.
The new URL is `https://assets.hiraia.org/models/tala-v0p4p1.apk`; older
`hiraia-tala-v0p4p1-*-debug.apk` artifacts remain immutable historical builds.
Install Hiraia and Tala on separate phones: Nearby cannot transfer activity between
both apps running on one device.

The project uses the existing Android Gradle wrapper generated under
`packages/mobile/android`. With JDK 17 and the Android SDK installed:

```sh
cd packages/tala
JAVA_HOME=/path/to/jdk17 ANDROID_HOME=/path/to/android-sdk pnpm apk
```

The test APK is `android/app/build/outputs/apk/debug/app-debug.apk`. It is debug-signed;
do not distribute it as a final school release. The package is `com.hiraia.tala`, so it
does not conflict with the student app.
Since `0.3.0`, each class has one enrollment QR. Version `0.4.0` removes groups while
preserving each class's QR identity, roster, activity and saved issue reports. Existing
`0.1.x` default-class bindings and the first group's `0.2.0` QR per class remain valid;
students bound to another `0.2.0` group QR must re-scan the class QR. Switching classes
stops the old class's collection and rotates its temporary code; start collection for
the newly active class.
Version `0.4.1` replaces the grade catalog with a fixed 1–12 selector and starts
collection when Class QR opens so student enrollment does not race advertising. It
also retains Wi-Fi state permissions on newer Android versions: Nearby returned
missing-permission code `8032` when those permissions were capped at Android 12.
Version `0.5.0` keeps existing QR identities and activity while adding connection
recency, guest aliases and full activity-count diagnostics. A teacher APK cannot
recover events the student APK never queued or sent; if a tile still shows only one
stored event after syncing, inspect the student-side teacher-sync outbox and the
last-batch rejected count before changing Tala's event allowlist.
Version `0.5.1` adds plain-language same-room reminders on the dashboard and QR screen.
Version `0.6.0` adds the student activity carousel and offline class XLSX sharing.
Version `0.7.0` changes classroom status icons to fill/pulse/ring states, updates the
same-room reminder, and adds offline media issue reports with queued upload.
Version `0.7.1` removes the status legend. Disconnected animals appear at half opacity;
connected animals use full opacity; transfers pulse. A red ring marks connection or
transfer errors, with half or full animal opacity respectively. A green ring marks a
completed transfer while the phone remains connected. Each animal and background color
is derived from the student's installation and profile IDs with SHA-256, then saved
on first sight so later metadata edits or app updates cannot change existing avatars.
Guest profiles use a common guest profile key so a placeholder-to-guest-profile handshake
keeps its avatar. The ordered animal and color palettes and hash inputs are part of
this mapping contract; do not reorder them without a migration. This is a one-time
remapping from older Tala versions, whose name-based avatars could not be reproduced
reliably on a replacement teacher phone. A student-app reinstall that changes both
IDs also changes the avatar unless a future identity-recovery mechanism is added.
Version `0.7.2` checks selected media before adding it to an issue report. Videos
and images over the remaining 10 MB allowance are rejected immediately, with a
clear prompt to choose a shorter clip. The save path repeats the size check.
Version `0.7.3` removes the teacher upload-key setup. Reports queue offline and
upload when the phone reconnects; the server validates and rate-limits anonymous
submissions and isolates image/video processing before allowing admin review.
Version `0.7.4` rejects videos longer than a minute before adding them to a report,
matching the server's media processing limit. Version `0.7.5` adds the classroom
tutorial and makes the selected classroom and its student count clearer on the dashboard.

With an Android emulator or phone connected, run the encryption and storage checks with
`../mobile/android/gradlew -p android connectedDebugAndroidTest` from `packages/tala`.

## Nearby protocol, version 1

All JSON is UTF-8. The service ID is `com.hiraia.classroom.v1`. Both sides use
`Strategy.P2P_STAR`: Tala advertises the selected class and student apps discover.
The QR format remains unchanged: its `class_id` is the class's enrollment identity.
Teacher, school, grade, class and year are shown beside the QR, not embedded in its JSON.
The QR value is:

```json
{"v":1,"kind":"hiraia-tala","class_id":"uuid","public_key":"base64url-DER-RSA-public-key"}
```

After both apps automatically accept the Nearby connection, Tala sends a `BYTES`
payload `{"v":1,"type":"challenge","challenge":"base64url-random"}`. The student
generates a fresh random 32-byte AES key and wraps it with the QR public key using RSA
OAEP with SHA-256 and MGF1-SHA1. It encrypts the following JSON with AES-256-GCM using
that AES key, a fresh 12-byte nonce, and the challenge's UTF-8 bytes as associated data:

```json
{
  "schema": 1,
  "class_id": "uuid",
  "installation_id": "existing-student-installation-id",
  "challenge": "challenge-from-tala",
  "profiles": [{"id":"student-profile-id","name":"student profile name"}],
  "events": [{"id":"existing-event-id","name":"card_viewed","occurred_at":1234567890000,"props":{"profile_kind":"student","profile_id":"student-profile-id"}}]
}
```

The encrypted outer payload is
`{"v":1,"type":"intro","wrapped_key":"base64url-RSA-OAEP-ciphertext","nonce":"base64url","ciphertext":"base64url"}`.
Send `intro` first with the current profiles and an empty `events` array. Tala saves the
roster, shows those students as **Connected**, and replies with an encrypted `ready`
envelope containing `{"challenge":"...","accepted":[],"rejected":[]}`. Then send
one or more envelopes with `type:"batch"` containing the events. Each batch can use a
new AES key and wrapped key. Send at most 50 profiles and 50 events per message. Names are sent inside the encrypted
payload, never in the Nearby endpoint name. Only the teacher phone holds the private key.
The QR is the enrollment invitation: show it only to the intended class.

After each batch's SQLite transaction commits, Tala sends an AES-GCM encrypted `ack` envelope
using the batch's AES key, a fresh nonce and the same associated data. Its plaintext is
`{"challenge":"...","accepted":["event-id"],"rejected":[]}`. A student retries
unacknowledged IDs. Tala deduplicates by `(installation_id,event_id)`, so a lost
acknowledgement does not duplicate activity. The student should send its current profile
list on each connection so name changes reach Tala. Student builds up to 0.4.23 bind the
whole device to one class; from 0.4.24 each profile joins its own class, and a phone sends
each class only the profiles that joined it.

### Additions in Tala 0.4.4

These keep `v` and `schema` at 1 and the service ID unchanged; older students ignore them.

- **Class hint.** Tala advertises the endpoint name `"Hiraia Tala 2 " + hint` instead of
  `"Hiraia Tala"`, where `hint` is the first 8 characters of
  base64url-without-padding(SHA-256(UTF-8(`"hiraia-tala-hint-v1:" + class_id`))) and
  `class_id` is the QR's. A later Tala may list several hints, comma-separated. Test
  vectors: `0f8fad5b-d9cb-469f-a165-70867728950e` → `WlOusN1s`,
  `7c9e6679-7425-40de-944b-e07fc1f90ae7` → `x3ejyN5T`. The hint is advisory; only the
  class key can read a batch.
- **Reply additions.** `ready` and `ack` plaintexts also carry `"class_name"` (the name the
  QR would show, at most 48 characters) and `"caps":["left_profiles"]`.
- **Leaving.** An intro or batch may carry `"left_profiles":["profile-id"]` (at most 50).
  Tala marks each listed student that is not also in `profiles` as having left; being
  listed in `profiles` again undoes it. Ids that are not valid ids are skipped. The Guest's
  id is the phone's `installation_id`; a leave for it also marks the `guest` placeholder
  that a build up to 0.4.23 may have left for that phone, which is the same Guest. An intro
  with no profiles but a leave does not create a Guest tile. The student deletes a leave
  once the `ready` or `ack` for the message carrying it arrives, and sends it only to a
  Tala whose endpoint name carries the matching hint.

### Manual enrollment without a camera

The 12-character code is **not** a shortened encoding of the RSA public key. It is
a short-lived secret used to authenticate a Nearby exchange that delivers the exact
QR JSON. It uses uppercase letters and digits `2`–`9`, excluding `0`, `1`, `I`, `L`
and `O`; hyphens are only for display. It expires after one hour or when the
teacher taps **Refresh QR Code**, changes classes, or restarts the app. The teacher must tap
**Collect activity** for the selected class.

After receiving Tala's normal `challenge`, the student sends one `BYTES` payload:

```json
{"v":1,"type":"manual_enroll","client_nonce":"base64url-16-random-bytes","proof":"base64url-HMAC-SHA256"}
```

Normalize the typed code to 12 uppercase unhyphenated characters. Calculate:

```text
secret       = SHA256(UTF8("hiraia-tala-manual-v1:") || ASCII(code))
proof        = HMAC-SHA256(secret, 0x01 || UTF8(challenge) || client_nonce_bytes)
response_key = HMAC-SHA256(secret, 0x02 || UTF8(challenge) || client_nonce_bytes)
response_AAD = 0x03 || UTF8(challenge) || client_nonce_bytes
```

Tala checks the proof against the active class's unexpired code and replies with
`{"v":1,"type":"manual_key","nonce":"base64url-12-random-bytes","ciphertext":"base64url-AES-GCM"}`.
Decrypt with AES-256-GCM, the `response_key` and `response_AAD`. The plaintext is the
same QR JSON shown on screen. Validate and persist it as if scanned, then send the
normal encrypted `intro` and `batch` on this connection using the current challenge.
Invalid codes are disconnected; Tala limits attempts per connection. Do not log the
code, proof or plaintext. Real-device interoperability testing is still needed.

Nearby may use Bluetooth, BLE or Wi-Fi without internet. Android permission prompts
appear once; later class sessions require only **Collect activity**. The app stops
advertising when backgrounded. Both phones need Google Play services.
