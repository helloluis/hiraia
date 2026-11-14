# In-place upgrade from Tala 0.4.x (PRD ACT-2) — design, not yet runnable

Today V1.0 builds are `com.hiraia.tala.next`; Android isolates app data per package, so no V1 build can
read 0.4.x's files, and nothing here runs yet. This documents what happens on the day a V1.0 build ships
as `com.hiraia.tala` with the pilot key and a version code above 19.

## What 0.4.x keeps on the phone (branch tala-0.4.x)

| Asset | Where | Code |
|---|---|---|
| Classes (name, teacher, school, grade, year, **enrollment id**) | SQLite `hiraia-tala.db` → `school_classes` | `TalaDatabase.kt` (schema 9 at 0.4.4) |
| Learners, events, device state, saved avatars | same db → `students`, `events`, `devices`, `student_avatars` | `TalaDatabase.kt` |
| Issue reports, relay queue, class options | same db → `issues`, `issue_media`, `activity_relay`, `relay_identity`, `class_options`; files under `files/issue-media/` | not carried (ACT-5: no upload in V1) |
| **RSA key pairs** | AndroidKeyStore, alias `hiraia.tala.class.<enrollment id>` | `ClassIdentity.kt` |
| Legacy default class id (`0.1.x`) | SharedPreferences `tala-class-v1` → `class_id` | `ClassIdentity.legacyClassId` |
| Settings (selected class, tutorial seen) | SharedPreferences | `TalaSettings.kt` |

## What survives an in-place upgrade automatically

- **Keystore entries.** AndroidKeyStore keys belong to the app UID. An upgrade of the same package
  signed with the same certificate keeps the UID, so every `hiraia.tala.class.<id>` key is still there.
  The port uses the **same alias** (`ClassKeys.kt`), so `ensureClassKey(enrollmentId)` finds the existing
  key and returns the same public key: **the QR does not change, student phones do not re-join.**
  (`allowBackup=false` in both apps, so keys are never expected from a cloud restore either.)
- **Files.** `/data/data/com.hiraia.tala/databases/hiraia-tala.db` and the `files/` directory stay.
  V1 opens the old database read-only and imports it (next section). Reinstalling (uninstall first)
  destroys both keys and db — that is the one path with loss, same as today.

## Import steps (first launch of V1 as `com.hiraia.tala`)

1. Detect `databases/hiraia-tala.db` (Expo: `Paths.document` is `files/`; the db is one level up —
   open it with `expo-sqlite`'s `openDatabaseAsync('hiraia-tala.db', { }, '<app data>/databases')`, or
   copy it first). Open **read-only** (`PRAGMA query_only = 1`); never write to it.
2. `inspectLegacy(source)` (`src/features/activity/upgrade.ts`): confirms the schema (≥ 3; 0.4.x
   migrations ran when 0.4.x last opened it) and lists classes. Schema 9 (0.4.4) carries `left_at` /
   `removed_at`; 5–8 (0.4.1–0.4.3) carry the same tables without them; both import. A schema < 3 phone
   (pre-0.3.0, Sept 2026) is told to open Tala 0.4.x once first; none is expected in the field.
3. For each 0.4.x class, create the planning `class` record (owner: Worker E / orchestrator) **with the
   0.4.x class id** so `activity_classes.class_id` points at it (or pass `classIdFor`). Name, teacher,
   school, grade, year copy over; `created_at` is preserved.
4. `importLegacy(source, store)` copies classes (with their **enrollment ids**), learners (incl. left /
   removed markers), events (ids, times, props, `received_at`), device state and saved avatars into the
   encrypted `tala-activity.db`. Idempotent (`INSERT OR IGNORE`), so an interrupted import resumes.
   Tested with a schema-9 and a schema-8 fixture (`upgrade.test.ts`), including that a learner removed in
   0.4.x stays removed and a resend is acknowledged but dropped.
5. Check `hasClassKey(enrollmentId)` for each imported class. Expected: true. If a key is missing
   (should only happen after a reinstall), the class keeps its activity but students must re-scan a new
   QR — show that plainly on the class.
6. Mark the import done (`activity_meta.legacy_imported = <ms>`), keep the old db untouched for one
   release as a safety net, then delete `hiraia-tala.db` and `files/issue-media/` in the following
   release. Issue reports and the relay queue are **not** imported: ACT-5 forbids uploads, and pending
   0.4.x reports are better flushed by 0.4.4 before cutover (release note item).
7. Settings: `tala-class-v1.class_id` (the 0.1.x default class) is already the first class's
   enrollment id in `school_classes`; nothing else from SharedPreferences is needed. The 0.4.x tutorial
   flag is ignored: V1 shows its own first-launch tutorial (ACT-8).

## Cutover checklist (the single deliberate step, decided by Luis)

- `TALA_ANDROID_APPLICATION_ID=com.hiraia.tala`, pilot signing key, `versionCode ≥ 20`.
- Keystore alias unchanged (`hiraia.tala.class.`), service id unchanged (`com.hiraia.classroom.v1`),
  endpoint name scheme unchanged (`Hiraia Tala 2 <hint>`), caps unchanged (`left_profiles`).
- Two-phone test against a **0.4.24 student that joined under 0.4.4**: it must sync to V1 without
  re-scanning (same `class_id` + `public_key` → `sameBinding` true on the phone).
- 0.4.x pending issue reports sent before upgrading.
