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
