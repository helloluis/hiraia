#!/usr/bin/env python3
"""Local, synthetic preview of /admin/crm. No production access and no real data.

Starts the real CRM API (deploy/crm/server.cjs) on loopback with a throwaway database and
throwaway keys, seeds it through its own POST API with the invented contacts in
crm_fixture.json (shaped like harvestd's exports), then starts the real admin app pointed at it
with a read-scoped key, signs in once to check the data path, and waits. Ctrl-C stops both and
deletes the temporary directory.

    (cd deploy/crm && npm ci)                                   # once: installs better-sqlite3
    python3 deploy/vps-monitor/preview/crm_cards_preview.py     # prints the URL and a sign-in
    python3 deploy/vps-monitor/preview/crm_cards_preview.py --check   # seed, verify, exit
"""
import argparse
import hashlib
import http.cookiejar
import json
import os
import secrets
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
MONITOR = HERE.parent
CRM_DIR = MONITOR.parent / "crm"
MODEL = "qwen2.5:14b-instruct-q4_K_M"
UNITS = {"m": "minutes", "h": "hours", "d": "days"}
PROFILE = ("organization", "department", "job_title", "location")
RANK = {"exact": 0, "approximate": 1, "message_timestamp": 0, "relative_label": 1, "first_observed": 2}


def at(offset, now):
    """'-2h' / '-90m' / '-3d' relative to now, as the CRM's ISO UTC form."""
    moment = now + timedelta(**{UNITS[offset[-1]]: float(offset[:-1])})
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def evidence_of(item):
    """The fixture's first-message evidence for one contact: per thread, plus linked conversations without a thread."""
    return [dict(t["first_message"], key=t["key"], platform=t["app"], thread_key=t["key"],
                 kind="group" if t["thread_name"].startswith("Group ") else "direct")
            for t in item.get("threads", []) if "first_message" in t] + item.get("local_evidence", [])


