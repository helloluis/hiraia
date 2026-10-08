# Curriculum phone rollout — 9 October 2026

The user authorized committing and pushing the completed curriculum changes, then
getting them onto the existing phones tomorrow at **09:00 Asia/Manila (GMT+8)**.
The request was received on 8 October. Preparation is scheduled for **00:00 on
9 October**, leaving time for the required release checks before local activation.
The scheduled prompts pin the exact pushed curriculum commit.

## Content to deliver

- The clickable Curriculum rows, broader reviewed pools for Grades 3–10,
  unread-only **Read more**, and optional grade-specific science collections.
- 7,962 of 49,155 main-bank cards in curriculum, plus 165 supplemental cards;
  273 new admissions from the completed 509-card review batch. The 236 new holds
  remain excluded. See [the report](card-bank-expansion-20261008.json).
- Required teaching units, quizzes, review history and profile data are preserved.

The validated source has 139 passing tests and a rebuilt database version
`844c1a2e1240`. Those source checks are not native-release qualification. Current
completion evidence is `build/curriculum-bank-expansion-20261008/completion-001.json`
(SHA-256 `dea68858a9e66348381d397776aa2014b12fcbd8d2688c18d61368a3bbaa0af0`).

## Midnight preparation

Work from the pinned curriculum commit on
`codex/cebuano-curriculum-alignment-20261007`, in the active checkout
`/Users/luis/Code/hiraia/build/cebuano-curriculum-alignment-20261007`.
Check for intervening work and preserve unrelated changes. The provisioning
recovery changes in that checkout belong to the already active service and were
deliberately excluded from the curriculum commit. Do not revert or stage them
incidentally. A fresh isolated release checkout is preferable if source changes
would otherwise overlap another task.

1. Read `CLAUDE.md`, `AGENTS.md`, `packages/mobile/BUILD.md`,
   `docs/RELEASE-0.4.40.md`, `docs/PROVISIONING-RECOVERY-20261008.md` and
   `packages/provisioner/README.md`. Reconcile actual current service state with
   these records before changing anything. Keep all local heavy work serial at
   nice 10, including descendants.
2. Prepare the next unused student version/build, expected **0.4.41 / 41**. Never
   replace the bytes behind 0.4.40 or reuse an occupied version. Apply the ordinary
   version, asset-catalog and prebuild steps. Commit and push the narrowly scoped
   release preparation; this is authorized by the requested phone rollout.
3. Run the formal model regression gate and the canonical Android, ChromeOS and
   Windows release pipeline. The complete manifest must bind the same source
   commit and versions, matching signed APKs, and packaged Windows CPU, voice,
   exam, saved-history and UI evidence. Source tests or an export are insufficient.
   Use the existing signing identities. If the protected runner requires a manual
   dispatch grant, follow its documented exact-branch/commit/expiry mechanism;
   do not disable the trust gate or imply that a historical grant covers a new SHA.
4. Preserve failed outputs and diagnose any failure before a versioned correction.
   Retain the actual process/CI exits, downloaded artifacts and all hashes under
   `build/curriculum-phone-rollout-20261009/`. Verify that the new artifacts contain
   this curriculum and the expected database. Stage a candidate only after all
   required checks pass. Do not activate it before 09:00.
5. Save `readiness.json` in that evidence directory with the release commit,
   version/build, full three-platform manifest and artifact paths/hashes, test
   receipts, mirror verification, candidate service capsule, activation procedure
   and rollback information. Record a failure honestly if preparation is blocked.

This request authorizes the local fleet update, not a public Internet release,
default-branch merge, Setup replacement, factory reset or student-data migration.
Do not silently substitute an OTA that cannot carry the changed bundled database.

## 09:00 local activation

Read the durable preparation result first; never duplicate a running build or
activate a partial release. Missing or failed required checks delay delivery and
must be reported. Do not claim 09:00 installation merely because a timer fired.

The currently activated recovery serves Hiraia 0.4.40 to the existing registered
fleet through Setup 0.4.3 (8). It deliberately withholds the rejected Setup 0.4.4
(9), including new QR enrollment. Preserve that Setup hold and the registered
cohort; update only the Hiraia offer to the new, verified version and exact APK.
The old Hiraia-only policy pins the old APK and cannot authorize a different hash.
Prepare a fresh exact-artifact policy using the same authenticated cohort and
preserve the original policy, offer history and receipts.

Preserve the production TLS identity, tokens, registrations, issued-ID log,
student data, Android verifier settings and signing keys. Use the tested service
staging/activation mechanism with its full-platform gate. The active immutable
service capsule is the authority for provisioning recovery behavior; do not replace
it with an older committed server that would re-offer the blocked Setup APK.
Wait for in-flight transfers/installations before replacing the service. Keep the
complete local asset mirror and existing rollback capsule available.

After activation, verify the exact offered version/hash, Setup hold, mirror,
registry preservation and healthy HTTP/TLS/discovery. Monitor authenticated offers
and install reports. Separate server readiness, phone-reported completion and
independently verified installed versions. Never call all phones updated from a
server health check or an old enrollment COMPLETE row.

The Mac must be powered, logged in, awake with its lid open and on the phones'
Wi-Fi. Setup 0.4.3 normally checks about every two hours, subject to Android's
scheduling; 09:00 is the delivery start, not a guaranteed completion time for every
phone. No USB connection or new enrollment is required for registered phones.
