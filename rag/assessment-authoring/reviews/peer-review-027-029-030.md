# Independent model review: batches 027, 029 and 030

28 September 2026, 17:26 GMT+8. This is a separate model review, **not native-speaker, teacher or student-pilot approval**. No canonical files were changed.

All 60 canonical items were read in English, Tagalog and Cebuano, including stems, options, keys, explanations, claims and primary teaching snapshots. No definite translation-induced reversal of a keyed answer was found. The findings concern an ambiguous answer, teaching provenance and weak distractors; these are not a zero-defect pass.

Both seeded weaknesses were detected in the actual current versions: G9-0037's all-salt/all-tides options and G10-0017's atom-transmutation option. **2/2 positive controls detected; this is not an estimated overall recall or precision score.**

## Required repairs before treating these as defensible assessment items

### ha-g9-0061 — high: Pangaea/Gondwana stem is under-specified

The stem asks for a supercontinent that later broke into today's continents without saying nearly all continents were united. Gondwana also broke into several present continents, making a literal reading of that foil defensible. USGS describes Gondwana as a supercontinent and distinguishes its extent from Pangaea: [USGS African geology report](https://pubs.usgs.gov/of/2005/1294/e/OF05-1294-E.pdf).

Keep options and key. Replace the stem:

- EN: **What was the single supercontinent that joined nearly all of today's continents before they separated?**
- TL: **Ano ang tawag sa iisang supercontinent na dating kinabibilangan ng halos lahat ng mga kontinente ngayon bago sila naghiwa-hiwalay?**
- BIS: **Unsay tawag sa usa ka supercontinent nga kaniadto naghiusa sa halos tanang kontinente karon sa wala pa sila nagbulag?**

The existing primary card's one-giant-landmass claim supports this distinction. No new date needs to be tested.

### ha-g10-0001 — high: claimed evidence judgment is not taught by its current source

The item claims to measure possible versus conclusive evidence, but its primary card asserts that a color change means a reaction/new substance. Its distractors concern mass gain and changing elements; a child who still believes every color change proves a reaction would select the same key. Thus the item cannot establish the claimed nuance even when answered correctly.

**Replacement provided separately:** `/private/tmp/hiraia-replacement-g10-0001.json` is a full draft specification with new target, primary source and bank provenance. It uses `dcard-11406` / `mixing-juice-powder-g9`, which explicitly teaches a physical change with retained identity in all three languages, and revises existing bank question `fwg-dissolving-sugar-2762`. The original bank question tests physical versus chemical dissolution; the revision changes the taught example to juice powder in water. Count as a revision, not a new item.

Replace the complete source snapshot and target ledger row; do not attach this new question to the old color-change source. Family `physical-change-no-new-substance` deliberately matches the existing Grade 6 physical-change family. The comparison supports G10-M-1 but does not establish full reaction-evidence mastery. Its prompt supplies the no-new-substance condition, so report classification recall only.

The source search also found `ffct-17163` / `signs-of-multiple-clues-stronger-g8`, but its Cebuano upgrades English “more sure” to certainty; it is unsuitable as sole proof of the intended uncertainty. `dcard-05563` / `colored-water-mixture-g6` describes food-coloring mixtures but does not explicitly teach physical-change classification. Do not silently approve either as an exact exposure link.

