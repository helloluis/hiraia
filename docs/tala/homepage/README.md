# Tala homepage: three showcases, and the Filipino promise section — hand-off note

Owner of this task: Claude Fable 5.2, Paseo agent `b11-dev:bea7a699-9151-447e-b46d-8647d846dcd9` (homepage only; it
stays the owner for revisions). Integration and release: the Tala release owner `b11-dev:12af59a8`. Requested by Luis
on 27 Nov 2026 21:31 Manila (Beaniebot thread ddb4d22d, rq_yrx5hmd6; assigned by rq_uvwqkxp7).

**Luis, verbatim:** "let's improve the homepage. the hero banner is good but the features section is way too busy (too
much text eveyrwhere). what i'd like to do is highlight our multi-grade lesson planner and our slideshow generator and
our DepEd science curriculum comprehensiveness as the three main features. let's make that entire section more visual
with fewer words but more high impact. let's also improve the filipino translation in the bottom section "Pangako
namin" coz it sounds quite clunky."

**Authority:** implementation and testing. NOT a deployment approval; the demo.19 approval does not cover this.

## State

- Branch `tala-v1-homepage` (local, not pushed), worktree `/home/b11/code/tala-wt/home`, base `f2a154a08`
  (`tala-v1-filipino` = the live `tala-v1-demo.19` code, `7388fac20`, plus a docs-only ledger commit).
- Commits, oldest first:
  - `94003f86d` the three showcases, the strings, the pictures, the tests, the Filipino promise section;
  - `42f73e47a` no pack number in the served HTML; the section rule; Filipino batch 2; the walk script;
  - `f0b3fef87` merge of the release owner's `tala-v1-carryon-fil` (its commit `637d135d9`: ONE Filipino label in the
    app's multi-grade plans, `tala-core/src/plan/combine-words.ts`, plus its docs-only ledger commits), at its request,
    so the Filipino planner picture and the app agree in the same release;
  - `7a8a820d1` the phone planner picture at full screen width; Filipino planner pictures re-shot;
  - `f49628063` the first version of this note (docs only);
  - `766ce4b3b` the slide picture's description reworded to fit both pictures (last app commit: two strings);
  - the commit that brings this note up to date (docs only).
- No migration, no new dependency, lockfile unchanged, no server or core file changed by this task (the one core line
  is the release owner's commit above), no setting, no new route. `/` is still a static page.
- Not deployed. Nothing was pushed, tagged or written to production; production was only read (the public homepage,
  `/api/v1/health`, `/api/v1/curriculum/index`, `/api/v1/packs/index`).

## What a visitor sees

The hero is untouched: the same markup and, at four widths in both languages, the same pixels as the live page (see
Checks). Below it:

| Before (demo.19) | After |
|---|---|
| "See what Tala can do": a sideways carousel of 11 captioned phone and laptop screens, the screens in Filipino whatever the page language | "See what Tala can do" as a quiet label, then three showcases |
| Seven feature cards (pacing, AI drafts, class lists, edit/lock/PDF, offline, sharing, weekly packs), each a headline and one to four sentences | 1. **One lesson plan for every grade in the room.** A capture of the real session editor: the hour as a timeline, and the block where Grade 5 has the teacher while Grade 4 carries on by itself |
| | 2. **Slides for your lesson, ready to edit.** A capture of the real slide editor on a teacher's own copy, with the editor's "draft, no teacher has reviewed" line in the picture and an AI-draft note beside it |
| | 3. **Science for Grades 3 to 10, week by week.** A map of every Science week of the shipped curriculum, with the weeks that have a draft pack marked, and a link to the Library |
| "Our Promise" (four promises), get-started card, footer | The same; only the Filipino words of "Ang pangako namin" changed |

Each showcase has a small label, a headline and one sentence. The third has a second sentence because packs are a
different claim from the curriculum and must carry their own caveat.

Gone from the homepage (still in the app): the class-list, edit/lock/PDF, sharing and offline cards and the carousel
captions. Offline stays in the hero line and in the promise section. Gone altogether: "DeepSeek, with Qwen as backup",
and "Science, Grades 3 to 10 today. More subjects coming", which was stale (English, Language, Reading and Literacy and
Effective Communication curricula have been live since demo.17 and demo.18).

## Decisions worth knowing

- **Captures, not drawings of the product.** Pictures 1 and 2 are screenshots of the running app, from
  `scripts/home-capture.mjs`: a local server, a fictional teacher per language seeded through the real API, no model
  call. The planner's three lessons (magnets, falling objects, water waves; the real DepEd competencies of Term 2
  Week 10 for Grades 4, 5 and 6) were written for the picture and are short on purpose; they are combined by the
  same function the app's "One plan for a multi-grade class" screen calls. The slides picture is a teacher's copy of
  the pack `sci26-g5-t2-w10`, day 1, linked to a lesson, on slide `d1s7`. In the pack's draft that slide's words say
  "stone" beside a drawing of a mango (the science is right; the words and the picture disagree), so the "teacher"
  has changed the title, first line and notes to the mango, which is exactly what the editor is for. The "Changed"
  mark on the slide is real.
