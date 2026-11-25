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
