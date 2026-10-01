# Incoming Grade 3 exam: existing-content reuse review

29 September 2026. Read-only model review; no questions authored, promoted or edited. “Exam” means the 12-item module in this internal document. Product wording is unchanged.

**There are zero approved incoming-Grade-3 items.** There are useful reuse leads: **20 closest existing draft candidates across 17 current knowledge families**, another **25 broader or more demanding draft leads**, and **25 targeted bank leads**. These groups are discovery inventory, not an approved exam pool; bank and draft leads overlap.

## Inventory and scope

The five Grade 3-material batches contain **76 drafts**, with 74 `source_checked` and two existing holds, across 67 current knowledge families. All explicitly say incoming Grade 3 is ineligible without separate foundational review. Their current readiness mapping is Grade 3 material for incoming Grade 4, not a foundation mapping for incoming Grade 3.

The shipping `quiz-bank-v2.jsonl` contains **40,619 unique fact-ID rows**. Only **14** carry a Grade 2 tag, none carries Grade 1, and **8,028** have no grade tags. There are 2,201 Grade 3-tagged rows. These are inventory tags, not evidence of earlier teaching. The Grade 2-tagged set itself includes particle/energy explanations, acid production, nocturnal vocabulary and a translation reversal.

The bank stores trilingual questions/options/explanations, a zero-based answer index and uneven legacy topic/grade/review metadata. It does not store the earlier-curriculum crosswalk, cohort match, knowledge/form families, prerequisites or exam approval required here. Some rows have a legacy `quiz-*` ID, while all have a `factId`. The [machine-readable ledger](candidate-map.json) preserves exact identities, claims, source hashes, all 76 draft decisions and all 14 Grade 2-tagged fact IDs.

All 76 draft English claims/stems/options were inspected, with trilingual inspection of the main shortlist and targeted bank leads. This was not an exhaustive quality review of 40,619 bank questions, nor native-language or teacher approval.

## Closest existing draft candidates — 20, still conditional

The Kindergarten 2016 anchors below were checked in the official-guide text retrieved by the parent at `/private/tmp/hiraia-grade3-readiness-20260929/kinder-2016.txt`, principally pp. 21–23. They are **possible supporting-knowledge mappings**, not proof that the exact item was taught. The parent is checking cohort applicability and the Grade 1/2 Makabansa crosswalk separately.

| Existing draft IDs | Narrow claim actually tested | Possible earlier-learning anchor / qualification |
|---|---|---|
| `ha-g3-0002`; `ha-g3-0003` | A gently stretched rubber band becomes longer; pressing can flatten soft clay. | Observed material changes, `PNEKPP-00-3`; longer/shorter, `MKME-00-2`; movement, `PNEKPP-00-4`. Recognition does not demonstrate manipulation. |
| `ha-g3-0004`; `ha-g3-0053` | New leaves show plant growth; a taller/larger kitten shows growth. | Observing plants/animals, `PNEKP-IIb-1` / `PNEKA-IIIh-2`. Already one shared growth family, not two independent targets. |
| `ha-g3-0007`; `ha-g3-0034`; `ha-g3-0035` | A carabao pulls a plow; pressing a door away is pushing; bringing a drawer toward oneself is pulling. | `PNEKPP-00-4`. The plow context needs familiarity review; 0034/0035 already share a family. |
| `ha-g3-0011`; `ha-g3-0048`; `ha-g3-0047` | A waving flag/moving leaves can signal wind; rain falling on dry ground wets it. | Weather `PNEKE-00-1` and familiar cause/effect `PNEKE-00-5`. The two wind items share one family. |
| `ha-g3-0013` | Separating used paper and food scraps into bins is sorting waste. | Environment care `PNEKE-00-4`, sorting by an attribute `MKSC-00-6`. Naming a practice is narrower than performing correct disposal. |
| `ha-g3-0023` | Sharp edges make broken glass capable of cutting skin. | Safe materials `PNEKPP-00-6`. Tests hazard recognition, not actual safe handling. |
| `ha-g3-0037` | A decrease from five equal-sized steps to two from a fixed tree means closer. | Nonstandard measurement/comparison `MKME-00-1` / `MKME-00-2`. Mixed numeracy and reading demand; not a pure spatial-vocabulary item. |
| `ha-g3-0058`; `ha-g3-0059` | A pigeon mainly flies with wings; a chicken picks up seeds with its beak. | Common animal body parts/movement/feeding, `PNEKA-IIIi-4`. Exact body-function mapping still needs review. |
| `ha-g3-0062` | A hen lays eggs, unlike a cat or goat. | Common-animal observation `PNEKA-IIIh-2`. This broad anchor alone does not establish prior egg-laying instruction. |
| `ha-g3-0067`; `ha-g3-0071`; `ha-g3-0072` | A goat needs clean fresh drinking water; a carabao eats grass; a parrot's tree-hole nest provides shelter. | Animal needs/care `PNEKA-III g-5/6` and feeding characteristics `PNEKA-IIIi-4`. Check distractor strength and local-context familiarity. |
| `ha-g3-0069` | A house protects a family from heavy rain by providing shelter. | Basic needs `PNEKBS-Ii-8`. “Shelter” remains English in both local-language options; familiarity must be checked, not assumed. |

