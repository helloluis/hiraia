# Assessment authoring and APK integration status

Updated 29 September 2026. The Grade 3 foundation extension, signed evaluation APKs and native validation are complete. The 28 September integration, USB transfer and approved synthetic telemetry cleanup are complete.

## Grade 3 foundation extension — 29 September

- Added a separate 72-item trilingual foundation pool with 51 knowledge families, anchored to selected May 2016 Kindergarten competencies. Source grade 0 is retained; the student remains in Grade 3. This is a limited Hiraia foundation sample, not a complete school-readiness examination.
- All 72 items passed source checks and reciprocal model review. All 27 injected defects were caught. Native-speaker, teacher and intended-age learner review remain pending; production admission remains disabled.
- Twelve-item baseline: three questions per domain, six stable benchmark slots and six additional foundation probes. Follow-ups use exact reviewed card exposures for up to six recent-learning questions; unused slots are separately counted foundation supplements.
- Position questions carry deterministic offline diagrams, preserved through restart and shown again with the result. No ordinary card quizzes or existing product wording was changed.
- All 74 app assessment tests pass, including 36 Grade 3 baseline forms and 288 follow-ups. All 21 old Grade 4–10 language baselines, option orders and comparison keys remain identical. The required model regression gate is green.
- Tala preserves labels by exact recorded bank hash. Its 28 JVM tests, three catalogue tests and two compiler timestamp tests pass. Six actual Grade 3 summary fixtures cover all three languages and 0/6 recent-item denominators.
- The signed APK passed three language baselines and an English fourteen-day follow-up: 48 displayed questions, 144 option labels, durable restart recovery, scoring, explanations, reminders and comparison. Four summaries remained offline with no production uploads. Tala's seven connected Android tests also passed. Two helper assertions were corrected; a suspected visual defect was disproved by identical screenshot pixels.
- Private artifacts remain student 0.4.26/code26 and teacher 0.4.4/code19 in `build/assessment-evaluation-20260929/`. The original public APK was restored and verified. No version bump, public release, server deployment, commit or push was performed for this extension.
- Details and final artifact/native evidence: [implementation record](../../docs/GRADE3-FOUNDATION-EXAM-IMPLEMENTATION-20260929.md).
- Closed at 08:55 GMT+8: owned emulators 5580/5584 stopped and task heartbeat `c683a593` deleted. No new synthetic event reached production; unrelated devices remained untouched.

## Original authoring handover — 28 September

[Authoring report](authoring-summary.md): **638 questions / 1,914 language versions / 33 batches**. Origins: 43 exact reuses, 577 revisions, 14 alternate forms, four new questions. 638 narrow targets and 554 knowledge families. Five holds excluded; 633 source-checked drafts, zero production-ready or human/pilot-approved items.

All 33 batches passed 25 mechanical controls each; pool 9, full-form simulations 159, exposure counting 4. Incoming Grades 4–10 each passed eight constructed fortnight follow-ups. No exact content duplicates. Separate model reviews covered 100 Grade 9/10 items and prompted 20 repairs. No native-speaker, teacher or empirical approval is claimed.

At that handover, non-held drafts sampled 212/335 subcategories and 291/324 internal mappings narrowly. Only 642/49,156 core cards had accepted teaching links; nine of 308 actual shelves reached a six-family upper bound. Typical fourteen-day usage remains unmeasured. The Grade 3 draft extension is recorded above; cohort verification, human review, coverage expansion and form calibration remain open. Source defects are in source-repair-notes.md.

## Completed integration — 28 September

