# Curriculum-first feed

The default feed resumes the active profile’s saved topic for its selected grade.
For a grade without saved progress, the existing school-calendar inference estimates
progress through the year. Topics are spaced evenly within each curriculum quarter;
this is a starting estimate, not knowledge of a particular classroom’s pace. Outside
the school year it starts at the first topic. The curriculum sheet lets a student or
teacher choose a different topic.

Each normal next-card choice stays within the current topic without keyword-based
ranking or forks. Saved card coverage advances exhausted topics in outline order.
After the final topic, the feed begins a curriculum review pass. Search can show a
one-off result, then the curriculum continues. Randomize clears the restriction and
starts the existing keyword-associated feed for the session. Reopening the app resumes
the saved curriculum; grade changes restore that grade’s saved topic or estimate.

Topic keys are stored as cards.curriculum.<grade> in the existing profile-specific
SQLite settings, alongside existing seen-card records. No model or network is needed.
The existing curriculum card membership and minimum-three-cards topic filter apply.

The title bar groups the name and switch arrow in one accessible pill on the right.
The compact page count and quiz ticks sit inside the card footer; the outer footer
retains Settings, grade, and correct-answer count.

Validation: mobile TypeScript check, curriculum-default.test.mts, and the existing
card harness (keyword, search magnet, and curriculum assertions). Device visual
validation requires a newly built APK; the installed APK predates these changes.

## Curriculum row clarity and lesson depth — 8 October 2026

The 0.4.40 Curriculum sheet made a topic without subcategory shortcuts look like
a noninteractive heading. Its unlabeled `4 / 4` chip counted unread/available
cards, which could also be mistaken for completion or a quiz score. The local UI
now renders every topic as a bordered **Read** button with a drawn chevron, a
minimum 64dp height and a localized unread-card count. Subcategory shortcuts remain
separate buttons. A row without shortcuts has no empty shortcut-container gap.
Screen-reader labels include the action, title, unread count and existing awards.
This changes presentation only; saved progress and lesson membership are unchanged.

For Grade 5 **Live young and eggs** (`g5:animal-reproduction`, `G5-L-5`), the
shipped bank contains **157 available cards tagged to the competency**, with 157
different source IDs. The 5 October explicit review admits only four teaching
cards—`ffct-07463`, `ffct-07838`, `ffct-11639`, `ffct-11274`—and no related
examples. `compile-lessons.py` enforces that exact selection even when another
card already has the competency tag. The lesson's target of 20 is a maximum run
length, not a promise of 20 admitted cards. All four admitted cards are present
in the served 0.4.40 APK and reachable through the topic title. Each of its five
taxonomy categories contains only one admitted card, so all category shortcuts
fall below the existing three-card display floor.

This is a curriculum selection limitation, not a content-download failure.
In the served 0.4.40 baseline, **301 of 308 authored lessons have 3–11
cards**, and **305 have no related examples**. The October audit intentionally
restricted the teaching path to explicitly verified coverage; it did not review
the wider library for use as additional examples. Earlier large-pool/variety
measurements must not be presented as the current lesson breadth.

Tags and different source IDs do not prove factual accuracy, semantic uniqueness,
grade suitability or translation quality. The expansion below keeps a separate
example review and preserves the exact teaching review/content locks.

Evidence: `build/curriculum-ui-20261008/lesson-depth-diagnosis-001.json` pins the
input data and exact counts. `validation-001.json` records the passing mobile
TypeScript and existing curriculum-navigation checks. This UI change is local,
uncommitted and not yet included in a rebuilt or deployed phone release.

## Grade 5 reading expansion — 8 October 2026

The first local Grade 5 expansion exposed **1,121 distinct source cards**, compared
with **139** in 0.4.40. Every authored topic gained examples: pools range from
12 to 204 cards. **Live young and eggs** grows from four to **49**, including
sharks with different reproductive modes, egg-laying mammals, local animals,
nesting and incubation. These are existing offline cards, not new downloads.

The 139 required teaching cards and every unit/quiz assignment are unchanged.
Additional examples enrich reading; they do not award new objective coverage or
replace an investigation, model, classification key or classroom activity.
The existing 20–30-card visit limits remain, and later visits draw further unseen
examples. Valid saved runs resume their exact sequence, including old short runs.
The Curriculum unread count describes the whole available topic pool.

`rag/pipeline/lesson-examples-review.json` admits examples explicitly by lesson:

- 796 distinct examples reuse active manual recovery decisions from September.
  Each original review and packet is hash-bound; the original English must still
  match, its lesson evidence must apply, and the current override must still
  point to that acceptance. Later translation edits do not impersonate the old
  trilingual review: the inherited approval is for the unchanged English, while
  the catalog separately pins the current released copy.
- 186 further distinct examples were selected after reading their full current
  English, Tagalog and Cebuano titles/bodies. These target thin topics and useful
  contrasts. The catalog records their rationale and 26 nonadmissions, including
  repetitive examples and specific copy/science issues.

