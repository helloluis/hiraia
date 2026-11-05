# CRM contact cards: release and rollback runbook

Ships CRM API 1.1.0 (`deploy/crm`), then `/admin/crm` (`deploy/vps-monitor`), to the hiraia.org
origin `root@10.77.0.20`. Order matters: the cards fail closed against API 1.0.0. Run it from a
checkout of the release commit, in one shell (`STAMP` names the backup). Stop at the first
unexpected output.

Expected effects: `hiraia-crm` restarts twice (key creation, then the unit step; harvestd retries
502/503); nginx gets a graceful reload with no config change; `hiraia-admin` restarts once. There is
no schema migration, and nothing changes for harvestd, Beaniebot or their keys.

## 0. Setup and pre-flight (read-only)

```bash
cd ~/Code/hiraia/build/crm-contact-cards-20261104        # any clean checkout of the release commit
git status --short; git log -1 --format='%h %s'
REPO=$PWD V=root@10.77.0.20 STAMP=$(date -u +%Y%m%dT%H%M%SZ); echo "$STAMP"
SSH_OPTS=(-o ConnectTimeout=15 -i "$HOME/.ssh/prod_ed25519" -o UserKnownHostsFile="$HOME/.ssh/known_hosts_ovh_guests")
r() { ssh "${SSH_OPTS[@]}" "$V" "$@"; }
r 'systemctl is-active hiraia-crm hiraia-admin nginx; ls /opt/hiraia-crm/server.cjs /opt/hiraia-monitor/admin_app.py'
curl -sS https://hiraia.org/api/crm/health; echo
```

Expect three `active`, both paths, and `{"ok":true}`. If not, stop: the admin does not run on this host.

## 1. Back up (origin)

```bash
r "STAMP=$STAMP bash -s" <<'EOF'
set -e; B=/root/release-crm-cards-$STAMP; install -d -m 700 "$B"
D=; [ -d /etc/systemd/system/hiraia-admin.service.d ] && D=etc/systemd/system/hiraia-admin.service.d
tar -C / -czf "$B/hiraia-monitor.tgz" opt/hiraia-monitor etc/systemd/system/hiraia-admin.service $D
tar -C / -czf "$B/hiraia-crm.tgz" opt/hiraia-crm
cp -p /etc/hiraia-crm/crm.env "$B/crm.env"
systemctl start hiraia-crm-backup.service && tail -n 2 /var/log/hiraia-crm-backup.log
ls -l "$B"
EOF
```

`hiraia-monitor.tgz` is the live admin exactly as it runs now. It includes any Sept 28
assessment-report edits that are live; those are not in Git, only uncommitted in the main checkout.
The archive also holds `config.json` secrets, so keep it root-only and delete it after a clean week.

## 2. CRM API 1.1.0 and the admin's read key (restarts `hiraia-crm`)

```bash
deploy/crm/install.sh "$V"
```

Expect, in order:
- `node runtime ok`;
- `mbp-harvestd: already configured` and `beaniebot: already configured`;
- `hiraia-admin: read key created (fingerprint …)`;
- `hiraia-admin read key -> /etc/hiraia-monitor/crm-admin.key (pickup shredded)`;
- `hiraia-crm.service: active`;
- `location /api/crm/ already present` and `nginx reloaded`;
- a backup line;
- `/api/crm/health 200` and `/api/crm/contacts 401`.

Check the version and the new embed with the admin's key. The key is read on the origin and is
never printed or put on a command line:

```bash
r 'printf "Authorization: Bearer %s\n" "$(cat /etc/hiraia-monitor/crm-admin.key)" | curl -sS -H @- https://hiraia.org/api/crm/status | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[\"version\"], d[\"counts\"][\"contacts\"])"'
r 'printf "Authorization: Bearer %s\n" "$(cat /etc/hiraia-monitor/crm-admin.key)" | curl -sS -H @- "https://hiraia.org/api/crm/contacts?include=threads,latest_extract&limit=1" | python3 -c "import json,sys; c=json.load(sys.stdin)[\"contacts\"]; print(\"embeds ok\" if not c or (\"threads\" in c[0] and \"latest_extract\" in c[0]) else \"MISSING EMBEDS\")"'
```

Expect `1.1.0 <contact count>` and `embeds ok`. Otherwise run R2 and stop.

## 3. Admin files: detect live drift, merge if needed (devbox; reads the origin)

```bash
W=$(mktemp -d) && cd "$W"
for f in admin_app.py admin_chrome.py pilot_dashboard.html; do
  scp "${SSH_OPTS[@]}" -q "$V:/opt/hiraia-monitor/$f" "live.$f"
  git -C "$REPO" show fe454e572:deploy/vps-monitor/$f > "base.$f"
  cp "$REPO/deploy/vps-monitor/$f" "ours.$f"
  if cmp -s "live.$f" "base.$f"; then cp "ours.$f" "$f"; echo "$f: live = base -> ours"
  else git merge-file -p "live.$f" "base.$f" "ours.$f" > "$f"; n=$?; [ $n = 0 ] && echo "$f: drifted -> clean merge" || echo "$f: $n CONFLICT(S) -> STOP"; fi
done
python3 -m py_compile admin_app.py admin_chrome.py && echo compiles
```