The 25 secondary draft leads are `ha-g3-0001`, `ha-g3-0005`, `ha-g3-0006`, `ha-g3-0012`, `ha-g3-0014`, `ha-g3-0015`, `ha-g3-0017`, `ha-g3-0020`, `ha-g3-0022`, `ha-g3-0024`, `ha-g3-0028`, `ha-g3-0040`, `ha-g3-0041`, `ha-g3-0042`, `ha-g3-0043`, `ha-g3-0044`, `ha-g3-0046`, `ha-g3-0050`, `ha-g3-0054`, `ha-g3-0055`, `ha-g3-0057`, `ha-g3-0060`, `ha-g3-0064`, `ha-g3-0073`, and `ha-g3-0074`. These include familiar contexts but also added mechanisms, specific facts, terminology or reading demands. Their exact claims are in the ledger. They are not included in the 20-item first shortlist.

## Bank leads that could fill missing targets

These are **reuse/revision leads**, not extra approved items. Exact claims, option counts and cautions for all 25 are recorded in the ledger.

| Area | Exact bank fact IDs worth examining | What to preserve / review |
|---|---|---|
| Body and senses | `eyes-for-seeing-g3`, `colors-of-objects-g3`, `eyes-tell-size-color-shape-g3`, `ears-for-hearing-g3`, `nose-for-smelling-g3`, `the-nose-and-smelling-g3`, `skin-for-touching-g3`, `tongue-organ-of-taste-g3` | Basic body-part/function matches fit the kind of claim described by `PNEKBS-Id-2` / `PNEKBS-Ic-4`. Three eye items and two nose items repeat knowledge; the ear question is negative. Review all explanations and local-language wording. |
| Observable properties | `classifying-solids-by-color-g3`, `classifying-solids-by-texture-g3`, `grouping-by-texture-g3`, `colors-of-solids-g3` | Color/texture recognition may support `PNEKPP-00-1`; recognizing the word does not show actual sorting or observation. “Solid” adds unnecessary scope for a basic property target. |
| Weather/clothing/safety | `sunny-weather-g3`, `windy-weather-g3`, `weather-conditions-g3`, `cloudy-day-safety-g3`, `weather-safety-steps-g3` | Weather descriptions, warmth from clothing, and safe shelter are leads for `PNEKE-00-1/2/6`. Check weather-label overlap, sunny/hot translation, distractor boundaries and precise safe-shelter wording. |
| Plant and animal care | `rain-waters-plants-g3`, `plant-care-needs-g3`, `caring-for-pets-and-farm-animals-g3` | Rain supplies water; watering meets a plant need; regular feeding helps pets. Plant watering's singing/painting distractors and the pet item's toys/grow-faster foils are weak. |
| Basic needs/body care | `what-basic-needs-are-g3`, `handwashing-before-eating-g3` | Naming food/water as basic needs; why soap-and-water handwashing matters before eating. The latter has four options and over-certain prevention wording; neither is admitted by its topic or grade tag. |
| Position/movement | `position-words-g3`, `describing-position-g3`, `moving-closer-g3` | These mostly name categories or define movement. They do not directly ask a child to identify in/on/over/under/top/bottom relationships (`MKSC-00-12`). “Moving closer” also assumes the viewer is the reference point. |

