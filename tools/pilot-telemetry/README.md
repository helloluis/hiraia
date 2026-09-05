# Pilot telemetry

Implementation: mobile in the **unified** worktree; ingestion, dashboard and deployment
files in **main**. These commits are not a production deployment.
The existing GA website integration is unchanged.

Main includes the existing committed VPS admin/monitor baseline from question-cards
so the authenticated dashboard and its deployment scripts are available. Newer
uncommitted training-monitor edits are excluded.

## Data path

`mobile → files/SQLite/hiraia-telemetry.db → HTTPS /api/telemetry/batch → telemetry.db → /admin/telemetry`

The endpoint implementation can run inside Next.js or as a standalone Node service.
The supplied nginx configuration uses the standalone service on **127.0.0.1:8136**.
This avoids coupling the pilot rollout to the current website's preexisting demo/shared
import errors. The standalone service uses the exact same validation and transaction code.
The authenticated Python monitor reads the SQLite database in read-only mode.

## What the pilot measures

- `first_open`: first launch of the instrumented app on an installation, not APK download
  completion or OS installation. Existing users upgrading to this build also count.
- `session_started`: each process launch; also foregrounding after 30 minutes away.
- `card_viewed`: focused, current page visible for 500 ms, excluding onboarding, rewards,
  preloads and outgoing animation copies. Once per page key during a process, with
  curated/generated source and language. This measures exposure, not proven reading.
- `quiz_shown`, `quiz_answer_submitted`, `quiz_graded`: one multiple-choice question is one
  quiz attempt. Stable attempt/event IDs and a state guard prevent duplicate grading.
  Correctness is collected; selected options, question/answer text and explanations are not.
- Downloads: started/resumed/failed/cancelled/verified-and-installed. Each retry is an
  attempt; a resume retains its byte offset. Cache availability is a separate event.
  Attempt durations include verification; an interrupted process can leave a start without
  an outcome. Do not label these unmatched starts as confirmed failures.
- `model_load_started`, `model_ready`, `model_load_failed`: initialization includes any
  required downloads and local model setup. `model_ready` means LocalEngine initialized,
  not that every background embedding task or first-query warmup has finished.
  CPU is reported for an explicitly selected CPU load; otherwise backend is `unknown`
  because a GPU request is not proof of actual GPU execution.
- Generation: actual card completion stream started/completed/failed, excluding static
  retrieval responses and reward prefetch. Completion does not assert educational quality.
- Image packs: **unified currently has no image-pack downloader**. The common
  `src/telemetry/download.ts` helper accepts `asset_kind: images` and is ready for its
  installer; there are no fabricated image-download events. Existing model, adapter and
  vector transfers are wired. Bundled illustrations are not downloads.
- The website tile reads the existing APK click counter: IP/day deduplicated button clicks,
  not unique phones or completed downloads. It does not cover file sharing/direct URLs.

## Offline and failure behavior

Events go into a separate SQLite file, so telemetry migrations/failures do not break the
learning database. Initial identity, first-open event and startup session are transactional.
Identity is a random pseudonymous installation token, not a hardware identifier or login.
Android backup/cloud/device-transfer rules exclude this database and its sidecars.

Foreground upload checks run every 30 seconds and on foregrounding, honoring persisted
retry time, exponential backoff/jitter and Retry-After. No additional native network SDK
or background service is required. Reconnection during an active session is discovered by
retrying; it is not an immediate network-change notification. No uploads are promised after
force-stop. Requests time out after eight seconds. Each wake sends at most five batches of
50 events. Server acknowledgments are sent only after transaction commit; retries dedupe
on `(installation_id, event_id)`.

The queue retains up to 10,000 events and prunes entries older than 90 days on append.
Pending in-memory writes are bounded too. Loss reports use a cumulative per-installation
counter; the dashboard takes each installation's maximum, not a sum of repeated snapshots.
Disk failures can still prevent recording, and an uninstall/never-reconnected phone can
lose unsent data. Queue loss cannot be observed until that phone uploads a report.

The settings switch clears unsent events and disables future collection across restarts.
A request already committed by the server cannot be recalled by switching off. Switching
back on resumes collection with the same installation ID. No analytics credentials,
child names, question/answer text, generated text or precise location are sent.

The schema is an allowlist: arbitrary properties are rejected. Ingestion is public and
write-only; client data is untrusted, not fraud-proof. Nginx and the handler bound request
size/rate. No raw IP or request body is persisted by this service; nginx access logging is
turned off for this endpoint. Do not expose the loopback ingestion port to the Internet.

The dashboard supports 7/30/90 days, event-time UTC grouping, delayed-event counts, sync
recency, card language/source, download outcomes, model timing, Android/RAM/build grouping,
and returning installations (sessions on more than one UTC date in the selected period).
There is no cross-site attribution join and no claim that installations equal children.

## Validation

Use Node 22 with dependencies installed for that runtime (including the native
`better-sqlite3` module). From the main repository root (override PILOT_MOBILE_PATH if needed):

```sh
node --import tsx --test tools/pilot-telemetry/*.test.mts
python3 -m unittest discover -s tools/pilot-telemetry -p 'test_*.py' -v
node_modules/.bin/tsc --noEmit -p tools/pilot-telemetry/tsconfig.json
bash tools/pilot-telemetry/build-server.sh
node tools/pilot-telemetry/http-smoke.mjs
```