- User requested 45-minute bank completion at 17:03, target 17:48. Selected-blueprint authoring and reports finished before target.
- User then requested integrating the assessment into finalized 0.4.26 and copying the signed APK over USB to Redmi. At 17:27 the user confirmed new 12-item flow alongside existing mini-quizzes. No mini-quiz replacement bank was produced.
- 0.4.26 already merged: release2841376f7, site17db9176c, startingHEAD1d0e2ad47. Actual release28September. Existing signed APK hash and pinned release certificate verified.
- Required regression gate green at17:19. First sandbox attempt failed on tsx IPC socket, not an assertion; authorized rerun succeeded. Assessment, reporting and build checks have passed.
- Parallel work is complete: grade10_earth delivered Tala receipt/display/export and capability gating; grade10_physics delivered native checks and durable evidence; grade10_biology delivered collector/admin reporting and guarded cleanup tooling. Root completed durable student reporting, final build/signing, live verification, USB copy and user-approved cleanup.
- Local evaluation flag EXPO_PUBLIC_ASSESSMENT_EVALUATION=1 admits non-held source-checked drafts as Hiraia prior-level practice. Unverified cohort/review status retained; production defaults remain gated. Grade3 foundation unavailable; enrolled grade unchanged; no unreviewed prerequisite regression.
- Private runtime isolation prevents public OTA overriding preview. Separate signing filename protects the public filename during signing, but Gradle packageRelease deletes generated-output siblings. Original public APK recovered, pinned hash verified, and restored after final packaging. Both final evaluation APKs are protected outside Gradle outputs in `build/assessment-evaluation-20260928/`.
- Physical Redmi connected at 18:10: serial `fda4585e0610`, marketing name **Redmi 10 2022**, approximately 94GiB free. User requested USB copy, not phone installation. Never target other agents' emulators.
- Initial UI APK passed60 native checks across English, Tagalog and Cebuano: all twelve items, expected scores, frozen options, Back lock, durable answers, force-stop/resume, reminder suppression, isolated history and read-aloud metadata. The final reporting-enabled APK separately passed native completion, deduplication, opt-out/opt-in and real HTTPS acknowledgement. Complete native report:100 passes and two resolved smoke-helper timing assertions. Evidence is preserved; dedicated student5580 and teacher5582 emulators are both stopped.
- All initial 50 assessment tests and 21 existing profile/review tests passed. Actual selector sustained 84 baselines + 672 rich follow-ups. Reporting addition: nine serializer/consent/ACK/byte-budget checks, 23 real SQLite repository checks, 47 student Tala protocol checks and full mobile TypeScript pass. Required model regression gate remains green; model assets unchanged.
- At approximately18:00 the user explicitly added telemetry reporting to admin (phone identifier, no student names) and Tala. Shared contract: `tools/pilot-telemetry/ASSESSMENT-CONTRACT.md`. Consent-at-completion epochs, persistent summary archive, replay/dedup, class paging and old-server ACK protection are implemented. These are completed-attempt summaries, not raw answers. Tala passed23 JVM and seven native checks; collector17 Node tests, admin/deployment/cleanup39 Python tests, HTTP smoke and desktop/mobile browser checks passed.
- Final reporting-enabled student build passed in5m01s with fresh Metro output and release signing. Artifact `build/assessment-evaluation-20260928/hiraia-v0p4p26-assessment-evaluation.apk`:438,729,577 bytes, SHA256 `e35f1871ca138eb7064dd76e5250ad808ca8f29060594555bebadd106cdea996`. At18:39 copied to Redmi `/sdcard/Download/hiraia-v0p4p26-assessment-evaluation.apk` and destination hash matched. User subsequently found and tried it. No agent installation on the phone.
- Tala evaluation APK: `build/assessment-evaluation-20260928/tala-v0p4p4-assessment-evaluation.apk`,15,639,839 bytes, SHA256 `ca6a12d33e476ecf5f37fe20cdf2bcf31512b6c64645ba78d0c4c0c351ca22fd`.
- Scoped collector/admin deployment passed at18:34; code-only rollback backup `/opt/hiraia-assessment-backups/20260928T103448Z`. At18:46 the actual APK's HTTPS upload was acknowledged; live report showed one expected8/12 result and no opted-out completion. Automatic approval review initially rejected synthetic cleanup pending explicit user permission. User approved only those test records at18:54. A fresh snapshot found79 rows in each of the six scoped source/delivery/mirror tables; guarded apply removed them and verified all six empty. The live admin report also verified zero results for the exact test installation. See `docs/ASSESSMENT-INTEGRATION-20260928.md` and the native/Tala validation reports.

## Reminders and continuity

Paseo heartbeat d669584a (target e634d654-b415-43a1-8c4d-8b71995bf036; former cron13,33,53 * * * *, Asia/Manila) was deleted after work completed at18:58. Both dedicated test emulators are stopped; unrelated devices and browser tabs were left untouched.

Work only /Users/luis/Code/hiraia; preserve unrelated changes including existing.gitignore modification. No commits/pushes/public APK publication/version bump/Redmi installation requested. New reporting request requires scoped server support; prepare and validate exact collector/admin deployment before applying. Read CLAUDE.md and BUILD.md before build. Canonical batches/reports are durable; temporary files are not the deliverable.

Own curriculum-research browser tabs were closed at17:55; no unrelated tabs touched.
