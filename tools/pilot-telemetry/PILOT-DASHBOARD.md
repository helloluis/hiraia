# Pilot dashboard and Neon mirror

Implementation is on `main` in the `hiraia-main-telemetry` worktree. The grade/language
context change is in the `unified` mobile worktree. These changes are not committed.

## Dashboard

The default `/admin` page becomes the pilot dashboard. Existing authentication, cookies,
CSRF protections, training APIs and configuration are preserved. Training UI moves to
`/admin/archive/training`; the earlier telemetry tables move to `/admin/archive/telemetry`.
An exact working-source snapshot is in `deploy/vps-monitor/archive/`. The prepared live
patch preserves the actual server's dashboard renderer and training APIs, rather than
replacing them with another branch's versions.

Cards show lifetime totals, independent of the selected chart period. Clicking a card
opens its chart after the last card in that responsive grid row. Exactly one card is
active; its dark green fill, gold edge and pointer connect it to the matching chart.
Chart ranges: trailing 14 days, one calendar month, three calendar months, or one calendar
year including today. 1Y app charts use weekly buckets. Dates are UTC; GA reports disclose
the property's own timezone. Unknown sources display unavailable, not invented zeroes.

- **APK downloads:** existing landing-page download-button clicks, deduplicated by IP hash
  and UTC day. They do not prove completed file transfers and exclude direct file sharing.
- **Model downloads:** `download_installed` events with `asset_kind=model`, including the
  embedding model; resumed attempts, failures, vector packs and image packs are excluded.
- **Sessions:** distinct `(installation_id, session_id)` pairs, dated by first observed event.
  A missing session-start event does not discard an otherwise observed session.
- **Flash cards:** curated and generated `card_viewed` events.
- **Quizzes/correct:** `quiz_graded`, with correctness required for the latter.
- **Persona:** latest known grade/language pair per session, then most frequent pair across
  sessions. Shared devices can have different personas in different sessions. Historical
  builds without grade remain unknown; unknown coverage is disclosed.

Recent sessions are ordered by most recent upload. Rows show first/last event timestamps,
last received time, persona, Android/build/RAM, cards, quizzes and correct answers. Opening
one reveals downloaded assets, failures and a paginated timeline of all allowlisted event
properties. Device-provided strings are rendered with textContent, never interpreted as HTML.

## Neon durability

SQLite remains the ingest database; successful responses follow a durable SQLite commit
(`synchronous=FULL` with WAL). Neon receives asynchronous copies through a separate worker.
The credential belongs only in `/etc/hiraia/telemetry-mirror.env` (root-owned, mode 0600).
The local credential file is git-ignored and mode 0600; it is not in the deployment archive.

Remote schema: `hiraia_telemetry.events`, `apk_download_hits`, and `mirror_health`.
The worker commits each remote batch before saving SQLite receipts. Duplicate replay uses
`ON CONFLICT DO NOTHING`; restored SQLite files and lost acknowledgments are safe to replay.
Local deletions never delete the remote copy. A daily full reconciliation repairs missing
remote rows even if old local receipts exist. Timer checks run every 30 seconds, but skip
Neon connections when nothing is pending, allowing Neon to sleep between activity.

The former 180-day pruning script now deletes nothing. Pilot history is retained for LTD
and 1Y reporting and recovery. This is asynchronous replication: events awaiting their
first remote copy still depend on the VPS disk. Events remaining on an offline phone
cannot be backed up remotely until they upload. The dashboard exposes mirror status.

### Restore

Use new destination filenames; the command refuses to overwrite existing files. It takes
a repeatable-read snapshot of Neon and restores the event and optional APK tables.

```sh
python deploy/vps-monitor/neon_mirror.py --env-file /etc/hiraia/telemetry-mirror.env \
  --restore-to /safe/new-telemetry.db --restore-apk-to /safe/new-apk-clicks.db
```

The APK restore contains only APK clicks, not website accounts or chats. Reconfigure the
collector/admin against the restored telemetry database after verifying it. To import APK
clicks into a full website database, back up that database first and insert the restored
click rows by their `(day, ip_hash)` key.

Neon's own point-in-time restore window depends on project configuration; no restore-window
setting was changed by this work. See https://neon.com/docs/introduction/branch-restore.

## Google Analytics

The adapter uses GA4's Data API, read-only scope and a server-side service account. Reports
are filtered to the web platform and supply sessions, daily totals, device categories and
country/region breakdowns. Cached reports survive transient failures and disclose staleness,
thresholding, report timezone and refresh time. No website visitor data is joined to student
installations or sessions.

Needed: numeric `HIRAIA_GA4_PROPERTY_ID`, Viewer access for the service account on that
property, and server-side `GOOGLE_APPLICATION_CREDENTIALS`. The existing measurement ID
`G-0J24GCEHCY` cannot substitute for the numeric property ID. Secrets must never enter HTML.
Install `deploy/vps-monitor/requirements-analytics.txt` in the admin service's virtualenv.
The adapter refreshes its file cache on demand, at most once per 30 minutes per period.
It is a reporting API integration, not a push subscription. Processed GA data can lag
24–48 hours. GA property `552885607` is connected as of 2026-09-06 using
`hiraia-dashboard@hiraia.iam.gserviceaccount.com`. The private key is installed at
`/etc/hiraia/ga-service-account.json` (root-owned, mode 0600), and the admin service
drop-in is `/etc/systemd/system/hiraia-admin.service.d/google-analytics.conf`.
All four ranges passed authenticated HTTPS verification, including device and location
breakdowns. Initial reports returned 19 sessions and the Asia/Manila property timezone.

