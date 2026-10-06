# Hiraia 0.4.31 — full-year curriculum coverage

6 October 2026. Android and ChromeOS **0.4.31 / code 31**, plus Windows
**0.4.31-preview.1**, built from `7839b3ac57b884b0063ee2ea0fdefed678b74d66`.
The [complete native pipeline](https://github.com/helloluis/hiraia/actions/runs/37390533981)
passed for all three editions from the same source commit.

## Downloads

Type **[hiraia.org/a](https://hiraia.org/a)** on the test device to download Android.
The redirect uses `Cache-Control: no-store`; it points directly at this release’s
immutable APK. The established release certificate permits an in-place update.

| Edition | Bytes | SHA-256 |
| --- | ---: | --- |
| [Android APK](https://assets.hiraia.org/models/hiraia-v0p4p31.apk) | 284,324,878 | `0439528bdb64d16525b8fef078c82c0c4aaf7353a9e3795e18ea49ca4b441e7f` |
| [ChromeOS APK](https://assets.hiraia.org/models/hiraia-v0p4p31-chromeos.apk) | 369,128,137 | `2718cb1951bea87bf12089cccfb2e128a0a31ff1f3e1c09b820e14fc5d3e4f22` |
| [Windows preview ZIP](https://assets.hiraia.org/models/hiraia-windows-v0.4.31-preview.1-x64.zip) | 571,385,947 | `7dc955293d9c3e0a1fcaca2bc46462e3fa6c266aa64c8c3214733f49dcfc876f` |

Both APKs use release certificate SHA-256
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Android contains ARM64; ChromeOS contains ARM64 and x86_64. Their separate OTA
runtimes are `66dbd892c0d2e6a8781b6c6a277a86188b222dd6` and
`4ceb3e1ba6b6b9d49c2bf4369f747445792b15c9`. Both contain the same JavaScript bundle,
SHA-256 `5b32398e1572e486206058aa4d12f57ab20afa659b70df8f7ab925cd5733a936`.
Windows remains an unsigned x64 preview with a [checksum sidecar](https://assets.hiraia.org/models/hiraia-windows-v0.4.31-preview.1-x64.zip.sha256).

## Curriculum and validation

- [Full-year audit](FULL-YEAR-CURRICULUM-AUDIT.md): all three terms, Grades 3–10,
  **322 listed competencies, 1,032 reviewed teaching/quiz slots and 1,280 distinct
  selected cards**. The extension adds 42 trilingual cards, 35 question changes
  on existing facts, and 20 persistent factual corrections.
- Model regression gate: **45/45 cases, 185 answers passed**. CI also passed
  platform, input, assessment, source freshness and TypeScript gates.
- All **74 curriculum/Calendar tests**, **84 assessment tests** and four known-bad
  audit controls passed. The full-year audit verifies the generated database,
  source PDF hashes and frozen English review evidence.
- Both final APKs were independently measured and signature-verified. Archive
  inspection verified all 42 new cards’ titles and bodies in all three languages,
  31 corrected grounding rows, 30 corrected rendered cards and 25 corrected quiz
  rows present in the database (including the prior pilot corrections). Both contain
  53,022 grounding rows, 3,070 bundled illustrations, the English offline voice,
  and the required distance–time diagram with identical decoded pixels.
- Packaged Windows passed the complete twelve-question exam, restart/resume,
  saved history, keyboard, zoom, carousel, out-of-order answers and screen-reader
  checks, plus CPU generation/embedding and English/Tagalog offline voices.
- Website production build, platform download tests and the app’s asset-catalogue
  parser passed. The catalogue is revision 8, bounded to code 31, with all 61 image
  packs and image baseline `ca57f3d76e889f08`.

The final vector dependency is `vectors-labse-45f9310c4179.i8.bin`, 122,162,688 bytes,
MD5 `deee5b7a02d9d7503e961057fcfc6b10`, SHA-256
`c866a5b22d2e99ddfb36c52fd6bf2357ae60ba8db4824292074a76b249d7528d`.
APK download pins, vector metadata and database bank hash agree. All 61 image packs
and the vector bank passed public availability/size checks.

## Publication

Release files are uploaded through the R2 publisher, which verifies full read-back
SHA-256 digests and public sizes. Android/ChromeOS legacy aliases are updated with
cache purges. Website download metadata, updater catalogue and the short link point
to 0.4.31. The website uses **Revised K-12 Curriculum** and the same full-year
competency catalogue as the app.

Before publication, the live standalone telemetry collector’s SHA-256 matched the
locally built collector exactly; its health check passed. This release adds no new
telemetry property keys, so a collector restart was unnecessary.

[Validation evidence](validation/0.4.31/) records the CI result, artifact identities,
APK content inspection, regression answers, packaged Windows tests, dependency
checks, publication metadata and live smoke checks. Website/publication changes
follow the built source commit without changing its app inputs. The unrelated
local `packages/mobile/BUILD.md` edits are excluded.

Physical Android testing remains pending on the user’s device. Instructional
coverage does not establish practical skill mastery. New and revised translations
retain their draft review status; the separate [Cebuano handoff](FULL-YEAR-CEBUANO-HANDOFF.md)
lists the affected IDs, fields and required regeneration order.
