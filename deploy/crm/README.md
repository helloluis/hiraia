# Hiraia CRM API — operations

A private, bearer-key-protected ingestion/read API at `https://hiraia.org/api/crm/` for the
school-pipeline CRM: contacts, conversation threads and classified **summaries** extracted by the
`harvestd` service on Luis's MBP from his own Messenger/Viber conversations (raw message text is
never synced). Beaniebot reads it for chat queries. Client-facing contract and examples:
[`docs/mbp-crm-integration.md`](../../docs/mbp-crm-integration.md).

It follows the host's existing pattern for private surfaces (telemetry collector, mission
control): a loopback Node service with SQLite in WAL mode, a hardened systemd unit, an nginx
`location` on the hiraia.org site, and a scripted installer from the devbox.

## Layout on the origin (`b11-apps`, 10.77.0.20)

| Path | What |
| --- | --- |
| `/opt/hiraia-crm/` | `server.cjs`, `db.cjs`, `migrate.cjs`, `migrations/`, `backup.sh`, `restore.sh`, `offsite.py`, `alert.py`, `keygen.sh`, `node_modules/` (better-sqlite3 12.10.0), `venv/` (boto3) |
| `/etc/hiraia-crm/crm.env` | port, DB path, **client key hashes** (`HIRAIA_CRM_CLIENT_<NAME>=<scope>:sha256:<hex>`) |
| `/etc/hiraia-crm/backup.passphrase` | AES-256 passphrase for backup artifacts (root, 0600). **Keep a copy in the password manager — without it offsite backups are unreadable.** |
| `/etc/hiraia-crm/offsite.env` | optional R2 credentials for the offsite push (root, 0600; see Backups) |
| `/var/lib/hiraia-crm/crm.db` | the database (service user `hiraia`, WAL) + `backup-status.json` |
| `/var/backups/hiraia-crm/{daily,weekly,monthly}/` | encrypted artifacts `hiraia-crm-<UTC>.tar.gpg` + `.sha256` sidecars |
| `/root/hiraia-crm-secrets/<client>.key` | one-time plaintext pickup files written by `keygen.sh` — shred after pickup |
| `/var/log/hiraia-crm-backup.log` | backup/alert log; request log is `journalctl -u hiraia-crm` |
| systemd | `hiraia-crm.service` (:8137), `hiraia-crm-backup.timer/.service`, `hiraia-crm-backup-alert.service` |
| nginx | `conf.d/hiraia-crm-rate.conf` (zone) + `location /api/crm/` in `sites-available/hiraia.org` |

## Install / update

```bash
deploy/crm/install.sh                      # root@10.77.0.20 by default; idempotent
deploy/crm/install.sh --offsite-env /path/to/r2.env    # also install offsite credentials
deploy/crm/install.sh --rotate-keys        # regenerate both client keys
```

The script copies the files, runs `npm ci`, creates the venv, generates config/passphrase/keys
only when missing, installs units and the nginx route (backed up, `nginx -t`-gated, auto-restored
on failure), runs a first backup and probes `https://hiraia.org/api/crm/health` (200) and
`/contacts` without a key (401). Run the unit tests first: `cd deploy/crm && npm ci && npm test`.

After an install, copy the live site file back over `deploy/nginx/hiraia.org.conf` so the repo
copy stays verbatim (the convention in `deploy/README.md`).

## Clients and keys

| Client | Scope | Who | Env var on the client |
| --- | --- | --- | --- |
| `mbp-harvestd` | `write` (includes read) | harvestd on the MBP | `HIRAIA_CRM_API_KEY` |
| `beaniebot` | `read` | Beaniebot chat queries | `HIRAIA_CRM_API_KEY` |

`keygen.sh <client> <read|write> [--rotate]` (on the origin, as root) generates a 256-bit key,
stores only its SHA-256 in `crm.env` under `HIRAIA_CRM_CLIENT_<CLIENT>`, writes the plaintext once
to `/root/hiraia-crm-secrets/<client>.key`, restarts the service and prints the fingerprint. The
server compares digests in constant time; `write` implies `read`. Adding a third client is the
same command with a new name — no code change. Key values never belong in chat, commits or docs.

## Database and migrations

SQLite (`better-sqlite3`), WAL, `foreign_keys=ON`. Tables: `contacts` (unique on
`platform + name`, case-insensitive), `threads` (unique on `contact_id + app + thread_name`),
`extracts` (append-only by design), `events` (append-only audit log; UPDATE/DELETE are refused by
triggers), `idempotency_keys` (30-day replay cache), `schema_migrations`.

Migrations are numbered SQL files in `migrations/`, applied in order and recorded; every statement
is `IF NOT EXISTS`, so re-running is a no-op and a database that lost its bookkeeping re-migrates
cleanly. The service migrates at start-up; by hand:

```bash
node /opt/hiraia-crm/migrate.cjs --status          # applied / pending
node /opt/hiraia-crm/migrate.cjs                   # apply pending (idempotent)
```

## Backups

`hiraia-crm-backup.timer` runs `backup.sh` daily at 19:00 UTC (03:00 Asia/Manila, `Persistent=true`
so a missed run happens at boot). Each run:

1. takes a consistent online snapshot (`sqlite3 .backup`, as the service user) and requires
   `PRAGMA integrity_check` = `ok`;
