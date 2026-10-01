# Teaching-link expansion — 28 September 2026

Integrated link records are in the affected [canonical batches](../batches/) and [review history](../teaching-link-review.json). The temporary proposal remains at `/private/tmp/hiraia-extra-links-biology.json`.

**12 manually accepted links across 12 current cards and 11 existing items; 8 candidates rejected.** The links and matching exposure IDs have been integrated into the canonical batches; question text and approval flags are unchanged.

Each accepted record was appended to `provenance.additional_teaching_cards`, with the same card ID added to `eligibility.recent_learning.source_card_ids`. The eleven affected item revisions were incremented; knowledge claims, families, question text, status and production flags were preserved.

## Observed shelf capacity changes

The calculation uses the actual generated Grade 7/8 lesson shelves and the current non-held draft item pool, with the proposed links overlaid in memory. Counts assume every linked claim in the shelf was encountered. They are upper bounds, not measured child exposure or proof of a viable twelve-question form.

| Actual lesson | Linked cards before → after | Distinct families before → after |
|---|---:|---:|
| g7:cell-observation — Observe Cells | 3 → 4 | 3 → 4 |
| g7:biological-levels — From Cells to the Biosphere | 3 → 8 | 3 → 6 |
| g8:photosynthesis-respiration — Photosynthesis and Respiration | 3 → 9 | 3 → 6 |
| g8:cell-energy-sites — Where Cell Processes Happen | 1 → 2 | 1 → 1 |

Grade 7 has 45 lessons and Grade 8 has 44. In this bounded overlay, each grade moves from zero to **one** single lesson with at least six distinct families. This does not fix broad coverage. Other lessons remain sparse.

The Grade 7 biological-levels gain comes from tissue, community and the explicitly taught heart-pumping example. The heart question remains Grade 4 material; a current Grade 7 card teaches that same fact. The Grade 8 photosynthesis gain adds existing producer, sunlight-energy and chloroplast-location questions. These remain their original material grades.

The follow-up selector still needs actual recent, profile-scoped exposures with matching presented language and teaching-body hashes. Benchmark overlap, recent repetition history and shared source identities can reduce the eligible pool below six. The findings do not justify promising 50% recent questions after ordinary use.

## Accepted records

| Item | Card | Reason |
|---|---|---|
| ha-g7-0023 | dcard-02649 / cell-membrane-g7 | All three languages explicitly say that the cell membrane controls what enters and leaves a cell. The material-composition statement is not separately assessed. |
| ha-g7-0034 | ffct-37964 / tissue-definition-g7 | All three bodies name tissue and say similar cells work together on one job, with specialized muscle tissue as the example. This supports the cell-cooperation definition, not the separate mastery of all organizational levels. |
| ha-g7-0037 | dcard-10280 / community-of-different-species-g7 | All three bodies explicitly name a community as populations of different species sharing one area. The keyed term and the different-population condition are both present. |
| ha-g4-0012 | ffct-37965 / organ-definition-g7 | The organ example explicitly says the heart pumps blood in all three languages. The existing Grade 4 recall item can be linked to this Grade 7 shelf exposure without relabeling it as Grade 7 mastery. |
| ha-g7-0037 | ffct-02184 / population-and-community-g6 | All three bodies directly contrast population with community and identify the latter as different populations living together in one place. Another encounter route to the same item/family, not another question. |
| ha-g7-0038 | dcard-09845 / global-scale-of-life-g7 | All three bodies explicitly identify the biosphere with every place on Earth where living things exist. The geographic examples illustrate that scope; no requirement to recall their names is added. |
| ha-g8-0038 | ffct-08550 / photosynthesis-needs-g5 | All three bodies explicitly list carbon dioxide as an input required to make food through photosynthesis. The gas is the only required recalled answer, not a complete balanced equation. |
| ha-g8-0039 | ffct-11099 / living-photosynthesis-g5 | All three bodies explicitly say plants release oxygen during photosynthesis. The item asks that product; it does not assess whether all atmospheric oxygen comes from land plants. |
| ha-g8-0040 | ffct-12465 / cellular-respiration-equation-g9 | All three bodies give glucose plus oxygen producing carbon dioxide and water, with energy released. The item explicitly limits its question to complete aerobic glucose respiration; the oxygen/glucose condition is present in this teaching equation. |
| ha-g6-0031 | ffct-08671 / epiphyte-photosynthesis-own-food-g6 | All three bodies explicitly say green plants make their own food through photosynthesis using sunlight. This is the keyed reason in the producer question; the question itself supplies the producer label. It does not ask the learner to generate an untaught label. |
| ha-g4-0011 | ffct-02609 / photosynthesis-light-energy-to-chemical-g8 | All three bodies identify sunlight energy used by plants in photosynthesis and stored in sugar. This supports the existing sunlight energy-source claim. Grass is the question’s ordinary green-plant context, not a newly assessed classification target. |
| ha-g7-0026 | ffct-11365 / light-reactions-photosynthesis-g8 | All three bodies explicitly locate named photosynthetic light reactions in chloroplasts. This supports the narrow chloroplast/photosynthesis answer for the question’s leaf setting. The water-splitting wording and ATP explanation are not assessed or certified by this link review. |