## Exclusions and concrete bank problems

**31 existing drafts are excluded as written from this conservative foundation shortlist.** This is a review boundary pending stronger earlier-learning evidence, not a claim that younger children cannot know the facts. The ledger lists every ID.

Examples include formal force/friction (`ha-g3-0033`, `ha-g3-0036`); opaque and light transmission categories (`ha-g3-0009`); sound-production mechanisms (`ha-g3-0008`, `ha-g3-0038`, `ha-g3-0039`, `ha-g3-0075`, `ha-g3-0076`); metals/manufacturing (`ha-g3-0026`, `ha-g3-0027`, `ha-g3-0030`, `ha-g3-0032`, `ha-g3-0045`); and reproduction, proboscis, water transport, leaf food-making and pollen (`ha-g3-0056`, `ha-g3-0061`, `ha-g3-0063`, `ha-g3-0065`, `ha-g3-0068`, `ha-g3-0070`). Observable motion or caring for a plant does not automatically justify these mechanisms or labels.

Both existing holds stay excluded: `ha-g3-0010` for pottery/firing vocabulary and `ha-g3-0049` for reflected-Moon-light scope. The Sun-shadow procedure in `ha-g3-0052` is not equivalent to a simple “do not look directly at the Sun” safety claim.

The targeted bank inspection found real reasons to reject blanket reuse:

- `basic-needs-of-life-g3` asks what comes “right after food”; `basic-plant-parts-g3` asks what comes “right after roots.” Neither supplies a meaningful unique sequence.
- `avoid-sharp-objects-g3` actually asks for the label “sense organs.” Its ID is not evidence of safety coverage.
- `wash-hands-when-g3` categorically treats handwashing after eating as unimportant. Exclude the item as written.
- `why-bubbles-pop-g3` has English air escaping but Cebuano air entering (`mosulod`). `germs-too-spread-hands-g3` uses Tagalog `pinakadalang` against English “most easily.” Both need repair/review, despite Grade 2 tags.
- `grouping-by-color-g3` does not specify color uniquely by saying “how they look.” `rainy-weather-g3` infers rain from wet ground without a rainfall condition; draft `ha-g3-0047` already supplies that condition.

## Rotation and remaining work

Twenty first-priority leads are only **17 current knowledge families**. They cannot even supply two complete 12-item exams under a maximum of two exact repeats: the first two forms require at least **22 distinct items**. The first four require at least **42** (`12 + 10 + 10 + 10`), before applying blueprint slots, family uniqueness, language, cohort or exposure restrictions. These are necessary structural floors, not sufficient pool sizes or validated equivalent forms.

The existing incoming-Grade-4 rotation result does not transfer: its sound, plant-function and Sun benchmark slots have not been approved for this earlier foundation scope. Renaming the blueprint would preserve inappropriate assumptions.

The existing **60–80-item planning allowance** remains reasonable to investigate, with reuse/revision counted separately from new authoring. Freeze the earlier-learning targets first, select genuinely distinct forms per slot, then run the actual selector against baseline and repeated follow-ups with sparse recent exposure. Do not count several phrasings of one eye/nose fact as several competencies.

The likely authoring/revision gaps are direct positive body-sense matches; simple plant care and needs; actual spatial relationships with an explicit referent; concrete observable-property comparisons; and short, plausible alternate forms for safe actions/weather choices. All still need exact earlier-curriculum mapping, individual cohort applicability, source fidelity, native-language and teacher review, meaningful distractors, exposure links and rotation validation. No item was approved or promoted by this audit.
