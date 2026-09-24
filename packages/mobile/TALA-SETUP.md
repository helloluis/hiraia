# Hiraia Tala — student Nearby (pilot)

Student-side classroom sync for the Calapacuan Grade 6 pilot. Teacher APK is
`packages/tala/android/app/build/outputs/apk/debug/app-debug.apk` in the hiraia
checkout (debug-signed). Protocol authority: Tala Kotlin.

## Integrated implementation

- Settings: **Join Hiraia Tala / Scan teacher QR**, **Enter code instead**, disclosure (EN/TL/CEB), **Sync now / Retry**, **Leave class**.
- **Per-student** binding to the **class** QR/`class_id` (0.4.24). Each profile, and the Guest, joins its own class on a shared phone, sends only its own name and activity to that teacher, and leaves without affecting the others. Settings acts on the student on screen. The current teacher companion is in `packages/tala`; class selection replaces the older group assignment UI. Re-scan same QR is a no-op. A different class asks confirmation and drops that student’s unsent old-class events (the UI only offers joining while unbound, so today that means Leave, then Join).
- Store (`hiraia-telemetry.db`): `teacher_bindings` (one row per scope: profile id or `guest`; class name, last sync and loss count per student), `teacher_outbox.scope`, `teacher_sent_scoped(class_id, id)` and `teacher_leaves`. Delivered ids are kept per class, so a student who returns to a class does not resend history.
- Wire (protocol v1, unchanged `v`/`schema`/`SERVICE_ID`): an intro or batch lists only the profiles bound to that class (the Guest as `{installation_id, "Guest"}`) and carries only their events. Classmates on one phone share one session.
- Finding the right teacher: Tala >= 0.4.4 advertises `"Hiraia Tala 2 " + hint(class_id)` (8 chars of base64url SHA-256 of `"hiraia-tala-hint-v1:" + class_id`), and the phone connects only where a hint matches. Tala 0.4.3 advertises plain `"Hiraia Tala"`: the phone offers its classes one connection at a time (student on screen first, then the most recently synced) and treats a disconnect before `ready` as "not this class". A connection that got `ready` is never offered a second class, because Tala 0.4.3 would paint that phone's tiles red. Decision logic: `src/tala/sessionCore.ts`.
- Leaving writes a tombstone. It is delivered as `left_profiles` only to a hinted Tala of that class, and deleted once its `ready` lists the `left_profiles` capability; undelivered tombstones expire after 30 days.
- Upgrade from 0.4.23 (one class per phone): nobody inherits the old class, so every student re-joins. Its delivered ids stay recorded for that class, and each student who existed before the upgrade sees a short re-scan notice for 30 days. 0.4.23 listed every profile on the phone in that class (or the Guest, as the installation id, when there was none), so the migration keeps the old class's key, and once the profiles have loaded it writes a leave tombstone for that class for each profile and for the Guest, except anyone already back in it; re-joining it later cancels that student's tombstone (`settleLegacyClass`, one transaction, once). These tombstones follow the rule above: only a Tala 0.4.4 of that class receives them, within 30 days of the upgrade. **A teacher still on Tala 0.4.3, or one the phone does not meet within those 30 days, keeps the 0.4.23 tiles of students who moved on: update to Tala 0.4.4 and use Remove from class on them.**
- Typed 12-character code (`XXXX-XXXX-XXXX`) uses the HMAC-SHA256 `manual_enroll` / `manual_key` exchange, then the same validated QR payload. The code is offered to one teacher in range at a time, in discovery order. A teacher that refuses it, cannot be reached twice (a failure while a sibling's sync holds the radio does not count), or is lost is skipped; the code stays pending for teachers found later in the burst, and when the burst ends unused the student sees "That code expired or is wrong".
- Separate `teacher_outbox` in `hiraia-telemetry.db`. Mothership ACK does not delete it.
- Native module `modules/hiraia-tala`: Nearby `com.hiraia.classroom.v1` / `P2P_STAR` / play-services-nearby 19.4.0, RSA-OAEP SHA-256 + MGF1-SHA1, AES-256-GCM.
- Empty batch after `ready` so Tala can mark today’s check-in with no events.
- While Hiraia is in the foreground it keeps looking for Tala and syncs on its own. No student tap. Radios stop when the app backgrounds. The teacher still taps **Collect activity**. A burst ends once every class on the phone has synced, or after 90 s; a burst in which the phone reached none of its classes' teachers (`ready`) counts toward the 30-minute backoff, even if some other class's teacher was in range. A long history that is still being delivered when the burst ends is not a miss.
- Joining pages that student's retained `card_viewed` / `quiz_graded` history into the teacher queue using the original event ids, skipping what the class already acknowledged. Teacher ACK is recorded in `teacher_sent_scoped` so a later sync does not resend. That path never writes the mothership outbox.
- History with no known owner is sent to no class (owner decision, 0.4.24). The Guest's history is only what was recorded as the Guest after profiles were recorded (`activity_details_since`, 0.4.15). Older rows carry `profile_id = 'guest'` only as the column default, and rows without an `activity_details` row name nobody; either could be any sibling, so neither is paged to any class. They still count in the phone's own activity screens.
- Telemetry-off clears teacher events and stops collection. Wording: mothership still has no names; a QR-bound teacher does.

## Build

From `packages/mobile` (JDK 17, Android SDK):

```sh
pnpm install
pnpm exec expo prebuild --platform android --no-install
node scripts/post-prebuild.mjs
pnpm apk
```

Install the student APK on a Redmi 14C. Install the **exact** Tala debug APK on a second Android 10+ phone. Both apps foregrounded, teacher offline, Bluetooth and Wi-Fi radios on. Scan QR, tap **Collect activity** on Tala.

## Tests run here

```sh
cd packages/mobile && pnpm qa:tala   # tala-nearby + tala-session
/opt/homebrew/bin/node --import tsx --test tools/pilot-telemetry/repository.test.mts   # from the repo root; better-sqlite3 is built for Node 26 here
```

Covers QR validation, typed-code normalize/proof/AES-GCM roundtrip, ACK rules, empty check-in, queue independence from mothership ACK, per-student routing and leave, event/profile sanitization (`tala-nearby`); grouping, class hints (shared test vectors), hinted vs trial connections, one class per connection, burst completion and backoff, `left_profiles` only to hinted teachers (`tala-session`); and, against real SQLite, the 0.4.23 migration and its leave tombstones, per-student bind/leave/tombstones, routing and caps, history paging per class (and no history without an owner), ACK idempotence, and every write still working on tables a later update widened (`repository.test.mts`). `tala-nearby` also runs the real `nearby.ts` in a simulated classroom on a virtual clock (one teacher connection at a time; Talas that read only their own class key and check typed codes with the real HMAC): typed codes with neighbours, unreachable and lost teachers, a legacy teacher whose first class synced elsewhere, a history longer than a burst, and the 0.4.23 leave notices. The Nearby radio, RSA sealing and Android lifecycle are stand-ins there, so the physical-device scenarios below still apply.

## Physical-device scenarios

**Not verified in this pass** (no second phone / Redmi 14C on this machine):

- Scan Tala QR or type the 12-character code on Redmi 14C while teacher collects
- New students appear in the selected class; switching classes selects that class’s QR
- Two student phones + one teacher
- Bluetooth-only (Wi-Fi off)
- Disconnect before ACK, restart both apps, dedupe
- Week offline then sync
- Android 10 teacher phone
- 35-phone contention

Do not treat this feature as classroom-ready until those run against the Tala test APK.