References:
- https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart
- https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema
- https://support.google.com/analytics/answer/11198161

## Live deployment — 2026-09-06

Deployed to the existing VPS after explicit user approval, including installation of the
private Neon environment file. Dashboard: https://hiraia.org/admin. Collector and mirror
timer are enabled at boot; the timer retries every 30 seconds. Existing authentication
and both archived dashboard routes were verified over public HTTPS.

Rollback copies of the original admin and both nginx site configurations are in
`/opt/hiraia-monitor/archive/pilot-rollout-20260906T001746Z/` on the VPS.
The initial attempt automatically rolled back when the mirror could not probe its default
home for optional PostgreSQL client certificates under ProtectHome. The service account
now has `/nonexistent` as its home, resolving this without relaxing service hardening.

Live verification passed all 28 application chart queries, authenticated dashboard and
archive routes, unauthenticated API protection, HTTPS ingestion, duplicate retry, and
Neon replication. Only the designated synthetic event was removed afterwards. Neon holds
the existing APK-click row; no real application events had arrived at verification.
Mirror status was synced with zero pending events. GA was subsequently connected and verified; see the Google Analytics section above.

The reviewed deployment layout is:

| Item | Destination |
| --- | --- |
| Patched live admin + reporting modules/HTML | `/opt/hiraia-monitor/` |
| Collector bundle + Linux `better-sqlite3@12.10.0` | `/opt/hiraia-telemetry/` |
| Python dependencies | `/opt/hiraia-analytics-venv/` |
| Telemetry SQLite and local mirror receipts | `/var/lib/hiraia-telemetry/telemetry.db` |
| Existing website DB, read-only for reporting/mirroring | `/var/lib/hiraia/hiraia.db` |
| Private Neon environment file | `/etc/hiraia/telemetry-mirror.env` |

Create an unprivileged `hiraia` service user with home `/nonexistent` and shell `/usr/sbin/nologin`. Collector and mirror run as that user; the
existing admin identity/auth settings are retained. Give admin read access to telemetry.
Install the supplied collector service and mirror service/timer. Add the exact telemetry
nginx location plus its http-context rate zone to both existing Hiraia sites; validate
with `nginx -t` before reload. Preserve timestamped copies of the live admin, service
configuration and nginx files for rollback. Do not run the old install.sh merely to update
this dashboard, because it provisions account configuration.

The existing `/admin` login credentials and training monitor continue to work. Collector
health is loopback-only at `127.0.0.1:8136/health`. Verify authenticated pilot/archive routes,
unauthenticated 401/redirect behavior, public ingestion, one successful Neon copy and zero
pending receipts. Use only a clearly designated synthetic event for the ingestion check,
and remove just that event from both stores afterwards.

## Local verification

```sh
# Node 22, matching the installed native SQLite module
node --import tsx --test tools/pilot-telemetry/*.test.mts
python3 -m unittest discover -s tools/pilot-telemetry -p 'test_*.py' -v
node_modules/.bin/tsc --noEmit -p tools/pilot-telemetry/tsconfig.json
bash tools/pilot-telemetry/build-server.sh
node tools/pilot-telemetry/http-smoke.mjs

# Separately: visibly labeled synthetic preview + browser interaction checks
python3 tools/pilot-telemetry/preview-dashboard.py
python3 tools/pilot-telemetry/test-browser.py
```

The browser test requires Playwright and an installed Chrome (override `CHROME_PATH`).
It checks all eight cards and four periods, active state, chart collapse/row placement,
session event expansion and a 390px viewport. Preview data never enters the real collector
or Neon. Screenshots are in the ignored `build/` directory.

The real Neon smoke test verified a single synthetic event's copy, deduplicated replay,
and restore, then deleted only that test event. No production app events existed at setup.
The existing APK-click record was initially backed up from the local machine and its
restore verified. Continuous mirroring is now deployed on the VPS and verified end to end.

## Shared profiles — 2026-09-06

The collector now accepts profile_kind (student/guest) and a random profile_id for
student events. First-name/name fields remain rejected. The dashboard adds unique
student profiles LTD, a first-recorded-activity time series, and deterministic
adjective-color-animal labels with four-character suffixes in recent sessions.
Guest and legacy events are excluded from the distinct-profile count. Identity is
the pair (installation_id, profile_id); aliases never replace the database key.

Collector and dashboard deployed with successful health checks. Rollback copies:
/opt/hiraia-monitor/archive/profiles-20260906/*.before. Neon mirrors the anonymous
fields through existing JSON event payloads. Updated APKs are required before
profile counts appear. Tests cover profile deduplication, aliases, Guest exclusion,
collector validation and browser chart behavior on desktop and mobile.

Flash-card history now uses event-time grade stacks (Grades 3–10 plus Unknown grade),
including generated views. Per-bucket segment sums match the original totals. Grade
colors stay fixed across ranges. The hero section was removed; Refresh and the
status timestamp sit immediately above the stat cards. Verified with data and browser
tests and deployed; rollback: /opt/hiraia-monitor/archive/grade-chart-20260906/.

Quizzes and correct quizzes also stack by event-time grade. Unique App Sessions
and Unique Student Profiles stack by each identity's first known valid grade across
all recorded history, with Unknown grade for identities lacking a valid grade.
Each identity is counted once at its first event date; profiles exclude Guest.
Changing grades does not multiply unique counts. Late-arriving earlier events can
revise historical attribution. All five charts share fixed grade colors and ranges.
