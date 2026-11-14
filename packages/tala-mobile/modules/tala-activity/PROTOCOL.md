# Hiraia Tala classroom protocol, version 1 — as shipped by Tala 0.4.4 and the student app 0.4.24

This is the wire contract the `tala-activity` port must satisfy (PRD ACT-1, ACT-3). It is derived
from the code on both sides, not from prose, and every statement cites the file it comes from.
All paths are on the maintenance branch `tala-0.4.x` unless marked otherwise:

- **Teacher (authority):** `packages/tala/android/app/src/main/java/com/hiraia/tala/`
  `NearbyCollector.kt`, `ClassIdentity.kt`, `ClassHint.kt`, `ClassNames.kt`, `ManualEnrollment.kt`,
  `TalaDatabase.kt` (`ingest`), `EnrollmentQr.kt`.
- **Student (the other end):** `packages/mobile/src/tala/` `protocol.ts`, `qr.ts`, `manual.ts`,
  `sessionCore.ts`, `nearby.ts`, `scope.ts`; native `packages/mobile/modules/hiraia-tala/android/src/main/java/expo/modules/hiraiatala/`
  `TalaCrypto.java`, `TalaNearby.java`; tests `packages/mobile/scripts/tala-nearby.test.mts`,
  `tala-session.test.mts`.
