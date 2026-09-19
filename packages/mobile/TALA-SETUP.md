# Hiraia Tala — student Nearby (pilot)

Student-side classroom sync for the Calapacuan Grade 6 pilot. Teacher APK is
`packages/tala/android/app/build/outputs/apk/debug/app-debug.apk` in the hiraia
checkout (debug-signed). Protocol authority: Tala Kotlin.

## What shipped

- Settings: **Join Hiraia Tala / Scan teacher QR**, **Enter code instead**, disclosure (EN/TL/CEB), **Sync now / Retry**, **Leave class**.
- Device-level binding to the **class** QR/`class_id` (Tala 0.3.0). No student group picker — the teacher assigns groups after enrollment. Re-scan same QR is a no-op. Different teacher asks confirmation and drops unsent old-teacher events.
- Typed 12-character code (`XXXX-XXXX-XXXX`) uses the HMAC-SHA256 `manual_enroll` / `manual_key` exchange, then the same validated QR payload.
- Separate `teacher_outbox` in `hiraia-telemetry.db`. Mothership ACK does not delete it.
- Native module `modules/hiraia-tala`: Nearby `com.hiraia.classroom.v1` / `P2P_STAR` / play-services-nearby 19.4.0, RSA-OAEP SHA-256 + MGF1-SHA1, AES-256-GCM.
- Empty batch after `ready` so Tala can mark today’s check-in with no events.
- While Hiraia is in the foreground it keeps looking for Tala and syncs on its own. No student tap. Radios stop when the app backgrounds. The teacher still taps **Collect activity**.
- Joining copies the last 7 days of `card_viewed` / `quiz_graded` into the teacher queue using the original event ids. Teacher ACK is recorded in `teacher_sent` so a later sync does not resend. That path never writes the mothership outbox.
- Telemetry-off clears teacher events and stops collection. Wording: mothership still has no names; a QR-bound teacher does.

## Build

From `packages/mobile` (JDK 17, Android SDK):

```sh
pnpm install
pnpm apk
```

Install the student APK on a Redmi 14C. Install the **exact** Tala debug APK on a second Android 10+ phone. Both apps foregrounded, teacher offline, Bluetooth and Wi-Fi radios on. Scan QR, tap **Collect activity** on Tala.

## Tests run here

```sh
cd packages/mobile && pnpm qa:tala
```

Covers QR validation, typed-code normalize/proof/AES-GCM roundtrip, ACK rules, empty check-in, queue independence from mothership ACK, unbind/opt-out, event/profile sanitization.

## Physical-device scenarios

**Not verified in this pass** (no second phone / Redmi 14C on this machine):

- Scan Tala QR or type the 12-character code on Redmi 14C while teacher collects
- New students appear Unassigned; teacher group assign does not change the QR
- Two student phones + one teacher
- Bluetooth-only (Wi-Fi off)
- Disconnect before ACK, restart both apps, dedupe
- Week offline then sync
- Android 10 teacher phone
- 35-phone contention

Do not treat this feature as classroom-ready until those run against the Tala test APK.
