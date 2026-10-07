# Full-year curriculum audit — Cebuano handoff

7 October follow-up: [local Cebuano alignment is complete](CEBUANO-CURRICULUM-ALIGNMENT-20261007.md)
on `codex/cebuano-curriculum-alignment-20261007`. That record covers both handoffs,
exact source edits, assessment-link review and the new **unpublished** vector asset.
Native-language and classroom certification remain pending. The 5 October scope
and evidence below are preserved as the historical handoff.

5 October 2026. **Content changes complete; native language review pending.** Scope: Science Grades 3–10, all three terms. This extends [the Term 2 handoff](TERM2-PILOT-CEBUANO-HANDOFF.md); preserve those earlier fixes.

This pass added **42 trilingual teaching cards**, added/replaced **35 questions on existing facts**, and made **20 persistent science corrections** (19 rendered cards and 19 grounding facts, with overlapping sets). Exact before/after scope is relative to commit `f540e6b0d`. [Machine-readable changes](full-year-content-changes.json) lists every affected ID and the correction payloads.

Review scientific meaning against English. New Tagalog/Cebuano text is a candidate for language review, not certified native prose. Keep card/fact IDs, answer indices, units, quantities and scientific limits. Do not restore excluded lesson candidates merely because their translation is fluent.

## Authoritative files

- New cards and 35 question additions/replacements: `packages/mobile/src/data/gradeNLessonSupplement.json`. Review `title`, `fact`, and question `q`, each `o`, and `e` in `bis` (and flag English/Tagalog issues separately). New card IDs equal their fact IDs.
- Persistent corrections: `rag/pipeline/full-year-content-corrections.json`. Edit this source overlay first; generated pool/bank edits alone will be overwritten.
- Teaching/quiz selection decisions: `rag/pipeline/full-year-review.json` and the earlier `term2-pilot-review.json`. These changes select existing content and do not themselves change translations.
- `three-domains-of-life-g8` has a correct pre-existing question override in the Grade 8 supplement, also preserved in the correction overlay. Keep both copies synchronized if translating it.

## New cards and existing-question changes

### Grade 3

Explicit teaching/quiz selections; new safe sorting, ruler measurement, message testing and sky-record activities; six focused question replacements/additions.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g3-year-safe-sorting` | Sort Materials Safely | G3-M-7 |
| `g3-year-measure-length` | Measure From Zero | G3-M-4 |
| `g3-year-message-test` | Test a Message | G3-F-8 |
| `g3-year-sky-record` | Keep a Sky Record | G3-E-6, G3-E-7 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `growth-in-living-things-g3`
- `makahiya-folds-wind-rain-g5`
- `malleable-materials-g4`
- `copper-best-everyday-conductor-wires-g6`
- `drum-membrane-vibrates-g5`
- `planning-with-weather-g4`

Meaning to preserve: Teacher observes hands-on work. New translations require language audit.

### Grade 4

Explicit selections, five trilingual activities, five questions on existing cards, and cross-bank lightning safety corrections.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g4-year-invention-interview` | Ask About an Invention | G4-M-2 |
| `g4-year-life-cycle-charts` | Compare Life-Cycle Charts | G4-L-5 |
| `g4-year-soil-drainage` | Compare Soil Drainage | G4-E-1 |
| `g4-year-soil-growth` | Test Soil and Growth | G4-E-3 |
| `g4-year-weather-log` | Read a Weather Log | G4-E-4, G4-E-5, G4-E-6 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `transport-system-g6`
- `shoot-system-g4`
- `living-basic-needs-g3`
- `fwg-heat-radiation-1351`
- `hotness-or-coldness-g4`

Meaning to preserve: Secondary-source research and classification/diagram production remain teacher-observed; app responses are not proof of completing these tasks.

### Grade 5

Explicit selections; five new activities/reference cards; six question additions/replacements; PAGASA wind ranges verified 2026-10-05. Preserve the plant/animal adaptation term split.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g5-year-liquid-mass` | Does Water Have Mass? | G5-M-1, G5-M-9 |
| `g5-year-circuit-test` | Build and Test a Circuit | G5-F-8, G5-F-9 |
| `g5-year-electromagnet-test` | Switch a Magnet On | G5-F-10 |
| `g5-year-rock-record` | Observe Before Naming | G5-E-2, G5-E-3 |
| `g5-year-wind-signals` | Read Wind Signals | G5-E-9 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `large-intestine-absorbs-water-g5`
- `potato-tuber-underground-stem-g6`
- `plant-thorns-spines-defense-g5`
- `fwg-mass-of-gases-2239`
- `seagrass-roots-rhizome-spread-g7`
- `inner-planets-rocky-vs-outer-gas-g5`

Meaning to preserve: Teacher checks diagrams, experiments and classification tables. Warning reference is educational and cannot replace live local bulletins.

### Grade 6

Explicit selections retain sound existing practicals; four new trilingual cards, four focused questions, and a sourced card/quiz/grounding correction for Balatik.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g6-year-separation-choice` | Choose a Separation Method | G6-M-6, G6-M-7 |
| `g6-year-volcano-map` | Map Local Volcano Risk | G6-E-2 |
| `g6-year-read-alert` | Read the Whole Bulletin | G6-E-5 |
| `g6-year-sky-sources` | Document Sky Knowledge | G6-E-10 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `scooping-technique-g6`
- `moving-receiver-on-a-bike-g6`
- `crops-and-their-seasons-g7`
- `stars-as-a-seasonal-clock-g6`