- Prose that must stay true: `packages/tala/README.md` ("Nearby protocol, version 1", "Additions in
  Tala 0.4.4", "Manual enrollment without a camera").

Where the README and the code disagree, the code wins; no such disagreement was found.

## 1. Transport

| Item | Value | Source |
|---|---|---|
| Library | Google Play services Nearby Connections (`play-services-nearby` 19.4.0 on both sides) | `packages/tala/android/app/build.gradle`, `packages/mobile/modules/hiraia-tala/android/build.gradle` |
| Service id | `com.hiraia.classroom.v1` | `NearbyCollector.SERVICE_ID`, `TalaNearby.SERVICE_ID` |
| Strategy | `Strategy.P2P_STAR` on both sides. Teacher **advertises**; student **discovers**. | `NearbyCollector.start`, `TalaNearby.startDiscovery` |
| Teacher endpoint name (0.4.4+) | `"Hiraia Tala 2 " + hint` where hint is the 8-character class hint (§3). Tala 0.4.3 and older advertised the plain `"Hiraia Tala"`. A later Tala may list several hints after the prefix, comma-separated. | `ClassHint.kt`, `sessionCore.ts` `HINTED_ENDPOINT_PREFIX`, `endpointHints` |
| Student endpoint name | `"Hiraia"` (carries nothing). Names travel only inside encrypted payloads. | `TalaNearby.requestConnection` |
| Connection acceptance | Both sides accept every initiated connection automatically while running (`acceptConnection`); a Tala that is not collecting rejects. No authentication token is compared; trust comes from the class key (§4). | `NearbyCollector.connectionCallback`, `TalaNearby.connectionCallback` |
| Payload type | `Payload.Type.BYTES` only; other types are ignored. | both `onPayloadReceived` |
| Outer size limit | A received BYTES payload over **180,000 bytes** is dropped and the endpoint disconnected. The student refuses to send over 180,000 bytes. | `NearbyCollector.payloadCallback`, `TalaNearby.send`, `nearby.ts` `sendEnvelope` |
| Encoding | Every payload is UTF-8 JSON. Binary values are **base64url without padding** (`A-Za-z0-9_-`). Decoders accept padded or unpadded input. | `ClassIdentity.encode/decode`, `TalaCrypto.encode/decode`, `manual.ts` |
| Lifecycle | Teacher advertises only while the app is foregrounded and the teacher started collection (or opened Class QR). `onPause` stops advertising and all endpoints; `onResume` restarts if permissions and radios are ready. | `MainActivity.onPause/onResume`, `startCollection` |
| Radios / permissions (teacher) | Android 10+ (`minSdk 29`). API ≥ 31: `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`; API ≤ 31: `ACCESS_FINE_LOCATION`; API ≥ 33: `NEARBY_WIFI_DEVICES`. Manifest also declares `BLUETOOTH`/`BLUETOOTH_ADMIN` (maxSdk 30), `ACCESS_WIFI_STATE`, `CHANGE_WIFI_STATE`, `ACCESS_NETWORK_STATE` (Nearby returned code 8032 when the Wi-Fi state permissions were capped at Android 12). Bluetooth **and** Wi-Fi must be on; Google Play services must be available. | `MainActivity.requiredPermissions`, `startCollection`, `AndroidManifest.xml`, README "Version 0.4.1" |

Both phones need Google Play services. The two apps cannot talk on one device.

## 2. Enrolment QR

The QR value is the JSON text (compact, key order as produced by `org.json`):

```json
{"v":1,"kind":"hiraia-tala","class_id":"<uuid>","class_name":"<≤48 chars>","public_key":"<base64url SPKI DER of a 2048-bit RSA key>"}
```

- `class_id` is the class's **enrollment id**: a random UUID generated once per class
  (`TalaDatabase.createClass` → `enrollment_id`). It never changes for the life of the class; it
  is what students bind to and what the hint is derived from. (`ClassIdentity.classId`)
- `public_key` is `KeyStore.getCertificate(alias).publicKey.encoded` for the keystore alias
  `"hiraia.tala.class." + class_id`: an RSA-2048 key generated in **AndroidKeyStore** with
  `PURPOSE_DECRYPT`, digests SHA-256 and SHA-1, padding `RSA_OAEP`. The private key never leaves the
  keystore. Encoded form is X.509 SubjectPublicKeyInfo DER (294 bytes → 392 base64url chars).
  (`ClassIdentity.init`)
- `class_name` was added in Tala 0.4.3 (Sept 2026). It is **display-only and never blank**:
  `ClassNames.resolve(classId, typed)` returns the teacher's trimmed name or, when none is stored,
  a deterministic "Colour Animal" name from SHA-256(UTF-8(class_id)) (byte 0 mod 16 colours, byte 1
  mod 24 animals; lists in `ClassNames.kt`), then `.take(48)`. The student cleans it
  (`cleanClassName`: control chars → space, collapse whitespace, trim, slice 48) and **never rejects a QR
  for a bad or missing name**. (`ClassIdentity.qrPayload`, `qr.ts`)
- Student validation (`parseTeacherQr`): text ≤ 4096 chars; JSON object; `v === 1`; `kind ===
  'hiraia-tala'`; `class_id` matches the UUID regex
  `^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` (case-insensitive) — so
  **enrollment ids must be RFC 4122 UUIDs with a valid variant nibble**; `public_key` is base64url
  (≤ 2048 chars) decoding to DER of 270–400 bytes starting `0x30`, containing the rsaEncryption OID
  `2a 86 48 86 f7 0d 01 01 01`, length ≥ 290. Anything else is a `QrError`.
- Identity of a binding is `(class_id, public_key)` (`sameBinding`). Changing either is a different
  class for the student; renaming is not. **Therefore an in-place upgrade must keep both the
  enrollment ids and the keystore key pairs** (ACT-2).
- Teacher, school, grade and school year are shown beside the QR, not embedded in it.
- Rendering (teacher): zxing `QRCodeWriter`, EC level **H**, margin 4, 700 px, with a 90 px white
  rounded badge and a 54 px Hiraia glyph in the centre (`EnrollmentQr.kt`). The badge is cosmetic;
  any renderer of the same text is wire-compatible.

## 3. Class hint (Tala 0.4.4+)

```
hint = base64url_nopad( SHA-256( UTF-8("hiraia-tala-hint-v1:" + class_id) ) )[0:8]
endpoint_name = "Hiraia Tala 2 " + hint
```

Test vectors (both sides): `0f8fad5b-d9cb-469f-a165-70867728950e` → `WlOusN1s`;
`7c9e6679-7425-40de-944b-e07fc1f90ae7` → `x3ejyN5T`; the full name for the first is
`Hiraia Tala 2 WlOusN1s` (≤ 32 bytes). (`ClassHint.kt`, `ClassHintTest.kt`, `sessionCore.ts classHint`)

Student behaviour that depends on the name (`sessionCore.ts`):
- A hinted teacher is offered **only** the classes whose hint appears in the name (including a class
  the phone only owes a leave for). An unhinted name (`"Hiraia Tala"` or anything else) gets every
  class with students, one trial connection at a time.
- Leave notices (`left_profiles`) are sent **only** to a teacher whose name carries the class's hint.
- The hint is advisory: a wrong hint costs a wasted connection; only the class key can read a batch.

## 4. Session: challenge, envelopes, acknowledgements

### 4.1 Challenge (teacher → student, plaintext)

On a successful connection the teacher generates a fresh challenge — **24 random bytes, base64url
without padding (32 chars)** — stores it per endpoint, and sends:

```json
{"v":1,"type":"challenge","challenge":"<base64url-24-bytes>"}
```

(`NearbyCollector.onConnectionResult`, `ClassIdentity.challenge()`.) One challenge per connection; it
is the AAD of every AES-GCM operation on that connection and is echoed inside every encrypted body.
A connection whose challenge is unknown (payload before challenge, or after disconnect) is ignored.

### 4.2 Key wrap and envelope (student → teacher)

For each `intro` or `batch` the student generates a **fresh 32-byte AES key** and a **fresh 12-byte
nonce**, wraps the key with the QR public key using **RSA-OAEP, hash SHA-256, MGF1 with SHA-1,
no label** (`"RSA/ECB/OAEPPadding"` + `OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA1,
PSpecified.DEFAULT)`), and encrypts the UTF-8 inner JSON with **AES-256-GCM, 128-bit tag, AAD =
UTF-8(challenge)**:

```json
{"v":1,"type":"intro"|"batch","wrapped_key":"<b64url 256 bytes>","nonce":"<b64url 12 bytes>","ciphertext":"<b64url ct||tag>"}
```

(`TalaCrypto.encryptRequest`; teacher side `ClassIdentity.unwrapSessionKey` requires the unwrapped
key to be exactly 32 bytes, `ClassIdentity.decrypt` requires a 12-byte nonce.) The same session key is
reused by the teacher for the reply to that message only.

### 4.3 Inner body (`schema` 1)

```json
{
  "schema": 1,
  "class_id": "<must equal the teacher's enrollment id>",
  "installation_id": "<ID>",
  "challenge": "<must equal this connection's challenge>",
  "profiles": [{"id":"<ID or 'guest'>","name":"<1–40 chars>"}],
  "events": [{"id":"<ID>","name":"<allowed name>","occurred_at":<ms>,"props":{...}}],
  "left_profiles": ["<ID>"]          // optional, 0.4.24+, only to a hinted Tala
}
```

Teacher validation (`TalaDatabase.ingest`, `NearbyCollector.payloadCallback`), any failure
disconnects the endpoint and nothing of the message is kept:
- `v == 1`; `type ∈ {intro, batch, manual_enroll}`; decrypted body is JSON; `batch.challenge ==
  challenge`; serialized inner length ≤ **150,000** chars.
- `schema == 1`; `class_id == enrollment id` of the advertised class.
- `installation_id` matches **ID** = `[A-Za-z0-9_-]{16,80}`. Once an endpoint has sent an
  `installation_id`, every later message on that connection must carry the same one.
- An `intro` must have **zero events** (`require(events.length == 0)`); its purpose is the roster.
- `profiles.length ≤ 50`, `left_profiles.length ≤ 50`, `events.length ≤ 50`.
- Each profile: `id` matches ID, **or** is the literal `"guest"` when the name is `Guest`
  (case-insensitive); name trimmed, non-empty, ≤ 40 chars. A profile named `Guest` (any id) is a
  Guest and is stored under a `Guest-XXXXXX` alias (6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`,
  unique per class, case-insensitive) rather than the sent name.
- Each event: `id` matches ID, else the **whole message fails**. Then it is *rejected* (listed in
  `rejected`, not stored) when `name` is not in the allow-list below, or `occurred_at` is outside
  `[1577836800000, 8640000000000000]`, or `props` is missing / not an object / serializes to more
  than **1,600** chars, or the derived profile id is neither `guest` nor an ID. Otherwise *accepted*.
  The event's learner is `props.profile_id` when `props.profile_kind == "student"`, else the phone's
  Guest row (created on demand).
- Event name allow-list (teacher 0.4.4): `first_open, profile_updated, session_started, card_viewed,
  quiz_shown, quiz_answer_submitted, quiz_graded, download_started, download_resumed, download_failed,
  download_cancelled, download_installed, asset_available, model_load_started, model_ready,
  model_load_failed, generation_started, generation_completed, generation_failed, queue_dropped`.
  The student additionally knows `assessment_completed` (`protocol.ts TEACHER_EVENTS`) but sends it
  **only** when the teacher's `caps` include `assessment_summary_v1` (`nearby.ts noteReply`,
  `queue.pending(..., assessmentsSupported)`); Tala 0.4.4 does not advertise that cap and would
  reject the event. The port keeps the 0.4.4 behaviour (cap not advertised).
- `correct` is stored as `props.correct == true` (quiz events).

Student limits mirror these (`protocol.ts`): `MAX_PROFILES 50`, `MAX_EVENTS 50`, `MAX_NAME 40`,
`MAX_PROPS 1600`, `MAX_OUTER 180_000`, `MAX_INNER 150_000`, plus its own `SYNC_BATCH_BYTES 90_000`
per inner batch (`assessmentProtocol.ts`).

### 4.4 Duplicate handling and acknowledgement semantics

- Events are keyed `(class, installation_id, event_id)` and inserted with `INSERT OR IGNORE`: a
  resend is harmless and is **re-acknowledged as accepted** (the student deletes on ack; a lost ack
  only causes a resend). A resend whose *content* now fails validation is rejected, the stored copy
  stays. (`TalaStorageTest.introDoesNotMarkSyncedAndRetriesDoNotDoubleCount`)
- An event for a learner the teacher **removed** (§6) is acknowledged as accepted but not stored.
- Reply bodies: `accepted` and `rejected` list only ids from this message; the student's `applyAck`
  fails the session (`ids`) if an id is unknown or listed twice, and treats ids in neither list as
  "retry". `accepted ∪ rejected` is deleted from the student queue; `rejected` increments the phone's
  `dropped` counter. An `ack` whose `challenge` differs is rejected (`applyAck`, `ready-challenge`).
- The student sends batches until a batch comes back for an **empty** `events` array; it then marks
  the class synced for this burst (`sendNextBatch`: `didEmptyBatch`). **The teacher must therefore
  acknowledge an empty batch** with empty lists; `ingest` does so and leaves the device's last
  accepted/rejected counts unchanged when `events` is empty.
- `devices.last_sync`/`last_seen`: an `intro` only touches `last_seen`; a `batch` sets both and, when
  it carried events, `last_accepted`/`last_rejected` for the "last batch" diagnostics.

### 4.5 Reply (teacher → student): `ready` / `ack`

Encrypted with the **same AES key the message was wrapped with**, a fresh 12-byte nonce, AAD =
UTF-8(challenge):

```json
{"v":1,"type":"ready"|"ack","nonce":"<b64url 12>","ciphertext":"<b64url>"}
```

plaintext:

```json
{"challenge":"<echo>","accepted":["<event id>"],"rejected":["<event id>"],"class_name":"<≤48>","caps":["left_profiles"]}
```

`ready` answers an `intro`, `ack` answers a `batch` (`NearbyCollector.reply`). `class_name` is
`ClassIdentity.displayName(stored name)` — identical to the QR's — and `caps` lists the protocol
extensions this Tala honours (0.4.4: exactly `["left_profiles"]`). Student builds before 0.4.24
ignore both keys. The student stores `class_name` from a `ready`/`ack` and, if `caps` contains
`left_profiles`, deletes the leave tombstones it sent in that message.

Reply ordering: the teacher sends `ready`/`ack` **after the SQLite transaction committed**, and only
if the connection still holds the same challenge (`running && challenges[endpointId] == challenge`).

### 4.6 Session state (teacher side)

```
connected ──send challenge──▶ awaiting-intro ──intro ok──▶ ready sent ──batch ok──▶ ack sent ──…
      any failure (parse, v, type, size, wrong class, wrong challenge, OAEP, GCM, ID, intro-with-events,
      installation change, >3 manual attempts) ──▶ disconnectFromEndpoint; the student treats a
      disconnect before `ready` as "this teacher does not hold my class key" (sessionCore.rejected)
      and tries its next class (unhinted) or gives up on this teacher.
```

The teacher does not require an `intro` before a `batch` in code (both go through `ingest`); the
student always sends `intro` first. Per-connection state the teacher keeps: challenge, bound
installation id, manual-enrol attempt count. `stop()` clears all three and calls `stopAdvertising`
+ `stopAllEndpoints`. A per-connection failure is reported to the UI as "transfer failed" when the
failing message was a `batch`, else "connection failed".

## 5. Manual (typed-code) enrolment, no camera

Teacher state: one `EnrollmentTicket(enrollmentId, code, expiresAt)` at a time, for the **active**
class, valid **one hour**, regenerated when expired / class changed / teacher taps "Refresh QR Code"
/ app restarts (`ManualEnrollment.current/clear`). `code` is 12 chars from
`ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no 0, 1, I, L, O), displayed as `XXXX-XXXX-XXXX`. The code is
not an encoding of the key: it authenticates a Nearby exchange that delivers the exact QR JSON.

After the normal `challenge`, the student sends one plaintext BYTES payload (≤ 2048 bytes):

```json
{"v":1,"type":"manual_enroll","client_nonce":"<b64url 16 random bytes>","proof":"<b64url HMAC-SHA256>"}
```

with (`manual.ts`, `ManualEnrollment.respond`), where `code` is the normalised 12 uppercase
characters without hyphens and `||` is byte concatenation:

```
secret       = SHA-256( UTF-8("hiraia-tala-manual-v1:") || ASCII(code) )
proof        = HMAC-SHA256( secret, 0x01 || UTF-8(challenge) || client_nonce )
response_key = HMAC-SHA256( secret, 0x02 || UTF-8(challenge) || client_nonce )
response_AAD =                      0x03 || UTF-8(challenge) || client_nonce
```

Teacher checks: an unexpired ticket exists for this class; `v == 1`, `type == manual_enroll`;
`client_nonce` decodes to exactly 16 bytes; `proof` equals the expected HMAC (constant-time
`MessageDigest.isEqual`); at most **3** attempts per connection. On success it replies, plaintext
outer JSON:

```json
{"v":1,"type":"manual_key","nonce":"<b64url 12>","ciphertext":"<b64url AES-256-GCM(response_key, nonce, AAD=response_AAD, plaintext=QR JSON)>"}
```

The plaintext is **byte-for-byte the QR payload currently shown** (name included, so typing and
scanning yield the same class name). The student decrypts, validates with `parseTeacherQr`, persists
the binding, then continues on the **same connection with the same challenge**: `intro`, then
batches. Any failure (bad code, bad nonce, too many attempts) disconnects; the student counts an
unreadable `manual_key` as a failed attempt and moves to the next teacher in range. The code,
proof and plaintext are never logged.

## 6. Roster semantics: enrolment per class, leaving, removal, Guests

(`TalaDatabase.ingest`, `removeStudent`, `students`; README "Additions in Tala 0.4.4".)

- **Per-class, per-profile membership.** Student 0.4.24+ joins each profile to its own class and
  sends a class only the profiles that joined it. Student builds ≤ 0.4.23 bound the whole phone to
  one class. Both are accepted; the teacher does not distinguish them.
- **Listing = membership.** Every profile in `profiles` is upserted (name updated) and its `left_at`
  cleared: being listed again undoes a leave.
- **Leaving.** `left_profiles` ids that are valid IDs and *not* also in `profiles` get `left_at =
  now` if not already set (a retried leave keeps the first date). Invalid entries are skipped
  silently; the message is still accepted. A left learner disappears from tiles and counts (events
  kept, shown as "Left <date>" in the spreadsheet) and returns if listed again.
- **The Guest.** The phone's Guest travels under `profile.id == installation_id` (`scope.ts
  wireId`) with name `Guest`. Older builds (≤ 0.4.23) left a `profile_id == "guest"` placeholder row
  by sending Guest-kind events without listing anyone. When a Guest profile arrives for a phone that
  has a `guest` placeholder, the placeholder's events and avatar are moved to the new id and the
  placeholder row deleted, keeping its `Guest-…` alias unless the teacher had removed it. A leave for
  `installation_id` also marks the phone's `guest` placeholder (same Guest). An `intro` with **no
  profiles and no leaves** creates a Guest row for the phone (older phones that list no one); an
  intro with no profiles **but a leave** does not.
- **Remove from class (teacher action).** Sets `removed_at`, deletes the learner's events (and
  anything pending for upload in 0.4.x). The phone is never told: its later events for that profile
  are **acknowledged as accepted and discarded**, and listing the profile does not bring it back.
  Only the removed profile is affected; other profiles on the same phone are unaffected. Exception: a
  removed `guest` placeholder does not block a Guest that later joins *by name* on that phone — that
  Guest appears as a new tile under a new alias (the removed alias is never reused).
- **Recovered student.** An accepted event whose profile has no row creates one named
  `"Recovered student"`, so history never lands on nobody.
- **Avatars.** Animal index = SHA-256(UTF-8(`"hiraia-tala-avatar-v1\0" + installation_id + "\0" +
  profileKey`))[0] mod 12, colour = byte[1] mod 6, where `profileKey` is `"guest"` for a Guest
  (`profile_id == "guest"` or name starting `Guest-`) else the profile id. Saved on first sight per
  class and never recomputed (`RosterIdentity.kt`, `TalaDatabase.rosterCards`). Display names
  collapse whitespace; duplicates (NFKC, case-insensitive) get `-2`, `-3`… in sorted order.

## 7. Version negotiation

There is none beyond the fields above. `v` (outer) and `schema` (inner) are both `1` and must stay
`1`; every 0.4.4 addition is optional and ignored by older peers:

| Capability | Teacher signals | Student reacts |
|---|---|---|
| Class hints in endpoint name | `"Hiraia Tala 2 …"` prefix | Connects only to its own classes; sends leaves |
| `class_name` in QR and replies | present | Names the class; never required |
| `left_profiles` | `caps` contains `left_profiles` | Deletes tombstones on reply |
| `assessment_completed` events | `caps` contains `assessment_summary_v1` (not in 0.4.4) | Only then sends them |

A future Tala may add caps; a future student must keep working against `caps: ["left_profiles"]`.

## 8. Compatibility checklist for the port (what §1–§7 require of `tala-activity`)

1. Advertise `com.hiraia.classroom.v1`, `P2P_STAR`, name `"Hiraia Tala 2 " + hint(enrollment id)`.
2. Accept all connections while collecting; send the 24-byte challenge immediately on success.
3. RSA-2048 key per class in AndroidKeyStore under alias `hiraia.tala.class.<enrollment id>`
   (same alias as 0.4.x so an in-place upgrade finds the existing keys), OAEP SHA-256/MGF1-SHA1
   unwrap, 32-byte session key; AES-256-GCM 128-bit tag, 12-byte nonce, AAD = challenge.
4. Enforce every limit in §4.3 exactly; ids `[A-Za-z0-9_-]{16,80}`; event allow-list unchanged.
5. `ready`/`ack` with `challenge`, `accepted`, `rejected`, `class_name` (= QR name), `caps:
   ["left_profiles"]`, sent only after commit; ack empty batches.
6. Dedupe on `(class, installation_id, event_id)`; re-ack duplicates; ack-and-drop for removed learners.
7. Manual enrolment exactly as §5, ≤ 3 attempts per connection, one-hour ticket per active class.
8. Enrollment ids are RFC 4122 v4 UUIDs; class names never blank (`ClassNames` fallback), ≤ 48.
9. Never put names in the endpoint name; never log codes, proofs or plaintext.
