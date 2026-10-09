# Hiraia 0.4.41 — expanded curriculum reading

9 October 2026. Android and ChromeOS **0.4.41 / build 41**, plus Windows
**0.4.41-preview.1**, from release source
`1a8f3ebcc1f36f362101bef15d8e33b904ed731e` on
`codex/cebuano-curriculum-alignment-20261007`.
All three editions passed the [canonical release pipeline](https://github.com/helloluis/hiraia/actions/runs/37806236278)
from that same commit. This website publication uses those exact qualified files.

## Downloads

[Choose an edition on hiraia.org](https://hiraia.org/#download), or use the
immutable downloads below. [hiraia.org/a](https://hiraia.org/a) selects Android.

| Edition | Bytes | SHA-256 |
| --- | ---: | --- |
| [Android APK](https://assets.hiraia.org/models/hiraia-v0p4p41.apk) | 284,685,326 | `b1f5d53465b1245f2b5d8c5a2dd74de6e2f39b676135ec5d3a59d991d780f6d7` |
| [ChromeOS APK](https://assets.hiraia.org/models/hiraia-v0p4p41-chromeos.apk) | 369,488,585 | `5d2b44a7d150ad9978728707076064265f743f838f76af3e64b8c09e2f8b8328` |
| [Windows preview ZIP](https://assets.hiraia.org/models/hiraia-windows-v0.4.41-preview.1-x64.zip) | 571,656,589 | `2a0775d8b1c0df7f858baf227b96ec0cfb2b6fea1ef93d5abbdde978d38b1a28` |

Both APKs retain the release certificate
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Android contains ARM64; ChromeOS contains ARM64 and x86_64. Their respective
OTA runtimes are `92ab44c88e3cdca918d73865597a801ddec36003` and
`21853b3ce6697e66ee284e16e890b5d869cb5779`.
Windows remains an unsigned x64 portable preview; its
[checksum sidecar](https://assets.hiraia.org/models/hiraia-windows-v0.4.41-preview.1-x64.zip.sha256)
is published alongside the ZIP.

## Curriculum and qualification

The reviewed curriculum commit is `2e1940a7943c807cc832bc2c853836c5cb145be1`:
**7,962 main-bank curriculum cards plus 165 supplements**, Grades 3–10,
with clickable lesson rows, unread-only Read more, and grade-specific collections.
Required units, questions, exclusions and review history are preserved.

The formal model regression gate passed **45/45 cases before the APK builds**.
Both signed APKs passed the input, curriculum, database, illustration, voice,
ABI, signing and distinct-runtime gates. Packaged Windows passed CPU inference,
768-dimensional embeddings, English and Tagalog offline voices, the twelve-question
exam, restart/resume, history, keyboard, zoom, carousel, out-of-order answers and
screen-reader checks. The curriculum source batch passed 139 tests separately.

All three packages contain the same database, SHA-256
`a9e9c42eb649e16dd9d0652e01662b0e2a4106be2c2bdb4d4033a862f5918fc4`,
and all 308 lesson revisions. The prior reviewed database has a different raw
hash because two token tables were inserted in a different physical row order.
The preserved comparison checked every table, column, blob, fact ordinal and
schema and found identical logical content. Release qualification uses the exact
packaged hash and that comparison proof.

## Public delivery

The canonical R2 publisher verified full read-back SHA-256 digests and public
sizes for all three packages, the Windows checksum, and the new search-vector
file. Both APK aliases were verified and their caches purged. The 64 existing
public dependencies also passed availability and size checks.

The new vector file is `vectors-labse-3a36094d18d2.i8.bin`, 122,162,688 bytes,
MD5 `3d555f7450025a208ca65f2f02436759`, SHA-256
`67912d4fd3270876ab2922316b20f8dad4109ac26eac2234cdb1728a6d59405b`.
The asset catalog is revision **10**, bounded exactly to build **41**, with
61 image packs and image baseline `ca57f3d76e889f08`; the production app parser
accepts it and rejects incompatible builds/baselines.

The three platform-download tests, exact-artifact/catalog parser checks, and
production website build passed. The build still reports the pre-existing typed
ESLint configuration error: `@typescript-eslint/await-thenable` lacks parser type
information. Its successful build and TypeScript check are not a clean lint result.

The standalone telemetry collector is byte-identical to the healthy deployed
collector: `9117733d3d91e7a183df606a65b88603aaa620f101857da901f6274e670c2303`.
This release introduces no new telemetry properties.

[Qualification and publication evidence](validation/0.4.41/publication.json)
records the source commit, CI jobs, exact artifacts and delivery checks.
The local fleet already uses these same qualified APK bytes. Hiraia Setup 0.4.4
remains withheld; this publication is the student application release.
