# CRM contact fields and first contact: release, backfill and rollback runbook

**Released 2026-11-05, 02:21–02:24 UTC**, from `1548e45b9` (the merge of `7a508f5ec` onto
`264508134`), run from the devbox `b11-dev`. It replaced CRM API 1.1.0 and the `/admin/crm` cards
from `6f30ce6c0` (see [`RELEASE-CRM-CONTACT-CARDS.md`](RELEASE-CRM-CONTACT-CARDS.md)).

Release record:
- **Backup:** `/root/release-crm-fields-20261105T022101Z`, so `STAMP=20261105T022101Z` for the
  rollback below.
- **CRM backup artifacts:**
  - `hiraia-crm-20261105T022134Z`, taken before the release; a verified copy is on the devbox in
    `~/release-crm-fields-20261105/offhost/`;
  - `hiraia-crm-20261105T022157Z`, taken by the installer after migration 002.
- **Data steps:**
  - The reconcile changed exactly the 5 contacts listed in step 3. Its backup, for R2, is
    `/var/lib/hiraia-crm/maintenance/reconcile-notes-2026-11-05T022223634Z.json`.
  - The backfill wrote 12 evidence rows from `/var/lib/hiraia-crm/maintenance/first-contact-20261105T022101Z.json`.
    Result: 3 exact, 9 approximate and 7 unavailable first contacts across 19 contacts, plus 7
    threads with a first message.
  - Both files belong to `hiraia` (0600). A re-run of either step changes nothing.
- **Checks:**
  - no drift in the live admin files;
  - keys unchanged (`hiraia-admin` fingerprint `c7c399f2f4e1`);
  - no admin errors and no CRM 5xx after the release.
- **Devbox:** it had no checkout, so the run used a checksummed `git archive` of the release commit,
  plus the `6f30ce6c0` copies of `crm_contacts.*` as the step 5 drift baseline.

This runbook ships three things in order. Stop at the first unexpected output.

1. **CRM API 1.2.0** (`deploy/crm`):
   - migration `002-contact-profile.sql` (additive: three new tables, nothing altered);
   - profile fields, phones and e-mails on contacts;
   - `POST /first-message-evidence`;
   - the derived `first_contact`;
   - `maintenance.cjs`.
2. **Data:**
   - the manual notes are reconciled into structured fields;
   - first contacts are backfilled from the MBP's capture store.
   Both are dry runs first, and both can be undone without a database restore.
3. **`/admin/crm`**: only `crm_contacts.{py,html,css,js}`. `admin_app.py`, `admin_chrome.py` and
   `pilot_dashboard.html` are untouched, so the live Sept 28 assessment-report edits need no merge.

**Why this order:**
- The 1.1 admin now in production works unchanged against API 1.2. This was rehearsed: the same
  cards appeared and no new field leaked to them.
- The 1.2 admin fails closed against API 1.1 ("The CRM API is older than 1.2").

**Expected effects:**
- `hiraia-crm` restarts once, from the installer. harvestd retries any 502/503 it gets.
- nginx gets a graceful reload with no config change.
- `hiraia-admin` restarts once.
- Nothing changes for harvestd's or Beaniebot's keys or payloads, since 1.1 requests are answered
  as before.

Run everything except step 4a from the devbox `b11-dev`, in one shell and in a checkout of the release
commit. The devbox holds the prod key; the origin is not reachable from the Mac.

## 0. Setup and pre-flight (read-only)

