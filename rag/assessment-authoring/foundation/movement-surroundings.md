# Incoming Grade 3 foundation exam: movement and surroundings

Authored in-session on 29 September 2026. This is the 36-item movement/surroundings half of the new foundation pool. The separate existing Grade 3-material bank is unchanged. These items support a Hiraia exam; they are not a full school exam or a general Grade 3 readiness decision.

Every question, option, explanation and translation was composed in-session. A local Python helper assembled the schema and this readable rendering; it did not generate questions from templates or call another model. Native-speaker, teacher and learner reviews remain pending, and every item has `production_ready: false`. Source-checked means the stated content/source checks occurred, not that later admission gates passed.

JSON SHA-256: `f221f20838f7395feb9611108f7ec1106fa1666be4a9607cd83c3464e2ff483b`.

## Scope and source

Scope: `incoming-grade3-foundations-2016k-v1`. Material grade is 0 (Kindergarten), separately from the incoming student grade. The [official May 2016 Kindergarten guide](https://www.deped.gov.ph/wp-content/uploads/2019/01/Kinder-CG_0.pdf) was read with its PDF page boundaries. Page 21 maps the familiar positions in/on/over/under/top/bottom to `MKSC-00-12`; that code is also reused elsewhere for counting, so the page is essential. Page 23 supplies `PNEKPP-00-4` (push/pull/rising/sinking), `PNEKPP-00-5` (familiar movement), and `PNEKE-00-1/2/4/5/6` (weather, suitable clothing, care, familiar cause/effect and safety).

Normally progressing 2026 Grade 3 children would have attended Kindergarten in 2023–2024 under the earlier guide. That is a cohort inference, not verified individual teaching history. No complete Grade 2 Makabansa crosswalk, whole competency mastery, practical skill or developmental norm is claimed. Newer Grade 3/4 card metadata does not itself establish earlier coverage; each item has its separate foundation claim.

## Inventory and baseline candidates

- 36 items: 18 FORCE_MOTION_ENERGY and 18 EARTH_SPACE; 24 distinct knowledge families.
- Six push/pull benchmark candidates (0037–0042) intentionally share one family. Context and task direction vary; they are not six independent constructs.
- Six position benchmark candidates (0049–0054): inside, contact-on and one shared vertical-position family. The four vertical/reverse variants share that family.
- Six weather benchmark candidates (0055–0060) cover familiar observations. Sharing a slot does not establish equal difficulty or calibration.
- 9 items have exact current trilingual card links; the other items make no recent-card eligibility claim. No fabricated card or bank hash is supplied.
- Six deterministic diagrams. Above is separated by a gap; on has contact; inside must be visibly enclosed. Items0053/0054 ask about the box and invert the scene’s ball-relative-box relation.
- Proposed baseline: 0037 push; 0043 round-and-round motion; 0049 inside; 0058 wind; 0061 raincoat; 0067 proper disposal. These are this half’s six candidates, not a complete twelve-item form.

Actual selector rotation and mixed-bank deduplication are integration checks. No numerical sufficiency claim follows from the raw item count.

## Review evidence and limits

All stems, options, answer keys and explanations were compared across English, Tagalog and Cebuano. Every linked card body was read in all three languages and copied as a literal current snapshot. Corpus root checks additionally found `unlod`53, `tugnaw`227, `ngilit`46, `mabinantayon`17, `tuyok`530, `pislit`73, `gapas`29 and `talsik`8 in current Cebuano bodies. Selected examples were inspected in context. These counts attest usage; they do not establish native quality or grade-appropriate comprehension.

Root and independent model peer review produced concrete repairs:0044 no longer offers compatible back-and-forth travel as a wrong answer on a straight path;0046 explicitly fixes equal travel distance and simultaneous start;0053 does not assume a prior question;0058 avoids an air/wind keyword cue in Tagalog/Cebuano and an implausible shadow-color distractor;0061 drops an unnecessary knitted/woven mismatch;0062 asks for an item made as rain protection rather than any temporary cover;0063 describes preserving warmth rather than a sweater creating heat;0065 uses an adjective for a slippery path rather than the path itself slipping;0069 uses the explicit both-sides-of-paper teaching card.

Source defects/exclusions retained for separate corpus review; no existing card was edited:

| Source | Evidence and handling |
|---|---|
| dcard-08198 / full-raincoat-g4 | EN says rainy days and TL says maulan; BIS says ting-ulaw nga adlaw. This weather-language mismatch needs corpus/native repair. Not linked to0061. |
| dcard-03728 / rainy-day-gear-g4 | Its English advice uses boots for walking in flooded areas. That unsafe context is excluded.0066 addresses small rain splashes and gives no floodwater instruction. |
| dcard-01170 / reusing-shopping-bags-g4 | Claims a cloth bag can be used for life, echoed across languages.0067–0072 do not copy that durability overclaim;0070 is limited to an explicitly usable bag and has no exact link to that card. |
| dcard-00635 / sunny-weather-g3 | BIS init nga panahon can collapse sunny into hot.0056 uses explicit bright Sun/few-clouds observations and does not attach that card.0060 retains only the separate verified same-day-change claim from dcard-00640. |

Source-check limitations are recorded per item. Clothing distractors and longer conditions in0046 need intended-age listening review. Position translations avoid on/above competing choices because their ordinary local-language terms can overlap. No left/right item is admitted from a source that only lists in/on/over/under/top/bottom.

## Item reference

### ha-f3-0037

Moving a door away from oneself with the hands is a push.

Family: `push-pull-action-direction`. Target: `g3-foundation-push-away`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `foundation-push-pull-motion`.

Limit: Recognizes a pictured-in-words everyday action; does not measure force, strength, or ability to open a door.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Your hands move a door away from you. What are you doing? | o1: Pushing; o2: Pulling; o3: Lifting | o1: Pushing | You push the door when your hands move it away from you. |
| Tagalog | Inilalayo mo ang pinto gamit ang iyong mga kamay. Ano ang ginagawa mo? | o1: Pagtulak; o2: Paghila; o3: Pagbuhat | o1: Pagtulak | Itinutulak mo ang pinto kapag inilalayo ito ng iyong mga kamay. |
| Cebuano | Gipalayo nimo ang pultahan gamit ang imong mga kamot. Unsa ang imong gibuhat? | o1: Pagtulod; o2: Pagbira; o3: Pag-alsa | o1: Pagtulod | Gitulod nimo ang pultahan kung gipalayo kini sa imong mga kamot. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: Pulling toward oneself reverses the stated direction. o3: Lifting moves an object upward; that is not the stated door action.

### ha-f3-0038

Bringing a drawer handle toward oneself is a pull.

Family: `push-pull-action-direction`. Target: `g3-foundation-pull-toward`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `foundation-push-pull-motion`.

Limit: Recognizes the stated hand action only; opening direction is explicit rather than assumed for every drawer.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | You bring a drawer handle toward you. What is this action? | o1: Pushing; o2: Lifting; o3: Pulling | o3: Pulling | Bringing the handle toward you is pulling. |
| Tagalog | Inilalapit mo sa iyo ang hawakan ng drawer. Anong kilos ito? | o1: Pagtulak; o2: Pagbuhat; o3: Paghila | o3: Paghila | Paghila ang paglapit ng hawakan sa iyo. |
| Cebuano | Gipaduol nimo ang kuptanan sa drawer ngadto kanimo. Unsa kini nga lihok? | o1: Pagtulod; o2: Pag-alsa; o3: Pagbira | o3: Pagbira | Pagbira ang pagduol sa kuptanan ngadto kanimo. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Pushing away is the opposite action. o2: Lifting raises the handle; the scenario says toward the child.

### ha-f3-0039

Pressing a button inward with a finger is a push.

Family: `push-pull-action-direction`. Target: `g3-foundation-press-button`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `foundation-push-pull-motion`.

Limit: Classifies the physical finger action; no electrical or machine-function claim is tested.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | A finger presses a button inward. Which action is this? | o1: Pulling; o2: Pushing; o3: Lifting | o2: Pushing | Pressing the button inward gives it a push. |
| Tagalog | Dinidiinan ng daliri ang pindutan papasok. Anong kilos ito? | o1: Paghila; o2: Pagtulak; o3: Pagbuhat | o2: Pagtulak | Pagtulak ang pagdiin sa pindutan papasok. |
| Cebuano | Gipislit sa tudlo ang buton pasulod. Unsa kini nga lihok? | o1: Pagbira; o2: Pagtulod; o3: Pag-alsa | o2: Pagtulod | Pagtulod ang pagpislit sa buton pasulod. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Pulling would draw the button outward toward the finger. o3: Lifting would raise the button, not press it inward.

### ha-f3-0040

Drawing a toy wagon closer by its rope is a pull.

Family: `push-pull-action-direction`. Target: `g3-foundation-pull-wagon-rope`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `foundation-push-pull-motion`.

Limit: Recognizes a direct, stated rope action; does not assess pulleys, friction, or rope tension.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | You bring a toy wagon closer by its rope. What are you doing? | o1: Pulling; o2: Pushing; o3: Lifting | o1: Pulling | You pull the rope to bring the wagon closer. |
| Tagalog | Inilalapit mo ang laruang kariton gamit ang tali nito. Ano ang ginagawa mo? | o1: Paghila; o2: Pagtulak; o3: Pagbuhat | o1: Paghila | Hinihila mo ang tali upang ilapit ang kariton. |
| Cebuano | Gipaduol nimo ang dulaan nga kariton gamit ang pisi niini. Unsa ang imong gibuhat? | o1: Pagbira; o2: Pagtulod; o3: Pag-alsa | o1: Pagbira | Gibira nimo ang pisi aron mapaduol ang kariton. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: Pushing does not describe drawing the rope toward oneself. o3: The wagon is brought closer, not raised from the ground.

### ha-f3-0041

A forward push on a cart can start it rolling forward.

Family: `push-pull-action-direction`. Target: `g3-foundation-push-cart-forward`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `foundation-push-pull-motion`.

Limit: Recognizes an everyday action for a free-rolling cart; no claim that every push overcomes a brake or blockage.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | A cart is free to roll. Which action can start it moving forward? | o1: Hold it still; o2: Lift it straight up; o3: Push it forward | o3: Push it forward | Pushing the cart forward can start it rolling forward. |
| Tagalog | Malayang makagugulong ang kariton. Aling kilos ang makapagpapagalaw dito pasulong? | o1: Hawakan nang hindi gumagalaw; o2: Buhatin nang tuwid pataas; o3: Itulak pasulong | o3: Itulak pasulong | Maaaring magsimulang gumulong pasulong ang kariton kapag itinulak ito pasulong. |
| Cebuano | Makaligid ang kariton nga walay babag. Unsang lihok ang makapasugod niini sa paglihok paabante? | o1: Kupti aron dili molihok; o2: Alsaha kini diretso pataas; o3: Itulod paabante | o3: Itulod paabante | Ang pagtulod sa kariton paabante makapasugod niini sa pagligid paabante. |

Exact teaching links: `dcard-01799` / `pushing-a-cart-g3`.

Wrong-answer rationale: o1: Holding the cart still prevents its movement. o2: Lifting moves it upward rather than rolling it forward.

### ha-f3-0042

Pulling a rope toward oneself can bring the object attached to it closer.

Family: `push-pull-action-direction`. Target: `g3-foundation-pull-rope-action`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `foundation-push-pull-motion`.

Limit: Recognizes the chosen action in a light toy context; not a test of lifting equipment or mechanical advantage.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | A light toy is tied to a rope. Which action brings it toward your hand? | o1: Push the toy away; o2: Pull the rope toward you; o3: Leave the rope still | o2: Pull the rope toward you | Pulling the rope toward you brings the attached toy closer. |
| Tagalog | Nakatali sa tali ang magaan na laruan. Aling kilos ang maglalapit dito sa iyong kamay? | o1: Itulak palayo ang laruan; o2: Hilahin ang tali papalapit sa iyo; o3: Hayaang hindi gumalaw ang tali | o2: Hilahin ang tali papalapit sa iyo | Lalapit ang nakakabit na laruan kapag hinila mo ang tali papalapit sa iyo. |
| Cebuano | Ang gaan nga dulaan gihigot sa pisi. Unsang lihok ang makapaduol niini sa imong kamot? | o1: Itulod palayo ang dulaan; o2: Biraa ang pisi padulong kanimo; o3: Pasagdi ang pisi nga dili molihok | o2: Biraa ang pisi padulong kanimo | Maduol ang gihigot nga dulaan kung imong birahon ang pisi padulong kanimo. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Pushing the toy away changes its position in the opposite direction. o3: Leaving the rope still supplies no action to bring the toy closer.

### ha-f3-0043

A wheel turning about its center moves round and round.

Family: `movement-round-and-round`. Target: `g3-foundation-round-and-round`. Source: `PNEKPP-00-5`, PDF p.23. Benchmark slot: `None`.

Limit: Names the familiar motion of a wheel turning in place; does not infer axle function, force, or rotational speed.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | A wheel spins in place. How does it move? | o1: Back and forth; o2: Round and round; o3: Straight ahead | o2: Round and round | A spinning wheel turns round and round about its center. |
| Tagalog | Umiikot ang gulong sa kinalalagyan nito. Paano ito gumagalaw? | o1: Pabalik-balik; o2: Paikot-ikot; o3: Tuwid na pasulong | o2: Paikot-ikot | Ang umiikot na gulong ay gumagalaw nang paikot-ikot sa gitna nito. |
| Cebuano | Nagtuyok ang ligid sa iyang nahimutangan. Giunsa kini paglihok? | o1: Balik-balik; o2: Patuyok-tuyok; o3: Diretso paabante | o2: Patuyok-tuyok | Ang nagtuyok nga ligid molihok nga patuyok-tuyok palibot sa tunga niini. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Back-and-forth motion reverses along a path, unlike the stated spinning. o3: Straight-ahead travel would change the wheel’s place; the stem fixes it in place.

### ha-f3-0044

A toy car travelling along a path without bends moves straight ahead.

Family: `movement-straight`. Target: `g3-foundation-straight-motion`. Source: `PNEKPP-00-5`, PDF p.23. Benchmark slot: `None`.

Limit: Names the explicitly described path; does not test distance, speed, or a force law.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | A toy car follows a path with no bends. How does it move? | o1: Straight ahead; o2: Round and round; o3: In zigzags | o1: Straight ahead | A path with no bends goes straight ahead. |
| Tagalog | Dumaraan ang laruang kotse sa daang walang liko. Paano ito gumagalaw? | o1: Tuwid na pasulong; o2: Paikot-ikot; o3: Paliku-liko | o1: Tuwid na pasulong | Tuwid na pasulong ang daang walang liko. |
| Cebuano | Nagsubay ang dulaan nga sakyanan sa agianang walay liko. Giunsa kini paglihok? | o1: Diretso paabante; o2: Patuyok-tuyok; o3: Liko-liko | o1: Diretso paabante | Diretso paabante ang agianan nga walay liko. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: Round-and-round travel follows a circular path. o3: A zigzag path has repeated turns, unlike the path without bends.

### ha-f3-0045

A playground swing usually moves back and forth.

Family: `movement-back-and-forth`. Target: `g3-foundation-back-and-forth`. Source: `PNEKPP-00-5`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes the ordinary swing motion, not every possible motion or safe use of playground equipment.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | How does a playground swing usually move? | o1: Only straight upward; o2: In complete circles; o3: Back and forth | o3: Back and forth | A swing moves forward, then back, again and again. |
| Tagalog | Paano karaniwang gumagalaw ang duyan sa palaruan? | o1: Tuwid na pataas lamang; o2: Sa buong mga bilog; o3: Pabalik-balik | o3: Pabalik-balik | Umuusad ang duyan, bumabalik, at inuulit ang kilos na ito. |
| Cebuano | Giunsa kasagarang paglihok sa duyan sa dulaanan? | o1: Diretso pataas lamang; o2: Sa kompleto nga mga lingin; o3: Balik-balik | o3: Balik-balik | Molihok ang duyan paabante, dayon pabalik, ug sublion kini nga lihok. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: A swing does not normally continue only upward. o2: A swing does not normally make full circles around its support.

### ha-f3-0046

For the same travel distance and simultaneous start, the toy arriving first completes the trip faster.

Family: `relative-motion-speed`. Target: `g3-foundation-faster-same-path`. Source: `PNEKPP-00-5`, PDF p.23. Benchmark slot: `None`.

Limit: Compares overall trip time under explicit equal-distance and simultaneous-start conditions; does not assert speed at every instant or ask for a calculation.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Red and blue toy cars start together and travel the same distance. Red arrives first. Which finished faster? | o1: The red car; o2: The blue car; o3: They finished together | o1: The red car | They started together and travelled the same distance. Red arrived first, so it finished the trip faster. |
| Tagalog | Sabay nagsimula ang pula at asul na laruang kotse. Pareho ang layong tinakbo. Nauna ang pula. Alin ang mas mabilis nakatapos? | o1: Ang pulang kotse; o2: Ang asul na kotse; o3: Sabay silang natapos | o1: Ang pulang kotse | Sabay silang nagsimula at pareho ang layong tinakbo. Nauna ang pula, kaya mas mabilis nitong natapos ang biyahe. |
| Cebuano | Dungan nagsugod ang pula ug asul nga dulaan nga sakyanan. Pareho ang gilay-on nga ilang giagi. Naabot una ang pula. Hain ang mas paspas nakahuman? | o1: Ang pula nga sakyanan; o2: Ang asul nga sakyanan; o3: Dungan sila nahuman | o1: Ang pula nga sakyanan | Dungan sila nagsugod ug pareho ang gilay-on nga ilang giagi. Nauna ang pula, busa mas paspas kini nakahuman sa biyahe. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: The blue car did not arrive first in the stated event. o3: The stem explicitly says red arrived first, excluding a tie.

### ha-f3-0047

An object moving downward through water toward the bottom is sinking.

Family: `sinking-downward-movement`. Target: `g3-foundation-sinking-motion`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Names an observed direction in the stated scenario; does not explain density or claim every coin/object sinks.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | A coin moves down through water to the bottom. What is it doing? | o1: Floating on top; o2: Sinking; o3: Rising | o2: Sinking | The coin is sinking because it is moving downward through the water. |
| Tagalog | Bumababa ang barya sa tubig hanggang sa ilalim. Ano ang ginagawa nito? | o1: Lumulutang sa ibabaw; o2: Lumulubog; o3: Umaangat | o2: Lumulubog | Lumulubog ang barya dahil pababa ang galaw nito sa tubig. |
| Cebuano | Nanaog ang sensilyo sa tubig padulong sa ilalom. Unsa ang gibuhat niini? | o1: Naglutaw sa ibabaw; o2: Nag-unlod; o3: Nisaka | o2: Nag-unlod | Nag-unlod ang sensilyo kay paubos ang paglihok niini sa tubig. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Floating on top does not match movement toward the bottom. o3: Rising is upward, opposite the stated downward movement.

### ha-f3-0048

An object moving upward is rising.

Family: `rising-upward-movement`. Target: `g3-foundation-rising-motion`. Source: `PNEKPP-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Names the stated upward motion of a balloon; does not imply all balloons rise or assess why a particular balloon rises.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | A balloon moves upward toward the ceiling. Which word describes its movement? | o1: Falling; o2: Staying still; o3: Rising | o3: Rising | The balloon is rising because it moves upward. |
| Tagalog | Gumagalaw ang lobo pataas patungo sa kisame. Aling salita ang naglalarawan sa galaw nito? | o1: Bumabagsak; o2: Hindi gumagalaw; o3: Umaangat | o3: Umaangat | Umaangat ang lobo dahil pataas ang galaw nito. |
| Cebuano | Molihok ang balloon pataas padulong sa kisame. Unsang pulong ang naghulagway sa paglihok niini? | o1: Nahulog; o2: Wala molihok; o3: Nisaka | o3: Nisaka | Nisaka ang balloon kay pataas ang paglihok niini. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Falling is downward movement. o2: The balloon is moving, so it is not staying still.

### ha-f3-0049

The ball shown within the open boundary of the box is inside the box.

Family: `spatial-containment-inside`. Target: `g3-foundation-inside-position`. Source: `MKSC-00-12`, PDF p.21. Benchmark slot: `foundation-relative-position`.

Limit: Recognizes this two-object picture only; not a test of three-dimensional geometry or position vocabulary categories.

Diagram: ball `inside` box. Question subject: `ball`. Keyed relation: `inside`.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Look at the picture. Where is the ball? | o1: Inside the box; o2: On the box; o3: Below the box | o1: Inside the box | The ball is inside the open box. |
| Tagalog | Tingnan ang larawan. Nasaan ang bola? | o1: Sa loob ng kahon; o2: Sa ibabaw ng kahon; o3: Sa ilalim ng kahon | o1: Sa loob ng kahon | Nasa loob ng bukas na kahon ang bola. |
| Cebuano | Tan-awa ang hulagway. Asa ang bola? | o1: Sa sulod sa kahon; o2: Sa ibabaw sa kahon; o3: Sa ilalom sa kahon | o1: Sa sulod sa kahon | Naa sa sulod sa abli nga kahon ang bola. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: The ball is not resting on the box’s top. o3: The ball is not beneath the box.

### ha-f3-0050

The ball touching and resting on top of the box is on the box.

Family: `spatial-contact-on`. Target: `g3-foundation-on-position`. Source: `MKSC-00-12`, PDF p.21. Benchmark slot: `foundation-relative-position`.

Limit: Recognizes the contact shown in the picture; above is deliberately not an alternative because it can also be broadly true.

Diagram: ball `on` box. Question subject: `ball`. Keyed relation: `on`.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Where is the ball resting in this picture? | o1: Inside the box; o2: Below the box; o3: On the box | o3: On the box | The ball rests on top of the box. |
| Tagalog | Saan nakapatong ang bola sa larawang ito? | o1: Sa loob ng kahon; o2: Sa ilalim ng kahon; o3: Sa ibabaw ng kahon | o3: Sa ibabaw ng kahon | Nakapatong ang bola sa ibabaw ng kahon. |
| Cebuano | Asa nagpatong ang bola niini nga hulagway? | o1: Sa sulod sa kahon; o2: Sa ilalom sa kahon; o3: Sa ibabaw sa kahon | o3: Sa ibabaw sa kahon | Nagpatong ang bola sa ibabaw sa kahon. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: The ball is not inside the box. o2: The ball is not underneath the box.

### ha-f3-0051

The ball shown with a clear gap higher than the box is above the box.

Family: `relative-vertical-position`. Target: `g3-foundation-above-position`. Source: `MKSC-00-12`, PDF p.21. Benchmark slot: `foundation-relative-position`.

Limit: Recognizes the explicit vertical relation in one picture, not physical support or why the ball is there.

Diagram: ball `above` box. Question subject: `ball`. Keyed relation: `above`.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Compare the ball with the box. Where is the ball? | o1: Inside the box; o2: Above the box; o3: Below the box | o2: Above the box | The ball is above the box, with a gap between them. |
| Tagalog | Ihambing ang bola sa kahon. Nasaan ang bola? | o1: Sa loob ng kahon; o2: Sa ibabaw ng kahon; o3: Sa ilalim ng kahon | o2: Sa ibabaw ng kahon | Nasa ibabaw ng kahon ang bola, at may puwang sa pagitan nila. |
| Cebuano | Itandi ang bola sa kahon. Asa ang bola? | o1: Sa sulod sa kahon; o2: Sa ibabaw sa kahon; o3: Sa ilalom sa kahon | o2: Sa ibabaw sa kahon | Naa sa ibabaw sa kahon ang bola, ug adunay luna tali kanila. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: The ball lies outside the box boundary. o3: Below reverses the visible vertical order.

### ha-f3-0052

The ball shown beneath the raised box is below the box.

Family: `relative-vertical-position`. Target: `g3-foundation-below-position`. Source: `MKSC-00-12`, PDF p.21. Benchmark slot: `foundation-relative-position`.

Limit: Recognizes the displayed vertical relation, not the stability or mechanics of the raised box.

Diagram: ball `below` box. Question subject: `ball`. Keyed relation: `below`.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | The picture shows a raised box. Where is the ball compared with it? | o1: Below the box; o2: Inside the box; o3: Above the box | o1: Below the box | The ball is below the raised box. |
| Tagalog | May nakataas na kahon sa larawan. Nasaan ang bola kung ihahambing dito? | o1: Sa ilalim ng kahon; o2: Sa loob ng kahon; o3: Sa ibabaw ng kahon | o1: Sa ilalim ng kahon | Nasa ilalim ng nakataas na kahon ang bola. |
| Cebuano | Adunay gipataas nga kahon sa hulagway. Asa ang bola kon itandi niini? | o1: Sa ilalom sa kahon; o2: Sa sulod sa kahon; o3: Sa ibabaw sa kahon | o1: Sa ilalom sa kahon | Naa sa ilalom sa gipataas nga kahon ang bola. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: The ball is outside the box boundary. o3: Above reverses the pictured vertical order.

### ha-f3-0053

When the ball is above the box, the box is below the ball.

Family: `relative-vertical-position`. Target: `g3-foundation-box-below-ball`. Source: `MKSC-00-12`, PDF p.21. Benchmark slot: `foundation-relative-position`.

Limit: Recognizes the inverse reference in the pictured vertical relation; shares the same family as ball-above and ball-below items.

Diagram: ball `above` box. Question subject: `box`. Keyed relation: `below`.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Look at the box. Where is it compared with the ball? | o1: Inside the ball; o2: Above the ball; o3: Below the ball | o3: Below the ball | The box is below the ball. The ball is higher. |
| Tagalog | Tingnan ang kahon. Nasaan ito kung ihahambing sa bola? | o1: Sa loob ng bola; o2: Sa ibabaw ng bola; o3: Sa ilalim ng bola | o3: Sa ilalim ng bola | Nasa ilalim ng bola ang kahon. Mas mataas ang bola. |
| Cebuano | Tan-awa ang kahon. Asa kini kon itandi sa bola? | o1: Sa sulod sa bola; o2: Sa ibabaw sa bola; o3: Sa ilalom sa bola | o3: Sa ilalom sa bola | Naa sa ilalom sa bola ang kahon. Mas taas ang bola. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: The separate box is not contained within the ball. o2: Above applies to the ball relative to the box, not the reversed question.

### ha-f3-0054

When the ball is below the box, the box is above the ball.

Family: `relative-vertical-position`. Target: `g3-foundation-box-above-ball`. Source: `MKSC-00-12`, PDF p.21. Benchmark slot: `foundation-relative-position`.

Limit: Recognizes the inverse reference in one diagram; no new independent knowledge family is claimed for the reversal.

Diagram: ball `below` box. Question subject: `box`. Keyed relation: `above`.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Find the box in the picture. Where is the box compared with the ball? | o1: Below the ball; o2: Above the ball; o3: Inside the ball | o2: Above the ball | The box is above the ball. The ball is lower. |
| Tagalog | Hanapin ang kahon sa larawan. Nasaan ang kahon kung ihahambing sa bola? | o1: Sa ilalim ng bola; o2: Sa ibabaw ng bola; o3: Sa loob ng bola | o2: Sa ibabaw ng bola | Nasa ibabaw ng bola ang kahon. Mas mababa ang bola. |
| Cebuano | Pangitaa ang kahon sa hulagway. Asa ang kahon kon itandi sa bola? | o1: Sa ilalom sa bola; o2: Sa ibabaw sa bola; o3: Sa sulod sa bola | o2: Sa ibabaw sa bola | Naa sa ibabaw sa bola ang kahon. Mas ubos ang bola. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Below describes the ball relative to the box, the reverse of the question. o3: The box is separate from the ball, not contained within it.

### ha-f3-0055

Rain consists of water drops falling from clouds.

Family: `rain-water-drops`. Target: `g3-foundation-rain-drops`. Source: `PNEKE-00-1`, PDF p.23. Benchmark slot: `foundation-weather`.

Limit: Recognizes familiar rain; no water-cycle, cloud-formation, or precipitation-process claim is assessed.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | What do we call water drops falling from clouds? | o1: Wind; o2: Rain; o3: Sunshine | o2: Rain | Water drops falling from clouds are rain. |
| Tagalog | Ano ang tawag sa mga patak ng tubig na bumabagsak mula sa ulap? | o1: Hangin; o2: Ulan; o3: Sikat ng araw | o2: Ulan | Ulan ang mga patak ng tubig na bumabagsak mula sa ulap. |
| Cebuano | Unsay tawag sa mga tulo sa tubig nga nahulog gikan sa panganod? | o1: Hangin; o2: Uwan; o3: Kahayag sa adlaw | o2: Uwan | Uwan ang mga tulo sa tubig nga nahulog gikan sa panganod. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Wind is moving air, not falling water drops. o3: Sunshine is light, not falling water drops.

### ha-f3-0056

Bright sunshine with few clouds is a familiar sign of sunny weather.

Family: `sunny-sky-observation`. Target: `g3-foundation-sunny-sky`. Source: `PNEKE-00-1`, PDF p.23. Benchmark slot: `foundation-weather`.

Limit: Recognizes a clear sunny example without claiming sunny always means hot or that rain and sunshine can never occur together.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Which sky best shows sunny weather? | o1: Bright Sun and few clouds; o2: Thick clouds cover the Sun; o3: Dark clouds with heavy rain | o1: Bright Sun and few clouds | Bright sunshine and few clouds show a sunny sky. |
| Tagalog | Aling langit ang nagpapakita ng maaraw na panahon? | o1: Maliwanag na araw at kaunting ulap; o2: Makapal na ulap na tumatakip sa araw; o3: Madilim na ulap at malakas na ulan | o1: Maliwanag na araw at kaunting ulap | Maliwanag na sikat ng araw at kaunting ulap ang makikita sa maaraw na langit. |
| Cebuano | Hain nga langit ang nagpakita nga hayag ang pagsidlak sa adlaw? | o1: Hayag nga adlaw ug pipila ka panganod; o2: Baga nga panganod nga nagtabon sa adlaw; o3: Ngitngit nga panganod ug kusog nga uwan | o1: Hayag nga adlaw ug pipila ka panganod | Hayag nga kahayag sa adlaw ug pipila ka panganod ang makita sa maong langit. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: Thick cloud cover blocking the Sun describes a cloudy example. o3: Dark clouds and heavy rain describe a rainy example rather than the clear sunny example requested.

### ha-f3-0057

Many clouds covering the sky are a familiar sign of cloudy weather.

Family: `cloudy-sky-observation`. Target: `g3-foundation-cloudy-sky`. Source: `PNEKE-00-1`, PDF p.23. Benchmark slot: `foundation-weather`.

Limit: Recognizes an observable cloudy sky; does not claim cloudiness guarantees rain, cold air, or a particular cloud type.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Many clouds cover most of the sky. What is the weather like? | o1: Clear, with no clouds; o2: Raining heavily; o3: Cloudy | o3: Cloudy | A sky covered by many clouds is cloudy. Clouds alone do not prove it is raining. |
| Tagalog | Maraming ulap ang tumatakip sa halos buong langit. Ano ang lagay ng panahon? | o1: Maaliwalas, walang ulap; o2: Malakas ang ulan; o3: Maulap | o3: Maulap | Maulap ang langit na natatakpan ng maraming ulap. Hindi sapat ang ulap lamang upang masabing umuulan. |
| Cebuano | Daghang panganod ang nagtabon sa kadaghanan sa langit. Unsa ang kahimtang sa panahon? | o1: Hayag, walay panganod; o2: Kusog ang uwan; o3: Dag-om | o3: Dag-om | Dag-om ang langit nga gitabonan sa daghang panganod. Ang panganod lamang dili pasabot nga nag-uwan. |

Exact teaching links: `dcard-05269` / `cloudy-weather-g3`.

Wrong-answer rationale: o1: No clouds contradicts the many clouds described. o2: Heavy rain is not stated and cannot be concluded from cloud cover alone.

### ha-f3-0058

Moving leaves can show the effect of wind, although the wind itself is not visible.

Family: `observable-wind-effects`. Target: `g3-foundation-wind-signs`. Source: `PNEKE-00-1`, PDF p.23. Benchmark slot: `foundation-weather`.

Limit: Recognizes one familiar effect of wind; does not claim every moving leaf is caused by wind or measure wind strength.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Leaves flutter. No rain is falling and nobody touches them. What can make them move? | o1: Wind; o2: Rain; o3: Sunshine | o1: Wind | Wind can move leaves. We see its effect, not the wind itself. |
| Tagalog | Kumakaway ang mga dahon. Walang ulan at walang humahawak sa mga ito. Ano ang maaaring magpagalaw sa mga ito? | o1: Hangin; o2: Ulan; o3: Sikat ng araw | o1: Hangin | Maaaring pagalawin ng hangin ang mga dahon. Epekto nito ang nakikita natin, hindi ang hangin mismo. |
| Cebuano | Nagkaway ang mga dahon. Wala mag-uwan ug walay naghikap niini. Unsay makapalihok niini? | o1: Hangin; o2: Uwan; o3: Kahayag sa adlaw | o1: Hangin | Ang hangin makapalihok sa mga dahon. Ang epekto niini ang atong makita, dili ang hangin mismo. |

Exact teaching links: `dcard-00636` / `windy-weather-g3`.

Wrong-answer rationale: o2: The stem explicitly excludes falling rain. o3: Sunshine is not the direct moving-air action that makes leaves flutter.

### ha-f3-0059

Rain reaching dry, uncovered ground can make its surface wet.

Family: `rain-wets-ground`. Target: `g3-foundation-rain-wets-ground`. Source: `PNEKE-00-5`, PDF p.23. Benchmark slot: `foundation-weather`.

Limit: Recognizes the immediate wetting effect; does not claim every ground surface stays wet, that puddles always form, or why water later disappears.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Rain falls onto dry ground. What can happen to the surface? | o1: It becomes drier; o2: It becomes wet; o3: It stays completely dry | o2: It becomes wet | Rain brings water to the ground, so its surface can become wet. |
| Tagalog | Bumuhos ang ulan sa tuyong lupa. Ano ang maaaring mangyari sa ibabaw nito? | o1: Lalo itong matutuyo; o2: Mababasa ito; o3: Mananatili itong lubos na tuyo | o2: Mababasa ito | May dalang tubig ang ulan, kaya maaaring mabasa ang ibabaw ng lupa. |
| Cebuano | Miulan sa uga nga yuta. Unsay mahimong mahitabo sa ibabaw niini? | o1: Mas mouga kini; o2: Mabasa kini; o3: Magpabilin kini nga hingpit nga uga | o2: Mabasa kini | Nagdala og tubig ang uwan, busa mahimong mabasa ang ibabaw sa yuta. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Rain adds water rather than drying the surface in this direct observation. o3: The stated rain reaches the ground; remaining completely dry is not the wetting effect being recalled.

### ha-f3-0060

Weather can change between morning and afternoon on the same day.

Family: `weather-can-change-within-day`. Target: `g3-foundation-weather-changes-in-day`. Source: `PNEKE-00-1`, PDF p.23. Benchmark slot: `foundation-weather`.

Limit: Recognizes same-day change; does not predict later weather, seasons, or climate.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | The morning is sunny, then rain falls that afternoon. What does this show? | o1: Weather cannot change; o2: It rained the whole day; o3: Weather can change in a day | o3: Weather can change in a day | The weather changed from sunny to rainy within one day. |
| Tagalog | Maaraw sa umaga, saka umulan sa hapon. Ano ang ipinapakita nito? | o1: Hindi nagbabago ang panahon; o2: Umulan buong araw; o3: Maaaring magbago ang panahon sa isang araw | o3: Maaaring magbago ang panahon sa isang araw | Nagbago ang panahon mula maaraw tungo sa maulan sa loob ng isang araw. |
| Cebuano | Hayag ang adlaw sa buntag, dayon miulan sa hapon. Unsa ang gipakita niini? | o1: Dili mausab ang panahon; o2: Miulan sa tibuok adlaw; o3: Mahimong mausab ang panahon sulod sa usa ka adlaw | o3: Mahimong mausab ang panahon sulod sa usa ka adlaw | Nausab ang panahon gikan sa hayag nga adlaw ngadto sa pag-uwan sulod sa usa ka adlaw. |

Exact teaching links: `dcard-00640` / `weather-changes-in-a-day-g3`.

Wrong-answer rationale: o1: The observed change contradicts an unchanging-weather claim. o2: The morning was sunny in the given example, so continuous all-day rain is not what was described.

### ha-f3-0061

Wearing a raincoat over clothing helps keep the covered clothing and body dry in rain.

Family: `rain-protection-clothing`. Target: `g3-foundation-raincoat-keeps-dry`. Source: `PNEKE-00-2`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes the ordinary purpose of a raincoat; does not guarantee dryness in all conditions or assess flood/storm safety.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Which clothing helps keep your body dry when it rains? | o1: A cotton shirt; o2: A raincoat; o3: A sweater | o2: A raincoat | A raincoat covers your clothing and helps keep rain off your body. |
| Tagalog | Aling kasuotan ang tumutulong na hindi mabasa ang katawan kapag umuulan? | o1: Koton na damit; o2: Kapote; o3: Sweater | o2: Kapote | Tinatakpan ng kapote ang iyong damit at tumutulong upang hindi mabasa ng ulan ang katawan. |
| Cebuano | Unsang sinina ang makatabang nga dili mabasa ang lawas kung mag-uwan? | o1: Sinina nga gapas; o2: Raincoat; o3: Sweater | o2: Raincoat | Gitabonan sa raincoat ang imong sinina ug makatabang kini nga dili mabasa sa uwan ang lawas. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: An ordinary cotton shirt absorbs rain instead of serving as rain protection. o3: An ordinary sweater is for warmth and is not designed as rainwear.

### ha-f3-0062

An open umbrella held overhead can block ordinary raindrops from reaching the person beneath it.

Family: `rain-protection-clothing`. Target: `g3-foundation-umbrella-rain`. Source: `PNEKE-00-2`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes the ordinary rain-protection purpose of an umbrella, not safe use during lightning, strong wind, or flooding.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Which item is made to keep rain off you? | o1: An umbrella; o2: A paper fan; o3: A notebook | o1: An umbrella | An open umbrella can stop raindrops from reaching you underneath it. |
| Tagalog | Aling gamit ang ginawa bilang panangga sa ulan? | o1: Payong; o2: Pamaypay na papel; o3: Kuwaderno | o1: Payong | Maaaring salagin ng bukas na payong ang mga patak ng ulan upang hindi ka mabasa sa ilalim nito. |
| Cebuano | Unsang gamit ang gihimo nga panagang sa uwan? | o1: Payong; o2: Paypay nga papel; o3: Notebook | o1: Payong | Ang abli nga payong makapugong sa mga tulo sa uwan aron dili ka mabasa sa ilalom niini. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: A paper fan is designed for moving air, not for rain cover, even if someone briefly holds it overhead. o3: A notebook is designed for writing, not as rain protection, even if someone briefly holds it overhead.

### ha-f3-0063

A sweater helps a person keep warm in cold weather.

Family: `cold-weather-warm-clothing`. Target: `g3-foundation-cold-weather-clothing`. Source: `PNEKE-00-2`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes familiar clothing for an explicitly cold situation; does not equate all cloudy days with cold weather.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | You feel cold on a chilly day. What can you wear to keep warm? | o1: A thin sleeveless shirt; o2: Swimwear; o3: A sweater | o3: A sweater | A sweater adds a warm layer when you feel cold. |
| Tagalog | Giniginaw ka sa malamig na araw. Ano ang maaari mong isuot upang manatiling mainit ang katawan? | o1: Manipis na damit na walang manggas; o2: Panlangoy na kasuotan; o3: Sweater | o3: Sweater | Tumutulong ang sweater na panatilihing mainit ang katawan. |
| Cebuano | Gitugnaw ka sa bugnaw nga adlaw. Unsay imong masul-ob aron dili tugnawon? | o1: Nipis nga sinina nga walay manggas; o2: Sinina sa paglangoy; o3: Sweater | o3: Sweater | Makatabang ang sweater nga dili ka tugnawon. |

Exact teaching links: `dcard-04583` / `cloudy-day-safety-g3`.

Wrong-answer rationale: o1: A thin sleeveless shirt leaves more skin uncovered and provides less warmth. o2: Swimwear is not the added warm layer for this cold situation.

### ha-f3-0064

A wide-brimmed hat can shade the head and face from sunlight.

Family: `sun-protection-shade`. Target: `g3-foundation-sun-shade-hat`. Source: `PNEKE-00-2`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes shade from a familiar item; does not claim complete sun protection or make a medical UV-prevention guarantee.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Which item shades your head and face from bright sunlight? | o1: A wide-brimmed hat; o2: Rubber boots; o3: Gloves | o1: A wide-brimmed hat | The wide brim of the hat casts shade over the head and face. |
| Tagalog | Aling gamit ang nagbibigay-lilim sa ulo at mukha mula sa maliwanag na sikat ng araw? | o1: Sombrerong malapad ang gilid; o2: Botang goma; o3: Guwantes | o1: Sombrerong malapad ang gilid | Nagbibigay-lilim sa ulo at mukha ang malapad na gilid ng sombrero. |
| Cebuano | Unsang gamit ang makalandong sa ulo ug nawong gikan sa hayag nga kahayag sa adlaw? | o1: Kalo nga lapad ang ngilit; o2: Botas nga goma; o3: Guwantes | o1: Kalo nga lapad ang ngilit | Ang lapad nga ngilit sa kalo makalandong sa ulo ug nawong. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: Boots cover feet, not the head or face. o3: Gloves cover hands, not the head or face.

### ha-f3-0065

Walking slowly and carefully on a wet, slippery path is safer than running or jumping on it.

Family: `wet-surface-slip-risk`. Target: `g3-foundation-wet-path-care`. Source: `PNEKE-00-6`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes a simple safe action on an ordinary wet path; not proof of behavior, physical balance, or safe floodwater access.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Rain has made a path wet and slippery. How should you move? | o1: Run quickly; o2: Walk slowly and carefully; o3: Jump along the path | o2: Walk slowly and carefully | Wet paths can be slippery. Walking slowly and carefully lowers the chance of falling. |
| Tagalog | Nabasa at naging madulas ang daan dahil sa ulan. Paano ka dapat kumilos? | o1: Tumakbo nang mabilis; o2: Maglakad nang mabagal at maingat; o3: Tumalon-talon sa daan | o2: Maglakad nang mabagal at maingat | Maaaring madulas ang basang daan. Mas maliit ang panganib na matumba kung mabagal at maingat kang lalakad. |
| Cebuano | Basa ug danlog ang agianan tungod sa uwan. Unsaon nimo paglihok? | o1: Pagdagan og paspas; o2: Paglakaw og hinay ug mabinantayon; o3: Paglukso-lukso sa agianan | o2: Paglakaw og hinay ug mabinantayon | Mahimong danlog ang basang agianan. Mas gamay ang risgo nga matumba kung hinay ug mabinantayon ang paglakaw. |

Exact teaching links: `dcard-04584` / `slippery-rainy-ground-g3`.

Wrong-answer rationale: o1: Running makes maintaining balance on the slippery path harder. o3: Jumping adds landing/balance demands on the slippery path.

### ha-f3-0066

Rubber boots help keep feet dry from small rain splashes.

Family: `rain-protection-clothing`. Target: `g3-foundation-rain-boots`. Source: `PNEKE-00-2`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes ordinary waterproof clothing for feet; no advice to enter floodwater or deep puddles and no claim boots always prevent wet feet.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Which keeps your feet dry from small rain splashes? | o1: Cotton socks; o2: Cloth slippers; o3: Rubber boots | o3: Rubber boots | Rubber boots cover the feet and help keep small splashes out. |
| Tagalog | Alin ang tumutulong na hindi mabasa ang paa sa maliliit na talsik ng ulan? | o1: Medyas na koton; o2: Tsinelas na tela; o3: Botang goma | o3: Botang goma | Tinatakpan ng botang goma ang mga paa at tumutulong upang hindi mapasukan ng maliliit na talsik ng tubig. |
| Cebuano | Hain ang makatabang nga dili mabasa ang tiil sa gagmayng talsik sa uwan? | o1: Medyas nga gapas; o2: Tsinelas nga panapton; o3: Botas nga goma | o3: Botas nga goma | Gitabonan sa botas nga goma ang mga tiil ug makatabang nga dili makasulod ang gagmayng talsik sa tubig. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Ordinary cotton socks soak up water rather than block it. o2: Cloth slippers absorb water and leave more of the foot exposed.

### ha-f3-0067

Putting one’s own small litter in a suitable rubbish bin helps keep shared surroundings clean.

Family: `proper-disposal-keeps-surroundings-clean`. Target: `g3-foundation-proper-trash-place`. Source: `PNEKE-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes ordinary litter disposal; does not ask a child to handle sharp, medical, unknown or hazardous waste.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | You finish a snack. Where should your empty wrapper go? | o1: In the proper rubbish bin; o2: Under a bench; o3: In a roadside drain | o1: In the proper rubbish bin | Put your wrapper in the proper bin to keep the surroundings clean. |
| Tagalog | Tapos ka nang kumain ng meryenda. Saan dapat ilagay ang walang lamang balot? | o1: Sa tamang basurahan; o2: Sa ilalim ng bangko; o3: Sa kanal sa tabi ng daan | o1: Sa tamang basurahan | Ilagay ang balot sa tamang basurahan upang manatiling malinis ang paligid. |
| Cebuano | Nahuman ka og kaon sa merienda. Asa angay ibutang ang walay sulod nga putos? | o1: Sa hustong basurahan; o2: Sa ilalom sa bangko; o3: Sa kanal daplin sa dalan | o1: Sa hustong basurahan | Ibutang ang putos sa hustong basurahan aron magpabiling limpyo ang palibot. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: Leaving the wrapper under a bench hides the litter rather than disposing of it. o3: A drain carries water; adding litter there can obstruct it.

### ha-f3-0068

When no bin is nearby, keeping one’s own wrapper until reaching a bin avoids littering.

Family: `proper-disposal-keeps-surroundings-clean`. Target: `g3-foundation-keep-wrapper-until-bin`. Source: `PNEKE-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Recognition for the child’s own ordinary small wrapper only; no instruction to collect unknown waste.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | You have your empty wrapper, but no bin is nearby. What should you do? | o1: Leave it beside the path; o2: Keep it until you find a bin; o3: Hide it under leaves | o2: Keep it until you find a bin | Keep your wrapper with you, then put it in a bin when you find one. |
| Tagalog | Hawak mo ang walang lamang balot, ngunit walang malapit na basurahan. Ano ang dapat mong gawin? | o1: Iwan sa tabi ng daan; o2: Itago muna hanggang makakita ng basurahan; o3: Itago sa ilalim ng mga dahon | o2: Itago muna hanggang makakita ng basurahan | Dalhin muna ang balot, saka ilagay sa basurahan kapag may nakita ka na. |
| Cebuano | Naa nimo ang walay sulod nga putos, apan walay duol nga basurahan. Unsay angay nimong buhaton? | o1: Ibilin daplin sa agianan; o2: Tipigi hangtod makakita og basurahan; o3: Tagoa ilalom sa mga dahon | o2: Tipigi hangtod makakita og basurahan | Dad-a una ang imong putos, dayon ibutang sa basurahan kung makakita na ka. |

Exact teaching links: none asserted.

Wrong-answer rationale: o1: Leaving it beside the path makes it litter. o3: Covering litter with leaves does not dispose of it properly.

### ha-f3-0069

Writing on the unused side of a used sheet lets the same paper be used again.

Family: `reusing-an-existing-object`. Target: `g3-foundation-reuse-paper`. Source: `PNEKE-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes using the same suitable paper again; does not assess recycling processes, formal categories, or a quantified environmental benefit.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | One side of your paper is still blank. How can you use the paper again? | o1: Throw the sheet away; o2: Take a new sheet instead; o3: Write on the blank side | o3: Write on the blank side | You can write on the blank side and use the same paper again. |
| Tagalog | Wala pang sulat ang isang panig ng papel mo. Paano mo ito magagamit muli? | o1: Itapon ang papel; o2: Kumuha na lang ng bagong papel; o3: Sulatan ang walang sulat na panig | o3: Sulatan ang walang sulat na panig | Maaari mong sulatan ang walang sulat na panig at gamitin muli ang parehong papel. |
| Cebuano | Wala pay sulat ang usa ka bahin sa imong papel. Unsaon nimo kini paggamit pag-usab? | o1: Ilabay ang papel; o2: Pagkuha na lang og bag-ong papel; o3: Sulati ang bahin nga walay sulat | o3: Sulati ang bahin nga walay sulat | Mahimo nimong sulatan ang bahin nga walay sulat ug gamiton pag-usab ang samang papel. |

Exact teaching links: `dcard-04271` / `reuse-materials-g4`.

Wrong-answer rationale: o1: Discarding the paper prevents the intended second use. o2: Taking another sheet leaves the existing blank side unused.

### ha-f3-0070

Using an existing usable bag again avoids taking another bag for the same task.

Family: `reusing-an-existing-object`. Target: `g3-foundation-reuse-bag`. Source: `PNEKE-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes a concrete second use; does not claim any bag lasts forever or measure the life-cycle impacts of materials.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | Your bag is still usable. What can you do to avoid taking another bag? | o1: Use the same bag again; o2: Throw it away before shopping; o3: Leave it and take a new bag | o1: Use the same bag again | A bag that is still usable can be used again for your things. |
| Tagalog | Magagamit pa ang iyong bag. Ano ang magagawa mo upang hindi na kumuha ng isa pang bag? | o1: Gamitin muli ang parehong bag; o2: Itapon ito bago mamili; o3: Iwan ito at kumuha ng bagong bag | o1: Gamitin muli ang parehong bag | Maaaring gamitin muli para sa iyong mga gamit ang bag na maayos pa. |
| Cebuano | Magamit pa ang imong bag. Unsay mahimo nimo aron dili na mokuha og laing bag? | o1: Gamita pag-usab ang samang bag; o2: Ilabay kini sa dili pa mamalit; o3: Ibilin kini ug kuhaa ang bag-ong bag | o1: Gamita pag-usab ang samang bag | Ang bag nga magamit pa mahimong gamiton pag-usab alang sa imong mga butang. |

Exact teaching links: none asserted.

Wrong-answer rationale: o2: Discarding a usable bag creates a need for another one. o3: Taking a new bag does not use the existing one again.

### ha-f3-0071

Closing a running tap when it is no longer needed avoids wasting water.

Family: `closing-unused-tap`. Target: `g3-foundation-close-unused-tap`. Source: `PNEKE-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes an ordinary conservation action at a working tap; no water-quality, supply-safety, or plumbing claim.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | You have finished using the tap. How can you avoid wasting water? | o1: Leave the water running; o2: Close the tap; o3: Open it farther | o2: Close the tap | Closing the tap stops water from running when it is not needed. |
| Tagalog | Tapos ka nang gumamit ng gripo. Paano mo maiiwasang masayang ang tubig? | o1: Hayaang umaagos ang tubig; o2: Isara ang gripo; o3: Lalo pang buksan ang gripo | o2: Isara ang gripo | Nahihinto ang pag-agos ng tubig na hindi kailangan kapag isinara ang gripo. |
| Cebuano | Nahuman ka na og gamit sa gripo. Unsaon nimo paglikay nga mausik ang tubig? | o1: Pasagdi nga mag-agos ang tubig; o2: Sirad-i ang gripo; o3: Ablihi pa og dako ang gripo | o2: Sirad-i ang gripo | Mohunong ang pag-agos sa tubig nga wala na kinahanglana kung sirad-an ang gripo. |

Exact teaching links: `dcard-01458` / `saving-water-and-electricity-g3`.

Wrong-answer rationale: o1: Leaving it running continues the waste. o3: Opening it farther increases the unnecessary flow.

### ha-f3-0072

Switching off a light that is no longer needed saves electricity.

Family: `turn-off-unneeded-light`. Target: `g3-foundation-switch-off-unused-light`. Source: `PNEKE-00-4`, PDF p.23. Benchmark slot: `None`.

Limit: Recognizes using a normal light switch only; no instruction to handle wiring, sockets, or a damaged switch.

| Language | Stem | Options | Answer | Explanation |
|---|---|---|---|---|
| English | No one needs the room light now. What saves electricity? | o1: Leave the light on; o2: Switch on another light; o3: Switch the light off | o3: Switch the light off | Switching off a light you no longer need saves electricity. |
| Tagalog | Wala nang nangangailangan ng ilaw sa silid ngayon. Ano ang makatitipid ng kuryente? | o1: Hayaang nakabukas ang ilaw; o2: Magbukas pa ng isa pang ilaw; o3: Patayin ang ilaw | o3: Patayin ang ilaw | Nakatitipid ng kuryente ang pagpatay ng ilaw na hindi na kailangan. |
| Cebuano | Wala nay nanginahanglan sa suga sa kwarto karon. Unsa ang makadaginot og koryente? | o1: Pasagdi nga siga ang suga; o2: Pasigaa pa ang laing suga; o3: Palonga ang suga | o3: Palonga ang suga | Makadaginot og koryente ang pagpalong sa suga nga dili na kinahanglan. |

Exact teaching links: `ffct-23593` / `energy-saving-turn-off-g3`.

Wrong-answer rationale: o1: Leaving the unneeded light on continues its electricity use. o2: Another switched-on light adds electricity use.
