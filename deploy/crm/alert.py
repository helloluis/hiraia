#!/usr/bin/env python3
"""Alert when the hiraia-crm backup fails. Wired as OnFailure= of hiraia-crm-backup.service.

  alert.py backup-failed [--unit hiraia-crm-backup.service]
  alert.py test                      # send a test alert through every channel

Channels — the ones the project already has:
  * /var/log/hiraia-crm-backup.log and journald (this unit's own output)
  * /var/log/hiraia-monitor.log — mission control's "guard activity" tail at hiraia.org/admin
  * e-mail through Resend, using resend_api_key + notify_email from /opt/hiraia-monitor/config.json
    (the same sender/recipient Tala reports and pilot applications use)
  * notify_webhook from that config, if set (same JSON shape as monitor.py)
Never raises: an alert that crashes is worse than a noisy one. Exit code is always 0.
"""
import json
import os
import socket
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

MONITOR_CONF = os.environ.get("HIRAIA_MONITOR_CONF", "/opt/hiraia-monitor/config.json")
MONITOR_LOG = os.environ.get("HIRAIA_MONITOR_LOG", "/var/log/hiraia-monitor.log")
BACKUP_LOG = os.environ.get("HIRAIA_CRM_BACKUP_LOG", "/var/log/hiraia-crm-backup.log")
STATUS_FILE = os.environ.get("HIRAIA_CRM_BACKUP_STATUS", "/var/lib/hiraia-crm/backup-status.json")
SENDER = "Hiraia <feedback@hiraia.org>"
UA = "hiraia-crm-alert/1.0"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def append(path: str, line: str) -> None:
    try:
        with open(path, "a") as handle:
            handle.write(line + "\n")
    except OSError as error:
        print(f"could not write {path}: {error}", file=sys.stderr)


def journal_tail(unit: str) -> str:
    try:
        return subprocess.run(["journalctl", "-u", unit, "-n", "40", "--no-pager", "-o", "short-iso"],
                              capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception as error:
        return f"(journal unavailable: {error})"


def load_config() -> dict:
    try:
        with open(MONITOR_CONF) as handle:
            return json.load(handle)
    except Exception:
        return {}


def email(config: dict, subject: str, text: str) -> str:
    api_key, recipient = config.get("resend_api_key"), config.get("notify_email")
    if not api_key or not recipient:
        return "email: not configured (resend_api_key/notify_email missing in mission-control config)"
    payload = json.dumps({"from": SENDER, "to": [recipient], "subject": subject, "text": text}).encode()
    request = urllib.request.Request("https://api.resend.com/emails", data=payload, method="POST",
                                     headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "User-Agent": UA})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.loads(response.read().decode() or "{}")
            return f"email: sent to {recipient} (resend id {body.get('id', '?')})"
    except Exception as error:
        return f"email: FAILED ({type(error).__name__}: {str(error)[:200]})"


def webhook(config: dict, subject: str, text: str) -> str:
    hook = config.get("notify_webhook")
    if not hook:
        return "webhook: not configured"
    try:
        urllib.request.urlopen(urllib.request.Request(hook, data=json.dumps({"subject": subject, "body": text}).encode(),
                                                      headers={"Content-Type": "application/json", "User-Agent": UA}), timeout=20)
        return "webhook: posted"
    except Exception as error:
        return f"webhook: FAILED ({type(error).__name__})"


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else "backup-failed"
    unit = sys.argv[sys.argv.index("--unit") + 1] if "--unit" in sys.argv else "hiraia-crm-backup.service"
    host = socket.gethostname()
    try:
        status = json.load(open(STATUS_FILE))
    except Exception:
        status = {}
    if mode == "test":
        subject = f"[hiraia-crm] TEST alert from {host}"
        summary = "This is a test of the CRM backup failure alert. No action needed."
    else:
        subject = f"[hiraia-crm] backup FAILED on {host}"
        summary = status.get("last_error") or "backup unit exited non-zero (see journal)"
    stamp = now()
    headline = f"{stamp} ALERT hiraia-crm backup {'TEST' if mode == 'test' else 'FAILED'} on {host}: {summary}"
    append(BACKUP_LOG, headline)
    append(MONITOR_LOG, headline)
    text = "\n".join([
        headline, "",
        f"last successful backup: {status.get('last_ok_at') or 'never'}",
        f"last artifact: {status.get('artifact') or '-'}",
        f"offsite: {json.dumps(status.get('offsite')) if status.get('offsite') else 'unknown'}",
        "", f"journal tail ({unit}):", journal_tail(unit), "",
        "Runbook: deploy/crm/README.md → Backups (run /opt/hiraia-crm/backup.sh by hand to reproduce).",
    ])
    config = load_config()
    results = [email(config, subject, text), webhook(config, subject, text)]
    for line in results:
        print(line)
        append(BACKUP_LOG, f"{stamp} alert {line}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:  # the alert itself must never fail loudly
        print(f"alert.py error: {error}", file=sys.stderr)
        sys.exit(0)
