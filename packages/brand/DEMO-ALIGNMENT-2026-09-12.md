# Demo alignment and title cards — 12 September 2026

## Live deployment

The VPS website now uses Fraunces SemiBold, the current outlined wordmark, the growing glyph loader, current app artwork, and closer Android header/card/quiz layouts. The sleeping-cat loading video and simulated progress bar have been removed. Production build and live browser checks passed.

The live download and update manifest point to **hiraia-v0p3p4.apk**, versionCode 7. Both the new versioned filename and **hiraia-v0p3p3.apk** are available in R2; legacy links were retained. The signer and publisher derive standardized filenames from the app version.

R2 inventory comparison found changes only to `models/hiraia-v0p3p3.apk`, `models/hiraia-v0p3p4.apk`, and `models/hiraia.apk`. No model, vector, or secondary illustration-download objects changed.

VPS rollback backup: `/root/hiraia-brand-backup-20260912-v7`.

## Title-card implementation — local, awaiting deployment approval

Implemented in the unified Android checkout and mirrored into the web demo:

- Initial and new curriculum-topic introductions with small quarter/category text, dominant localized lesson title, and three available lesson illustration previews.
- A separate page identity and viewed-history entry. The Android left-edge pull and demo equivalent return to the introduction; ordinary navigation resumes toward the live card.
- Continuing an introduction reveals its already selected fact without counting the introduction as a normal card. Five normal cards precede a quiz. Historical replay does not change counters or reset the interval.
- Existing review queues/history are retained. Existing artwork resolvers and downloaded illustration packs are reused.

Validation: native type-check; 21 review/title/history tests; production Android build; exact inventory and SHA-256 verification for all 12,373 packaged illustrations; local unified production web build. Browser checks covered three loaded previews, initial five-card quiz cadence, title history replay, left-edge swipe, and 320×640 layout with scrollable quiz answers/explanation/continue.

Android was installed and inspected on emulator-5554; no USB phone was connected. Final artifact uses **hiraia-v0p3p5.apk**, versionCode 8. It has not been published. The website still advertises the verified live 0.3.4 release.

Automatic approval review rejected uploading the title-card web source/data to the VPS, stating the earlier APK deployment authorization did not cover the new source payload. No workaround upload was attempted. The earlier demo alignment remains live; title-card publication requires approval.

Pending signed 0.3.5 artifact: 311,440,690 bytes; SHA-256 `5b70917e498896f700c25166f9c7fdddc1b3b7c5ab271a47244861aec2079e32`; MD5 `e1afb1db6440f37b797d2c5744ab10d6`. Local download configuration is prepared for this release; publish and verify the immutable APK before deploying that configuration.

## Follow-up: larger brand

User approved publishing the APK after enlarging the wordmark. Homepage size changed from 44px to 56px (desktop 60px to 72px); native/demo header size from 21px to 26px. The 320px browser check found no overflow or header overlap. Android type-check, rebuild, signing, and all 12,373 illustration hashes passed again.

Automatic review still rejected the separate title-card web-source upload. The approved website rollout therefore contains only logo-size changes and the new APK link; its demo title-card implementation remains local.

Publication completed after the follow-up approval: **0.3.5 / versionCode 8** is live at `https://assets.hiraia.org/models/hiraia-v0p3p5.apk`. Full read-back SHA-256 and public HEAD matched the final artifact above. The website and update manifest now point at that immutable URL. The generic alias may retain an older cached response; it is not used by the website or update manifest.

The larger homepage/demo-header brand and v8 download configuration were deployed successfully, with rollback backup `/root/hiraia-brand-backup-20260912-v8`. Storage comparison changed only `models/hiraia-v0p3p5.apk` and `models/hiraia.apk`; model and secondary-download objects were unchanged. The Android APK includes title cards; deploying the corresponding web demo source remains blocked pending explicit approval.
