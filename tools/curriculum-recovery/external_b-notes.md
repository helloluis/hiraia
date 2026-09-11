# External set B — review notes (packets 20000–20017)

Owner: external_b coordinator (Claude session, Luis). Covers the 18 packets 20000–20017 (1,728 facts) reviewed by this session; packets 20018–20029 (1,108 facts) were reviewed by `grok-external-b` and are not described here. The partition is COMPLETE: 2,836 decisions, 330 proposed recoveries, 2,506 holds; every one of the 30 review files passes `apply.py` dry-run (checked 2026-09-11). Written 2026-09-11.
These are PROPOSALS. Nothing was applied, no tags/authoring/generated data changed, nothing committed, built or deployed.
Per-packet counts and dry-run results live in `external_b-second-pass-state.json`.

## Method

Each 96-fact packet was split into eight 12-fact bundles carrying everything §Review method requires: full en/tl/bis
copy, the prior screening verdicts, every candidate competency with its EXACT MATATAG text, **every facet that code
would admit the card into** (with the compiler's own regex), the two apply.py blocks (grade-scoped exclusion,
enrichment-only cats), and every card variant sharing the stable factId in both pools. One reviewer agent per bundle;
then a KEEP-SKEPTIC agent re-judged every proposed recovery and reverted those it could refute. An assembler mirrored
apply.py's rules and auto-held anything failing them before writing the review file (0 auto-holds were needed).
Reviewers ran on Claude Sonnet 5; packets 20000–20002 and parts of 20006/20012 were reviewed on Claude Fable 5.1
before the model switch. Within packet 20002 the two models recovered at 39% and 38% of the same population.

## Counts

1728 decisions in these 18 packets: **286 proposed recoveries**, 1442 holds. Every packet's
`apply.py <review>` dry run (no --apply) exited 0. Fact ids are unique, all inside the external_b partition, and
disjoint from every other owner's review file.

Recovery rate splits by POPULATION, not by reviewer: packets 20000–20007 hold the facts whose first-pass verdicts
were all "wrong" (~30% recovered); 20008+ hold facts already judged not-core (~4%).

Most-used destination codes: G6-L-8 (7), G7-L-1 (6), G6-M-4 (6), G7-M-3 (6), G9-F-7 (6), G3-L-7 (5), G6-L-6 (5), G4-M-6 (4), G9-L-2 (4), G9-F-12 (4), G7-L-2 (4), G7-M-7 (4).

## What the coordinator should act on

### 1. 423 holds are sound content blocked by a facet that would falsely admit them

These cards teach a real component of their competency, but the chosen code also admits them into a facet they do NOT
teach (usually a diagram/table/investigation/activity facet matched on a bare word), so they were held rather than
silently loosening a filter. Repairing the facet is the cheapest recovery left in this set. Facets named most often:

- `G6-L-6:predation` — 5 cards
- `G7-L-8:organism-to-biosphere` — 4 cards
- `G3-L-6:shelter` — 4 cards
- `G3-M-5:hardness` — 4 cards
- `G6-E-5:before` — 3 cards
- `G6-L-8:nonliving-interactions` — 3 cards
- `G7-L-2:technique` — 3 cards
- `G6-L-8:living-interactions` — 3 cards
- `G3-F-7:bright-light` — 3 cards
- `G3-E-9:eye-protection` — 3 cards
- `G7-M-2:particles` — 3 cards
- `G7-L-2:mitochondria` — 3 cards
- `G3-E-6:planets` — 3 cards
- `G5-L-6:birds` — 3 cards
- `G3-L-7:food-and-shelter` — 3 cards

### 2. 44 cards in the SHIPPING pool carry a factual error

Found while verifying claims against primary sources. These are live pool cards (every one resolves in
`cardsPool.app.json`), so the error reaches the feed regardless of curriculum tagging — worth a content fix
independent of this recovery pass:

