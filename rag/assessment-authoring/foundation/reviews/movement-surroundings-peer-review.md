# Independent model review: movement and surroundings foundation drafts

29 September 2026. Reviewer: `/root/grade10_earth`, independent of the author of this half. Reviewed all 36 items, `ha-f3-0037` through `ha-f3-0072`, in English, Tagalog and Cebuano. This is a second model review, not native-speaker, teacher, accessibility or student-pilot approval.

After the corrections below, this review found no remaining blocking factual, keyed-answer, translation-meaning or teaching-link defect in these 36 evaluation drafts. All items remain `production_ready=false`; native-speaker, teacher and student-pilot fields remain null. The Kindergarten mapping supports narrow foundation observations, not a complete Grade 2 Makabansa crosswalk or a Grade 3 readiness certificate.

Final reviewed file: `movement-surroundings.json`, SHA-256 `f221f20838f7395feb9611108f7ec1106fa1666be4a9607cd83c3464e2ff483b`, checked at 08:26 GMT+8. The item set and all answer languages were read before recommending the corrections; changed items were read again afterwards. This hash includes the corrected 0062 source-review note, which no longer claims that light rain is explicit in the revised stem.

## Corrections verified

| Item / component | Defect | Corrected behavior |
|---|---|---|
| 0044 | A path with no bends can still be traversed back and forth, so that foil was also possible. | The foil is now a zigzag path; both foils require bends. All three languages were compared. |
| 0046 | Simultaneous starts on the same path did not explicitly establish equal travel distances; the second car's color was unstated. | Both colors and the same travel distance are explicit. Earlier arrival now supports the stated faster completed trip. This does not measure speed calculation. |
| 0053 | “This time” and corresponding transitions assumed a previous question in a shuffled form. | The question independently asks about the box relative to the ball. The scene still records the ball above the box; the key correctly gives the inverse relation. |
| 0058 | The first shadow-color foil was weak. An intermediate moving-air stem named the answer directly in Tagalog/Cebuano because air and wind were both rendered as hangin. | The stem describes fluttering leaves with no rain or touching. It asks what can move them. Wind is the supported option without naming it in any stem; no universal claim about every moving leaf is made. |
| 0061 | English knitted and Cebuano hinabol introduced an unnecessary woven/knitted difference. | All three use an ordinary sweater. Corpus evidence for hinabol described woven materials and crafts; no native-fluency claim follows. |
| 0062 | A notebook or paper fan can briefly keep some light rain off a person, so “can help stay dry” did not uniquely identify the umbrella. | The stem now asks which item is made for rain protection. The other objects are designed for other uses. |
| 0063 | Tagalog said the sweater adds heat, drifting from the claim that it helps keep a person warm. | Tagalog now says it helps keep the body warm. The item does not teach that clothing generates heat or that all cloudy days are cold. |
| 0065 | The original Tagalog/Cebuano could describe the path itself slipping. | The path is explicitly wet and slippery: naging madulas / basa ug danlog. Slow, careful walking is the key; floodwater access is outside scope. |
| 0069 | The original teaching link described reusing school paper broadly, while the question specifically used an unused side. | The link now uses dcard-04271 / reuse-materials-g4, whose three bodies explicitly describe using both sides of paper. The supplied blank-side condition supports the familiar application. |
| Inside diagram / 0049 | The ball bottom and front wall top both met at y=130. The ball looked perched on the rim rather than visibly inside. | Root moved the front wall top to y=120 while the ball bottom remains y=130. The lower 10 view-box units are occluded by the wall, preserving a visible ball within the box. |

0044, 0046, 0053 and 0065 were also independently raised by the parent reviewer. The author and parent made their own file changes; this reviewer did not edit their JSON or renderer code.

## Sources and language checks actually performed

