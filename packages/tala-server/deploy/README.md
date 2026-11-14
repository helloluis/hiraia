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
