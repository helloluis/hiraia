# decks — a teacher's own copy of a pack's slides

Contract: `packages/tala-core/src/contracts/decks.ts` and the `decks.*` routes in `contracts/api.ts`.
Layout (shared with the web viewer and editor): `packages/tala-core/src/decks`.

The Hiraia original stays shared and read-only; the packs module serves it from the library on disk. "My copy" is
one row in this module's own table, owned by one account. Nothing here writes to the library, and nothing a teacher
does to a copy reaches the original or another teacher's copy.

| Route | What |
|---|---|
| `decks.create` `POST /decks` | Make my copy of a pack's deck in one language. Answers my existing copy when I have one (even if the pack has since left the library). A new copy needs the same access as opening the pack, and a built deck that matches the reviewed content. |
| `decks.list` `GET /decks` | My copies, newest first (no slide content). |
| `decks.get` `GET /decks/:deckId` | The copy, the slides exactly as first copied (`baseSlides`), and `original`. |
| `decks.save` `PUT /decks/:deckId` | Store my slides. `baseRev` must be the stored rev, or `force` (the teacher chose "keep my version"); otherwise `conflict` with `details: { reason, rev, updatedAt }`. Answers `{ rev, updatedAt, changedSlides }` only. |
| `decks.reset` `POST /decks/:deckId/reset` | Throw my edits away and copy the library's current original again. Refused (`not_found`, `reason: original_unavailable`) when I can no longer open it; the copy is left as it was. |
| `decks.delete` `DELETE /decks/:deckId` | Remove the copy. |
| `decks.media` `GET /decks/:deckId/media/:slug` | One of my copy's drawings (PNG, inline). |
| `decks.pptx` `GET /decks/:deckId/pptx` | My copy as an editable PowerPoint file. |

`packs.media` (`GET /packs/:packId/media/:slug?lang=`) lives in the packs module and serves the same drawings for
the shared original, with the pack's own visibility.

## Ownership

Every route needs a session. Every statement that reads or writes a deck names the owner
(`WHERE id = ? AND owner_id = ?`), so another teacher's deck id answers `not_found` with the same body as an id that
does not exist. There is no sharing and no public route. `onAccountDeleted` removes an account's copies;
`onAccountMerged` hands them to the surviving account (both copies are kept when each account had one of the same
pack; `decks.create` then answers the one changed most recently).

## What a copy holds

- `slides_json`: the teacher's slides. `base_slides_json`: the slides as copied, never changed by a save, so "what
  did I change" and "put this slide back" do not depend on the library.
- `media_json` + table `decks_media`: the drawings the copy may show. The bytes are exactly what the built deck
  embeds (the Hiraia-watermarked derivative), stored once per SHA-256 and shared by every copy that shows them. They
  live in SQLite, not beside the library, so replacing `/var/lib/tala/packs` cannot take them away. Drawings no copy
  shows any more are swept when a copy is deleted or reset.
- `rev`: bumped on every save and reset.

`original` on a detail is computed against the library as it is now: `available` = the account may open that
language version today; `updated` = its reviewed content hash differs from the one the copy was made from. Both are
`false` when the pack is gone; the copy still opens, saves, shows its drawings and downloads.

## Rules a save enforces

