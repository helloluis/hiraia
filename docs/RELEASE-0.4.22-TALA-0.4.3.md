# Hiraia v0.4.22 and Tala v0.4.3

Release date: September 22, 2026. Built from the `hiraia-unified` checkout.

| | Hiraia | Tala |
|---|---|---|
| Package | `com.hiraia.app` | `com.hiraia.tala` |
| Display version | 0.4.22 | 0.4.3 |
| Android version code | 22 | 18 |
| Bytes | 435197646 | 15073815 |
| URL | https://assets.hiraia.org/models/hiraia-v0p4p22.apk | https://assets.hiraia.org/models/tala-v0p4p3.apk |
| SHA-256 | `c33144ff5b304ee0e1f753251fced3ae5d7d3252f38ced97dbae60a65d819c3e` | `4b94899f484611aa6d49f13302e31ad77e635ee39ced92975eb3c31adf3707a1` |
| MD5 | `43e5df37c3755b160cb587684dc16d92` | `67ff682694534720c1e6cabd1653ab70` |
| Signing certificate SHA-256 | `40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35` | `50dcc69a6eb8ad94354de148087d28919be757eafcd4d304512a5db35f1703ae` |

Both APKs keep their existing signing identities, so installs upgrade in place.

## Changes

**Card and quiz language.** 1,532 card fields repaired across the Cebuano corpus plus 31
English and 49 Tagalog titles; 1,023 quiz-bank items touched. Findings and method are in
`tools/cebuano-language-audit/` and `tools/quiz-language-audit/TL-AUDIT-PLAN.md`.

**Illustrations.** Model-scored audit and ChatGPT Image 2.0 regeneration of the frozen
inventory: 564 rejected PNGs quarantined, `slug` cleared on 631 cards so they print as
posters, packs re-cut to 12,149 bundled + 22,932 downloadable. See
`tools/image-audit/AUDIT-AND-REGEN-2026-09-21.md`.

**Title truncation fixed at source.** `TITLE_MAX = 20` was applied as a raw character slice
in three title generators, severing words in ALL THREE languages — 128 titles cut mid-word at
exactly 20 characters against 2–6 at every neighbouring length. The generators now trim whole
words; the 105 already-severed titles in the pool were restored.

**Narration.** Punctuation-guided pauses for the bundled voices, which encode no commas or
stops: comma 180 ms, dash/colon 280 ms, sentence end 420 ms, inserted as PCM silence inside
the clips. Number expansion runs first so decimals do not create false pauses.

**Lesson recap.** Recap pages print three short topic titles sampled across the section
instead of one full body paragraph per card.

**Classroom enrolment.** The Settings section is now headed JOIN A CLASS, separated by a rule
from Wika and Baitang, with much shorter Tagalog and Cebuano copy. Once enrolled it shows the
class's own name. Class names are no longer optional: Tala generates a colour-and-animal name
when a teacher types none, and derives a stable one from the class id for classes created
before names existed, so `class_name` is never blank on the wire. It is advisory only —
`sameBinding` still compares class_id and public_key, so renaming a class does not orphan
enrolled students, and a teacher build predating the field still enrols normally.

## Validation

- Regression gate: 45/45, gate green, 111 card draws.
- Voice tests 16/16; Tala protocol tests 15/15, including QR parsing with the name absent,
  padded, hostile and non-string.
- `pnpm qa:images` green; 12,149 APK illustrations matched inventory and SHA-256.
- Both APKs verified for package id, version, build code and signing certificate. Tala's
  release variant is non-debuggable and signed with the established pilot key.
- Both uploads read back from R2 and confirmed by public HEAD.

## Known gaps

- 33 Cebuano cards remain flagged for a native speaker: idiom and lexical-authority questions
  where dictionary and corpus disagree. 13 more are held on thinly attested roots.
- Narration pacing has not been tuned by ear on a phone.
- Image packs were not published to R2; only the APKs were.