- **One picture per language and per layout.** English pages show English screens, Filipino pages Filipino ones. From
  600 px wide the page shows the wide capture; below it, a capture of the app's own phone layout at the phone's
  width, so nobody reads a desktop screen shrunk onto a phone. WebP with a JPEG fallback, lazy, each in a box of its
  own proportions (nothing moves while it loads).
- **The curriculum map is data, and so are its numbers.** No count is written into any string (a test fails if one
  is). The curriculum side (grades, terms, weeks, the number of competencies) is generated from
  `packages/tala-server/data/packs/science-*.json` by `scripts/home-coverage.mjs` into
  `src/features/landing/science-coverage.generated.ts`; `coverage.test.ts` recomputes it from the pack files, so a
  stale file fails the test run. The pack side (which weeks, how many) is asked from `/api/v1/packs/index` each time
  the page is opened, for the page's language. Until that answer arrives, and when it does not (no script, no signal,
  an error), the line says one always-true sentence without a number and no pack mark is drawn. A cached or zero
  count is never shown, and the served HTML never contains a pack count. If a pack is ever approved by a teacher, the
  sentence and the legend switch to a variant that no longer says "no teacher has reviewed".
- **The map is a real table.** A screen reader hears each grade and term with its weeks, competencies and packs, not
  262 unnamed squares. Pack weeks are told apart by a yellow cap on a dark mark (shape and brightness, not hue alone).
- **Motion:** a picture that is still below the screen rises 14 px and fades in once when it is reached; the pack
  marks fade in when the library answers. Both are off under "reduce motion", in print and without script (nothing is
  hidden unless the script that will show it is running).
- **Shared files:** only `landing.*` keys in the four i18n files; one additive block at the end of `globals.css`
  (`tala-landing-*`); `PublicShell.tsx` untouched (its `Feature` helper still draws the promise section).

## Claims: every sentence and number on the new section, and where it comes from

Numbers below are today's (27 Nov 2026); the page computes them.

