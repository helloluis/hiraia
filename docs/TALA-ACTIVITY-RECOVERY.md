# Tala activity reporting and reinstall recovery

Implemented on `hiraia-unified` after Hiraia 0.4.17 / Tala 0.4.1. Those published
APKs do not contain this change. Deploy the server changes and release updated
APKs for both apps to enable the complete workflow.

## Teacher upload provenance

Previously, Tala uploaded teacher issue reports but kept collected student
activity only on the teacher phone. It now keeps a durable, separate activity
relay ledger in SQLite. The Nearby acceptance and relay insert commit together;
acknowledging the student does not depend on internet availability.

Tala uploads at most 50 events from one student installation/class per request to
`/api/telemetry/batch`. Android jobs wait for internet, retry failures with backoff,
and survive a reboot. Each wake processes at most 20 batches. A periodic job
also checks for pending work every 15 minutes (Android may defer execution).
HTTP `Retry-After` is respected. Lost replies leave events pending. Partial ACKs
clear only the named records; rejected events remain recorded separately and
remain visible in the local classroom. Settings shows delivery totals.

The request retains the **student** `installation_id` and original event IDs.
Separate metadata identifies `reporter.app=tala`, a durable teacher installation
UUID, and the teacher app version. Names, roster entries, class/school titles,
answers, and free text are not included in this activity upload. The existing
teacher-authored issue-report workflow is separate.

The server stores provenance in `telemetry_deliveries`, keyed by event and
reporter. It still counts each `(student installation_id,event id)` once in
`telemetry_events`, whether a direct student upload or a teacher relay arrives
first. It preserves the first accepted event payload. A second delivery receipt
does not add an activity. These labels are client-declared provenance, not proof
of teacher authentication. Legacy unlabelled requests are the Hiraia student
path; existing historical rows are not retroactively assigned a reporter.

The protected pilot dashboard's event detail shows **Tala teacher app** or
**Hiraia student app**, reporter ID, and reconstructed-history status. The Neon
mirror and restore include these receipts independently of event receipts, so
teacher provenance added after a direct upload is still copied.

Tala requires `reporter_recorded=true` before acknowledging a server upload.
Against an older server it retains and retries the upload until the new server
can record its provenance. Do not release the new APK before upgrading ingestion.

## Reinstall/new teacher phone

1. Install Tala and recreate the teacher's classes.
2. Open the relevant class QR and start monitoring.
3. Each student scans that new QR (or uses the teacher's pairing code) in Hiraia.
   A fresh installation has new keys; a matching class/teacher name is not enough
   to trust a new phone. Existing data cannot restore the lost private key.
4. Hiraia automatically sends retained card-view and quiz-result history in
   batches of 50, alongside newly queued activity. Keep the apps open and nearby.
   Interrupted recovery resumes in later syncs without restarting the history.

Student learning history survives both mothership and teacher delivery ACKs.
Changing the class/public-key binding atomically resets teacher delivery state;
scanning the same unchanged QR does not replay acknowledged history. Old receiver
ACKs cannot clear the replacement receiver's queue. Recovery pages directly from
retained history rather than placing an entire semester in the bounded outbox.
Telemetry opt-out prevents replay, just as it prevents ordinary teacher sync.

All retained card/quiz dates, original IDs, available grades/languages and profile
IDs are recovered, including records older than seven days or a year. Exact
learning-event payloads/session IDs are retained from this update onward and
backfilled from existing queues where available. Older compact records may lack
original session IDs or other metadata: these are explicitly marked reconstructed
and use the student installation ID as the legacy session placeholder. Do not
interpret that placeholder as a measured learning session. Missing grades are
not inferred from the student's current grade. Missing profile names appear as
“Recovered student” until that profile's roster information is available.

Recovery cannot recreate records already absent from the student's phone, a
student app that was itself erased, or teacher-only data such as issue reports,
class settings and school metadata. It restores learning history, not a full
backup of a teacher installation. Other operational events (downloads, model
loads, etc.) have their existing bounded queues; they are not lifetime archives.

## Rollout and verification

- Server: update/restart whichever process hosts telemetry ingestion (standalone
  telemetry server or Next), the protected admin dashboard, and the Neon mirror.
  New tables are additive; preserve the existing databases and backup first.
- Tala SQLite v8 upgrades old classroom databases without removing classes,
  events, issues, avatars, or keys. Existing collected events enter the relay as
  reconstructed because older Tala discarded original session IDs.
- Release both APKs with increasing Android version codes. No version bump,
  production deployment, or public APK replacement is part of this code change.
- Tests cover real student SQLite recovery across ACK/rebind/restart, same-QR
  idempotence, opt-out, exact and legacy payloads; both server delivery orders;
  dashboard labels; independent mirror receipts/reconciliation; native migration,
  privacy allowlisting, offline/lost ACK, partial ACK and permanent rejection.
