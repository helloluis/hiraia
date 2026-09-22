# Connected lessons and section recaps

New curriculum runs retain their larger eligible card pool while teaching authored
core objectives in order. Optional examples are selected in blocks of up to five
cards and displayed together by their existing topic group. A fresh seed varies
starting examples and independent example groups; it does not shuffle the core
objective order. Unseen facts are preferred and duplicate source facts remain
excluded. Existing valid saved runs keep their exact sequence and progress.

At a completed lesson or manually selected subcategory boundary, the feed finishes
any pending review quiz and displays a recap before entering the next lesson.
The recap shows at most three distinct short topic labels from cards visited in
that run, spread across the section in reading order. It uses existing localized
card titles (or the existing short topic-label fallback), never the full card
paragraphs. It says “what we explored,” not that the student has mastered the material.

“Explore again” replans the same scope from the student's existing coverage,
favoring unseen examples when available. It preserves activity, quiz results and
achievements. Once the pool is exhausted, revisiting can include familiar cards.
Scrolling down or pressing the next-section button continues; the recap text itself
scrolls within its card. Explicit Calendar jumps, searches and Randomize remain available.

The recap and its next-lesson destination are saved per profile and grade when the
final card lands, so restarting at that boundary restores the recap. Neither recap
nor title pages record an additional fact-card view. No model inference or network
request is needed to prepare the recap. APK publication is a separate release step.

Validation: `lesson-recap.test.mts` exercises actual store boundary/navigation
functions, serialization, repeat scope and contiguous ordering. Existing lesson
variety, Calendar, curriculum, grade and review tests cover content eligibility,
objective quizzes, old saves and review behavior.


## Vertical navigation

The feed and student onboarding now use native vertical scrolling. Earlier cards are
above the live card; horizontal page swipes, edge-pull history, and corner-peel animations
have been removed. Bottom continuation arrows point down; onboarding Back points up.
Scrolling forward at a fork follows its first choice; the two explicit choice buttons
remain available. A quiz must be answered before continuing.

The feed keeps at most 31 page snapshots, including lesson titles, recaps, and answered
quizzes. Browsing them does not advance the curriculum or record another view. Quiz
ordering and answers survive virtualization. History resets on student/grade changes.
The live recap offers another run; past recap pages are read-only.

Validation: mobile TypeScript check; curriculum/recap/review/search regression tests;
production pager callback tests for drag/momentum deduplication, slow scrolling, history,
resizing, quiz gates, and review interception. Native touch behavior (especially nested
long-text scrolling) still requires a device pass before release. No APK was built for
this source change.

Cebuano directional copy was checked against corpus bodies with `ceb_usage.py`:
`paubos` 508, `pataas` 339, `balikan` 2, `naunang` 3. Existing UI uses the loanword
“scroll”; these are interface instructions, not changes to audited card content.


## Prepared next page (Redmi feedback)

The trailing native-list row is now the real, read-only next page rather than a loading
slot. During reading time, Hiraia selects the already queued destination, warms its
localized text and button labels, prefetches available local illustration bytes, and
mounts the card offscreen. On commit its stable key preserves the rendered view. Feed
text is fully visible immediately rather than restarting the typewriter animation.
If preparation is incomplete, there is no empty row to scroll into; the current card's
Continue button still works.

Selection honors title pages, pending quiz/reward destinations, due reviews, lesson
recaps, and new-topic titles. Prefetch does not advance lesson state, record a card
view, open/grade a quiz, or request generation. Generated follow-ups still require the
explicit Continue action. Pending loads are invalidated by navigation, language/profile
changes, or review changes. Quiz Continue and the review-complete button explicitly use
down arrows.