The complete English, Tagalog and Cebuano body was read for each proposed card. Full bodies are preserved as exact support substrings in the JSON; the same-claim judgment was manual. Topic labels or shared words did not create the links.

For `ffct-11365`, the accepted claim is only the explicitly named photosynthesis/chloroplast relationship. This does not certify the water-splitting translation or ATP wording. For `ffct-08671`, the item itself supplies the term producer and asks the reason; the card explicitly provides the keyed sunlight/own-food fact. Neither link claims the learner has demonstrated additional untaught vocabulary.

## Rejected candidates

- `ha-g6-0040` ← `ffct-37973`: Names water as nonliving but does not teach the tested word abiotic. Do not supply an untaught vocabulary equivalence through a topic link.
- `ha-g8-0027` ← `ffct-12566`: Teaches guard cells opening stomata after taking up water, but the recorded target claims both opening and closing. The closing action is absent.
- `ha-g7-0022` ← `ffct-37606`: Says to use fine focus at high power but does not explicitly teach the small-focus-changes property in the recorded claim. Kept as a lead rather than extending the exact claim.
- `ha-g7-0027` ← `ffct-37661`: Describes a stiff rectangular outer wall but does not explicitly teach its supporting role and location outside the membrane together. The existing question tests that compound description.
- `ha-g7-0027` ← `ffct-37612`: Contrasts stiff plant outer walls with animal membranes, but does not explicitly establish the supporting layer outside the plant cell membrane required by the current item.
- `ha-g8-0039` ← `ffct-17827`: The English says oxygen is made, while the Tagalog/Cebuano phrasing does not clearly preserve that production relation. Not accepted as trilingual evidence for oxygen production.
- `ha-g7-0026` ← `ffct-11933`: Says chloroplasts make food from sunlight, water and air but does not name photosynthesis, which is the scored answer. A different card explicitly names the process.
- `ha-g7-0024` ← `dcard-12788`: Explicitly discusses most DNA in eukaryotic nuclei, but does not identify ordinary human cheek cells as that cell type. Kept as a lead rather than assuming the learner already knows the extra classification bridge.

## Validation and limits

The existing `validate_teaching_links` function passed on all 11 proposed item copies, checking exact current snapshots, fact IDs, unchanged claims and family IDs, trilingual verbatim support, review status and matching recent-exposure IDs. That initial check used in-memory copies. The canonical records were subsequently updated as described above.

All reviews are author source checks with `independent: false`. Teacher, native-language and student-pilot approval remain pending. Twelve links create no new questions, no empirical growth metrics and no evidence of typical fourteen-day coverage.

## Integration record

Integrated at 2026-09-28T09:28:24+00:00. Affected canonical batch JSON files:

- `rag/assessment-authoring/batches/003-grade4-living-things.json`
- `rag/assessment-authoring/batches/015-grade6-living-things.json`
- `rag/assessment-authoring/batches/019-grade7-cells-and-life-organization.json`
- `rag/assessment-authoring/batches/023-grade8-systems-and-inheritance.json`

All four affected batch renders and validation reports were regenerated sequentially. Each passed all 25 mechanical controls with zero errors and zero warnings. These controls check traceability and invariants; they do not certify semantic or language quality.

Also rewritten: each batch’s `.md` and `.validation.json`, the shared `targets.md`, and `teaching-link-review.json`. The question bank, teaching pool, app and student data were not changed.