2. writes `manifest.json` (per-table row counts, snapshot sha256, host, stamp);
3. copies config — `crm.env` (hashes only), the units, the nginx snippets; **never** the
   passphrase or `offsite.env`;
4. `tar.gz` → `gpg --symmetric` AES-256 (SHA-512 S2K, max iteration count) using
   `/etc/hiraia-crm/backup.passphrase`, then decrypts and lists the artifact again before it counts;
5. stores it in `daily/`, hard-links it into `weekly/` on Sundays and `monthly/` on the 1st, and
   prunes to **7 daily / 4 weekly / 6 monthly**;
6. if `/etc/hiraia-crm/offsite.env` exists, `offsite.py push` uploads the artifact (+ sidecar) to
   the R2 bucket, **downloads it again and compares the sha256**, then prunes remote tiers to the
   same retention; without the file the run logs `offsite: NOT configured` and the status reports
   `"offsite":{"state":"unconfigured"}`;
7. writes `/var/lib/hiraia-crm/backup-status.json`; `GET /api/crm/status` exposes it with
   `backup.stale` (true when the last success is older than 36 h).

Offsite target: the project's existing private R2 bucket **`b11-ovh-backups`** (it already holds
the OVH restic repository under `restic/`), prefix `hiraia-crm/{daily,weekly,monthly}/`. The
uploader refuses `hiraia-assets` (public) and the `restic/` prefix. `offsite.env` needs
`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (optionally `R2_SESSION_TOKEN`,
`HIRAIA_CRM_BACKUP_BUCKET`, `HIRAIA_CRM_BACKUP_PREFIX`). Mint a token scoped to that bucket with
Object Read & Write — not the account-level key from the devbox — and install it with
`install.sh --offsite-env FILE`.

Manual run and inspection:

```bash
systemctl start hiraia-crm-backup.service && tail -3 /var/log/hiraia-crm-backup.log
ls -l /var/backups/hiraia-crm/*/
/opt/hiraia-crm/venv/bin/python /opt/hiraia-crm/offsite.py list --env /etc/hiraia-crm/offsite.env
```

### Failure alerting

`OnFailure=hiraia-crm-backup-alert.service` runs `alert.py backup-failed`, which appends an
`ALERT` line to `/var/log/hiraia-crm-backup.log` **and** `/var/log/hiraia-monitor.log` (the
"guard activity" tail in mission control at `/admin`), e-mails `notify_email` through Resend using
the key mission control already holds in `/opt/hiraia-monitor/config.json`, and posts to
`notify_webhook` if configured. A silent timer (never firing) shows up as `backup.stale: true` on
`GET /api/crm/status`. Test the channel: `python3 /opt/hiraia-crm/alert.py test`.

## Restore

```bash
# 1. pick an artifact (local tier, or fetch an offsite one first)
ls /var/backups/hiraia-crm/daily/
/opt/hiraia-crm/venv/bin/python /opt/hiraia-crm/offsite.py fetch --env /etc/hiraia-crm/offsite.env \
    --key hiraia-crm/daily/hiraia-crm-<stamp>.tar.gpg --out /tmp/hiraia-crm-<stamp>.tar.gpg

# 2. verify-only restore into a temp dir: sidecar sha256, integrity_check, per-table row counts
#    compared with the manifest (and, optionally, with the live DB)
/opt/hiraia-crm/restore.sh /var/backups/hiraia-crm/daily/hiraia-crm-<stamp>.tar.gpg \
    --verify-against /var/lib/hiraia-crm/crm.db

# 3. put it live (stops the service, keeps the old DB as crm.db.pre-restore-<stamp>, migrates,
#    starts, checks /health) — only after step 2 says RESTORE VERIFIED
/opt/hiraia-crm/restore.sh /var/backups/hiraia-crm/daily/hiraia-crm-<stamp>.tar.gpg --install
```

Disaster case (host lost): new host → `install.sh` → copy the passphrase from the password manager
to `/etc/hiraia-crm/backup.passphrase` → fetch the newest offsite artifact → `restore.sh … --install`
→ re-issue client keys with `keygen.sh … --rotate` (hashes are inside the artifact's `crm.env`, but
rotating is cheaper than reasoning about whether the old plaintexts are still safe).

## Verification checklist (what "deployed" means)

```bash
curl -sS https://hiraia.org/api/crm/health                                  # {"ok":true}
curl -sS -o /dev/null -w '%{http_code}\n' https://hiraia.org/api/crm/contacts   # 401
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Authorization: Bearer nope' https://hiraia.org/api/crm/contacts  # 401
curl -sS -o /dev/null -w '%{http_code}\n' http://hiraia.org/api/crm/health   # 301 → https
# on the origin, with the pickup files (never echo them):
ssh root@10.77.0.20 'K=$(cat /root/hiraia-crm-secrets/beaniebot.key); curl -sS -H "Authorization: Bearer $K" https://hiraia.org/api/crm/status'
systemctl status hiraia-crm.service hiraia-crm-backup.timer --no-pager
```

## Uninstall

See the header of `install.sh`. Keep `/var/lib/hiraia-crm`, `/var/backups/hiraia-crm` and
`/etc/hiraia-crm` until the data and the passphrase are confirmed unnecessary.