Expect no `STOP`. If production runs the Sept 28 assessment edits, `admin_app.py` and
`pilot_dashboard.html` report `drifted -> clean merge` and keep both features. This was rehearsed
against the main checkout's Sept 28 files: the merge was clean, it compiled, and `/admin/crm`, the
assessments route and the Observatory section all served. A conflict means production differs from
both versions: resolve it by hand or stop.

## 4. Admin UI (restarts `hiraia-admin`)

```bash
cp "$REPO"/deploy/vps-monitor/crm_contacts.{py,html,css,js} "$REPO/deploy/vps-monitor/systemd/crm-cards.conf" .
scp "${SSH_OPTS[@]}" -q crm_contacts.py crm_contacts.html crm_contacts.css crm_contacts.js admin_app.py admin_chrome.py pilot_dashboard.html "$V:/opt/hiraia-monitor/"
scp "${SSH_OPTS[@]}" -q crm-cards.conf "$V:/tmp/crm-cards.conf"
r 'bash -s' <<'EOF'
set -e
chmod 755 /opt/hiraia-monitor/*.py
stat -c 'key: %a %U' /etc/hiraia-monitor/crm-admin.key
install -D -m 644 /tmp/crm-cards.conf /etc/systemd/system/hiraia-admin.service.d/crm-cards.conf; rm -f /tmp/crm-cards.conf
cd /opt/hiraia-monitor && python3 -c "import admin_app, crm_contacts; crm_contacts.page('/admin', 'x'); print('imports + page render ok')"
systemctl daemon-reload; systemctl restart hiraia-admin; sleep 2
systemctl is-active hiraia-admin; curl -s -m 5 http://127.0.0.1:8135/admin/health; echo
EOF
```

Expect `key: 600 root`, `imports + page render ok`, `active` and `ok`.

Do not use `deploy/vps-monitor/install.sh` here. It rebuilds `config.json` (new session secret,
RunPod/Resend keys taken from your shell) and defaults to the old Vultr host.

## 5. Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://hiraia.org/admin/api/crm/contacts                 # 401
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://hiraia.org/admin/crm               # 302 …/admin/login
r 'journalctl -u hiraia-admin --since "-10 min" --no-pager | grep -iE "traceback|error" | tail -n 5; journalctl -u hiraia-crm --since "-30 min" --no-pager | grep -c "\"status\":5" | xargs echo "crm 5xx since deploy:"'
```

Expect `401`, `302 https://hiraia.org/admin/login`, no traceback lines and `crm 5xx since deploy: 0`.
Then sign in at https://hiraia.org/admin and open CRM, on both phone and desktop:

- The count equals the CRM's non-test contacts. Cards are newest first, `≈` appears only on
  approximate times, never-contacted records come last, and every card shows its channel chips.
- Search for a known name or school, toggle a channel and a stage, then "Clear all". A reload keeps
  the filters.
- Observatory, Tala reports, Detailed reports and Training still load, including the assessments
  section if it was live before.
- After the next harvestd run (at most 15 min), this shows 2xx:
  `r 'journalctl -u hiraia-crm --since "-20 min" --no-pager | grep mbp-harvestd | tail -n 3'`

Finally, push and merge the release commit so that `main` matches production.

## Rollback

**R1 — admin UI only (restarts `hiraia-admin`).** This is enough when only the page misbehaves,
because CRM 1.1.0 is backward compatible.

```bash
r "STAMP=$STAMP bash -s" <<'EOF'
set -e; B=/root/release-crm-cards-$STAMP
rm -f /etc/systemd/system/hiraia-admin.service.d/crm-cards.conf /opt/hiraia-monitor/crm_contacts.py /opt/hiraia-monitor/crm_contacts.html /opt/hiraia-monitor/crm_contacts.css /opt/hiraia-monitor/crm_contacts.js
tar -C / -xzf "$B/hiraia-monitor.tgz" opt/hiraia-monitor/admin_app.py opt/hiraia-monitor/admin_chrome.py opt/hiraia-monitor/pilot_dashboard.html
systemctl daemon-reload; systemctl restart hiraia-admin; sleep 2; systemctl is-active hiraia-admin
EOF
```

**R2 — CRM back to 1.0.0 and revoke the admin key (restarts `hiraia-crm`).** There was no schema
change, so the database is untouched. Run R1 first if the UI is deployed.

```bash
r "STAMP=$STAMP bash -s" <<'EOF'
set -e; B=/root/release-crm-cards-$STAMP
tar -C / -xzf "$B/hiraia-crm.tgz"
sed -i '/^HIRAIA_CRM_CLIENT_HIRAIA_ADMIN=/d' /etc/hiraia-crm/crm.env; chown root:hiraia /etc/hiraia-crm/crm.env; chmod 640 /etc/hiraia-crm/crm.env
rm -f /etc/hiraia-monitor/crm-admin.key
systemctl restart hiraia-crm; sleep 2; curl -s -m 5 http://127.0.0.1:8137/api/crm/health; echo
EOF
```

Expect `active` (R1) and `{"ok":true}` (R2). After a clean week, delete the backup with
`r "rm -rf /root/release-crm-cards-$STAMP"`.