| On the page | Source |
|---|---|
| "One lesson plan for every grade in the room." "Start together, teach one grade at a time while the others work on their own, then finish together." | The combined multi-grade plan, live since demo.15: `tala-core/src/plan/combine.ts` builds a shared opening, one turn with the teacher per grade group, and a shared closing, for two to four grade groups (`MAX_GROUPS` in `tala-web/src/features/lessons/combine-model.ts`). The page does not say how many grades. |
| "Slides for your lesson, ready to edit." "Change any word, rewrite a slide with AI, then present it or download it as PowerPoint." | The slide editor (demo.11) and a lesson's slides with AI rewrite (demo.19): `features/slides/DeckEditor.tsx`, routes `decks.save`, `decks.ai.*`, `decks.pptx`. All four actions are visible in the picture. Not claimed: that the file was checked in Microsoft PowerPoint (parser checks only, as the ledger says). |
| "AI draft: check the science before class" | Every pack is an AI draft: `/api/v1/packs/index` `counts.approved` = 0. The editor's own line in the picture says the same. |
| "Science for Grades 3 to 10, week by week." | First and last grade of the shipped Science curriculum packs (`science-bow-2026:3:science` … `:10:science`; `/api/v1/curriculum/index`). "Week by week": in every term of every grade, each week from 1 to the term's last week has at least one competency placed in it; the summary refuses to be built otherwise (`summarizeCurriculum`). |
| "322 learning competencies from DepEd's 2026 Budget of Work" | Sum of `competencyCount` of the eight Science packs (34 + 33 + 40 + 35 + 45 + 44 + 46 + 45). Every competency's `source.document` is "DepEd Science G<n>: 2026 Three-Term BOW" (test). |
| "each with its page number so you can check the source" | Each of the 322 records has `source.document`, `edition`, `page` (the PDF page) and `url` (test). The page says a page number, not a copy of the page. |
| The map: 262 marks, 8 grades by 3 terms | Generated summary: 11 weeks per term, except Grade 5 Term 1 and Grade 6 Term 2 with 10, as the Budget of Work places them. The library's own index lists the same 262 weeks and the same 322 competency ids (test). |
| "Draft lesson packs are ready for 103 of 262 weeks." (Filipino page: 99) | `/api/v1/packs/index` at view time: weeks whose pack in the page's language has status `draft`, `needs_work` or `approved`. English 103, Filipino 99 today. |
| "They are AI drafts that no teacher has reviewed yet." | `counts.approved` = 0. With any approved pack the page says instead: "Lesson packs are ready for N of 262 weeks. Each pack says whether a teacher has reviewed it." |
| "The Library shows which weeks have a ready-made lesson pack and whether a teacher has reviewed it." (shown only until the library answers) | The Library page (`/library`): each week's cover carries its status label. |
| Legend: "Week with DepEd competencies" / "Draft lesson pack ready" | As the two rows above. |
| The promise section | Claims unchanged; English unchanged. |
| The footer disclaimer | Byte for byte as before (test `showcase.test.ts`). |

Not claimed anywhere: teacher review, DepEd approval or affiliation, a pack for every week, every pack in Filipino,
English teaching packs, anything about Mathematics, Office application checks, how many grades a plan can hold.

## The Filipino of "Ang pangako namin": before and after

Every Filipino line on the page was reviewed by the Filipino owner (`b11-002:7964278f`) through the release owner:
batch 1 (bridge 4f94a29f, 35 items, 19 changed by the reviewer), batch 2 (bridge 2e41a780, one line, OK as written)
and batch 3 (bridge 60a7758f, one picture description, OK as written). No unreviewed Filipino is left. The English
of this section is unchanged.

| | Before (live) | After |
|---|---|---|
| Title | Ang pangako namin | Ang pangako namin sa iyo |
| Free | **Palaging libre** — Walang bayad at walang premium na plano. Nonprofit ang Hiraia. | **Libre at mananatiling libre** — Walang bayad sa paggamit ng Tala at walang premium na plano. Nonprofit ang Hiraia. |
| Offline | **Gumagana offline** — Gawa ang Android app para magamit kahit mahina o walang signal. | **Magagamit offline ang Android app** — Madalas mahina ang signal dito, kaya ginawa namin ang Android app para magamit kahit mahina ang koneksyon. |
| Simple | **Madaling gamitin** — Kung marunong kang mag-text, kaya mo ang Tala. | **Madaling gamitin** — Hindi kailangan ng espesyal na kaalaman sa tech para magamit ang Tala. |
| Check | **Suriin muna ang draft** — Sinusuri ng Tala ang format ng draft na gawa ng AI. Ikaw ang susuri kung tama ang nilalaman bago mo i-lock. | **Draft pa lang ang gawa ng AI** — Format lang ng draft na gawa ng AI ang sinusuri ng Tala. Ikaw ang susuri kung tama ang impormasyon bago mo i-lock ang draft. |
| Last line | Paunang bersyon pa ito. Libre itong gamitin at patuloy pa naming pinapahusay. | Paunang bersyon pa lang ito. Libre itong gamitin at patuloy namin itong pinapahusay. Sinasabi namin kung ano ang kaya nitong gawin at kung saan may limitasyon. |