```bash
cd ~/Code/hiraia                                      # a clean checkout of the release commit
git status --short; git log -1 --format='%h %s'
(cd deploy/crm && npm ci && npm test)                 # 27 tests, all pass
REPO=$PWD V=root@10.77.0.20 STAMP=$(date -u +%Y%m%dT%H%M%SZ); echo "$STAMP"
SSH_OPTS=(-o ConnectTimeout=15 -i "$HOME/.ssh/prod_ed25519" -o UserKnownHostsFile="$HOME/.ssh/known_hosts_ovh_guests")
r() { ssh "${SSH_OPTS[@]}" "$V" "$@"; }       # feeds a heredoc script to the origin
rc() { ssh -n "${SSH_OPTS[@]}" "$V" "$@"; }   # one command; never reads stdin
rc 'systemctl is-active hiraia-crm hiraia-admin nginx; ls /opt/hiraia-crm/server.cjs /opt/hiraia-monitor/crm_contacts.py'
r 'bash -s' <<'EOF'
crm() { printf "Authorization: Bearer %s\n" "$(cat /etc/hiraia-monitor/crm-admin.key)" | curl -sS -H @- "https://hiraia.org/api/crm$1"; }
crm /status | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["version"], "migrations", d["migrations"], "contacts", d["counts"]["contacts"], "backup stale", d["backup"].get("stale"))'
EOF
```

Expect:
- three `active` lines and both paths;
- `1.1.0 migrations 1 contacts <N> backup stale False`.

Note N. It counts test records, which the lists and cards leave out: at release time 21 records,
of which 2 are test records, so 19 cards. Every command reads the admin's key on the origin, and no key is ever printed or put on a
command line.

## 1. Back up (origin)

```bash
r "STAMP=$STAMP bash -s" <<'EOF'
set -e; B=/root/release-crm-fields-$STAMP; install -d -m 700 "$B"
tar -C / -czf "$B/hiraia-crm.tgz" opt/hiraia-crm
tar -C / -czf "$B/admin-crm-files.tgz" opt/hiraia-monitor/crm_contacts.py opt/hiraia-monitor/crm_contacts.html opt/hiraia-monitor/crm_contacts.css opt/hiraia-monitor/crm_contacts.js
systemctl start hiraia-crm-backup.service && tail -n 2 /var/log/hiraia-crm-backup.log
ls -l "$B"; ls -t /var/backups/hiraia-crm/daily/*.tar.gpg | head -n 1
EOF
A=$(rc 'ls -t /var/backups/hiraia-crm/daily/*.tar.gpg | head -n 1'); echo "$A"
scp "${SSH_OPTS[@]}" -q "$V:$A" "$V:$A.sha256" ~/      # off-host copy: offsite backups are still unconfigured
```

Expect a backup line ending in `ok` and two archives. The `.tar.gpg` is encrypted, and its
passphrase stays in `/etc/hiraia-crm/backup.passphrase` and the password manager. This artifact is
the last-resort restore point (see Rollback R4).

## 2. CRM API 1.2.0 (restarts `hiraia-crm`; migration 002 runs at start)

```bash
deploy/crm/install.sh "$V"
```

Expect, in order:
- `node runtime ok`;
- `backup passphrase kept`;
- `mbp-harvestd`, `beaniebot` and `hiraia-admin`: `already configured (fingerprint …)`;
- `hiraia-crm.service: active`;
- loopback health `{"ok":true}`;
- `location /api/crm/ already present` and `nginx reloaded`;
- a backup line;
- `/api/crm/health 200 (want 200)` and `/api/crm/contacts 401 (want 401)`.

```bash
r 'bash -s' <<'EOF'
crm() { printf "Authorization: Bearer %s\n" "$(cat /etc/hiraia-monitor/crm-admin.key)" | curl -sS -H @- "https://hiraia.org/api/crm$1"; }
crm /status | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d["counts"]; print(d["version"], "migrations", d["migrations"], "contacts", c["contacts"], "profiles", c["contact_profiles"], "points", c["contact_points"], "evidence", c["first_message_evidence"])'
crm "/contacts?include=threads,latest_extract,contact_points&limit=200" | python3 -c 'import json,sys; c=json.load(sys.stdin)["contacts"]; print("1.2 fields ok" if all(k in x for x in c for k in ("phones","emails","organization","first_contact")) else "MISSING 1.2 FIELDS", len(c))'
EOF
```