Meaning to preserve: Retain the existing correction to the BOW’s reversible/irreversible overgeneralization. Volcano maps/bulletins and community interviews require current local sources and teacher assessment; no live alert claimed.

### Grade 7

Five new trilingual teaching cards, two equipment questions, and explicit selection for every remaining official slot. Retain accurate existing practicals and their limits on litmus, microscope observations, solubility, solvent volume and graph direction.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g7-year-cell-compare` | Compare Cell Parts | G7-L-2, G7-L-4 |
| `g7-year-heat-effects` | Helpful and Harmful Heat | G7-F-9 |
| `g7-year-philippine-faults` | Why Faults Move Here | G7-E-2 |
| `g7-year-local-quake-plan` | Read Our Earthquake Plan | G7-E-6 |
| `g7-year-globe-light` | Model Sunlight and Day Length | G7-E-10, G7-E-11 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `flat-surface-reading-g7`
- `lab-safety-gear-g7`

Meaning to preserve: Maps and local evacuation drills require teacher and local-authority verification. A graph of distance alone cannot establish unchanged direction. Practical demonstrations are not certified by quizzes.

### Grade 8

Five trilingual practical/example cards, five focused question overrides, four source corrections, and reviewed selections across the remaining official slots.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g8-year-family-model` | A Fictional Family | G8-L-4 |
| `g8-year-particle-table` | Compare Atomic Particles | G8-M-3 |
| `g8-year-track-storms` | Plot a Recorded Storm | G8-E-8 |
| `g8-year-rance-example` | A Tidal Power Example | G8-E-12 |
| `g8-year-observe-acceleration` | Observe Changing Motion | G8-F-1, G8-F-2 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `xylem-water-transport-g6`
- `photosynthesis-detailed-g7`
- `aerobic-respiration-g10`
- `pagasa-agency-weather-g4`
- `perpendicular-force-no-work-g8`

Meaning to preserve: Fictional single-gene families avoid unsupported claims about real relatives. Historical typhoon tracks are not live forecasts. Photosynthesis tests and light investigations retain teacher supervision.

### Grade 9