- `egg-and-sperm-discovery-g9` — History-of-science claim is oversimplified into error: Harvey (1651) only hypothesized 'ex ovo omnia' and thought semen merely stimulated the egg; Leeuwenhoek (1677/78) observed spermatozoa and believed each sperm carried a preformed embryo (spermism), with th
- `esters-and-flavor-g9` — Factual error: esters contain an ester group (-COO-, derived from a carboxylic acid), not a carboxyl group (-COOH); the sentence 'Esters are organic compounds with a carboxyl group' would teach a wrong structure. Also no MATATAG competency at grades 3-10 cover
- `evacuation-plans-g6` — Content fits G6-E-5:before exactly (what to do before a volcanic eruption) and variant dcard-00106 would also fit, but the Cebuano of the reviewed card is wrong: 'sa dili pa moubo ang bulkan' - 'moubo' means to cough / get lower, not to erupt; it must be 'mobu
- `fermentation-atp-count-g8` — Accuracy: '38 ATP from aerobic respiration' is the outdated theoretical maximum; the current accepted yield is about 30–32 ATP per glucose (2.5 ATP/NADH, 1.5 ATP/FADH2). The fermentation part (net 2 ATP from glycolysis) is correct. The card also goes beyond G8
- `finding-50-degrees-north-g7` — Accuracy: 'halfway between the equator and the North Pole' is 45°N, not 50°N; the card's central clause is numerically wrong (oversimplified into error). Additionally no MATATAG grade 3–10 competency covers locating places by latitude (the old K-12 S7ES-IVa-1
- `forces-in-motors-and-generators-g10` — Oversimplified into error: motors and generators work through the interaction of electric current and a magnetic field (magnetic/Lorentz force on moving charges, electromagnetic induction), not 'two forces, electric force and magnetic force working together';
- `fwg-brain-usage-1925` — Myth-busting trivia about brain usage; no MATATAG competency at grades 3–10 covers brain activity / nervous system among the candidates. All matches are keyword-only: G7-L-10:less-energy matches on '10%' — needs facet repair: G7-L-10:less-energy matches on '10
- `fwg-electricity-1179` — Claim is misattributed: the 860 V record belongs to Electrophorus voltai (de Santana et al. 2019); E. electricus is documented at up to ~650 V (older figures ~480 V). Stating 860 V for E. electricus is factually wrong, so the card cannot be recovered under any
- `heat-cannot-fully-become-work-g9` — Two problems. (1) The claim is oversimplified into error: the second-law limit is that heat cannot be completely converted to work in a cyclic process because some heat must be rejected to a colder reservoir (the surroundings), not 'dissipated into the system
- `hormone-balance-g10` — Held by keep-skeptic: Science is oversimplified into error for a 'Compare Feedback Loops' lesson: menstrual-cycle FSH/LH/estrogen/progesterone levels are not 'relatively stable' (they swing many-fold, and the LH surge is the textbook POSITIVE-feedback case), s
- `light-bouncing-back-g4` — Accuracy: the card defines reflection as light that 'bounces back toward its source'. Reflected light leaves the surface at the angle of incidence; it returns toward the source only at normal incidence, so this is an oversimplification into error (e.g. moonlig
- `milk-powder-dissolves-g6` — Held by keep-skeptic: Science is oversimplified into error: milk powder does not dissolve, it disperses into a colloid that DepEd modules classify as a non-uniform/colloidal mixture, so filing 'dissolves thoroughly ... smooth and even mixture' under G6-M-4 tea
- `mutation-definition-g10` — Card defines mutation as 'a change in the DNA sequence of cells due to extreme exposure to ionizing radiation,' presenting radiation exposure as though it were the defining/general cause of mutation. Per verified sources, the majority of mutations actually ari
- `pegasus-the-winged-horse-g5` — Card states Pegasus's October visibility and Greek-myth origin — naming/mythology trivia about one constellation. G6-E-8's 'constellations-year' facet is about modeling how star patterns change over a year via a Sun-Earth-Moon system model, not naming a specif
- `phosphoric-acid-formulas-g9` — Card is factually wrong: phosphoric acid's actual molecular formula is H3PO4, identical to its empirical formula, because the H:P:O ratio 3:1:4 cannot be reduced further (verified via search). The card's claim of a molecular formula H6P2O8 containing 'two empi
- `precession-and-seasons-g10` — Factually a pop-science myth: because the Gregorian calendar is pinned to the tropical year (defined by the equinoxes/solstices), calendar months always correspond to the same season regardless of axial precession -- verified via WebSearch (Astronomy.com). Wha
- `pressing-a-cotton-ball-g4` — G3-M-8 has two admitted facets (shaping, pressing) that both regex-match this card ('shape', 'pressed'), but the card only genuinely teaches the 'pressing causes a physical change' point — it does not teach 'shaping' as a distinct technique; 'shape' appears me
- `short-wavelength-x-rays-g10` — Held by keep-skeptic: Science is doubtful/oversimplified into error: luggage scanners work because X-rays pass through low-density contents while dense metals absorb them and show as opaque; the card's causal claim 'penetrate through metals, which is why they
- `sugar-s-elements-g9` — Factual error: the card states sucrose's molar mass as 342.1 g/mol; the correct, widely-cited value is 342.30 g/mol (verified via WebSearch against WebQC and Pearson chemistry sources). Independent of the numeric error, no candidate genuinely teaches the card'
- `sun-s-ultraviolet-rays-g4` — Factual error: the card claims UV rays are 'why we feel warm when sunbathing,' but the warmth felt from sunlight comes primarily from infrared radiation (with some contribution from absorbed visible light), not UV — UV is responsible for sunburn/photodamage, n
- `television-history-g4` — Factually wrong dates: the first public television demonstration was Baird's in January 1926 (not 'introduced in 1920'), and colour television did not appear 'around 1940' - the first commercial colour broadcast was CBS in June 1951, the NTSC standard was appr
- `the-nasal-cavity-g9` — G5-L-2 ('identify ... the parts of the respiratory system as the nose, windpipe, and lungs, and describe how they work') is the only genuine content match — nasal-cavity function is part of describing how the nose works. However, the Tagalog and Cebuano transl
- `tincture-of-iodine-g7` — Factual error: the card says 'water is the solvent', but tincture of iodine is by definition an alcoholic solution — USP tincture is ~2% iodine plus sodium/potassium iodide in ~50% ethanol / water, and iodine is only sparingly soluble in water (the iodide salt
- `too-much-daily-waste-g5` — Accuracy doubt: the causal claim 'people create more waste than landfills can hold, so some garbage is left uncollected' is an oversimplification into error — uncollected garbage results from collection-service gaps, not landfill capacity, and 'more waste than
- `travel-in-groups-g4` — Accuracy doubt plus no competency: penguins do not 'travel in family groups' (they form colonies/huddles, not family units) nor gather to protect each other from danger, so the generalization is oversimplified into error. No candidate covers animal group behav
- `units-of-volume-g3` — Factual error: inches, meters, and centimeters are units of length/distance, not volume. The volume of a solid is properly measured in cubic units (e.g. cm³, m³) or by water displacement in liters/mL. As written the claim conflates length and volume measuremen
- `air-supports-life-g3` — Held by keep-skeptic: The card's title and majority content group airplanes/helicopters with people/birds as things that 'need air,' conflating a living thing's biological need (breathing) with a machine's aerodynamic requirement for flight; only one clause ('
- `carabao-few-misconception-dirty-g4` — Myth-busts that a carabao's mud bath is healthy grooming (cooling + pest removal), not dirtiness. G3-F-1's 'roll' facet matches only on the word 'rolls'; the competency is about ways to make objects move (pushing/pulling/rolling by natural causes or people), n
- `cellular-respiration-fermentation-muscles-g9` — Corrects the myth that lactate causes delayed muscle soreness (actual cause: micro-tears/inflammation), teaching anaerobic respiration/fermentation. None of the current candidates teach cellular respiration or fermentation — matches are all incidental on the w
- `common-cold-virus-cause-g5` — Card teaches that colds are caused by viruses infecting the nose/throat, not cold air alone — a health myth-busting fact, not a curriculum teaching component of any candidate. G5-L-2's 'nose' facet (respiratory-system parts and how they work) matches only on t
- `compost-worms-regrow-body-myth-g7` — Card is an animal-regeneration myth-bust about worms (invertebrate biology), not solid-material transformation or plant propagation. G3-M-8's 'cutting' facet fires on the word 'cut' but that competency teaches making SOLID MATERIALS useful by shaping/pressing/
- `crocodile-eyes-misconception-blind-g5` — Most candidates (living/non-living examples, basic needs, environment dependence, moving objects, light uses, sun safety, local inventions, habitat classification, sun importance, electromagnets, mixture separation, biotic/abiotic factors, interaction help/har

### 3. 34 cards have a Tagalog or Cebuano problem

- `egg-and-sperm-discovery-g9` — History-of-science claim is oversimplified into error: Harvey (1651) only hypothesized 'ex ovo omnia' and thought semen merely stimulated the egg; Leeuwenhoek (1677/78) observed spermatozoa and believed each sperm carried a preformed embryo (spermism), with th
- `electric-guitar-energy-g6` — Claim is muddled into error: an electric guitar's pickups convert the mechanical energy of the vibrating strings into an electrical signal; it is the amplifier and speaker that convert electrical energy into sound (and heat). Saying 'an electric guitar changes
- `evacuation-plans-g6` — Content fits G6-E-5:before exactly (what to do before a volcanic eruption) and variant dcard-00106 would also fit, but the Cebuano of the reviewed card is wrong: 'sa dili pa moubo ang bulkan' - 'moubo' means to cough / get lower, not to erupt; it must be 'mobu
- `gases-expand-and-push-g6` — Held by keep-skeptic: G6-E-1 is 'what volcanoes are and how they are FORMED' (lesson How Volcanoes Form); the card teaches an eruption-trigger mechanism, entering the magma facet on a word, and its science is doubtful (eruptions are driven by decompression/gas
- `gathering-data-g7` — Definitional error: the card says 'Gathering data means making a judgment based on the results of an experiment', which describes drawing conclusions/interpreting results, not gathering data (collecting observations and measurements). Putting this under G7-M-6
- `gear-for-rainy-days-g4` — Cebuano meaning error: 'Sa ting-ulaw nga adlaw' — 'ulaw' means shame/shy in Cebuano; rainy is 'ulan' ('ting-ulan' / 'maulan nga adlaw'), so the Bisaya card does not say 'on rainy days'. The English and Tagalog are fine and the content (dressing for rain) is a
- `hemophilia-g9` — Two independent blockers. (1) Cebuano meaning error: 'ang dugo mobag-o hinay kaayo o dili gyud' says the blood 'changes/renews' (bag-o = new) very slowly or not at all; it does not say 'clots'. The central clause is mistranslated (Tagalog 'namumuo' is correct)
- `hormone-balance-g10` — Held by keep-skeptic: Science is oversimplified into error for a 'Compare Feedback Loops' lesson: menstrual-cycle FSH/LH/estrogen/progesterone levels are not 'relatively stable' (they swing many-fold, and the LH surge is the textbook POSITIVE-feedback case), s
- `law-of-reflection-g10` — The card states the coplanarity clause of the law of reflection (incident ray, reflected ray, normal in one plane) — correct, but no candidate competency is served: G3-F-6:behavior matches on 'reflect' yet 'incident ray / normal line / plane' is far above grad
- `low-power-appliances-g10` — The English content is a precise, genuine match for G10-F-12's 'save|efficien|reduce' facet (choosing low-power appliances reduces electrical consumption). However, the Bisaya translation is inaccurate: it uses 'makapakgang' ('can stop/halt/block' — confirmed
- `making-oxalic-acid-solution-g7` — Held by keep-skeptic: Science is doubtful: '15 g is 25% of 60 ml' conflates mass and volume with no stated w/v basis (a 25% w/w reading gives 60 g, not 60 mL), a 25 g/100 mL oxalic acid solution exceeds room-temperature solubility (~10 g/100 mL), oxalic acid i
- `munggo-seed-germination-g5` — Held by keep-skeptic: Card narrates a germination procedure ('water it every day' = verb hit on the 'water' pattern) and never identifies water as a basic need of living things, so the G3-L-6 match is inferential/keyword rather than taught; it also implies sun
- `short-wavelength-x-rays-g10` — Held by keep-skeptic: Science is doubtful/oversimplified into error: luggage scanners work because X-rays pass through low-density contents while dense metals absorb them and show as opaque; the card's causal claim 'penetrate through metals, which is why they
- `the-nasal-cavity-g9` — G5-L-2 ('identify ... the parts of the respiratory system as the nose, windpipe, and lungs, and describe how they work') is the only genuine content match — nasal-cavity function is part of describing how the nose works. However, the Tagalog and Cebuano transl
- `tincture-of-iodine-g7` — Factual error: the card says 'water is the solvent', but tincture of iodine is by definition an alcoholic solution — USP tincture is ~2% iodine plus sodium/potassium iodide in ~50% ethanol / water, and iodine is only sparingly soluble in water (the iodide salt
- `transparent-and-translucent-g7` — Held by keep-skeptic: System flags grade_mismatch and the card's own depedCompetency (S7LT-IIIh) confirms this is genuine G7 light content; the G3-F-6:behavior facet is only hit via the generic keyword 'through' inside 'pass through'/'get through', not because
- `air-supports-life-g3` — Held by keep-skeptic: The card's title and majority content group airplanes/helicopters with people/birds as things that 'need air,' conflating a living thing's biological need (breathing) with a machine's aerodynamic requirement for flight; only one clause ('
- `ashfall-downwind-pattern-g6` — Card teaches a genuine, grade-appropriate earth-science fact (ashfall is carried downwind, producing asymmetric ash distribution around a volcano), which would otherwise fit G6-E-4's 'ash' facet (materials released by volcanic eruptions in the Philippines). Ho
- `birds-flapping-downstroke-power-g5` — The English content is otherwise a strong match for G3-L-4 (wings as an outer body part with a role 'to move': the downstroke generates the force that lifts and propels the bird forward), and the science is accurate (the downstroke is the primary power stroke
- `cogon-grass-sun-loving-open-fields-g4` — Held by keep-skeptic: The card is just a keyword pattern-match on 'sun'/'light' — it never invokes the biotic/abiotic classification framework G6-L-7 actually teaches (it's a plain botanical growth fact, same shallow-connection problem the prior reviewer alrea

### 4. 19 facts have card variants whose text differs and could not be reconciled

Per the integration guard, the compiler may select a variant other than the one reviewed, so these were held:

- `finding-the-average-g7` — The card is a generic arithmetic-mean procedure; no candidate competency is about it. Every candidate is a substring artifact: G9-E-5 'age' and G9-E-6 'era' both inside 'average', G9-E-7 'core' inside 'score', G9-E-4 'dat' in 'added'?/no, G8-F-8 and G10-F-8 on
- `first-period-meaning-g10` — AUP-sensitive (human reproduction; text not quoted). No candidate competency covers the human reproductive system: G3-L-3 'reproduce' facet is the grade-3 'living things grow, respond, reproduce' lesson — menstruation is not an age-appropriate component of it;
- `formula-mass-g9` — No MATATAG competency at grades 3–10 covers formula mass / mole calculations. The only nouns shared with candidates are 'NaCl' (G9-M-6, blockedCatsAllEnrichment=true) and 'mass' (G8-M-3 subatomic mass, G9-F-3 blocked, G10-M-6 conservation of mass, G10-F-4/5 mo
- `glossopteris-fossil-clue-g10` — Needs facet repair: G9-E-1:focus-2 (pattern 'fit|coast|rock|mountain' — coastline fit and matching rock/mountain belts) matches on 'rocks' in 'found in rocks across South America', but the card teaches only the fossil line of evidence, not rock-formation or co
- `hanging-wall-and-footwall-g8` — Variants differ in wording (dcard-12792 Q&A form vs dcard-00761 'sits above the fault plane') but both are correct and consistent — reconciled. Still hold: the correct home is G7-E-1 (classify faults by angle of the fault plane and direction of slip — hanging
- `improving-a-survey-g4` — Card is a rubric statement (revise questionnaires by 'content, creativity, presentation, and participation'), not a science teaching component. G4-M-7 (guided-survey facet) is about applying process skills/attitudes in an environmental survey and G9-L-11 (surv
- `independent-variable-g7` — Content belongs to G6-M-8 (fair test: change one factor), but needs facet repair: G6-M-8:measure matches on 'dependent' inside the word 'independent' and the card does not teach the measured/dependent variable; G6-M-8:control matches on 'control' but the card
- `joule-unit-g8` — variants differ: dcard-10897 - unresolved identity. The reviewed card (ffct-37756) says the joule is the unit of mechanical energy (~energy to lift a small apple 1 m; correct), while variant dcard-10897 says 'The Joule is the SI unit of heat, and it measures t
- `kettle-boiling-over-g7` — Card teaches macroscopic thermal expansion of a heated liquid (water expands in volume as it heats). No candidate genuinely covers this: G7-M-3's 'spaces'/'temperature' facets are about particle spacing/motion, not bulk volume expansion, and the card never men
- `making-oxalic-acid-solution-g7` — Held by keep-skeptic: Science is doubtful: '15 g is 25% of 60 ml' conflates mass and volume with no stated w/v basis (a 25% w/w reading gives 60 g, not 60 mL), a 25 g/100 mL oxalic acid solution exceeds room-temperature solubility (~10 g/100 mL), oxalic acid i
- `menstrual-phase-g5` — Human reproductive-health content (AUP: referenced by factId only). None of the four candidates is remotely on topic: G3-E-4:patterns and G3-E-8:daytime match on 'days', G10-M-2 on 'pH' inside 'phase', G10-L-6 on 'cell'. The MATATAG competency that would hold
- `rayleigh-waves-g7` — variants differ: dcard-04120 describes Rayleigh-wave motion as 'a mix of longitudinal, compressional, and dilatational motion' (denser, more technical/potentially confusing phrasing since compressional and longitudinal are near-synonyms in seismology) versus d
- `results-and-data-g7` — variantTextsDiffer=true and the sibling cards under this factId teach substantively different content: dcard-09570 (reviewed) explains quantitative vs. qualitative observations (would plausibly fit G3-M-4's 'observing ... measuring using units such as ... cent
- `solar-system-model-g7` — No candidate genuinely teaches the card's content (a solar-system orrery-type model's usefulness for depicting planetary orbits/distances). All matches are keyword hijacks: G3-E-6 matches 'planets' but is about guided daytime/nighttime sky observation, not mod
- `toaster-energy-use-g10` — Variants differ: dcard-08636 (app, the reviewed text) asks 'How much energy does a 1200-watt toaster use in 20 days?' and answers with '10 total hours' — the '30 minutes a day' clause is missing, so the answer is unsupported by the question as written (a child
- `visible-light-g6` — G9-F-11's 'visible' facet requires comparing relative wavelengths/frequencies across the EM spectrum; this card only gives a bare definition of visible light and never compares it to other wave types, so it's a keyword-only hit (needs facet repair: G9-F-11:foc
- `waste-segregation-g4` — variantTextsDiffer is true: the reviewed card (dcard-06653) ties waste segregation specifically to preventing the harmful effects of burning garbage, while the sibling variant (dcard-01657) describes segregation only as sorting trash into different bins for pr

### 5. 743 holds have no MATATAG destination at grades 3–10

Health/first-aid advice, body systems outside the G4-L-1 list (lymphatic, nervous, reproductive), gemology, the mole
concept, lens ray-diagram conventions, and similar off-ladder content. They are recorded with that reason and need a
curriculum decision, not a review decision.