No card prose, translations, questions, competency tags, global exclusions or
language-audit hold dispositions change. This is not native-language certification
or a claim that every distinct source ID is a semantically unique teaching point.
That first expansion covered Grade 5 only. The subsequent all-grade expansion
below extends the evidence rules to the other seven supported grades. Its
regression audit also withdraws five inherited Grade 5 examples whose older
approvals were superseded by the October pilot review. The required Grade 5
teaching/quiz assignments and the 49-card animal-reproduction pool are unchanged.

`lesson_examples.py` rejects changed copy, missing/revoked evidence, wrong lesson
mapping and current exclusions. `compile-lessons.py` merges these examples only
into the related pool and rejects lost approved examples. `audit-full-year.py`
checks the extension independently while leaving the original October English
review lock and coverage report byte-identical. Do not regenerate the core lock
just to increase reading breadth.

After an explicitly reviewed example edit, regenerate the affected lesson
manifest, `build-lesson-similarity.py`, and `audit-content-reach.mts`. Run the
example guard tests, existing core audit, actual-feed curriculum tests and mobile
type-check. The content-reach projection now uses fixed seeds so its `--check`
result is reproducible. This change is local and awaits a separate release.

## Reading expansion across Grades 3–10 — 8 October 2026

All supported grades now have broader, explicitly reviewed reading pools. These
are counts from the actual Curriculum feed, including retained Grade 6 supporting
lessons; they are not counts of tagged-but-unreachable cards.

| Grade | Available in 0.4.40 | Available after expansion |
|---|---:|---:|
| 3 | 148 | 1,566 |
| 4 | 132 | 1,063 |
| 5 | 139 | 1,116 |
| 6 | 258 | 1,117 |
| 7 | 175 | 1,011 |
| 8 | 170 | 729 |
| 9 | 192 | 767 |
| 10 | 167 | 589 |

There are **7,854 unique card IDs across the eight grades**: 7,689 from the
49,155-card main bank (15.64%) and 165 supplemental lesson cards. Adding grade
totals would count shared cards more than once. The existing
20–30-card visits still reserve objective/quiz anchors and prioritize unseen
examples. A deterministic simulation reached every eligible fact within 20
visits per topic. This is a software reachability check, not measured learning
time, engagement or mastery.

The combined example catalog contains 6,504 cards and 6,644 lesson associations:
6,263 associations backed by active historical manual decisions, and 381 backed
by full current-copy readings (including the preceding Grade 5 pass). This turn
read 293 further lesson/card pairs in full, admitted 193 associations on 192
cards, and left 100 current copies out of the additional pools. Some selected
cards already belonged to another topic; associations are not new distinct cards.
The original 308 authored lessons retain their units, core IDs, quiz assignments,
titles, competencies and run limits byte-for-byte at the field level. The
original core review lock and coverage reports remain unchanged.

The first all-grade regression run failed two existing false-match tests. Older
recovery approvals had been admitted without applying later explicit pilot
nonselections. The correction removes all 43 conflicted additions and makes the
compiler reject that evidence conflict. Five were in the preceding Grade 5
expansion; none were required teaching cards. The failed run and the complete
withdrawal list are saved in
`build/curriculum-expansion-all-grades-20261008/superseded-evidence-diagnosis-001.json`.
The existing false-match tests remain unchanged.

The [per-grade and per-topic inventory](all-grades-example-expansion-20261008.json)
records exact counts, evidence and remaining gaps. **62 of 309 runtime topics
still have fewer than ten cards**, including specialized experimental and graphing
topics. Additional cards must meet the same evidence rules; unrelated material
must not fill those gaps. The Grade 5 adaptation topic is split across two terms,
which explains the extra runtime topic and its smaller plant-only pool.

