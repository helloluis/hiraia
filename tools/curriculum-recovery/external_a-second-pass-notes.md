# external_a second-pass coordinator notes

Status: **complete_pending_integration**. Do not apply, mutate tags/authoring, commit, push, build, or deploy.

## Totals
- Assigned: 2836
- Reviewed: 2836
- Proposed recoveries: 490
- Holds: 2346
- Packets: batch-10000 through batch-10070 (70×40 + 36)

## Dry-run
Independent `apply.py` (no `--apply`) at packet completion passed for each packet. A later full re-run found **26 packets** now failing `previousExclusion` identity because `curriculumTagExclusions.json` changed after those reviews (local coordinator integrations of other partitions). Live file is missing or restated the exclusion string for some proposed recoveries.

- Packets still passing dry-run: 45
- Packets with exclusion-identity drift: 26 (batch-10000 through about batch-10025)
- Recovery rows with exclusion mismatch: 314

The local coordinator should re-check `previousExclusion` against the current exclusions file before applying, and inspect rather than overwrite.

## Common hold classes
- Duplicate stable-ID variants with disagreeing EN
- Diagram/table/investigation/chart activity facets
- Keyword/regex traps (eat⊂heat/wheat, hat⊂that, shell, fin, light, rain)
- Missing current facet (density/buoyancy, mole/% composition, incomplete metamorphosis, GPS without plate displacement)
- Translation defects (pag-uyon, malaglag, magaan for density, putyukan vs wasp)
- Factual overclaims (Ceres ice shell, Jupiter distance, PH blood types, Vigan adobe, Everest boiling point)

## Files owned
- `tools/curriculum-recovery/batch-10000.packet.json` … `batch-10070.packet.json`
- matching `.review.jsonl` and `.notes.md`
- `tools/curriculum-recovery/external_a-second-pass-state.json`
