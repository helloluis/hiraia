# Hiraia 0.4.30 — three-term curriculum pilot

5 October 2026. Android and ChromeOS version **0.4.30 / code 30**, with Windows
**0.4.30-preview.1**, built from `52be6cbc246c1a64e15d77bbd0d42406c7b43a70`.
The [complete native pipeline](https://github.com/helloluis/hiraia/actions/runs/37291677518)
passed for all three editions. Source changes are pushed to `hiraia-unified` and
`codex/apk-footprint-refactor`.

## Pilot downloads

For manual entry on a test device, [hiraia.org/a](https://hiraia.org/a) redirects
directly to the Android APK below.

| Edition | Bytes | SHA-256 |
| --- | ---: | --- |
| [Android APK](https://assets.hiraia.org/models/hiraia-v0p4p30.apk) | 285,209,614 | `aad7023da9f15c5a0ef7b3875426f71ac4961fef1d8376d75473c0cc70a97953` |
| [ChromeOS APK](https://assets.hiraia.org/models/hiraia-v0p4p30-chromeos.apk) | 370,016,969 | `68729c8697ab12a1e4476fde929bf2287ca037710514661ffc05b05a2bf1535d` |
| [Windows preview ZIP](https://assets.hiraia.org/models/hiraia-windows-v0.4.30-preview.1-x64.zip) | 572,015,628 | `f3dc8b7e4d0e3202be4182944a5c7a65d9e56c4eaf74d94c7e86828fb993d20b` |

All files passed R2 read-back SHA-256 verification and public HEAD checks. Both APKs
also passed public byte-range GET checks. Windows has a [checksum sidecar](https://assets.hiraia.org/models/hiraia-windows-v0.4.30-preview.1-x64.zip.sha256).
Distribution uses these versioned pilot URLs. Production aliases, website deployment
and updater promotion were not part of this test-device publication.

Both APKs use release certificate SHA-256
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Android contains ARM64; ChromeOS contains ARM64 and x86_64. Their OTA runtimes are
`21637cd6fff0f9063bfea0ac982e7a7b501bfb13` and
`0921cdcade4a2af0553c00da3f573df31c5a5aa3`, respectively. Both contain the same JS
bundle, SHA-256 `064d4b599b45412126d89ec39878ec715dfff8d1efad85f3f7f724e865f9b6af`.

## Content and validation

- App and website use the Revised K-12 Curriculum and three terms, based on the
  archived official Grade 3–10 PDFs. The focused audit covers all 65 competencies
  whose Term 2 blocks overlap weeks 4–9. See [the audit](TERM2-PILOT-AUDIT.md).
- Both compiled APKs contain all 17 new pilot card IDs. Archive inspection verified
  12 corrected grounding facts, 11 corrected quizzes, 53,022 grounding rows, 3,070
  bundled illustrations and the English voice. The required distance–time diagram
  survived Android's PNG recompression with identical decoded pixels.
- CI model gate: **45/45 cases, 185 answers passed**. The independent Linux run also
  passed 45/45 with 111 answers. The initial photosynthesis failure led to a real
  grounding correction separating light energy from water/carbon-dioxide inputs;
  the assertion still requires water and light.
- All 84 exam tests passed. The final focused curriculum/diversity tests passed
  16/16; mobile and desktop TypeScript checks passed. Database/vector alignment,
  assessment-bank freshness, and Tala catalogue freshness passed.
- Packaged Windows passed the complete twelve-question exam, restart/resume,
  saved history, keyboard, zoom, carousel, out-of-order answers and screen-reader
  checks, plus CPU generation/embedding and offline English/Tagalog voices.
- Website production build passed. It still reports the existing typed-ESLint
  parser configuration error; this is not a clean lint result.

The final downloadable vectors are
`vectors-labse-fbd8f7e58c9e.i8.bin` (122,162,688 bytes), MD5
`0aab8aa002afc12bcf9beb8b7d7f6126`, SHA-256
`50f18f677e9ff784c8c25d18e36f03598d3d5302f060eef08e76ee0700979c88`.
The APK's download pin, vector metadata and database bank hash agree. The new
filename causes existing installations to fetch the corrected semantic data.
All 61 referenced image packs were available at their expected public sizes.
The prepared code-30 asset catalogue passed the app's own parser with image
baseline `ca57f3d76e889f08`.

[Build, publication and validation evidence](validation/0.4.30-pilot/) includes the
complete three-platform manifest, APK inspections, regression results, Windows
exam evidence, and candidate catalogues. Physical Android testing remains the
purpose of this pilot download. New and revised language content retains its
draft review status; the [Cebuano handoff](TERM2-PILOT-CEBUANO-HANDOFF.md) lists every
affected source, including the additional photosynthesis correction.
