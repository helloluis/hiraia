# Teachers' uploaded files in private R2 storage: settings, keys, checks, outages

Luis decided on 25 Nov 2026: keep all Tala user files in a private R2 folder, indefinitely. For the uploads
feature that means: every uploaded PowerPoint file is one object in the private bucket `hiraia-archive`, under the
environment's prefix, at

    <TALA_R2_PREFIX>teachers/<account id>/uploads/<upload id>/original      e.g. tala/production/teachers/…/original

and it stays there until the teacher deletes that file or her account. Nothing expires it, lists the bucket or
sweeps it. What a teacher's file was read into, her edits and the slide pictures (a cache) stay in the database
like every other record; the file itself is no longer copied into SQLite.

What is kept where, and why (the feature owner's inventory, 25 Nov): the uploaded deck is the only file a teacher
brings that the server keeps. Class-list files are read and discarded on purpose (pupils' names); downloads
(edited deck, plan PDF, Word, account export) are made on request and never stored. Both are open questions for
Luis; nothing about them changes here.

## Settings (`/etc/tala/tala.env`)

| Name | Value on production | |
|---|---|---|
| `TALA_R2_ENDPOINT` | the account's `https://<account>.r2.cloudflarestorage.com` | names the account: never paste it into a report |
| `TALA_R2_BUCKET` | `hiraia-archive` | private: no public address, no custom domain, no object expiry rule; its lock rules cover only `objects/sha256/` and `snapshots/` |
| `TALA_R2_PREFIX` | `tala/production/` (rehearsals: `tala/rehearsal/`) | joined to the name as it is; each folder ends in `/`; required outside a developer machine |
| `TALA_R2_REGION` | `auto` | |
| `TALA_R2_CREDENTIALS_FILE` | `/etc/tala-r2/r2-credentials.json` | file root:tala 0640 in a folder root:tala 0750 of its own: `/etc/tala` is root-only (0700) on the host, and the web server, running as `tala`, reads this file itself (to pick up renewed keys without a restart) |

In staging and production, with none of these set, or any of them missing or unusable, **no upload is taken** and
the log says why once at start (`deck_upload_storage_off`). Files are never kept in the database instead. Only
`TALA_ENV=local` with nothing set keeps files in the database (a developer machine, the tests).

## The key

The key file is JSON: `accessKeyId`, `secretAccessKey`, `sessionToken`, `expiresAt` (ISO 8601, UTC); no other field.
The web server refuses a file that every user of the machine may read. It reads the file again when it changes (a
rename counts), at most every two seconds, a minute before `expiresAt`, and at once when the store refuses a key
(and tries that request once more only when the file now holds other keys). No restart.

The keys are short-lived and limited to ONE prefix of ONE bucket (object read and write, no listing), derived on
b11-dev from the parent R2 credential, which never leaves b11-dev:

    ~/.venvs/hiraia-publish/bin/python -I renew-r2-keys.py --parent /home/b11/code/hiraia/.env.cloudflare.local \
        --prefix tala/production/ --ttl-hours 24 --install-on b11-apps

It sends the key on ssh's standard input over the pinned root route, makes the folder `/etc/tala-r2` (root:tala 0750)
when it is not there, writes the key beside the old file, sets root:tala 0640, renames it into place, and checks that
the installed file is the one sent and that the user `tala` can read it. It prints no value.

**Renewal**: `tala-r2-renew.timer` (a user timer of `b11` on b11-dev; lingering is on) runs it every six hours for
keys that last 24 hours: three renewals in a row can fail before uploads stop. Install:

    install -D -m 0755 renew-r2-keys.py ~/.local/share/tala-r2/renew-r2-keys.py
    install -D -m 0644 tala-r2-renew.service tala-r2-renew.timer -t ~/.config/systemd/user/
    systemctl --user daemon-reload && systemctl --user enable --now tala-r2-renew.timer
    systemctl --user start tala-r2-renew.service && journalctl --user -u tala-r2-renew.service -n 5

The server warns (`deck_upload_storage_keys_ending`, at most hourly) when its key has under six hours left. A key
that does not expire, limited to this bucket and made by Luis in the Cloudflare dashboard, can replace the timer
without any change to the server: same file, without `sessionToken` and `expiresAt`.

## How the server uses the store

- **New upload**: the file is read by the worker as before; then, inside the same turn at the one job place (one
  whole file in memory at a time for the whole server), it is written with `If-None-Match: *` (nothing is ever
  overwritten) and Content-MD5, read back and checked against its SHA-256, and only then recorded. Until then the
  arriving pieces stay; a failure is a plain "try again" (`upload_storage_unavailable`) and finishing again resumes
  from them.
- **"The file I uploaded"**: sent a piece of 512 KiB at a time, each fetched from the bucket as the connection takes
  it. The first piece is fetched before answering (a store that does not answer is a "try again",
  `download_storage_unavailable`); the whole SHA-256 is checked before the last piece is sent, so a changed object
  never arrives as if it were her file. The edited download and the drawing fetch the whole file and check it.
- **Delete** (a file, or an account): recorded in the same transaction, then the object is removed at once, and
  retried with back-off until it is gone. A write whose outcome was not known is removed twice, ten minutes apart.
- **Table of intents** `decks_upload_objects` (migration `decks:005_upload_objects`): every object being written,
  kept, or still to be removed. A crash leaves nothing unknown: a write still "writing" after 15 minutes is removed.
- **Older databases** whose files are still in `decks_upload_file_pieces` are moved one file per run: written,
  read back, compared, recorded; the pieces go only when no upload kept in the database still needs them.
- **Never**: a link to the bucket, a key in the drawing service (its unit, settings and socket are unchanged; it has
  no network), a listing, an expiry, an overwrite.

## When R2 does not answer (an hour, say)

| | |
|---|---|
| New uploads | finishing is refused with "try again"; her pieces stay (24 h) and finishing again resumes |
| Downloads of uploaded files, pictures being drawn | "try again" / busy; the editor goes on without new pictures |
| Saving edits, the list, opening the editor, everything else on the site | unaffected (records are in the database) |
| Deletes | done for the teacher at once; the objects are removed when the store answers |
| Log | `deck_upload_storage_unavailable` once (why: timeout, network, status), `deck_upload_storage_still_unavailable` every five minutes with what waits, `deck_upload_storage_back` with how long it was down |

After a failure the server rests 2 s before asking again, doubling to a minute, so an outage costs no waiting.

## Checks

- Real store, the server's own client, synthetic bytes (rehearsal or production window):
  `TALA_R2_*=… pnpm --filter @hiraia/tala-server exec tsx scripts/decks/r2-check.ts`. Writes one object under
  `<prefix>route-check/<run>/`, reads it back whole and in pieces, checks no-overwrite, a wrong checksum, a name
  outside the prefix, removes it and checks it is gone.
- Every upload's object against the database (read through the server's client, no listing):
  `TALA_DB_PATH=… TALA_R2_*=… pnpm --filter @hiraia/tala-server exec tsx scripts/decks/r2-verify.ts [--upload <id>]`.
- Tests: `src/modules/decks/s3-sign.test.ts` (AWS's published Signature V4 examples) and `uploads-r2.test.ts`
  (against `fake-s3.ts`: outages, hangs, 5xx, dropped and corrupted answers, a write that lands but is not
  answered, expired and renewed keys during an upload, a download and a waiting delete, a changed object,
  carry-over, restart).

Measured on real R2 (25 Nov 2026, `tala/rehearsal/`, the server's own client): all of `r2-check.ts` passed; a
45-second key was refused after its end (403 `SignatureDoesNotMatch`) and the next request, with a renewed file
renamed into place, succeeded without a restart.

## Rollback

Once files are in R2, the way back is `tala-v1-demo.13` (which has no uploads at all and leaves the uploads' tables
alone) and forward again: the objects and their records are found as they were. Never an earlier uploads candidate
(`c6938a492`, `d1eb90438`): those read files only from the database and would not find these.