Text is tidied (one line per field; notes keep their line breaks), empty lines are dropped, a drawing must be one of
the copy's own (alt text is restored from it when empty), a `revealOf` or `sourceId` that points nowhere is cleared,
slide ids must be unique, and a copy whose original had a credits slide must keep one: that slide carries the art
credit and the honest "draft / reviewed by" and "edited by its teacher" lines (the layout prints them; they are not
the teacher's to type over). The contract's limits (`DECK_LIMITS`) are checked by the kernel before the handler runs.

## The download

`pptx-write.ts` turns the saved slides into a `.pptx` through the same display list the browser draws
(`layoutDeck`), so the file looks like what the teacher saw. It follows the decks the pack renderer builds:
`pptx-template.ts` holds that renderer's theme, master, layouts and notes master verbatim, and the two brand marks.
Every word is real text, lists are native, pictures are only the drawings (embedded byte for byte) and the brand
marks, every slide has speaker notes. Nothing is read from the library at export time, and the same saved copy always
downloads as the same bytes.

`zip.ts` is a small ZIP reader/writer on `node:zlib` (no new dependency); `pptx-read.ts` finds a built deck's slides
and drawings.

## Storage

Migration `decks:001_init` creates `decks_decks` and `decks_media` (both `STRICT`). It is additive: an older
release simply ignores the two tables. No new directory, environment variable or setting on the host.

Teachers' own uploaded files (`uploads.ts`, migrations `decks:002`–`decks:005`) are kept in a private R2 bucket
(`r2.ts`, `s3-sign.ts`, settings `TALA_R2_*`), one object per upload; `decks_upload_objects` records every object
written or still to be removed. See `packages/tala-server/deploy/r2/README.md`.

## Tests

`decks.test.ts` (routes, two teachers, conflicts, library snapshots, the download, account hooks), `pptx.test.ts`
(ZIP, reader, writer), `packages/tala-core/src/decks/decks.test.ts` (layout). Fixtures are built by `testing.ts`
from the committed sample library with this module's own writer and invented drawings: hermetic.

Opt-in checks against real built decks on a development machine (not part of the suite): set
`TALA_DECKS_REAL_DECK_DIR` to one built language version for the reader test.

## A lesson's presentation (27 Nov 2026)

Luis: "Presentations should be displayed prominently in the Lesson Plan view … There should be an AI regeneration
button on the slides too." and "Multigrade presentations should be dynamically assembled in the Lesson Plan view."
Code: `lessons.ts` (routes, AI runner, downloads), `lesson-store.ts` (tables), `slides-ai.ts` (model input/output),
prompts `prompts/slides/deck.v1.md` and `prompts/slides/slide.v1.md`; pure parts in `packages/tala-core/src/decks`
(`lesson.ts`, `assemble.ts`). The web panel is `packages/tala-web/src/features/editor/PresentationPanel.tsx`.

| Route | What |
|---|---|
| `decks.lesson.get` `GET /plans/:planId/presentation` | The lesson's slides (its day of a pack copy, or its own deck), `stale`, and the AI request in progress or waiting, if any. A multi-grade session answers `kind: 'session'` and its `parts` (each grade's own lesson and slides). |
| `decks.lesson.link` `POST /plans/:planId/presentation` | Use my copy of a pack (made when I have none) for this lesson, and which day is the lesson's (0 = whole deck). Refused (`lesson_has_slides`) when the lesson has its own AI slides. |
| `decks.lesson.unlink` `DELETE /plans/:planId/presentation` | A pack copy stays among my copies; slides made from this lesson are removed (with their versions). |
| `decks.lesson.checked` `POST …/checked` | The teacher says the slides still fit the changed lesson: `stale` clears. |
| `decks.lesson.source` `PUT …/sources/:groupId` | Which of my lessons is a grade's part of a session (`planId: null`: let Tala find it again). |
| `decks.lesson.pptx` `GET …/pptx` | The lesson's slides only, or the session put together now from the saved plan (decks/assemble.ts), as PowerPoint. |
| `decks.ai.start` `POST …/ai` | `scope`: `new` (slides for a lesson that has none), `lesson` (rewrite all of the lesson's slides), `slide` (one slide). Answers the request already in progress for the lesson instead of starting another. Refused before any model call for an empty lesson, a session plan, a whole-week link (`choose_day`) or generation switched off. |
| `decks.ai.get` `GET …/ai/:jobId` | `queued` → `running` → `ready` (a proposal) or `failed` (a reason: disabled, providers_unavailable, invalid_output, quota_exceeded, budget_exceeded, interrupted, gone). |
| `decks.ai.apply` `POST …/ai/:jobId/apply` | Writes the proposal: the deck as it was is kept in `decks_revisions` first, in the same transaction. Refused (`slides_changed`) when the slides it replaces changed since, unless `force`. A second apply changes nothing. |
| `decks.ai.discard` `POST …/ai/:jobId/discard` | "Keep mine" (also dismisses a failure). |
| `decks.revisions` `GET /decks/:deckId/revisions` | Earlier versions, newest first (20 kept). |
| `decks.restore` `POST /decks/:deckId/revisions/:revisionId/restore` | Puts one back; the deck as it is is kept as an earlier version first. |

The model writes words only (`slides-ai.ts`): ids, days, every check's answer slide and pictures are the server's; a
picture is one of the deck's own drawings by slug or none (an unknown slug is dropped). The input is the CURRENT
SAVED lesson, read through `records.planSnapshot` (pre-class sections only; competency wording from the curriculum
service). Features `slides.generate` (quota bucket `full`) and `slides.rewrite` (bucket `section`), routes
`TALA_LLM_ROUTE_SLIDES_GENERATE` / `TALA_LLM_ROUTE_SLIDES_REWRITE` (default `cloud`). Each request id goes into the
gateway's cache key, so asking again gives a new suggestion rather than the cached one.

Staleness: the link keeps the SHA-256 of `lessonDigestSource` (title, language, grades, competencies, typed
objectives, pre-class sections). Linking, applying a whole-lesson rewrite and "they still fit" record the lesson as
it was then; a one-slide rewrite does not. A different hash later is a cue only.

Slides made from a lesson (`origin = 'lesson'`, `pack_id = ''`) are full decks like any copy (edit, present,
download, revisions) but have no library original (no reset) and are not listed by `decks.list` (the Library's
"your copies"); the lesson that made them is how they are reached.

Migration `decks:006_lesson_presentations` adds `origin`, `subject`, `source_plan_id` to `decks_decks` (defaults keep
every existing row a pack copy) and `decks_plan_links`, `decks_revisions`, `decks_ai_jobs`, `decks_session_sources`.
Additive. `decks.reset` now keeps the copy as it was as an earlier version first; `decks.delete` removes a deck's
links, versions and open proposals. Account deletion and merging cover the new tables.
