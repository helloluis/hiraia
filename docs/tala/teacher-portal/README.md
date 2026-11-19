# Teacher portal rework (19 Nov 2026)

Luis's brief, in short: teachers who are not tech-savvy must find the portal unintimidating and easy to follow —
icons, pictures, no walls of text and no boxes inside boxes; the Library should read like a professionally laid out
magazine; slides should open in a carousel and be editable by each teacher in their own copy; This Week should show
the next teaching day and point to the Library for help.

The one question every screen now answers first: **what am I teaching next, and what do I do first?**

## Visual direction

"Field notebook": the look of a well-made teacher's magazine printed on Hiraia's cream paper.

- **Size says importance.** Small-caps kicker → Fraunces headline → a larger lead paragraph → calm body text at
  17 px with generous leading → small grey captions. The scale lives in `tailwind.config.ts`
  (`text-kicker|read|lead|headline|quote|hero`) and `globals.css` (`.kicker`, `.reading`).
- **Rules and white space, not boxes.** Sections are separated by a hairline and a heading with its icon. Tinted
  blocks are kept for the few things that must stand out: the Big Idea (yellow, with the lightbulb), what learners
  do (sage), cautions (brick).
- **One icon family** (`src/components/icons.tsx`): 24 px grid, 1.75 px round strokes, `currentColor`. It replaces
  the typographic placeholders (▦ ≡ ⌂ ⚙) in the navigation and is used beside every heading and action. Icons never
  stand in for words.
- **Pictures are real content first.** Pack covers are the decks' own cover slides; the cover drawing on a pack page
  is the deck's drawing, shown whole with its Hiraia mark. Four decorative engravings (`public/art/`, provenance in
  its README) are used in quiet places only: the Library's opening, empty states and the "make these slides yours"
  invitation. They are AI-generated, are not science content and are not part of any pack.
- **Colour** is still the Hiraia tokens only (tints are a token at reduced opacity); Tala teal stays the one accent.
- **Honest labels stay.** Every draft is called a draft on its cover, on its page and on its slides; "How this pack
  was checked" keeps the three review stages apart; an edited copy says on its credits slide that the edits were not
  checked by Hiraia. Drawings are never cropped, so the Hiraia watermark stays on every one.

## What changed, screen by screen

| Screen | Before | Now |
|---|---|---|
| Navigation | Typographic placeholder glyphs | Real icons; same four destinations on phones |
| Library | A grade picker, a term picker and a list of 11 rows with status badges, most of them "Not built yet" | A magazine front: "For your classes" (this week's and next week's pack for the teacher's grades, from their school calendar), then covers of the weeks that exist; weeks not built yet are folded into one line |
| Pack | One long page: banner, download boxes, competency boxes, five stacked accordions of dense text | A feature article: cover with drawing and honest status, **Big Idea** with the lightbulb, the week at a glance (five day covers), then Lesson plans / Slides / Teacher guide |
| Lesson plan | Paragraphs labelled Teacher / Learners | A timeline of timed steps; what to **say** stands on its own marked lines like a script; expected answers are quieter; the slides for each step sit under it; materials and "what learners should see" are a checklist beside the text; the exit-ticket answer is folded away |
| Teacher guide | Headings and paragraphs | A reference with a contents rail: science explanations open one at a time, words as a glossary, wrong ideas set against what is true, questions and answers folded, materials as a checklist with substitutes |
| Slides | A grid of 53 small pictures | Thumbnails grouped by day; a carousel lightbox (swipe, arrow keys, teacher notes, present full screen); **Edit my copy** |
| My copy (new) | — | A small slide editor: click the words on the slide to change them, teacher notes, add / duplicate / delete / move slides, undo, autosave, present, download as PowerPoint |
| This Week | Every day of the week expanded, every lesson with its full competency text and two buttons | The next teaching day on top, everything else collapsed; for each Science lesson the matching Library pack |
| Lessons | A list | The same list, plus a pointer to the Library |

The wording of pack content is never changed by the layout: the script view only adds line breaks around quoted
speech (`features/library/prose.ts`, tested on every built pack).

## My copy: how it works

- The Hiraia original is shared and read-only. **Edit my copy** makes a full copy that belongs to the signed-in
  account (`decks` server module, `contracts/decks.ts`). Nothing is shared or public; there is no sharing feature.
- Every read, write, drawing and export of a copy is checked against the owning account in SQL. Someone else's copy
  answers "not found", exactly like a copy that does not exist.
- A copy is self-contained: its slides, the slides as first copied (for "put this slide back" and "what did I
  change?"), and its drawings (the watermarked files embedded in the original deck, stored once in SQLite by their
  SHA-256). Replacing or removing the library (`/var/lib/tala/packs`) cannot break a copy; the copy only reports
  that the original was updated or is gone.
- One layout engine (`packages/tala-core/src/decks`) draws slides in the browser and writes the PowerPoint file, so
  what a teacher sees is what they download. The export is a real editable deck (text boxes, native lists, title
  placeholders, speaker notes, alt text, Cambria/Calibri), built without any new dependency.
- Saving: automatic, with the revision the edit started from; a stale save is a conflict the teacher resolves, never
  a silent overwrite. Unsaved work is kept on the device.

## Demo path (about three minutes)

1. Sign in → **This Week** opens on the next teaching day. Point at the lesson and at "From the Library".
2. Open the recommended pack → the cover, the **Big Idea**, the week at a glance.
3. **Lesson plans** → Day 1: the timed steps, the lines to say, the slides under a step; open the exit-ticket answer.
4. **Slides** → tap a slide → carousel: arrows / swipe, teacher notes, Present.
5. **Edit my copy** → click a line on a slide, change the example to something from your town → "Saved".
6. Leave, come back (or sign out and in): the change is there. Present it, or download the PowerPoint.
7. **Teacher guide** → "Common wrong ideas" and "Words for this week".

## Checking it

```sh
# from packages/tala-web, against a local server (TALA_ENV=local, temp TALA_DB_PATH, a pack snapshot)
pnpm exec tsx scripts/ui-seed.mjs http://localhost:3410 --db "$TALA_DB_PATH" --teacher a --lang en   # fictional teacher
node scripts/decks-acceptance.mjs http://localhost:3410 --library <packs dir> [--snapshot <new snapshot dir>]
PLAYWRIGHT_PATH=… CHROMIUM_PATH=… node scripts/ui-capture.mjs http://localhost:3410 <outDir> <spec.json>
```

`decks-acceptance.mjs` walks two fictional teachers through copy → edit → sign out/in → export, checks that neither
the shared original nor the other teacher's copy changed, and (with `--snapshot`) swaps in a new library the way the
host does and checks again.
