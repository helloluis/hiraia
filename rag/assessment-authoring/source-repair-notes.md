# Source defects requiring separate repair

These were encountered during assessment selection. They are not a prevalence
estimate or a completed audit of the teaching bank. Production sources have not
been edited by this content-authoring task.

## Bleach described as hand sanitizer — high priority

- Card: `dcard-09952`; fact: `making-disinfectant-g7`.
- Verified against the pinned `cardsPool.app.json` snapshot on 28 September 2026.
- All three teaching bodies instruct readers to dilute bleach into a surface
  disinfectant and dilute it again into hand sanitizer. This is unsafe teaching
  content, not a translation-only issue. No assessment link is accepted.
- [CDC's investigation of cleaning/disinfecting practices](https://www.cdc.gov/mmwr/volumes/69/wr/mm6923e2.htm)
  identifies applying household cleaning/disinfectant products to bare skin as
  a high-risk practice. [CDC's bleach guidance](https://www.cdc.gov/hygiene/about/cleaning-and-disinfecting-with-bleach.html)
  concerns correctly prepared surface disinfection, with product-label directions.
- Repair requires removing the hand-sanitizer instruction in all languages,
  reviewing the remaining concentration/context and generator source, and
  rebuilding the shipping content through its normal pipeline. A corrected
  assessment alone cannot repair what the child is taught.

## Other selected source holds

The authoritative item hold records remain in the batch JSON: `ha-g3-0010`,
`ha-g3-0049`, `ha-g4-0076`, `ha-g5-0077`, and `ha-g6-0067`. They cover unresolved
vocabulary/curriculum fit, an inadequate teaching link, an outdated wind-warning
range and an unsafe volcanic-alert assurance. They are excluded from form selection.

## Incorrect indicator identity

`dcard-03623` / `making-homemade-litmus-g7` describes onion-skin indicator paper as
litmus. Its bank question tests the actual litmus red-to-blue rule, which that
body does not teach. The draft uses a different teaching source. Plant extracts
can serve as indicators, but that does not make them litmus or establish the same
color changes. See [RSC's litmus test](https://edu.rsc.org/experiments/acid-or-alkali-acidic-or-alkaline-a-litmus-paper-test/1708.article).

## Physics claims narrowed or rejected

- `ffct-21902` / `velocity-time-graph-area-distance-g9`: signed area on a
  velocity–time graph gives displacement. Total distance requires integrating
  speed (the absolute value of velocity). This card was not selected.
- `ffct-21901` / `velocity-time-graph-slope-acceleration-g9`: a positive slope
  means positive acceleration, which need not increase speed when velocity is
  negative. `ha-g8-0045` assesses only the valid slope–acceleration relation.
- `ffct-21992` / `mechanical-energy-sum-g8`: mechanical energy is kinetic plus
  potential energy, not all energy in an object. `ha-g8-0054` reuses the narrow
  correct question; the teaching body's total-energy wording needs repair.

See [OpenStax's acceleration treatment](https://openstax.org/books/physics/pages/3-1-acceleration)
and [work and energy](https://openstax.org/books/physics/pages/9-1-work-power-and-the-work-energy-theorem).
These assessment selections do not certify every sentence of a linked card.

## Final Grade 9/10 review findings

- `ffct-15720` / `color-change-sign-reaction-g6` overstates color change as
  establishing a new substance. The proposed evidence-judgment question also
  failed to discriminate that misconception. `ha-g10-0001` was replaced with
  source-backed physical-dissolution classification using `dcard-11406`; its
  old source/content remain in revision history. Appearance alone is not proof
  of a chemical reaction. [OpenStax's physical/chemical properties treatment](https://openstax.org/books/chemistry-2e/pages/1-3-physical-and-chemical-properties)
  supplies a physical-change/color example.
- `ffct-17163` / `signs-of-multiple-clues-stronger-g8` upgrades English increased
  confidence to certainty in Cebuano. It was rejected as a teaching link for
  uncertain reaction evidence.
- Subduction sources `ffct-35154`, `ffct-32826`, and `dcard-08586` use overly
  simple whole-slab melting explanations. The Grade 10 draft instead uses a
  card explicitly describing slab water helping mantle material melt.
- `ffct-08603` describes carbon dioxide already stored in fossil fuels; the
  relevant stored material is carbon compounds. The combustion draft uses a
  different source. `dcard-08627` makes an absolute non-depletion claim for
  renewable resources and was excluded.

The [Grade 10 biology](reviews/batch-031-review.md),
[physics](reviews/batch-032-review.md), [Earth science](reviews/batch-033-review.md),
and [peer-resolution records](reviews/peer-review-resolutions-20260928.md) preserve
the exact selection decisions. These are specific findings, not defect-rate
estimates or a completed repair of the feed bank.

## Chemistry selection exclusions

- `dcard-02806` / `copper-wire-g8`: the claim that copper atoms are not chemically
  bonded is false; metallic bonding is chemical bonding. It was not selected.
- Bank fact `atomic-mass-on-table-g8` conflates mass number (protons plus
  neutrons for an isotope) with the atomic mass displayed in the periodic table.
  Grade 8 item 0011 uses a different, explicit mass-number source.

See [OpenStax's atomic structure and symbolism](https://openstax.org/books/chemistry-2e/pages/2-3-atomic-structure-and-symbolism).

## Earth science claims narrowed

- `ffct-32800` / `shield-volcano-shape-g6`: the final claim that shield volcanoes
  do not erupt explosively is false. `ha-g8-0066` uses only the fluid-lava/shape
  relation and does not accept a no-hazard conclusion. See [USGS volcano
  types](https://pubs.usgs.gov/gip/volc/types.html).
- `typhoon-landfall-g8` in the bank promises weakening on landfall without
  qualification. `ha-g8-0076` asks about the typical inland heat/moisture loss;
  landfall itself is not a safety clearance. The teaching card
  `ffct-29332` also needs its absolute wording narrowed.
- Spring/neap source wording about gravitational pulls combining or fighting
  is only an elementary shorthand. Tidal effects reinforce at both new and full
  Moon; ordinary force vectors are not always parallel. The assessment records
  tidal range and lunar phase, not a guaranteed flood level. See [NOAA's tide
  explanation](https://oceanservice.noaa.gov/facts/springtide.html).
