# Remaining excluded facts: second-pass assessment

2026-09-10, unified. Completed recovery preserved in commit `56364dcf8`. This assessment changes no curriculum tags, review decisions, or reach counts; the heartbeat remains stopped.

## Recommendation

A targeted second pass is worthwhile. Start with 288 cards (three reviewers of 96) before committing to reviewing all 12,245. Search across all current competencies, prioritize cards that fill thin teaching facets or add distinct concepts, and measure validated recoveries plus useful topic coverage. Do not assume the first pass recovery rate will repeat.

## Inventory and screening limitation

| Remaining original screening class | Facts |
|---|---:|
| No current core match | 12,221 |
| Flagged quality | 23 |
| Missing prior review | 1 |
| Total | 12,245 |

These are unreviewed in the completed recovery pass, separate from its 5,233 held decisions. The original 12,224 no-match count is three larger because the initial manual sample reviewed three cards from that class.

`tools/curriculum-recovery/screen.py` searches authored unit patterns only within competencies previously assigned to a fact. Thus “no current core match” does not establish that no curriculum destination exists. 4,003 of the remaining cards have only prior assignments marked wrong; one has no prior assigned reviews. Neither count certifies content quality.

A diagnostic scan against every live unit found at least one pattern match in a new competency for 12,205 cards, including 3,999 of the 4,003 all-wrong-assignment cards. This very high match rate demonstrates why unranked regex matching is insufficient: generic words and substring collisions produce many irrelevant destinations. It is a lead-generation diagnostic, not an estimated recovery yield.

## Exploratory sample

Read the full English text of 40 cards drawn without replacement from the remaining screening rows, using Python Random seed 20260910. Also inspected prior assignment evidence and relevant live unit definitions. This was an assessment of review opportunities, not complete trilingual verification; none are counted as approved or newly reviewed in the recovery checkpoint.

| Card | Previous issue | Promising destination to verify |
|---|---|---|
| dcard-06758: measuring volume tools | Assigned to friction | G5-M-5 measuring containers |
| dcard-06915: centering microscope specimens | Assigned to particle theory | G7-L-1 microscope parts/functions |
| ffct-05764: rice and corn begin as seeds | Rejected for not comparing entire life cycles | G6-L-2 seed reproduction |
| dcard-11432: soil conditions supporting growth | Previous population-limits assignment | G6-L-7 soil as an ecosystem factor |

The sample also includes content needing wording/factual verification, narrowly advanced topics, and facts that may add repetition to already abundant topics. These should not be forced into core simply to increase the reachable count. Full language, fact, duplicate-identity and compiled-facet checks remain mandatory before approval.

## Proposed next run

1. Reconcile remaining IDs against all existing reviews, preserving the original screening snapshot.
2. Retrieve several plausible destinations across grades from meaning, terminology and exact competency requirements. Distinguish wrong prior assignments from genuine missing curriculum coverage.
3. Pilot 96 all-wrong-assignment cards, 96 related/prerequisite cards, and 96 randomly selected remaining cards. Keep lane selection and resulting yields separate; targeted yields cannot be extrapolated to the whole remainder.
4. Record direct recovery, justified facet/filter repair, text/translation repair, and unsuitable-to-core outcomes. Integrate only fully validated direct recoveries; do not silently weaken filters.
5. Continue the most productive lanes if they produce useful coverage. A proposed operational threshold is about 20% clean recovery, or a lower rate when recovering scarce practical/quiz anchors. This is a planning choice, not an evidence-derived cutoff.

At the completed window's observed approximately 1,120 reviews per hour across three reviewers, a same-speed full pass would take roughly 11 hours. Cross-competency discovery adds work, so budget 12–18 hours provisionally and revise after the pilot. No new run or schedule has been started.

Sample IDs: ffct-07497, ffct-20695, ffct-23251, ffct-01867, ffct-13338, ffct-01557, ffct-17443, ffct-17033, ffct-11919, ffct-20046, dcard-04158, ffct-01864, dcard-11432, dcard-04066, ffct-18334, ffct-02768, dcard-08001, dcard-07712, ffct-14056, ffct-07310, ffct-18351, dcard-10886, dcard-10033, dcard-11139, dcard-10456, ffct-35125, ffct-11698, ffct-00487, ffct-17882, ffct-21617, ffct-07506, ffct-29592, ffct-33995, ffct-09707, ffct-19239, ffct-00628, dcard-06758, ffct-05764, ffct-18252, dcard-06915.
