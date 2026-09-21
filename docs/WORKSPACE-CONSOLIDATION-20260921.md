# Local workspace consolidation — 21 September 2026

The canonical working checkout is **`/Users/luis/Code/hiraia`**, on
**`hiraia-unified`**. Start ordinary development and local builds here.

## Integrated work

- Fast-forwarded the completed `cebuano-language-audit` history through
  `cd89b6bf3`, including the source pool, title-generator fixes, audit evidence,
  held findings and generated inventory.
- Recorded the tested mobile work in `3cc327192`: LaBSE-first retrieval and memory
  admission, varied curriculum examples, quiz sounds, download-status UI,
  onboarding transitions and the Android glyph-animation crash fix.
- Retained the existing unified voice, Tala, connectivity, telemetry, branding,
  image-delivery and Metro build changes. Older snapshots' 0.4.14 settings were
  not used to replace the newer 0.4.19 configuration.
- Rebuilt `cards.db` in the canonical checkout. Its version is `eaacc6f34090`;
  the audit's originally staged SQLite file was `3a296ceb6c94`. These are hashes
  of the database bytes. All 49,156 `card_text` rows and 25,751 `card_question`
  rows compare exactly with the staged audit database, as do `search_meta` and
  `fact_meta`. SQLite integrity checks pass. The grounding-bank hash remains
  `90318bad81dd`.
- The source delta changes 713 existing cards: 354 Cebuano titles, 300 Cebuano
  bodies, 31 English titles and 48 Filipino titles. Some fields share a card.
  Card IDs, card count and taxonomy are unchanged. Held proposals remain held.
- Refreshed local dependencies, generated Expo routes and the native Android
  project. Staged pinned voice weights and validated image packs. Preserved the
  established signing identity. Added explicit object validation for downloaded
  update manifests to pass the consolidated dependency environment's type check.

The Git branch named `main` is preserved; the default development branch in this
directory is `hiraia-unified`. No remote push or public release is part of this
consolidation. The app version remains 0.4.19.

## Recovery and retired worktrees

Full directory snapshots of 16 retired worktrees are preserved in:

`/Users/luis/Code/hiraia-worktree-archive/20260921-consolidation/retired-worktrees/`

This includes untracked and ignored files, not just committed source. The archive
also contains branch/commit inventory, binary patches, saved index/worktree
metadata, the old root Android project and root files that collided with newly
tracked files. Every original branch remains available in Git. Old worktree
registrations were pruned only after preserving the directories and metadata.

The original root's tracked edits are additionally saved in stash commit
`e465ebb049bb0d3b76576a84d80572ce81c8ae63`, labelled
`preserve root pre-consolidation tracked edits 20260921`. Most are already present
or superseded in the consolidated branch. Do not blindly pop that stash: it also
contains obsolete release settings and earlier deployment configuration.

These are full recovery snapshots, not active checkouts. Each has an
`ARCHIVE-RESTORE.md`. To recover an old branch, create a new worktree from its
retained branch or recorded commit and selectively restore the saved local edits.
Do not copy an entire old tree over the canonical checkout.

Archiving consolidates locations without reclaiming their disk space. Large
training files, research outputs and credentials already in the canonical
checkout remain local and were not added to the consolidation commits.

Obsolete Metro servers on 8081/8082, the old design server and the previous Next
development server were stopped before moving/checking out their input trees.
Agents, the existing embedding server, ADB and the emulator were left running.
Restart any needed development server from the canonical checkout.

## Validation and build

- 116 targeted mobile tests passed, covering retrieval, memory admission, vector
  reads, model lifecycle, all-grade lesson selection, quiz feedback, profiles and
  download status.
- Asset/model update tests passed, and the mobile TypeScript check passed after
  route regeneration and manifest validation.
- The local on-device-model regression harness completed with `GATE GREEN`.
  This is a regression result, not independent language-quality certification.
- The release build is run with `packages/mobile/scripts/build-apk.sh`; its
  illustration, voice, curriculum, database freshness and native checks remain
  enabled. Build details and APK verification are saved in the consolidation
  archive's `BUILD-VERIFICATION.json` once complete.

The APK location is:

`packages/mobile/android/app/build/outputs/apk/release/app-release.apk`

The earlier Redmi profiling report remains at
`/Users/luis/Code/hiraia-device-profiles/redmi10-6gb-20260921/FINAL-REPORT.md`.
Its APK predates this Cebuano database integration; it remains useful as profiling
evidence, not as the newest content build.