Points for Luis's eye:
- The texting comparison ("Kung marunong kang mag-text…") is gone from the Filipino; the English still has it.
- The offline promise now names the Android app in its headline and is no stronger than the English (a first draft
  that said "your schedule and lessons are on the phone" was pulled back at the release owner's and the reviewer's
  word: that behaviour was not verified for this note).
- The last line is the one place where the Filipino is longer than the English: it spells out "honest" ("we say
  what it can do and where it has limits"). It is the reviewer's wording, kept as written.
- This section is 116 words in Filipino now (75 before); the English is 71. Its layout is unchanged.

## Numbers (supporting evidence, not a substitute for looking at it)

Visible words, counted the same way on the live page and on the candidate (text a sighted reader sees; picture
descriptions and screen-reader-only text not counted):

| Features area (carousel + cards before; three showcases after) | Before | After | |
|---|---|---|---|
| English | 320 | 142 | −56 % |
| Filipino | 388 | 166 | −57 % |

Of the 142 English words, 22 are the chart's own labels (Term 1–3, the grade numbers, the legend).

Pictures a visitor downloads for this area (WebP):

| | Before: the carousel | After |
|---|---|---|
| Phone | 66 kB for the first screen, up to 689 kB for all eleven | 85 kB (English), 100 kB (Filipino) |
| Desktop | 246 kB for the first four screens, up to 689 kB | 171 kB (English), 221 kB (Filipino) |

Largest single file: `slides-wide-fil.webp`, 154 kB (budget 160 kB, enforced by a test). In the repository,
`public/screens` goes from 24 files, 1.70 MB, to 16 files, 1.41 MB.

JavaScript for `/` (First Load JS, production build): 204 kB on demo.19, 207 kB now. Page height: 3,328 → 4,238 px on
a 1366 px desktop, 4,345 → 4,947 px on a 390 px phone (English).

## Checks

Run on a local production build of this branch (`next build`, `next start`, `TALA_ENV=local`, the release owner's
staged copy of the live Science library), Chromium 145, signed out.

- **Clean export, as the host builds it** (`git archive` of the host's folder set plus the pack fixtures the tests
  read, frozen install, Node 22.23.4), on the last app commit `766ce4b3b`: lockfile identical to demo.19 and no
  `package.json` changed; 0 type errors in core, server and web; tests core 326, server 376 + 1 skipped, web 182;
  the curriculum-map check passes; production build ok, `/` static, 7.28 kB / 207 kB First Load JS. The same result
  on `7a8a820d1` and `f49628063` (the release owner's own export of `f49628063` agrees). The commit after `766ce4b3b`
  changes nothing but this file; the check on it is in the hand-off message. Script:
  `/home/b11/tala-homepage-20261127/bin/export-check.sh`.
- **Tests:** web 182 (169 on demo.19 + 13 new in `coverage.test.ts` and `showcase.test.ts`); core and server
  unchanged in count.
- **Browser walk** (`scripts/home-walk.mjs`, read-only): 182 of 182 checks on the build of `766ce4b3b`, with the
  live site as the reference.
  - English and Filipino at 1366 × 900, 390 × 844, 360 × 740, 768 × 900 and 200 % zoom: the right words; exactly
    three showcases in order; the shipped curriculum numbers; the pack sentence and the pack marks equal to the
    library's answer at that moment; both pictures the right file for the language and the layout, loaded,
    described and unstretched; no sideways scrolling (measured against the device width); layout shift under 0.1
    and no higher than the live page at the same size.
  - **Hero unchanged:** the same markup and 0 differing pixels against `https://tala.hiraia.org` at 1366, 768, 390
    and 360 px, in both languages. In the diff, `LandingPage.tsx` has no hunk inside the hero block.
  - Keyboard: 12 stops, each with a visible focus ring and in view; the showcases add one stop (the Library link).
  - Touch: every link and button in the header and the page is at least 44 × 44 px on the phone and foldable sizes.
  - Contrast: all 18 pieces of text in the showcases meet WCAG AA, on desktop and on a 360 px phone.
  - Language switch: words, pictures and the page language change together, both ways, and the choice is kept.
  - Motion: waiting pictures come in fully once reached; with reduced motion nothing animates and nothing waits.
  - A slow library (3 s): no number and no pack mark until it answers; when it does, the numbered sentence takes the
    place of the plain one and nothing below moves. No answer at all: the plain sentence stays, no pack mark, no pack
    legend, no number.
  - Without script: the three showcases, both pictures, the whole map and the links are there; no pack number.
  - Links: `/`, `/sign-in`, `/register`, `/library`, `/download` answer 200 signed out and set no cookie; `/` itself
    sets no cookie; no link points at a pack file or the API; the two outside links answer.
- Evidence (screenshots, clips, the walk's log and JSON, before and after sets):
  `/home/b11/tala-homepage-20261127/` (`before/`, `after/`, `compare/`, `preview/`, `walk3/`), and the links in the
  hand-off message.

## Not done, and known limits

- Not deployed, so nothing was checked on production beyond reading the old page.
- Chromium only, with phone and foldable sizes emulated. Not tested: a real Android phone, iOS Safari, Firefox, a
  screen reader, a slow real network.
- The Filipino was reviewed by the Filipino owner, which is an agent; no Filipino-speaking teacher has read it.
- The pictures show a local build of this branch with invented data; after a later change to the lesson editor or
  the slide editor they should be re-shot (`scripts/home-capture.mjs`, then copy the sizes into `shots.ts`).
- Found on the way, not part of this change and not changed here:
  - the footer's "Built with QVAC SDK" link is 40 px tall on phones (`PublicShell.tsx`, shared with other pages);
  - a reader who chose English gets the server's Filipino for an instant and the hero card changes height (layout
    shift 0.018 on desktop, 0.065 at 200 % zoom; the same on the live site);
  - in the lesson editor on a Filipino phone, the timeline's end label ("Pagtatapos ng klase · 60 min") reaches past
    its card's right edge (it is all there, and it is in the phone picture as the phone shows it);
  - the pack slide `sci26-g5-t2-w10` `d1s7` says "stone" beside a drawing of a mango (logged by the release owner).

## How to check it again

```sh
cd packages/tala-web
pnpm exec tsx scripts/home-coverage.mjs --check          # the curriculum map matches the shipped packs
pnpm test                                                 # includes coverage.test.ts and showcase.test.ts
# a local production server (TALA_ENV=local, a temp TALA_DB_PATH, the Science pack library), then:
PLAYWRIGHT_PATH=… CHROMIUM_PATH=… SHARP_PATH=… pnpm exec tsx scripts/home-walk.mjs http://127.0.0.1:<port> <outDir> --reference https://tala.hiraia.org
# to re-shoot the pictures (creates two fictional accounts on that local server):
PLAYWRIGHT_PATH=… CHROMIUM_PATH=… SHARP_PATH=… pnpm exec tsx scripts/home-capture.mjs http://127.0.0.1:<port> public/screens/home --db <TALA_DB_PATH>
```

After a deploy the same walk can be pointed at `https://tala.hiraia.org` (it only reads); leave out `--reference`.

## waiting_for_user

- **Question (asked once, thread ddb4d22d, by the homepage owner with its report):** "Release the redesigned Tala
  homepage to tala.hiraia.org? It is branch `tala-v1-homepage` on top of the live demo.19 and would become
  `tala-v1-demo.20`: the three-showcase section in place of the carousel and the seven feature cards, the reworded
  Filipino 'Ang pangako namin', and one Filipino label inside the app's multi-grade plans ('Ituloy ang sariling
  gawain'). No database change, no new setting; rollback is demo.19."
- **Owner of the question:** homepage owner `b11-dev:bea7a699` (revisions to the page); the release itself is the
  release owner's `b11-dev:12af59a8`, through its usual window.
- **Blocked until answered:** push of the branch and tag, and the production deploy. Nothing else waits on it.
