# Grade 9 curriculum audit and implementation

Completed on unified, 2026-09-09. Grade 9 and 10 were authorized together. No APK was built, installed or published in this pass.

## Before and after

| Area | Before | After |
|---|---|---|
| Calendar | 21 broad topics exhausted their inventory | 46 bounded lessons in competency order |
| Curriculum coverage | Tags and category labels did not prove each named skill | 46 competencies, 156 explicit coverage slots, no empty teaching/quiz slots |
| Category crosswalk | No reviewed crosswalk for this grade | All 35 labels mapped as direct, supporting or enrichment |
| Gap filling | Missing instruction and unassessed existing facts | 19 new trilingual cards and 26 questions, including 7 on existing facts |
| Candidate quality | Incidental-word matches and misleading explanations | Narrower filters and 28 documented grade-scoped exclusions |
| Reachable facts | 1,638 in broad chronological topics | 1,628 in core plus rotating related examples |
| Progress | Broad-topic cursor | Exact profile/grade lesson run persists and restores |

Quarter order: Q1 Force/Motion/Energy; Q2 Earth/Space; Q3 Life; Q4 Matter. The shared compiler checks each competency against its guide quarter; the runtime uses the curriculum quarter map for supplemental card weighting.

## Content and sequencing fixes

- Action–reaction diagrams distinguish forces on different bodies from balanced forces on one body.
- Circuit instruction uses teacher-supervised low-voltage batteries, open-switch assembly and correct meter placement.
- Earth-layer drawings distinguish overlapping mechanical and compositional schemes; radiocarbon and exact-age overclaims are excluded.
- DNA models, mutation causes/effects, ecosystem diagrams and anonymous environmental survey planning now have offline teaching and assessment material.
- Conservation classification uses scientific names and explicitly dated DENR examples, including plants as well as animals. It does not present an undated global status as a permanent national label.
- Chemical formula ratios, covalent-network exceptions, metallic malleability and supervised property investigations receive explicit treatment.

The authored targets are 20 or 30 cards. Required teaching/quiz anchors are retained while additional, competency-matched examples rotate across visits. Fact aliases are deduplicated. Short pools finish early without invented filler. Random/keyword discovery is unchanged. No global tags were rewritten in this pass; the scoped exclusions are recorded in `grade9-scoped-exclusions.json`. `grade9-tag-corrections.json` is empty intentionally.

## Content richness and limits

Core candidate pools contain **1,122 distinct facts**. The related shelves keep another **506** reachable beyond those narrow core filters. That is an internal core-versus-total comparison, not a claim of that many newly authored facts. Compared with the previous broad route, reach changes by -10, reflecting new cards and intentional exclusions.

| Visits to every lesson | Distinct facts viewed in simulation |
|---|---:|
| 1 | 960 |
| 3 | 1,479 |
| 5 | 1,607 |
| 10 | 1,628 |
| 20 | 1,628 |

A first pass presents **971 cards across lessons**, containing **960 distinct facts** (some anchors recur between lessons). At 20 seconds per presentation this is **5h 23m 40s**, excluding quizzes, recaps and practical work. Simulations are not measured student engagement.

13 lessons have fewer distinct candidates than their target:

| Lesson | Eligible facts | Target |
|---|---:|---:|
| Investigate Force, Mass, Acceleration | 19 | 20 |
| Investigate Circuits | 25 | 30 |
| Evidence for Continental Drift | 18 | 20 |
| Three Plate Boundaries | 15 | 20 |
| Small Worlds, Early Solar System | 20 | 30 |
| DNA, Genes, and Inheritance | 28 | 30 |
| How Mutations Arise | 22 | 30 |
| Different Effects of Mutations | 21 | 30 |
| Label Philippine Ecosystems | 16 | 30 |
| Plan an Environmental Survey | 6 | 20 |
| Name Ionic Compounds | 26 | 30 |
| Share Electrons in Molecules | 18 | 20 |
| Compare Bonding and Properties | 27 | 30 |

Coverage here means every authored facet has instructional material and an associated offline question. It is not proof that a multiple-choice question assesses the entire competency: teacher-led experiments, source research, surveys, diagrams and debates still need real performance assessment. Some practical cards contain prompts to consult a reference; their explanatory text and quiz work offline, but the referenced publications are not bundled into the APK. Language and classroom review remain appropriate. This is a targeted curriculum-routing audit, not a complete factual certification of the entire 50k bank.

## Validation

- 67 tests passed across Grades 3–10, Calendar selection/defaults, real feed walks, restoration, quiz series, recaps and regression links.
- Real-feed tests check every Calendar lesson remains visible (the minimum of three facts is preserved), quarter weighting, repeated-visit coverage and eventual reach of every eligible fact.
- TypeScript type-check passed.
- Grades 3–8 simulated core counts, total reach and all revisit projections are byte-for-byte equivalent as parsed report objects to the pre-Grade-9/10 report.
- Build validation now checks both grade manifests in addition to the previous grades.

## Sources and scope

- Curriculum baseline: `rag/sources/curriculum-guides/matatag-jhs-competencies.json`, the previously verified August 2023 MATATAG Science Grades 3–10 extract. Its verification metadata records comparison against the curriculum PDF. This pass does not certify alignment with later curriculum revisions.
- [CDC radiation comparison](https://www.cdc.gov/radiation-health/about/non-ionizing-radiation.html): distinguishes exposure and radiation type.
- [NHGRI mutation definition](https://www.genome.gov/genetics-glossary/Mutation): copying errors, mutagens, viral infection and inheritance distinction.
- [USGS Earth interior](https://pubs.usgs.gov/gip/dynamic/inside.html) and [solid asthenosphere clarification](https://www.usgs.gov/faqs/are-tectonic-plates-floating-magma): mechanical versus compositional layers.
- [USGS plate-motion explanations](https://pubs.usgs.gov/gip/dynamic/understanding.html) and [This Dynamic Planet](https://pubs.usgs.gov/imap/2800/TDPback-screen.pdf): boundary settings, mountain building and slab dehydration.
- [PHIVOLCS trench map](https://gisweb.phivolcs.dost.gov.ph/arcgis/rest/services/PHIVOLCSPublic/Trenches/MapServer) and [Philippine Fault mapping](https://www.phivolcs.dost.gov.ph/philippine-fault-zone-maps/): local geological map work.
- [NASA meteor explanation](https://science.nasa.gov/solar-system/meteors-meteorites/): recurring debris encounters.
- [DENR-hosted 2019 plant survey, Table 1-22](https://eia.emb.gov.ph/wp-content/uploads/2019/12/MS_eia-report_nov-2019.pdf) and [2022 hearing documentation](https://eia.emb.gov.ph/wp-content/uploads/2022/10/AWTIP-T5-Public-Hearing-Documentation-101722-reduce.pdf): dated DAO 2017-11 plant categories. These are supporting reports applying the list, not a claim that a new national reassessment occurred in 2026.
- [DENR kalaw report applying DAO 2019-09](https://calabarzon.denr.gov.ph/news-events/bundok-irid-sa-probinsya-ng-rizal-patuloy-na-nagsisilbing-kanlungan-ng-tayabak-rafflesia-kalaw-at-iba-pang-mahahalagang-buhay-ilang/): national Vulnerable example with scientific name.
- [NICHD assisted reproduction](https://www.nichd.nih.gov/health/topics/infertility/conditioninfo/treatments/art): IVF explained without conflating it with gene editing.
