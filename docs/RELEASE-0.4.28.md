# Hiraia 0.4.28 — exam in every edition

Android and ChromeOS are 0.4.28 (code 28); Windows is 0.4.28-preview.1 (x64).
The shared 12-question exam is available from Settings, with offline scoring, saved
progress, restart recovery, answer review and per-profile history. The Windows download
image now shows the exam captured from the packaged Windows executable.

All three packages were built from `c0299c74e2929424e7d49ede6a6e72bf2439dee2` in
[the successful three-edition CI run](https://github.com/helloluis/hiraia/actions/runs/36810771410).
The later website commit contains release pointers and preserves intervening archive work.

## Release files

| Edition | Bytes | SHA-256 |
| --- | ---: | --- |
| [android](https://assets.hiraia.org/models/hiraia-v0p4p28.apk) | 438,774,633 | `5505895e8c79e8224fb775d8b4646545ceef6772786766b3cb6bc6bfbfabbd4a` |
| [chromeos](https://assets.hiraia.org/models/hiraia-v0p4p28-chromeos.apk) | 523,581,988 | `331a52dd620d524da953c8ecdc5fec6cf2ec66bdf571a717bc4db56c218a2a37` |
| [Windows preview](https://assets.hiraia.org/models/hiraia-windows-v0.4.28-preview.1-x64.zip) | 674,698,611 | `22619cbe9e1651b8d774c7d722ad8230c926e4740f9e672b44f4aaa6213aa6f7` |

Both APKs retain release certificate SHA-256
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Windows remains an unsigned portable ZIP. Its checksum is also published beside the ZIP.

| APK | ABIs | OTA runtime |
| --- | --- | --- |
| android | arm64-v8a | `e70c196b94796f963c7fb1a5ff1ad96ae21faf5a` |
| chromeos | arm64-v8a, x86_64 | `46254bf8809496e30b894b5749641e8781e67467` |

The Android and ChromeOS JavaScript bundles have the same SHA-256:
`60dcfc040dfb5527cb2321203e7eb2b10fb54c21d8c303e0a6dda286f8df49cb`. Their OTA runtimes remain separate.
Asset catalog revision 6 is pinned to code 28 and image baseline `14d7c42699fd80bd`,
with all 42 packs accepted by the app’s own catalog parser.

## Validation

- Formal model gate: all 45 cases and 185 samples passed. The observed smoking-assertion
  false rejection and its controls are documented in [the integration record](EXAM-ALL-EDITIONS-20261001.md).
- Shared exam suite: 82 cases; the broader exam/reader/review run passed 108. All eight
  grade baselines and all three languages pass selection and collector serialization checks.
- Signed Android APK: full offline exam at 720 × 1600, 200% text, restart after three
  answers, expected 8/12 score, all twelve explanations, and visible saved history.
- Signed ChromeOS APK: the same checks at 1366 × 768. The initial history driver swiped
  outside the narrow Settings panel; targeting its actual scroll container fixed the test.
  The saved result was then verified. [APK evidence](validation/0.4.28/apk-exams.json).
- Packaged Windows: full exam, exact restart recovery, history, keyboard controls, 200%
  zoom, 900 × 600 window, ordinary quizzes, offline read-aloud, 768-dimensional QVAC
  embeddings and CPU generation. English and Tagalog voices both synthesized audio.
  The actual ZIP was extracted into a path with spaces and accented characters.
  [Windows evidence](validation/0.4.28/windows.json).
- Windows history now uses an isolated SQLite reader, so read-only history does not
  disable progress writes. Eight desktop host/storage tests pass.
- The native collector bundle matches the already-deployed server byte for byte:
  `9117733d3d91e7a183df606a65b88603aaa620f101857da901f6274e670c2303`.
- A Windows cp1252 default mangled the multiplication sign in one combined-report label.
  Individual manifests, artifact hashes, test flags and the executable were correct.
  The combiner now explicitly reads/writes UTF-8; a test reproduces the legacy locale.
  The locally verified combined index uses the original UTF-8 individual manifests.

## Scope and remaining validation

The exam keeps its existing Assessment preview label and review status: 710 authored
questions, 705 compiled, five held. This release does not claim new teacher or language
approval. The compiled bank input hash is
`ec09f5c0e2740fc74d01b9129211b6670ebfe91e7714016e4362e671bb4e301d`.

ChromeOS remains Preview: the signed package was exercised in an Android large-screen
emulator, and physical Chromebook ARC testing is still pending. Windows native tests ran
on Windows Server 2022 x64; consumer Windows 10 device testing remains pending. Windows
ARM and Windows Tala classroom sync remain outside this preview.

All versioned files, both APK legacy aliases, and the Windows checksum sidecar passed
R2 read-back verification and public HEAD checks on 1 October 2026. The website
production build and browser checks at 1440, 768, 390 and 320 pixels passed; images
retain their full aspect ratio, download metadata matches the release manifests,
and no page overflow or browser exceptions were observed.

The production web build still emits the existing typed-ESLint parser configuration
error before completing successfully. Type checking and browser validation passed;
this release does not claim a clean ESLint run.