def wait_for(url, process, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise SystemExit(f"process for {url} exited with {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError):
            time.sleep(0.2)
    raise SystemExit(f"timed out waiting for {url}")


def post(base, key, path, body, idempotency_key):
    request = urllib.request.Request(f"{base}{path}", data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Idempotency-Key": idempotency_key})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read())


def seed(base, key, db_path, fixture, now):
    """Write every fixture contact through the API, then backdate the CRM's own write times.

    The API stamps server time on each write; a preview seeded in one second would show every
    summary as synced "today". Backdating created_at/updated_at in this throwaway database makes
    the cards look like a CRM that has been running for weeks. Production data is never touched.
    """
    provenance = fixture["provenance"]
    backdate = []
    for n, item in enumerate(fixture["contacts"], 1):
        spec = dict(item["contact"])
        extracts = item.get("extracts", [])
        latest = extracts[-1] if extracts else None

        def summary(extract):
            lines = [extract["summary"]] + ([provenance["ocr"]] if extract.get("ocr") else []) \
                + ([provenance["approximate"]] if extract["approximate"] else [])
            return "\n".join(lines)

        if latest:
            spec["notes"] = summary(latest)          # harvestd sends notes = the formatted summary
        for field in ("last_contact",):
            if field in spec:
                spec[field] = at(spec[field], now)
        contact = post(base, key, "/contacts", spec, f"preview:contact:{n}")
        cid = contact["id"]
        threads = {}
        for t in item.get("threads", []):
            body = {"contact_id": cid, "app": t["app"], "thread_name": t["thread_name"]}
            if "last_seen" in t:
                body["last_seen"] = at(t["last_seen"], now)
            threads[t["key"]] = post(base, key, "/threads", body, f"preview:thread:{n}:{t['key']}")["id"]
            backdate.append(("UPDATE threads SET created_at=?, updated_at=? WHERE id=?",
                             (at(t["synced"], now), at(t["synced"], now), threads[t["key"]])))
        # First-message evidence (CRM 1.2), per thread and for linked conversations without a CRM thread.
        for ev in evidence_of(item):
            body = {"contact_id": cid, "evidence_key": f"preview:{n}:{ev['key']}", "platform": ev["platform"],
                    "conversation_kind": ev["kind"], "first_message_at": at(ev["at"], now), "quality": ev["quality"],
                    "basis": ev["basis"], "direction": ev.get("direction", "unknown")}
            if ev.get("thread_key"):
                body["thread_id"] = threads[ev["thread_key"]]
            post(base, key, "/first-message-evidence", body, f"preview:evidence:{n}:{ev['key']}")
        for e_n, e in enumerate(extracts, 1):
            extracted = {"summary": summary(e), "next_action": e["next_action"], "dates": e["dates"],
                         "classified_stage": e["stage"], "export_id": sha(f"export:{n}:{e_n}"),
                         "policy_version": e.get("policy", "school-business-v4"),
                         "source_checkpoint": sha(f"checkpoint:{n}:{e_n}"), "classification_run": 100 + n * 10 + e_n,
                         "last_contact_approximate": e["approximate"]}
            conversation = "conv_" + sha("%s:%s" % (n, e["thread"]))[:16]     # opaque, like harvestd's IDs
            body = {"contact_id": cid, "thread_id": threads[e["thread"]], "source_thread": conversation,
                    "model_version": MODEL, "extracted_json": extracted}
            eid = post(base, key, "/extracts", body, f"preview:extract:{n}:{e_n}")["id"]
            backdate.append(("UPDATE extracts SET created_at=? WHERE id=?", (at(e["synced"], now), eid)))
        updated = max([at(item["synced"], now)] + [at(e["synced"], now) for e in extracts])
        backdate.append(("UPDATE contacts SET created_at=?, updated_at=? WHERE id=?", (at(item["synced"], now), updated, cid)))
    with sqlite3.connect(db_path, timeout=10) as db:
        for sql, params in backdate:
            db.execute(sql, params)
    return len(fixture["contacts"])


def check(origin, email, password):
    """Sign in like a browser and read the cards endpoint once."""
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    form = urllib.parse.urlencode({"email": email, "password": password}).encode()
    opener.open(f"{origin}/admin/login", data=form, timeout=10).close()
    session = next((c.value for c in jar if c.name == "hiraia_sess"), None)
    if not session:
        raise SystemExit("preview sign-in failed: no session cookie")
    # The cookie is Secure; cookiejar will not send that over plain-http loopback (browsers do on localhost).
    request = urllib.request.Request(f"{origin}/admin/api/crm/contacts", headers={"Cookie": f"hiraia_sess={session}"})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.loads(response.read())
    if not data.get("ok"):
        raise SystemExit(f"cards endpoint failed: {data}")
    states, platforms = {}, {}
    for card in data["contacts"]:
        states[card["activity"]["state"]] = states.get(card["activity"]["state"], 0) + 1
        for channel in card["channels"]:
            platforms[channel["platform"]] = platforms.get(channel["platform"], 0) + 1
    return data, states, platforms


def verify(cards, fixture, now):
    """Compare the 1.2 card fields with what the fixture seeded. Returns (problems, coverage counts)."""
    problems, counts = [], {"first contact exact": 0, "first contact approximate": 0, "first contact unavailable": 0,
                            "phones": 0, "e-mails": 0, **{field: 0 for field in PROFILE}}
    by_name = {card["name"]: card for card in cards}
    for item in fixture["contacts"]:
        spec = item["contact"]
        card = by_name.get(spec["name"])
        if spec.get("is_test"):
            if card:
                problems.append(f"{spec['name']}: test record listed")
            continue
        if not card:
            problems.append(f"{spec['name']}: missing from the cards")
            continue
        for field in PROFILE:
            if card.get(field) != spec.get(field) or card.get(f"{field}_source") != spec.get(f"{field}_source"):
                problems.append(f"{spec['name']}: {field} round-trip differs")
            counts[field] += bool(card.get(field))
        for kind, plural in (("phones", "phones"), ("emails", "e-mails")):
            seeded = sorted(point["value"] for point in spec.get(kind, []))
            shown = card.get(kind) or []
            if sorted(point["value"] for point in shown) != seeded:
                problems.append(f"{spec['name']}: {kind} differ")
            if any("source_ref" in point for point in shown):
                problems.append(f"{spec['name']}: {kind} leak source_ref to the browser")
            if shown and shown[0].get("primary") is False and any(point.get("primary") for point in shown):
                problems.append(f"{spec['name']}: primary {kind} not listed first")
            counts[plural] += len(shown)
        evidence = evidence_of(item)
        got = card.get("first_contact")
        if not evidence:
            counts["first contact unavailable"] += 1
            if got:
                problems.append(f"{spec['name']}: first contact without any message evidence")
            continue
        best = min(evidence, key=lambda e: (instant(at(e["at"], now)), RANK[e["quality"]], RANK[e["basis"]]))
        want = (instant(at(best["at"], now)), best["quality"], best["basis"], best["platform"], best["kind"])
        if not got or (instant(got["at"]), got["quality"], got["basis"], got["platform"], got["conversation_kind"]) != want:
            problems.append(f"{spec['name']}: first contact is not the earliest, best-substantiated evidence")
        counts[f"first contact {best['quality']}"] += 1
        # Thread names never reach the browser, so match per-thread first messages by platform and evidence.
        shown = sorted((ch["platform"], str(instant((t["first_message"] or {}).get("at"))),
                        (t["first_message"] or {}).get("quality"), (t["first_message"] or {}).get("basis"))
                       for ch in card["channels"] for t in ch["threads"])
        seeded = sorted((t["app"], str(instant(at(t["first_message"]["at"], now)) if "first_message" in t else None),
                         t.get("first_message", {}).get("quality"), t.get("first_message", {}).get("basis"))
                        for t in item.get("threads", []))
        if shown != seeded:
            problems.append(f"{spec['name']}: thread first messages differ")
    return problems, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--admin-port", type=int, default=18135)
    parser.add_argument("--crm-port", type=int, default=18137)
    parser.add_argument("--password", help="preview sign-in password (default: random, printed)")
    parser.add_argument("--keep", action="store_true", help="keep the temporary directory on exit")
    parser.add_argument("--check", action="store_true", help="seed, verify the data path, then exit")
    args = parser.parse_args()
    if not (CRM_DIR / "node_modules" / "better-sqlite3").is_dir():
        raise SystemExit(f"run `npm ci` in {CRM_DIR} first")
    # A busy port would let the health probe reach whatever already listens there (say, a preview still
    # running), and the seed would then write to the wrong server. Refuse instead.
    for port in (args.crm_port, args.admin_port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            if probe.connect_ex(("127.0.0.1", port)) == 0:
                raise SystemExit(f"port {port} is already in use (another preview?); stop it or pass --crm-port/--admin-port")

    sys.path.insert(0, str(MONITOR))
    from admin_app import hash_password

    work = Path(tempfile.mkdtemp(prefix="hiraia-crm-preview-"))
    write_key = "hcrm_preview-harvestd_" + secrets.token_urlsafe(32)
    read_key = "hcrm_hiraia-admin_" + secrets.token_urlsafe(32)
    password = args.password or secrets.token_urlsafe(12)
    email = "preview@localhost"
    clean = {k: v for k, v in os.environ.items() if not k.startswith("HIRAIA_")}
    crm_env = {**clean, "HIRAIA_CRM_PORT": str(args.crm_port), "HIRAIA_CRM_HOST": "127.0.0.1",
               "HIRAIA_CRM_DB_PATH": str(work / "crm.db"), "HIRAIA_CRM_BACKUP_STATUS": str(work / "no-backup.json"),
               "HIRAIA_CRM_ALLOW_HTTP": "1",                      # loopback only; production stays HTTPS
               "HIRAIA_CRM_CLIENT_PREVIEW_HARVESTD": f"write:sha256:{sha(write_key)}",
               "HIRAIA_CRM_CLIENT_HIRAIA_ADMIN": f"read:sha256:{sha(read_key)}"}
    key_file = work / "crm-admin.key"
    key_file.write_text(read_key + "\n")
    key_file.chmod(0o600)
    (work / "config.json").write_text(json.dumps({
        "admin_email": email, "admin_password_hash": hash_password(password), "session_secret": secrets.token_hex(32)}))
    admin_env = {**clean, "HIRAIA_ADMIN_CONF": str(work / "config.json"), "ADMIN_PORT": str(args.admin_port),
                 "HIRAIA_MONITOR_STATE": str(work / "state"), "HIRAIA_MONITOR_LOG": str(work / "monitor.log"),
                 "HIRAIA_DB_PATH": str(work / "absent-web.db"), "HIRAIA_TELEMETRY_DB_PATH": str(work / "absent-telemetry.db"),
                 "HIRAIA_CRM_API_KEY_FILE": str(key_file), "HIRAIA_CRM_BASE_URL": f"http://127.0.0.1:{args.crm_port}/api/crm"}

    processes = []

    def cleanup():
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
        if args.keep:
            print(f"kept {work}")
        else:
            subprocess.run(["rm", "-rf", str(work)], check=False)

    def interrupted(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        with open(work / "crm.log", "w") as crm_log, open(work / "admin.log", "w") as admin_log:
            processes.append(subprocess.Popen(["node", str(CRM_DIR / "server.cjs")], env=crm_env, stdout=crm_log, stderr=subprocess.STDOUT))
            wait_for(f"http://127.0.0.1:{args.crm_port}/api/crm/health", processes[0])
            fixture = json.loads((HERE / "crm_fixture.json").read_text(encoding="utf-8"))
            now = datetime.now(timezone.utc)
            count = seed(f"http://127.0.0.1:{args.crm_port}/api/crm", write_key, work / "crm.db", fixture, now)
            processes.append(subprocess.Popen([sys.executable, str(MONITOR / "admin_app.py")], env=admin_env,
                                              stdout=admin_log, stderr=subprocess.STDOUT))
            origin = f"http://127.0.0.1:{args.admin_port}"
            wait_for(f"{origin}/admin/health", processes[1])
            data, states, platforms = check(origin, email, password)
            problems, coverage = verify(data["contacts"], fixture, now)
            print(f"seeded {count} synthetic contacts; the cards endpoint lists {data['total']} (test records excluded)")
            print(f"  activity: {json.dumps(states, sort_keys=True)}  channels: {json.dumps(platforms, sort_keys=True)}")
            print(f"  1.2 fields: {json.dumps(coverage)}")
            for problem in problems:
                print(f"  PROBLEM {problem}")
            if args.check:
                return 1 if problems else 0
            print(f"\n  open   http://localhost:{args.admin_port}/admin/crm\n  email  {email}\n  pass   {password}\n\nCtrl-C to stop.", flush=True)
            while all(p.poll() is None for p in processes):
                time.sleep(1)
            print("a preview process exited; logs:", work / "crm.log", work / "admin.log")
            args.keep = True                      # keep the logs for inspection
            return 1
    except KeyboardInterrupt:
        return 0
    finally:
        cleanup()


if __name__ == "__main__":
    sys.exit(main())