The shipping color-change overclaim remains a source repair task. [OpenStax Chemistry 2e](https://openstax.org/books/chemistry-2e/pages/1-3-physical-and-chemical-properties) explicitly gives grinding with a possible color change as a physical-change example; observed color alone is not proof.

### ha-g9-0037 — high measurement weakness: two fantasy-scale distractors

“Remove all salt from the sea” and “stop all tides” can be rejected without knowing anything about mangrove habitat. Keep the same root-shelter claim but test which plant structure provides that shelter. Proposed complete stem/options, with `o1` remaining correct:

| | EN | TL | BIS |
|---|---|---|---|
| Stem | Which part of a living mangrove tree provides sheltered spaces underwater for young fish? | Aling bahagi ng buhay na puno ng bakawan ang nagbibigay ng masisilungang lugar sa ilalim ng tubig para sa maliliit na isda? | Unsang bahin sa buhing kahoy sa bakhaw ang naghatag og masilongang mga dapit ilalom sa tubig alang sa gagmayng isda? |
| o1 | Its roots | Mga ugat nito | Mga gamot niini |
| o2 | Its flowers | Mga bulaklak nito | Mga bulak niini |
| o3 | Its fruits | Mga bunga nito | Mga bunga niini |

Retain the root-shelter explanation. Revised rationales: o2 confuses reproductive flowers with the submerged shelter structure; o3 confuses reproductive fruits with the submerged root network. This remains an easy recall question, but all three alternatives are real parts of the same plant rather than invented ecosystem powers. Native review should check the age-versus-size wording in TL/BIS; the teaching card itself uses small fish.

### ha-g10-0017 — high measurement weakness: incorrect options eliminate themselves

The atom-to-new-element foil is unrelated to the mechanism, while the mass-gain foil contradicts equal masses in the stem. Proposed question tests the exposed-surface relation directly and avoids both defects. Keep `o2` correct:

| | EN | TL | BIS |
|---|---|---|---|
| Stem | For equal masses of the same solid, which form usually exposes more total surface to a reacting solution? | Sa magkaparehong mass ng iisang solid, aling anyo ang karaniwang may mas malaking kabuuang surface na nakadikit sa solution na ka-react nito? | Alang sa parehong mass sa samang solid, unsang porma ang kasagarang adunay mas dakong kinatibuk-ang surface nga ma-expose sa solution nga ka-react niini? |
| o1 | Large pieces | Malalaking piraso | Dagkong tipik |
| o2 | Fine powder | Pinong pulbos | Pinong pulbos |
| o3 | Both must expose equal surface | Dapat magkapantay ang exposed surface ng dalawa | Kinahanglan pareho ang exposed surface sa duha |

Narrow the target claim to **fine powder exposing more total surface than equal-mass large pieces under comparable conditions**. Retain the explanation connecting that surface to faster reaction. This question does not separately demonstrate that the student can reason about every rate factor. o1 reverses the fragmentation-area relation; o3 confuses equal mass with equal exposed area.

### ha-g10-0018 — medium: same transmutation distractor recurs

The catalyst item has one good near-miss (higher activation energy) but an implausible new-element foil. Replace only `o2`:

- EN: **By being permanently used up as an extra reactant**
- TL: **Sa permanenteng pagkaubos nito bilang dagdag na reactant**
- BIS: **Pinaagi sa permanenteng pagkahurot niini isip dugang nga reactant**

New rationale: confuses a catalyst, regenerated by the overall catalytic cycle, with an additional consumed reactant. Keep the lower-activation-energy key. Teacher review should check whether catalyst-versus-reactant vocabulary is already taught; the option is a proposed misconception foil, not a new exposed teaching claim.

## Other specific quality flags

These do not change the current keyed answers. They are targeted revision candidates rather than a blanket demand to make every recall question difficult.

- **ha-g9-0029, medium:** quiet conversation and gentle moving air are poor mutagen distractors. Candidate replacements are **low-intensity radio waves / ordinary audible sound**; TL **mahihinang radio waves / karaniwang tunog na naririnig**; BIS **hinay nga radio waves / ordinaryong madungog nga tingog**. Keep “directly damage DNA” and UV key. The direct-DNA-damage distinction was checked against [NCI electromagnetic-fields guidance](https://www.cancer.gov/about-cancer/causes-prevention/risk/radiation/electromagnetic-fields-fact-sheet), which states radiofrequency fields are not known to damage DNA directly. Do not use X-rays or gamma rays as wrong answers because they can damage DNA. This is a proposed item repair, not a reviewed Hiraia teaching-card exposure link.
- **ha-g9-0032, medium:** only the key is qualified; two absolute guarantees make testwise elimination easy. Candidate options: key **Helping ecosystem functions continue under stress** / TL **Pagtulong na magpatuloy ang mga tungkulin ng ecosystem sa stress** / BIS **Pagtabang sa pagpadayon sa mga buluhaton sa ecosystem panahon sa stress**; foils **Making different species respond in the same way** / TL **Paggawa na pareho ang tugon ng iba't ibang species** / BIS **Paghimo nga pareho ang tubag sa nagkalainlaing species**, and **Making different species need the same resources** / TL **Paggawa na parehong resources ang kailangan ng iba't ibang species** / BIS **Paghimo nga pareho nga resources ang gikinahanglan sa nagkalainlaing species**. Preserve the non-guarantee explanation and review distractor plausibility with a teacher.
- **ha-g9-0072, medium:** ocean water cooling the core is an implausible distractor. Replace that option with **Earth's magnetic field / Magnetic field ng Earth / Magnetic field sa Yuta**; correct enormous pressure remains. This is a competing Earth-interior concept rather than an invented ocean plumbing mechanism.
- **ha-g9-0073, medium:** liquid water with dissolved minerals is too remote from mantle misconceptions. Replace only o3 with **Rigid solid rock that cannot slowly change shape / Matigas na solid rock na hindi maaaring dahan-dahang magbago ng hugis / Gahi nga solid rock nga dili mahimong hinay-hinay nga mausab og porma**. This directly contrasts the important solid-can-flow idea with the common rigid-solid misconception.
- **ha-g9-0078, medium:** Moon ejecting a new cloud annually and a new comet striking Earth each year are implausible. Candidate foils: **The parent comet orbits Earth once a year / Umiikot sa Earth ang pinagmulang kometa isang beses kada taon / Ang gigikanang kometa motuyok sa Yuta kausa matag tuig**, and **Earth enters the main asteroid belt once a year / Pumapasok ang Earth sa main asteroid belt isang beses kada taon / Ang Yuta mosulod sa main asteroid belt kausa matag tuig**. Both are concrete orbital misconceptions. Keep Earth crossing a debris trail as key; do not generalize all showers to comet debris.
- **ha-g9-0079, low:** “robotic” in the stem largely supplies the no-crew answer. Delete **robotic / robotic / robotic** from the stem; keep “space probe.”
- **ha-g9-0080, medium:** “Earth-based” in the stem leaves only the option explicitly located on Earth. Replace stem with **Which effect does placing a telescope above Earth's atmosphere avoid? / Anong epekto ang naiiwasan kapag inilagay ang telescope sa itaas ng atmospera ng Earth? / Unsang epekto ang malikayan kon ibutang ang telescope ibabaw sa atmospera sa Yuta?**. Keep the options and atmospheric-distortion explanation; neither a star's intrinsic distance nor motion disappears in space.

## Not flagged as factual failures

The conditions in these items correctly avoid common overclaims: G9-0067 species geological duration versus individual lifespan; G9-0068 undisturbed superposition; G9-0069 suitable mineral isotope records; G9-0071 S-waves not crossing as S-waves; G9-0077 orbital-neighborhood criterion; G10-0004 temperature-qualified neutral pH; G10-0005 final pH not automatically 7; G10-0011 specific magnesium/dilute HCl; G10-0015 ordinary closed chemical model; G10-0019/0020 direction rather than guaranteed final temperature.

Technical English retained in TL/BIS is not itself a translation defect. No blanket dialect, register or stylistic normalization is recommended.

## Incidental identity check

While selecting the replacement family, the current pool showed `ha-g9-0001` family `chemical-change-new-substance` and `ha-g6-0005` family `chemical-change-new-substances`, despite essentially the same core claim. Unify these singular/plural family IDs if both could appear in one eligible form. This is a semantic near-duplicate lead; it was outside the 60-item content review.

## Reviewed snapshots

All 60 items were revision 1 when inspected. SHA-256 of the canonical files at 17:20 GMT+8:

- 027: `ec833e6cbc0599c31debc9f48d396edc13132ff8ae79eee1285426fc6606c9d8`
- 029: `4bd2c7730f4be18c65c1012d85d04dc17200e6468bdd3fa1f7abcc3fc5b8323c`
- 030: `d9fc4184c6feb8e3de50540a86533e809fa5a339167823ac62f9289aac58ed0e`

Later edits must be rechecked; these hashes record what was reviewed rather than imply approval of subsequently changed text.