Nonadmissions include unresolved translated wording, overly broad science claims,
duplicate examples and unverified current conservation claims. FaultFinder
availability examples were withheld after [PHIVOLCS reported the service
unavailable](https://www.phivolcs.dost.gov.ph/announcement-for-the-phivolcs-faultfinder-users/).
All authority checks are scoped in the example catalog; the selection is not a
fresh scientific or native-language audit of every inherited card.

Two cards considered for another topic already occur in the frozen core:
`ffct-22472` (Grade 7 tug-of-war/net-force qualification) and `ffct-12777`
(Grade 10 bioreactor definition restricted to large industrial tanks). Their
new associations were rejected and their existing placements are recorded for
focused core re-review. This expansion neither silently rewrites that prior
approval nor claims those concerns were repaired.

The website competency catalog and demo topic metadata were regenerated from
the same manifests. Topic card counts grow; direct competency/objective counts
do not. Its provenance now pins the full-year review, original English lock
and additional-example catalog. Regenerate these alongside the mobile similarity
and content-reach artifacts after future example changes.

This work changes local source and generated artifacts only. It has not been
built into an APK, published, or delivered to the phones running 0.4.40.

Validation: **105 tests pass** (11 example-evidence guards, four core-audit
controls, 87 mobile curriculum/navigation/variety/saved-session checks and three
website curriculum checks). All eight compilers, the original full-year audit,
similarity/content-reach freshness checks and mobile/web TypeScript pass. All
6,504 example cards match the bundled SQLite database exactly in English,
Tagalog and Cebuano bodies, titles and emphasis spans. The 550 inherited
evidence files are tracked repository inputs. The demo retains the same 798
available cards; regenerated topic metadata removes outdated cross-topic
associations without removing demo cards. Results and failed-run diagnosis are
in `build/curriculum-expansion-all-grades-20261008/`.

## Unseen reading and card-bank admission — 8 October 2026

Completing a short lesson now offers **Read more** when that topic has unread
cards. These runs draw only unseen, admitted cards, without repeating the required
teaching anchors. They keep the lesson's visit limit. The Curriculum browser also
offers four grade-specific science collections: matter, living things, force /
motion / energy, and Earth / space. Collections use 20-card runs and appear as
related reading after a lesson. They contain only cards already admitted to
lessons for that grade; category names and automatic tags cannot admit new cards.

Optional reading preserves the saved curriculum destination and exact lesson
sequence. It does not replace the lesson's quiz series, change quiz answers or
awards, or count as new competency coverage. Read status persists across repeated
lessons and app restarts. Alternate versions of an already-read source are not
advertised as new reading. Exhausted collections have no empty reading action;
ordinary lessons can still be revisited. Topic titles remain visible Read buttons.

The first unused-bank review batch examined **509 complete current card copies**
in English, Tagalog and Cebuano. It admitted **273 new main-bank card IDs** in
328 explicit lesson placements and preserved **236 holds**. Holds include
unresolved wording, source or placement evidence as well as confirmed defects;
they are not all proven errors. The historical automatic tag reviews failed the
calibration for bulk reuse: matching English or a positive tag did not establish
current scientific and translation accuracy. Three parallel reviewers handled
disjoint 150-card packets after the 59-card calibration.

The current curriculum contains **7,962 of 49,155 main-bank cards (16.20%)**, up
from 7,689 (15.64%) immediately before this batch. An additional **165 supplemental
lesson cards** bring the total to **8,127 unique card IDs**. Collections provide
another route to these same cards and must not inflate that count. Grade totals
overlap and must not be summed as though every card were unique across grades.

| Grade | Main-bank cards | Supplemental cards | Total unique cards in grade |
|---|---:|---:|---:|
| 3 | 1,607 | 10 | 1,617 |
| 4 | 1,094 | 16 | 1,110 |
| 5 | 1,135 | 16 | 1,151 |
| 6 | 1,158 | 18 | 1,176 |
| 7 | 1,008 | 22 | 1,030 |
| 8 | 730 | 27 | 757 |
| 9 | 768 | 27 | 795 |
| 10 | 589 | 29 | 618 |

The per-card inventory accounts for the entire main bank: 1,192 required
curriculum cards, 6,770 additional curriculum cards, 15,986 explicit holds and
25,207 cards awaiting current-text review. Thus **41,193 cards remain outside the
curriculum**. This is a completed bounded review and a new reading flow, not a
claim that the whole unused bank has been reviewed or made safe to admit.

[The current report](card-bank-expansion-20261008.json) records each lesson's
before/after counts, review provenance, protected inputs and database verification.
[The admission tooling](../tools/curriculum-bank-audit/README.md) can reproduce the
inventory, prepare disjoint full-copy review packets, and validate further
acceptances. Its compiler gate rejects held, stale, incomplete-language or
wrong-lesson evidence. Original decisions and later corrections remain separate;
only the pinned effective review files enter the catalog. No card prose,
translations, question bank, global exclusions or required teaching units change.

This is local source work. No new APK, version, commit, push, deployment or phone
rollout is part of this change. It is not native-language certification.

Validation: **139 tests pass** (12 example-admission guards, four core-audit
controls, 113 curriculum/feed/navigation tests, three website checks and seven
profile/review-persistence checks). All eight compilers, the full-year audit with
database checks, generated-artifact freshness and both TypeScript targets pass.
All 6,777 catalogued example cards match the SQLite database's trilingual bodies,
titles and emphasis exactly. The card pool, quiz bank, teaching reviews, review
lock and exclusions retain their original hashes. The database was rebuilt for
the changed card-loader source; its version is `844c1a2e1240`.

The optional-reading simulation reaches every eligible card in all eight grades,
using bounded runs and leaving zero unread cards. **54 of 309 runtime topics
still have fewer than ten cards**. Grade 4's collections select 1,109 of its 1,110
curriculum IDs because two IDs are alternate versions of one source; both IDs
remain counted in curriculum coverage. Six mobile-sized renders of the actual
components (English, Tagalog and Cebuano; browser and recap) and six button
dispatch checks pass. These are React Native Web previews, not native phone
tests. Actual logs and preserved fixture failures are under
`build/curriculum-bank-expansion-20261008/`.
