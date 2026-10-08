# Hiraia 0.4.41 — local curriculum rollout preparation

Preparation began **9 October 2026, 00:00 GMT+8** for the user-authorized local
phone rollout at 09:00. The reviewed curriculum source is commit
`2e1940a7943c807cc832bc2c853836c5cb145be1` on
`codex/cebuano-curriculum-alignment-20261007`.

The candidate sets student version **0.4.41 / code 41** and asset-catalog revision
10, limited to code 41. Image-pack identities, bundled languages, signing identity
and native dependencies remain unchanged. It includes the broader Grade 3–10
reading pools, clearly clickable Curriculum rows, unread-only Read more and
grade-specific science collections. The curriculum contains 7,962 main-bank card
IDs plus 165 supplemental cards; held material is excluded. Required teaching
units, questions, quiz progress and profiles remain intact.

The completed source checks passed 139 tests. This is not yet a native-release
result. The scheduled preparation must obtain matching signed Android/ChromeOS
artifacts and the complete Windows packaged validation from one release commit,
including the formal model regression gate before APK builds. No artifact may
be offered on the strength of the source tests alone.

Preparation and final readiness receipts live under
`build/curriculum-phone-rollout-20261009/`. The baseline confirms that the live
immutable service is `~/.hiraia/provisioner/releases/0.4.40-466cf804593718c9` and
that the relevant uncommitted recovery server bytes match its pinned server.
The existing Hiraia-only fleet policy and rejected Setup APK hold must carry
forward, with a fresh exact-Hiraia-artifact policy for the new version. No new
Setup release, enrollment, factory reset, public release or default-branch merge
is authorized by this preparation.

Keep the current service active until the scheduled activation and all release
checks pass. Record measured hashes and actual process/CI exits in readiness;
do not replace them with planned commands or stale 0.4.40 evidence. The full
procedure and timing are in
[the rollout runbook](CURRICULUM-PHONE-ROLLOUT-20261009.md).
