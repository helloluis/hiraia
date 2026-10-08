# Hiraia 0.4.41 — staged local curriculum rollout

Prepared on **9 October 2026** for the authorized **09:00 Asia/Manila** local
rollout. This record describes the staged release. The live phone offer remains
0.4.40 until the separate activation task verifies readiness and switches it.

## Source and delivery

- Release source: `1a8f3ebcc1f36f362101bef15d8e33b904ed731e`, pushed to
  `codex/cebuano-curriculum-alignment-20261007`.
- Reviewed curriculum: `2e1940a7943c807cc832bc2c853836c5cb145be1`.
- Student version/build: **0.4.41 / 41**. Asset catalog revision 10 accepts only
  build 41; all 61 image-pack identities are unchanged.
- 7,962 main-bank curriculum cards plus 165 supplements, across Grades 3–10,
  with clickable lesson rows, unread-only Read more, and grade-specific collections.
  The required units, questions, exclusions and review history remain intact.
- Local fleet scope: the same 98 registered phones using Setup 0.4.3 (8).
  The rejected Setup 0.4.4 (9) and new QR enrollment remain withheld.

## Measured artifacts

All three editions came from the same source commit in successful
[CI run 37806236278](https://github.com/helloluis/hiraia/actions/runs/37806236278).

| Edition | Bytes | SHA-256 |
| --- | ---: | --- |
| Android, `hiraia-v0p4p41.apk` | 284,685,326 | `b1f5d53465b1245f2b5d8c5a2dd74de6e2f39b676135ec5d3a59d991d780f6d7` |
| ChromeOS, `hiraia-v0p4p41-chromeos.apk` | 369,488,585 | `5d2b44a7d150ad9978728707076064265f743f838f76af3e64b8c09e2f8b8328` |
| Windows, `Hiraia-win32-x64-0.4.41-preview.1.zip` | 571,656,589 | `2a0775d8b1c0df7f858baf227b96ec0cfb2b6fea1ef93d5abbdde978d38b1a28` |

Both APKs use the established release certificate
`40d750d5576cb59c311c7ba713403e065b934967d7a7d1bc80652e1167a20c35`.
Android runtime: `92ab44c88e3cdca918d73865597a801ddec36003`.
ChromeOS runtime: `21853b3ce6697e66ee284e16e890b5d869cb5779`.
Windows is the tested unsigned portable preview ZIP.

## Verification

The formal model gate passed 45/45 cases before the APK builds. Both signed APKs
passed the native input, curriculum freshness, database, illustration, voice,
ABI, signing and distinct-runtime guards. Packaged Windows passed actual CPU
inference and 768-dimensional embedding, English and Tagalog offline speech,
the twelve-question exam, resume/history, keyboard, zoom, carousel, out-of-order
navigation and screen-reader checks. The earlier curriculum source batch passed
139 tests; that evidence is retained separately from release qualification.

Read-back verification found all 308 lesson revisions and reading-flow labels
inside each package. All three contain the same database:
`a9e9c42eb649e16dd9d0652e01662b0e2a4106be2c2bdb4d4033a862f5918fc4`
(version `a9e9c42eb649`).

The first local verification rejected that byte hash because the reviewed
database was `844c1a2e1240…`. Diagnosis compared every column of every table,
including search blobs and fact ordinals: all values and schemas are exact.
Only the physical row ordering of the two token tables changed. Their builders
insert keys originating in Python sets without sorting, so the regenerated file
and its byte-derived version are not byte-reproducible. The token binary and all
eight lesson manifests also match exactly; the resident index differs only in
that database-version field. The failed check, full comparison and versioned
verification are preserved. The versioned verifier requires that exact comparison
proof and the measured packaged hash alongside the signing, platform and curriculum
checks. The source, compiler, APKs and canonical CI guards remain unchanged.

## Staging and activation

Candidate: `~/.hiraia/provisioner/releases/0.4.41-ea878f726521b51f`.
Rollback: `~/.hiraia/provisioner/releases/0.4.40-466cf804593718c9`.
The candidate contains the already tested recovery server, a fresh exact-APK
policy for the same 98 phones, and the unchanged Setup hold. Its policy was
exercised offline against the real signed APK. All 64 required mirror files
passed the existing size/digest validator.

The final staging check preserved all 98 registration identities, keys and issued
logs, 1,723 prior events and 22 prior offers. It confirmed the original LaunchAgent
and live 0.4.40 offer, healthy HTTP and pinned TLS, and withheld Setup/QR endpoints.
The temporary exact-commit signing-runner grant was removed after the Mac job;
the unchanged runner hook rejects an unapproved dispatch again.

Durable readiness, CI logs and downloads, exact artifact checks, database
comparison, staged policy, mirror evidence, activation command and rollback
procedure are under `build/curriculum-phone-rollout-20261009/`.
Use `readiness.json` and [the activation runbook](CURRICULUM-PHONE-ROLLOUT-20261009.md)
at 09:00. No new phone offer or public download pointer was activated during
preparation. Phone installation remains to be observed after activation; it is
not established by CI or staging success.