Expect:
- `1.2.0 migrations 2 contacts <N> profiles 0 points 0 evidence 0`;
- `1.2 fields ok <N minus test records>`.

The live `/admin/crm` (still 1.1) keeps working. On any other output, run R3 and stop.

## 3. Manual notes → structured fields (origin; dry run, review, apply)

```bash
rc 'runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs reconcile-notes'
```

The output is masked: phones appear as "E.164 phone, 12 digits", never as digits. The dry run on the
5 Nov notes snapshots proposed the changes below; production may differ if a note changed since.

| Contact | Proposed change (the values print on the origin; they are kept out of this public repo) |
| --- | --- |
| #9 | `+ organization` (manual_note; stated as Affiliation) |
| #10 | `+ location` (manual_note; stated as Location) |
| #19 | `+ job_title` (google_contacts) and `+ phone` (google_contacts, 1 entry); notes rewritten |
| #20 | `+ phone` (from national format, 2 Google Contacts entries); notes rewritten |
| #21 | `+ phone` (google_contacts) and `+ organization "Department of Education (DepEd)"` (manual_note: her organization, not her school); notes rewritten |
| #5, #16 | `= nothing to reconcile` |

Every harvested contact (its notes are the classified summary) should show
`= nothing to reconcile`. Stop and review if:
- any other `+` line appears;
- a `· … already set to a different value (kept)` line appears;
- a `! notes still hold … phone-like` line appears.

Then apply:

```bash
rc 'runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs reconcile-notes --apply' | tail -n 1
rc 'runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs reconcile-notes' | tail -n 1
```

Expect:
- `… 5 changed (backup of the originals: /var/lib/hiraia-crm/maintenance/reconcile-notes-<UTC>.json)`;
- then `… 0 would change`.

**Write the backup path down: R2 needs it.** That file (hiraia, 0600) holds the original notes,
including the phone numbers.

## 4. First-contact backfill