Read the locally preserved [DepEd Kindergarten Curriculum Guide, May 2016](https://www.deped.gov.ph/wp-content/uploads/2019/01/Kinder-CG_0.pdf), including PDF pages 21 and 23 and the matching preserved text under `foundation/sources/`:

- Page 21, MKSC-00-12: in, on, over, under, top and bottom. The same code also appears beside counting on page 18, so the page-and-meaning anchor matters. No left/right foundation item was admitted.
- Page 23, PNEKPP-00-4: moving objects by pushing, pulling, rising, sinking and blowing; PNEKPP-00-5: straight, round-and-round, back-and-forth, fast and slow.
- Page 23, PNEKE-00-1: weather descriptions and daily observations; PNEKE-00-2: weather clothing/use; PNEKE-00-6: weather safety; PNEKE-00-4: care for the environment; PNEKE-00-5: familiar cause and effect.
- Page 21 also supplies the familiar wet/slippery-corridor example under MKAP-00-5, consistent with the narrow safe-movement context in 0065.

Read all three current bodies for every admitted teaching link. The nine linked items use dcard-01799, dcard-05269, dcard-00636, dcard-00640, dcard-04583, dcard-04584, dcard-04271, dcard-01458 and ffct-23593. Snapshot identity, actual fact IDs and literal support excerpts were checked against `rag/pipeline/cardsPool.app.json`. The other 27 items retain empty source-card lists rather than inventing Hiraia teaching evidence.

Additional vocabulary/context comparisons read ffct-22429 (door push/pull), ffct-10629 (pulling a plow), ffct-22445 (cart/swing), ffct-05964 (litter), dcard-00635 and dcard-05270 (weather), dcard-08198 (raincoat) and dcard-01174 (paper reuse). These comparisons are language/context evidence, not additional admitted teaching links.

The exact `danlog` corpus search returned 40 Cebuano bodies, including ffct-05488 where a pool edge is slippery. The corresponding Tagalog `madulas` search returned 117 bodies. No exact `nadanlog` body was found; that absence alone is not a grammar verdict. `hinabol` occurred in six bodies, describing woven crafts/materials, including nipa roofing, amakan, inabel and plant fibers. These attested meanings support the narrow corrections; they do not certify the new sentences as native-quality.

The rainy-day raincoat source dcard-08198 says ting-ulaw in Cebuano despite rainy/maulan in English/Tagalog. It remains excluded from the 0061 teaching links. The reviewed 0060 source uses init in a sunny-morning example, but its admitted narrow claim is that weather changes during a day, which its three bodies explicitly support. The new item does not rely on hot and sunny being interchangeable.

## Families and diagram semantics

There are 24 knowledge families across the 36 items. Door/drawer/button/cart/rope contexts remain in the same push/pull family; vertical diagram inversions remain in the same vertical-position family. Raincoat/umbrella/boots share a conservative rain-protection family, and the disposal/reuse variants retain their respective families. Repeated contexts have not been counted as independent knowledge.

Existing Grade 3-material items were compared for shared claims. The new items preserve existing family IDs for push/pull direction, observable wind effects, rain wetting the ground and reuse of an existing object. The different source cards cannot make those concepts independent within one form.

Diagram items 0049–0054 were checked against the scene, explicit subject and keyed answer. Inverse questions 0053/0054 ask about the box, while scene metadata consistently describes the ball relative to the box. Neither language pits the potentially overlapping on/above expressions against one another as choices. The on scene touches the top; above and below have clear gaps.

Root's `diagram.ts` and `AssessmentDiagramView.tsx` were read. A browser SVG reproduction of the original geometry was visually inspected; the pre-fix screenshot is `/private/tmp/hiraia-foundation-diagram-review-20260929.png`. The corrected inside occlusion was checked in the actual source code. This was not a React Native or device-rendering test. Native screenshot verification and intended-age interpretation remain part of root's integration work. The image is required for the six position questions; read-aloud must not narrate the answer.

## Verification and limits

The local read-only checks passed for 36 IDs, 108 language option sets, nine complete trilingual source snapshots with literal excerpts, valid keyed option IDs and matching distractor-rationale keys, diagram subject/inverse relations, and false/null production/review gates. Family grouping was also reviewed for meaning. The standalone schema validator and injected controls are owned by the compiler agent; this review does not substitute their mechanical results for meaning review.

No item was newly placed on hold after its concrete correction. That does not mean difficulty, form equivalence, reading level, local curriculum coverage or native language quality has been established. Those gates remain pending. The author should freeze the corrected file before final catalogue generation, and root should verify rotation and native presentation from that exact version.