Five trilingual teaching cards, five focused questions, two persistent science corrections, and explicit selections for all remaining slots. Include the Term 2 weeks 10–11 ecosystem diagrams and survey block previously outside pilot scope.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g9-year-cart-test` | Test Force and Mass | G9-F-2, G9-F-3 |
| `g9-year-current-safety` | Current and Safe Circuits | G9-F-6 |
| `g9-year-circuit-comparison` | Compare Circuit Designs | G9-F-7, G9-F-9 |
| `g9-year-boundary-map` | Compare Boundary Evidence | G9-E-2 |
| `g9-year-dna-traits` | From DNA to Traits | G9-L-2 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `fwg2-x-ray-machine-1932`
- `radioactive-decay-cancer-treatment-g10`
- `water-molecule-two-covalent-bonds-g9`
- `ammonia-formula-nh3-g8`
- `atomic-eight-two-plus-six-g9`

Meaning to preserve: Preserve the BOW as evidence while qualifying its shorthand: current is charge flow, covalent networks exist, and physical changes in intermolecular interactions are not alone proof of a new substance. Practical work remains teacher assessed.

### Grade 10

Nine trilingual practical/example cards, two focused questions, four source corrections and reviewed selections for every remaining official slot, including Term 2 weeks 1–2 and 10–11.

| New card / fact ID | English title | Competencies |
|---|---|---|
| `g10-year-momentum-test` | Test Stopping Motion | G10-F-5 |
| `g10-year-reaction-evidence` | Clues Need Evidence | G10-M-1 |
| `g10-year-indicator-test` | Compare Two Indicators | G10-M-2 |
| `g10-year-rate-test` | Measure Reaction Rate | G10-M-8 |
| `g10-year-mass-accounting` | Account for All Matter | G10-M-5, G10-M-6, G10-M-7 |
| `g10-year-collision-sources` | Check Safety Evidence | G10-F-7 |
| `g10-year-power-route` | From Plant to Home | G10-F-9 |
| `g10-year-energy-plan` | Plan an Energy Saving | G10-F-12 |
| `g10-year-selection-discussion` | Discuss Population Change | G10-L-3, G10-L-4 |

Questions on existing fact IDs (`q`, `o`, `e`):

- `balancing-blood-pressure-g10`
- `gnss-networks-g10`

Meaning to preserve: Chemical clues are not proof by themselves; unchanged indicator color does not identify salts; dissolving sugar is not a reaction-rate experiment. Keep existing qualifications for plate predictions, mostly solid asthenosphere, projectile angles and climate mitigation/adaptation. Group tasks and practical skills require teacher assessment.

## Persistent science corrections

All fields supplied by the overlay are in scope. Some correct facts previously had no quiz; the overlay does not invent a bank row when none exists.

| Card ID | Grounding/source fact ID | Correction |
|---|---|---|
| `ffct-22620` | `lightning-crouch-low-g6` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `ffct-24472` | `lightning-avoid-crouch-low-g5` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `ffct-24485` | `lightning-avoid-hair-warning-sign-g6` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `ffct-25169` | `safety-lightning-crouch-open-g6` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `ffct-27183` | `fwg-lightning-safety-954` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `ffct-30102` | `crouch-low-if-caught-outside-g6` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `ffct-35122` | `fwg-lightning-safety-216` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `ffct-36314` | `fwg2-lightning-safety-349` | NWS withdrew the lightning crouch recommendation; a posture or warning sign does not make outdoor exposure safe. Remove illustration and titles promoting that posture. |
| `grounding only` | `lightning-strikes-crouch-low-safety-g6` | Grounding-only duplicate of the outdated outdoor crouch instruction. |
| `ffct-35419` | `fwg-stars-556` | Balatik is incorrectly assigned to Ursa Major; remove the unsupported universal perfect-planting-time claim. |
| `ffct-27027` | `fwg-forms-of-energy-1154` | A moving coaster need not stop at the crest or convert all kinetic energy to potential energy. |
| `ffct-23394` | `work-needs-force-along-motion-g8` | The old same-direction-only rule excluded negative work. |
| `ffct-15822` | `compound-fixed-ratio-g7` | Fixed composition means a ratio, not an absolute amount of each element. |
| `dcard-02924` | `three-domains-of-life-g8` | Align the teaching statement with molecular classification, not habitat alone. |
| `ffct-20639` | `bonding-is-chemical-change-g9` | Qualify the curriculum bond-change shorthand: intermolecular changes in melting alone do not establish a new substance. |
| `ffct-39803` | `reliable-investigation-meaning-g9` | Remove the false exact-results-every-time guarantee and distinguish repeatability from validity. |
| `ffct-24100` | `momentum-mass-conserved-total-g10` | Closed to matter is not sufficient for momentum conservation; net external impulse is the relevant condition. |
| `ffct-21914` | `inelastic-collision-g10` | Distinguish inelastic from perfectly inelastic and state the external-impulse condition. |
| `ffct-21910` | `impulse-longer-time-less-force-g10` | The impulse relationship constrains average force, not the force at every instant. |
| `ffct-26284` | `seatbelt-purpose-inertia-g6` | The question incorrectly called inertia a force. |

The lightning changes remove titles and illustrations that taught crouching outdoors. Balatik now identifies Orion, with National Museum attribution and community differences; its unverified illustration is removed. Three further illustrations were removed: a mass-balance picture on momentum (`ffct-24100`), an exclusively sticking collision picture (`ffct-21914`), and ramp balls on the seatbelt card (`ffct-26284`). `ffct-20639` also has a new title, “Spot a Chemical Change,” and four correction topics were qualified. All supplied `title`, `topic` and `slug` fields must propagate. Illustrations elsewhere were not comprehensively reviewed.

## Translation and regeneration checks

Read `docs/TRANSLATION-LEXICON-DEFECTS.md` and the Cebuano audit plan before editing. Check Cebu Cebuano usage through the corpus and a dictionary when needed; rarity alone is not an error. Preserve exact-substring emphasis. English science terms may remain English. Do not remove qualifications such as **average** stopping force, **net external impulse**, or clay water retention versus water available to plants.

Before changing grounding text, copy `rag/bank/science-facts.jsonl` to a local baseline whose hash matches the current vector metadata. After source edits, propagate in this order:

```sh
python3 rag/pipeline/content_corrections.py
python3 rag/pipeline/gen-cards-questions.py
# If grounding text changed: refresh its vectors against the saved baseline,
# publish a NEW immutable vector filename, and update edition.ts filename/MD5.
python3 packages/mobile/scripts/build-assessment-bank.py
python3 rag/pipeline/build-cards-db.py
for grade in 3 4 5 6 7 8 9 10; do
  python3 rag/pipeline/compile-lessons.py --grade "$grade"
done
python3 packages/mobile/scripts/build-lesson-similarity.py
pnpm --filter @hiraia/web competencies:generate
python3 rag/pipeline/audit-full-year.py --check-db
```

The similarity/vector scripts need the documented NumPy/LaBSE environment. The English review lock allows translation-only edits; do not run `--record-review` merely to make a changed English assertion pass. Investigate any review mismatch and explicitly re-review the science first. Run the grade/full-year/pilot/Calendar tests and assessment checks after regeneration.

## Validation and release boundary

The [audit report](FULL-YEAR-CURRICULUM-AUDIT.md) records coverage, sources and final checks. There are 322 listed competencies and 1,032 reviewed teaching slots. Practical investigations, drawing graphs, discussion and research still require teacher observation. This is not an audit of every discovery-library card or a fluency certification.

These changes are not in the previously published 0.4.30 APK. No new APK, version bump, app deployment or commit is included in this audit. The refreshed retrieval vectors are a separate immutable dependency for the next build.