**4a. On the MBP** (Luis's Mac), in a checkout of the release commit. This reads the self-snooper
databases read-only and sends nothing:

```bash
python3 deploy/crm/tools/first_contact_evidence.py --out ~/first-contact-bundle.json
scp ~/first-contact-bundle.json b11-dev:first-contact-bundle.json && rm ~/first-contact-bundle.json
```

Expect the coverage report. The 5 Nov dry run gave 19 contacts:
- 3 exact;
- 9 approximate;
- 7 unavailable: group-only participants #9, #10, #12, #13 and #14, and the manual #20 and #21.

The bundle holds 12 items. It can grow if harvestd has linked more conversations since.

**4b. On the devbox:** stage the bundle on the origin for the service user, then run a dry run:

```bash
scp "${SSH_OPTS[@]}" -q ~/first-contact-bundle.json "$V:/root/first-contact-bundle.json" && shred -u ~/first-contact-bundle.json
r "STAMP=$STAMP bash -s" <<'EOF'
set -e; F=/var/lib/hiraia-crm/maintenance/first-contact-$STAMP.json
install -d -o hiraia -g hiraia -m 700 /var/lib/hiraia-crm/maintenance
install -o hiraia -g hiraia -m 600 /root/first-contact-bundle.json "$F" && shred -u /root/first-contact-bundle.json
runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs apply-first-contact "$F"
EOF
```

Expect:
- one line per item ending in `-> create`;
- `12 item(s): 12 would write, 0 rejected — dry run`.

A `rejected (…)` line means a contact was renamed or merged, or a thread moved, since the bundle was
made. Stop and find out why before applying. Then apply and confirm that the step is idempotent:

```bash
rc "runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs apply-first-contact /var/lib/hiraia-crm/maintenance/first-contact-$STAMP.json --apply"
rc "runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs apply-first-contact /var/lib/hiraia-crm/maintenance/first-contact-$STAMP.json" | tail -n 1
```

Expect:
- one `first_contact #<id> <name>: <UTC time> <quality>/<basis> via <platform>` line per contact;
- `12 applied`;
- then `0 would write`.

The rule is monotonic: re-running a bundle, or a newer one later, can only confirm a first contact
or move it earlier on stronger evidence.

## 5. Admin UI (restarts `hiraia-admin`)

```bash
W=$(mktemp -d) && cd "$W"
for f in crm_contacts.py crm_contacts.html crm_contacts.css crm_contacts.js; do
  scp "${SSH_OPTS[@]}" -q "$V:/opt/hiraia-monitor/$f" "live.$f"
  git -C "$REPO" show 6f30ce6c0:deploy/vps-monitor/$f > "base.$f"
  cmp -s "live.$f" "base.$f" && echo "$f: live = 6f30ce6c0" || echo "$f: DRIFTED -> STOP"
  cp "$REPO/deploy/vps-monitor/$f" "$f"
done
python3 -m py_compile crm_contacts.py && echo compiles
rc 'install -d -m 700 /root/crm-admin-stage'
scp "${SSH_OPTS[@]}" -q crm_contacts.py crm_contacts.html crm_contacts.css crm_contacts.js "$V:/root/crm-admin-stage/"
r 'bash -s' <<'EOF'
set -e; S=/root/crm-admin-stage
PY=/opt/hiraia-analytics-venv/bin/python; [ -x "$PY" ] || PY=python3   # the interpreter in hiraia-admin's ExecStart
cd "$S"
PYTHONPATH=/opt/hiraia-monitor $PY -c "import crm_contacts, os; assert os.path.dirname(os.path.abspath(crm_contacts.__file__)) == '$S'; crm_contacts.page('/admin', 'x'); print('staged page render ok')"
HIRAIA_CRM_BASE_URL=https://hiraia.org/api/crm HIRAIA_CRM_API_KEY_FILE=/etc/hiraia-monitor/crm-admin.key PYTHONPATH=/opt/hiraia-monitor $PY -c "
import collections, crm_contacts
d = crm_contacts.directory(); cs = d['contacts']
q = collections.Counter((c['first_contact'] or {}).get('quality', 'unavailable') for c in cs)
print('live data path ok:', d['total'], 'contacts; first contact', dict(q), '; organization', sum(bool(c['organization']) for c in cs), '; phones', sum(len(c['phones']) for c in cs))"
install -m 755 crm_contacts.py /opt/hiraia-monitor/crm_contacts.py
install -m 644 crm_contacts.html crm_contacts.css crm_contacts.js /opt/hiraia-monitor/
cd / && rm -rf "$S"
systemctl restart hiraia-admin; sleep 2
systemctl is-active hiraia-admin; curl -s -m 5 http://127.0.0.1:8135/admin/health; echo
EOF
```

Expect:
- four `live = 6f30ce6c0` lines and `compiles`;
- `staged page render ok`;
- `live data path ok: <N> contacts; first contact {…}`, with aggregate counts only and 12
  contacts with a first contact unless 4a found more;
- `organization 2`;
- `phones 3`;
- `active`;
- `ok`.

A `DRIFTED` line means production differs from the deployed commit: stop and compare. If a check
fails, `set -e` stops before the install and the old admin keeps serving untouched files.

Do not use `deploy/vps-monitor/install.sh` here. It rebuilds `config.json`, with a new session
secret and keys taken from your shell.

## 6. Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://hiraia.org/admin/api/crm/contacts                 # 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://hiraia.org/admin/crm               # 302 …/admin/login
rc 'journalctl -u hiraia-admin --since "-10 min" --no-pager | grep -iE "traceback|error" | tail -n 5; journalctl -u hiraia-crm --since "-30 min" --no-pager | grep -c "\"status\":5" | xargs echo "crm 5xx since deploy:"'
```

Expect `401`, `302 https://hiraia.org/admin/login`, no traceback lines and `crm 5xx since deploy: 0`.
Then sign in at https://hiraia.org/admin → CRM, on phone and desktop, and check:

- Card faces show the affiliation line (job title or role · organization · school):
  - #21's shows DepEd as the organization, with no school;
  - #19's leads with its job title rather than the pipeline role.
- Backfilled contacts show a **First contact** line: a date, `≈ date` or `by date`. Others show none.
- **Details** shows phones as tap-to-call links with "from Google Contacts", the first-contact
  provenance, and each thread's first message. No Google Contacts link or id appears anywhere.
- Search "deped", "metrobank" and a first-contact month ("sep 2026"), and sort by "First contact
  (earliest)". A reload keeps the view.
- After the next harvestd run (at most 15 min), this shows 2xx:
  `rc 'journalctl -u hiraia-crm --since "-20 min" --no-pager | grep mbp-harvestd | tail -n 3'`

Finally:
- Merge the release commit so that `main` matches production.
- After a clean week:
  - delete the release backup;
  - shred the maintenance files, since the reconcile backup holds the original notes with the phone
    numbers.

  ```bash
  rc "rm -rf /root/release-crm-fields-$STAMP; shred -u /var/lib/hiraia-crm/maintenance/*.json"
  ```

## Rollback

Undo in reverse order and only as far as needed. All the undo commands are dry runs until `--apply`.

**R1: admin UI only (restarts `hiraia-admin`).** Enough when only the page misbehaves.

```bash
r "STAMP=$STAMP bash -s" <<'EOF'
set -e; tar -C / -xzf /root/release-crm-fields-$STAMP/admin-crm-files.tgz
systemctl restart hiraia-admin; sleep 2; systemctl is-active hiraia-admin
EOF
```

**R2: data (no restart; needs CRM 1.2).** This removes only what the steps wrote:
- `revert-first-contact` deletes the bundle's evidence rows that maintenance wrote. Rows written or
  since improved by another client stay.
- `revert-reconcile` puts back exactly what the reconcile changed, and only where nothing has
  changed since. Notes that harvestd replaced, and numbers or fields edited by hand, stay and are
  reported.

Each undo is written to `events`. Run both commands as dry runs, read them, then repeat each with
`--apply`:

```bash
rc "runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs revert-first-contact /var/lib/hiraia-crm/maintenance/first-contact-$STAMP.json"
rc 'runuser -u hiraia -- node /opt/hiraia-crm/maintenance.cjs revert-reconcile /var/lib/hiraia-crm/maintenance/reconcile-notes-<UTC>.json'
```

**R3: CRM code back to 1.1.0 (restarts `hiraia-crm`).**
- Run R1 first if the new admin is deployed.
- The database keeps the three 1.2 tables. 1.1.0 ignores them: this was rehearsed, and it boots,
  lists and reports `migrations 1`. A later 1.2.0 start reuses them as they are.
- Run R2 before R3 if the data should go too, because R2 needs 1.2's `maintenance.cjs`.

```bash
r "STAMP=$STAMP bash -s" <<'EOF'
set -e; rm -f /opt/hiraia-crm/maintenance.cjs /opt/hiraia-crm/migrations/002-contact-profile.sql
tar -C / -xzf /root/release-crm-fields-$STAMP/hiraia-crm.tgz
systemctl restart hiraia-crm; sleep 2; curl -s -m 5 http://127.0.0.1:8137/api/crm/health; echo
EOF
```

**R4: last resort, a full database restore.** Use the artifact from step 1, following
`deploy/crm/README.md` → Restore: verify-only first, then live. This discards every CRM write since
step 1, including harvestd's, so prefer R2.

Expect `active` (R1), the dry-run listings and then `… reverted` / `… deleted` (R2), and
`{"ok":true}` (R3).
