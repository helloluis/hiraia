# Deploying Tala (tala.hiraia.org)

One process (Next.js serving the web app and `/api/v1`) under systemd on the apps host, behind nginx and
Cloudflare. SQLite file and the downloadable APK live in `/var/lib/tala`; secrets in `/etc/tala/tala.env`
(root, mode 600). Nothing here contains a secret value.

| File | Goes to |
|---|---|
| `tala.service` | `/etc/systemd/system/tala.service` |
| `tala.hiraia.org.nginx.conf` | `/etc/nginx/sites-available/tala.hiraia.org` (+ symlink in `sites-enabled`) |
| `tala.env.example` | template for `/etc/tala/tala.env` |
| `deploy.sh` | `/opt/tala/deploy.sh` |

Release = a tag on the `tala-v1` branch (`tala-v1-demo.N`). Deploy: `/opt/tala/deploy.sh <tag>` — builds
beside the running release, switches, restarts, checks `/api/v1/health`, rolls back if unhealthy.
Roll back by hand: `/opt/tala/deploy.sh <previous tag>`.

Publishing an APK: copy `tala.apk` and `tala-apk.json` into `/var/www/tala-download/` (outside the service state directory, whose mode systemd resets to 0750 on every start, which nginx cannot traverse) (the `/download`
page reads the manifest at request time; nginx serves the file).

Backups (not automated yet): `sqlite3 /var/lib/tala/tala.db ".backup '/path/tala-$(date +%F).db'"`.

## Teaching packs data

The prebuilt Science packs are data, not code: the release only contains the server rules. The pack library
(`index.json`, and `pack.json` + `review.json` per week and language) and the built files (PPTX, PDFs, slide
previews, per-language `manifest.json`) live in `/var/lib/tala/packs`, owned by `tala`:

    /var/lib/tala/packs/index.json
    /var/lib/tala/packs/science-bow-2026/<packId>/<en|fil>/{pack.json,review.json}
    /var/lib/tala/packs/artifacts/<packId>/<en|fil>/{manifest.json,<files>,previews/thumb-NN.webp}

Install or refresh them from the machine that built the packs:

1. `packages/tala-packs/scripts/stage-for-deploy.sh /tmp/tala-packs.tgz` (copies exactly the served files and
   writes `SHA256SUMS`).
2. Copy the tarball to the host, then as root:
   `mkdir -p /var/lib/tala/packs.new && tar -xzf /tmp/tala-packs.tgz -C /var/lib/tala/packs.new &&
   (cd /var/lib/tala/packs.new && sha256sum -c --quiet SHA256SUMS) && chown -R tala:tala /var/lib/tala/packs.new &&
   rm -rf /var/lib/tala/packs.prev && { [ ! -d /var/lib/tala/packs ] || mv /var/lib/tala/packs /var/lib/tala/packs.prev; } &&
   mv /var/lib/tala/packs.new /var/lib/tala/packs`. The server reads them per request (no restart needed).
3. `TALA_PACKS_LIBRARY_DIR` / `TALA_PACKS_ARTIFACTS_DIR` in `/etc/tala/tala.env` point there (set once).

A file is served only when its bytes match its manifest for the exact reviewed content, so a partial copy shows
"being rebuilt" instead of a broken download. Drafts are hidden from signed-out visitors; in production they are
open to the emails in `TALA_PACK_REVIEWERS`, or to every signed-in account with `TALA_PACK_DRAFT_PREVIEW=signed-in`.
Only a pack a named teacher approved is public. Roll back the data with `mv /var/lib/tala/packs.prev
/var/lib/tala/packs` (after moving the current one aside).

## Mathematics pilot data (six weeks, from `tala-v1-demo.12`)

A second, separate library BESIDE the Science one, so that a Science refresh (which replaces `/var/lib/tala/packs`
wholesale) can never remove it:

    /var/lib/tala/packs-math/index.json
    /var/lib/tala/packs-math/mathematics-bow-2026/<packId>/<en|fil>/{pack.json,review.json}
    /var/lib/tala/packs-math/artifacts/<packId>/<en|fil>/{manifest.json,<files>,previews/thumb-NN.png}
    /var/lib/tala/packs-math/{SHA256SUMS,STAGE-RECORD.json,NOTICES/}

No setting is needed: the server looks for `packs-math` next to the Science root (two levels above
`TALA_PACKS_LIBRARY_DIR`). `TALA_PACKS_MATH_LIBRARY_DIR` and `TALA_PACKS_MATH_ARTIFACTS_DIR` override that. Where the
folder is absent, the Library is Science only, exactly as before the pilot.

1. Stage it on the dev box from the Math owner's verified delivery, extracted into an empty folder (nothing in the
   delivery is executed; the script copies an explicit list of files and compares every hash with the delivery's
   own records):
   `python3 -I packages/tala-server/deploy/math-pilot/stage-math-pilot.py <bundle root> <empty out dir> --bundle-sha256 <hex>`
   then `tar -czf tala-packs-math.tgz -C <out dir> .`
2. Copy the tarball to the host, then as root:
   `mkdir -p /var/lib/tala/packs-math.new && tar -xzf /var/tmp/tala-packs-math.tgz -C /var/lib/tala/packs-math.new &&
   (cd /var/lib/tala/packs-math.new && sha256sum -c --quiet SHA256SUMS) && chown -R tala:tala /var/lib/tala/packs-math.new &&
   { [ ! -d /var/lib/tala/packs-math ] || mv /var/lib/tala/packs-math /var/lib/tala/packs-math.prev; } &&
   mv /var/lib/tala/packs-math.new /var/lib/tala/packs-math`. The server reads it per request (no restart).
3. Take it away again: `mv /var/lib/tala/packs-math /var/lib/tala/packs-math.removed`. The Library is Science only
   at the next request. A release older than `tala-v1-demo.12` ignores the folder.

The same rules as Science apply: every version is a draft until a named teacher approves it, drafts are closed to
signed-out visitors, and a file is served only when its bytes match its manifest. A pilot deck is shown from the
delivery's own checked slide pictures and cannot be copied for editing in Tala; its PowerPoint file can be downloaded.

## Replacing some Filipino editions only (Science overlay)

When revised Filipino editions are ready for part of the library, the next Science library is built FROM THE LIVE ONE,
so English and every edition that is held stay byte-identical:

1. Copy the live library to the dev box and check it against its own `SHA256SUMS` (it is the base).
2. `python3 -I packages/tala-server/deploy/science-overlay/overlay-filipino.py --base <live> --source <revised library>
   --holds <holds.json> --out <empty dir> --source-sha256 <hex> --library-version <date>`. The holds file names every
   pack whose Filipino edition is NOT taken, by reason. The tool refuses to run when a label would change, when a
   taken edition is not whole or does not pair with the live English, or when any file outside the taken Filipino
   folders would differ. It writes `OVERLAY-RECORD.json` (what was taken, what was held, counts before and after).
3. Validate the output with the release code, then install it exactly like a full Science refresh (above):
   `packs.new`, `sha256sum -c`, `chown`, previous library to `packs.prev`. No restart.
4. Roll back: `mv /var/lib/tala/packs /var/lib/tala/packs.rolled-back && mv /var/lib/tala/packs.prev /var/lib/tala/packs`.

A teacher's private copy never depends on the library: after a swap it only says that its original was updated.