Mobile type-check from unified:

```sh
node_modules/.bin/tsc --noEmit --incremental false -p packages/mobile/tsconfig.json
```

Host tests exercise actual SQLite statements with a thin Expo API adapter, not Expo's native
bridge. Delivery tests cover offline/restart/lost acknowledgments, late events, partial
acknowledgments, rejection handling, storage limits, corrupt JSON and persistent opt-out.
The HTTP smoke test starts a temporary loopback service/database, verifies real POSTs and
retry deduplication, and removes them afterwards. Python tests cover reporting and auth.

## Deployment recipe (not executed)

1. Build the standalone artifact with `bash tools/pilot-telemetry/build-server.sh`.
   Ship `packages/web/.telemetry/server.cjs` alongside the web package's installed
   `better-sqlite3` dependency, compiled for the VPS architecture/Node version. Do not copy
   a macOS native module to Linux. The service requires Node 22 or later.
2. Review `hiraia-telemetry.service`: set the real checkout path, service user and Node
   binary. Create its private state directory. Use the **same absolute**
   `HIRAIA_TELEMETRY_DB_PATH` in this service and the Python admin service. Give admin read
   access to the directory, database and WAL sidecars; keep SQLite on local disk.
3. Ship both `deploy/vps-monitor/admin_app.py` and `pilot_analytics.py`. Preserve the
   existing admin configuration/session secret. Optionally set `HIRAIA_DB_PATH` on admin
   to the website database for its click counter. Missing configuration shows Unavailable.
4. Install/start the telemetry service. Check loopback `/health`. Apply the exact telemetry
   location and `limit_req_zone` from `deploy/nginx/hiraia.org.conf`; run `nginx -t` before
   reload. The zone directive belongs in the nginx **http** context. Restart admin.
5. Verify public HTTPS ingestion using a clearly designated smoke-test installation and
   confirm `/admin/telemetry` requires login. Remove only that synthetic installation's
   rows afterwards. No production endpoint test has been run by this implementation.
6. Build the pilot APK in unified with a unique `EXPO_PUBLIC_BUILD_ID`. The default endpoint
   is `https://hiraia.org/api/telemetry/batch`; use `EXPO_PUBLIC_TELEMETRY_URL` for an HTTPS
   staging collector. New builds must keep the backup-exclusion plugin. Native libraries
   must be present before using the local `-x :react-native-bare-kit:link` build shortcut.
7. Test the final APK: offline launch/card use/quiz, force-stop/relaunch, reconnect and verify
   a single count per event, then opt out and confirm the local queue is cleared. A short
   airplane-mode test on a real budget phone remains valuable before distributing widely.

Retention: schedule `python3 tools/pilot-telemetry/prune.py --db /absolute/telemetry.db`
under the writer account, daily. Default is 180 days **since receipt**, so late offline
activity is retained for a full period. It removes history and deduplication records;
never set retention shorter than the client queue window. Use SQLite's backup API for
live backups rather than copying only the main file while WAL writes are active.

## Verified local build · 2026-09-05

- Test APK: `build/hiraia-pilot-telemetry.apk`, 310,123,948 bytes, Android API 29 minimum,
  ARM64 only, versionCode 2. **Debug-signed**, for testing; use the established release
  signing procedure and appropriate versionCode before public distribution.
- SHA-256: `b4434b024e42b5a90e4b0ad962e6ec2fb84a0fcd0cbff2833606047f62490d31`.
- Full Gradle release build passed, including lint and packaged backup exclusions.
- 15 JavaScript/TypeScript tests and 4 Python tests pass. Mobile and isolated telemetry
  TypeScript checks pass. The standalone collector passes a real loopback HTTP smoke test.
- Android 10 ARM64 emulator: offline first launch, curated card viewing and quiz grading
  worked. The 21 queued records survived force-stop; relaunch produced 23 records, with
  exactly one first_open, two sessions and one grading despite repeated answer taps.
  The actual Android records passed server validation; replay did not duplicate them.
- Native opt-out cleared the queue and remained disabled after a further restart.
- Compiled APK manifest and XML resources retain the cloud/backup/device-transfer exclusions.
- `build/dashboard-demo.html` and `.png` are a browser-rendered preview with **synthetic
  demo data**, not pilot-user results. Native screenshots and JSON verification reports
  are beside them. No physical phone was used and no live server was changed.

The large image catalogue exposed a preexisting Metro asset-index bottleneck. A release-only
adapter in unified, `packages/mobile/scripts/metro-static-asset-cache.cjs`, shares one
immutable directory index per platform for the duration of that process. A regression test
compares original/cached Metro hashes, scales, files and platform choices. It does not patch
node_modules and must NOT be loaded into a development watcher.

The successful build command from unified was:

```sh
EXPO_PUBLIC_BUILD_ID=pilot-telemetry-20260905 \
NODE_OPTIONS="--max-old-space-size=8192 --require $PWD/packages/mobile/scripts/metro-static-asset-cache.cjs" \
bash packages/mobile/scripts/build-apk.sh -x :react-native-bare-kit:link
```

Metro bundled 14,040 modules in 17.5 seconds; the complete Gradle build took 2m16s.
The native link task was skipped because this worktree already had the QVAC native artifacts.
