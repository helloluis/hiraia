"""Private Hiraia Tala report intake and admin review surface."""

import base64
import binascii
import hashlib
import html
import ipaddress
import json
import os
import pwd
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

STATE_DIR = os.environ.get("HIRAIA_MONITOR_STATE", "/var/lib/hiraia-monitor")
DB_PATH = os.path.join(STATE_DIR, "tala-reports.db")
MEDIA_DIR = os.path.join(STATE_DIR, "tala-media")
MAX_REQUEST = 14_000_000
MAX_MEDIA = 10_000_000
MIME_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4"}
CATEGORIES = {"App problem", "Content concern", "Device problem", "Other"}
DEVICE_COOLDOWN_MS = 30_000
DEVICE_HOURLY_LIMIT = 6
IP_HOURLY_LIMIT = 20
ATTEMPT_MINUTE_LIMIT = 5
ATTEMPT_HOURLY_LIMIT = 30
GLOBAL_ATTEMPT_HOURLY_LIMIT = 120
PROCESSOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tala_media.py")
# Resend allows 40 MB of attachments after Base64. Tala already caps media at 10 MB;
# leave headroom for the JSON envelope and skip any leftover that would overflow.
EMAIL_ATTACH_BUDGET = 8_000_000
_lock = threading.Lock()


class InvalidMedia(ValueError):
    pass


class ProcessorUnavailable(RuntimeError):
    pass


@contextmanager
def _db():
    os.makedirs(STATE_DIR, mode=0o700, exist_ok=True)
    os.chmod(STATE_DIR, 0o700)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    os.chmod(DB_PATH, 0o600)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS reports (
            id TEXT PRIMARY KEY, payload_sha256 TEXT NOT NULL, device_id TEXT NOT NULL,
            category TEXT NOT NULL, details TEXT NOT NULL, created_at INTEGER NOT NULL,
            received_at INTEGER NOT NULL, class_name TEXT NOT NULL, school_name TEXT NOT NULL,
            teacher_name TEXT NOT NULL, media_count INTEGER NOT NULL,
            notified_at INTEGER NOT NULL DEFAULT 0, notify_error TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS media (
            id TEXT PRIMARY KEY, report_id TEXT NOT NULL, name TEXT NOT NULL,
            mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS intake_attempts (
            source_ip TEXT NOT NULL, attempted_at INTEGER NOT NULL
        );
    """)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(reports)")}
    if "source_ip" not in columns:
        conn.execute("ALTER TABLE reports ADD COLUMN source_ip TEXT NOT NULL DEFAULT ''")
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS media_report ON media(report_id);
        CREATE INDEX IF NOT EXISTS reports_device_received ON reports(device_id,received_at);
        CREATE INDEX IF NOT EXISTS reports_ip_received ON reports(source_ip,received_at);
        CREATE INDEX IF NOT EXISTS attempts_ip_time ON intake_attempts(source_ip,attempted_at);
    """)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _uuid(value):
    if not isinstance(value, str):
        return False
    try:
        return str(uuid.UUID(value)) == value
    except ValueError:
        return False


def _text(value, maximum, required=False):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError("invalid_text")
    value = unicodedata.normalize("NFKC", value).strip()
    if len(value) > maximum or (required and not value):
        raise ValueError("invalid_text")
    if any(unicodedata.category(character) in ("Cc", "Cs") and character not in "\n\t"
           for character in value):
        raise ValueError("invalid_text")
    return value


def normalize_ip(value):
    try:
        return str(ipaddress.ip_address((value or "").strip()))
    except ValueError:
        return "unknown"


def allow_request(source_ip):
    source_ip = normalize_ip(source_ip)
    now = int(time.time() * 1000)
    minute = now - 60_000
    hour = now - 3_600_000
    with _lock:
        with _db() as conn:
            conn.execute("DELETE FROM intake_attempts WHERE attempted_at<?", (now - 86_400_000,))
            per_minute = conn.execute("SELECT COUNT(*) FROM intake_attempts WHERE source_ip=? AND attempted_at>?",
                                      (source_ip, minute)).fetchone()[0]
            per_hour = conn.execute("SELECT COUNT(*) FROM intake_attempts WHERE source_ip=? AND attempted_at>?",
                                    (source_ip, hour)).fetchone()[0]
            global_hour = conn.execute("SELECT COUNT(*) FROM intake_attempts WHERE attempted_at>?",
                                       (hour,)).fetchone()[0]
            if (per_minute >= ATTEMPT_MINUTE_LIMIT or per_hour >= ATTEMPT_HOURLY_LIMIT or
                    global_hour >= GLOBAL_ATTEMPT_HOURLY_LIMIT):
                return False, 60
            conn.execute("INSERT INTO intake_attempts VALUES(?,?)", (source_ip, now))
    return True, 0


def _processor_command(source, target, mime):
    direct = [sys.executable, PROCESSOR, source, target, mime]
    try:
        account = pwd.getpwnam("hiraia-media")
    except KeyError:
        if os.environ.get("HIRAIA_MEDIA_ALLOW_UNSANDBOXED") == "1":
            return direct, None
        raise ProcessorUnavailable("media_sandbox_unavailable")
    setpriv = "/usr/bin/setpriv"
    if not os.path.isfile(setpriv):
        raise ProcessorUnavailable("media_sandbox_unavailable")
    return ([setpriv, f"--reuid={account.pw_uid}", f"--regid={account.pw_gid}",
             "--clear-groups", "--no-new-privs", "/usr/bin/python3", PROCESSOR,
             source, target, mime], account)


def _process_media(staging, media_id, mime, content):
    source = os.path.join(staging, media_id + ".upload")
    target = os.path.join(staging, media_id + "." + MIME_EXT[mime])
    with open(source, "xb") as file:
        file.write(content)
    os.chmod(source, 0o640)
    command, account = _processor_command(source, target, mime)
    if account is not None:
        os.chown(staging, 0, account.pw_gid)
        os.chmod(staging, 0o770)
        os.chown(source, 0, account.pw_gid)
    if mime == "video/mp4" and (not os.path.isfile("/usr/bin/ffmpeg") or
                                 not os.path.isfile("/usr/bin/ffprobe")):
        raise ProcessorUnavailable("video_processor_unavailable")
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=35, check=False,
                                env={"PATH": "/usr/bin:/bin", "LANG": "C", "PYTHONNOUSERSITE": "1"})
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ProcessorUnavailable("media_processor_unavailable") from error
    finally:
        try:
            os.remove(source)
        except FileNotFoundError:
            pass
    if result.returncode:
        message = result.stderr.decode("utf-8", "replace")[-300:]
        if "unavailable" in message or "No such file" in message:
            raise ProcessorUnavailable("media_processor_unavailable")
        raise InvalidMedia("invalid_attachment_content")
    try:
        stated_size = int(json.loads(result.stdout)["size"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ProcessorUnavailable("invalid_processor_response") from error
    if (not os.path.isfile(target) or os.path.islink(target) or os.path.getsize(target) != stated_size or
            stated_size <= 0 or stated_size > MAX_MEDIA):
        raise InvalidMedia("invalid_attachment_content")
    os.chmod(target, 0o600)
    return target, stated_size


def receive(raw, config, source_ip="unknown"):
    if len(raw) > MAX_REQUEST:
        return 413, {"error": "invalid_report_size"}
    source_ip = normalize_ip(source_ip)
    try:
        data = json.loads(raw)
        if not isinstance(data, dict) or not _uuid(data.get("id")) or not _uuid(data.get("device_id")):
            raise ValueError("invalid_id")
        category = _text(data.get("category"), 40, True)
        if category not in CATEGORIES:
            raise ValueError("invalid_category")
        report = {
            "id": data["id"], "device_id": data["device_id"], "category": category,
            "details": _text(data.get("details"), 2000, True),
            "class_name": _text(data.get("class_name"), 80),
            "school_name": _text(data.get("school_name"), 80),
            "teacher_name": _text(data.get("teacher_name"), 80),
        }
        created = data.get("created_at")
        if not isinstance(created, int) or created < 1577836800000 or created > (time.time() + 86400) * 1000:
            raise ValueError("invalid_date")
        report["created_at"] = created
        attachments = data.get("attachments", [])
        if not isinstance(attachments, list) or len(attachments) > 3:
            raise ValueError("invalid_attachments")
        media = []
        total = 0
        for item in attachments:
            if not isinstance(item, dict) or not _uuid(item.get("id")) or item.get("mime") not in MIME_EXT:
                raise ValueError("invalid_attachment")
            try:
                decoded = base64.b64decode(item.get("data", ""), validate=True)
            except (ValueError, binascii.Error):
                raise ValueError("invalid_attachment") from None
            total += len(decoded)
            if total > MAX_MEDIA or not decoded:
                raise ValueError("invalid_attachment")
            media.append((item["id"], f"attachment-{len(media) + 1}.{MIME_EXT[item['mime']]}",
                          item["mime"], decoded))
        if len({item[0] for item in media}) != len(media):
            raise ValueError("duplicate_attachment")
    except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
        return 400, {"error": str(error) or "invalid_report"}

    digest = hashlib.sha256(raw).hexdigest()
    with _lock:
        with _db() as conn:
            existing = conn.execute("SELECT payload_sha256 FROM reports WHERE id=?", (report["id"],)).fetchone()
            if existing:
                if existing["payload_sha256"] != digest:
                    return 409, {"error": "report_id_conflict"}
            else:
                now = int(time.time() * 1000)
                device = conn.execute("SELECT MAX(received_at),COUNT(*) FROM reports WHERE device_id=? AND received_at>?",
                                      (report["device_id"], now - 3_600_000)).fetchone()
                source = conn.execute("SELECT COUNT(*) FROM reports WHERE source_ip=? AND received_at>?",
                                      (source_ip, now - 3_600_000)).fetchone()[0]
                hourly = conn.execute("SELECT COUNT(*) FROM reports WHERE received_at>?",
                                      (now - 3_600_000,)).fetchone()[0]
                stored_bytes = conn.execute("SELECT COALESCE(SUM(size),0) FROM media").fetchone()[0]
                if device[0] is not None and now - device[0] < DEVICE_COOLDOWN_MS:
                    return 429, {"error": "report_cooldown", "retry_after": 30}
                if (device[1] >= DEVICE_HOURLY_LIMIT or source >= IP_HOURLY_LIMIT or hourly >= 60 or
                        stored_bytes + total > 1_000_000_000):
                    return 429, {"error": "report_capacity_reached"}
                os.makedirs(MEDIA_DIR, mode=0o700, exist_ok=True)
                os.chmod(MEDIA_DIR, 0o700)
                staging = tempfile.mkdtemp(prefix="tala-report-")
                final = os.path.join(MEDIA_DIR, report["id"])
                if os.path.exists(final):
                    shutil.rmtree(staging)
                    return 409, {"error": "report_id_conflict"}
                try:
                    rows = []
                    for media_id, name, mime, content in media:
                        path, safe_size = _process_media(staging, media_id, mime, content)
                        rows.append((media_id, report["id"], name, mime, safe_size,
                                     os.path.join(final, os.path.basename(path))))
                    if stored_bytes + sum(row[4] for row in rows) > 1_000_000_000:
                        return 429, {"error": "report_capacity_reached"}
                    conn.execute("""INSERT INTO reports
                        (id,payload_sha256,device_id,category,details,created_at,received_at,
                         class_name,school_name,teacher_name,media_count,source_ip)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (report["id"], digest, report["device_id"], report["category"],
                         report["details"], created, now, report["class_name"],
                         report["school_name"], report["teacher_name"], len(media), source_ip))
                    conn.executemany("INSERT INTO media VALUES(?,?,?,?,?,?)", rows)
                    shutil.move(staging, final)
                    os.chmod(final, 0o700)
                except InvalidMedia:
                    return 400, {"error": "invalid_attachment_content"}
                except ProcessorUnavailable:
                    return 503, {"error": "media_processor_unavailable"}
                except Exception:
                    if os.path.isdir(final):
                        shutil.rmtree(final, ignore_errors=True)
                    raise
                finally:
                    shutil.rmtree(staging, ignore_errors=True)
    notify(report["id"], config)
    return 200, {"ok": True, "id": report["id"]}


def _utc(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _load_media_files(report_id):
    with _db() as conn:
        rows = conn.execute("SELECT id,name,mime,size,path FROM media WHERE report_id=?",
                            (report_id,)).fetchall()
    files = []
    for row in rows:
        try:
            with open(row["path"], "rb") as file:
                files.append({
                    "id": row["id"], "name": row["name"], "mime": row["mime"],
                    "size": row["size"], "data": file.read(),
                })
        except OSError:
            files.append({
                "id": row["id"], "name": row["name"], "mime": row["mime"],
                "size": row["size"], "data": None,
            })
    return files


def pick_email_attachments(files, budget=EMAIL_ATTACH_BUDGET):
    attached, skipped = [], []
    used = 0
    for item in files:
        data = item.get("data")
        if not data:
            skipped.append(f'{item["name"]} (unreadable on server)')
            continue
        if used + len(data) > budget:
            skipped.append(f'{item["name"]} ({len(data) // 1024} KB — over the email size budget)')
            continue
        attached.append({
            "filename": item["name"],
            "content": base64.b64encode(data).decode("ascii"),
            "content_type": item["mime"],
        })
        used += len(data)
    return attached, skipped


def email_payload(row, files, budget=EMAIL_ATTACH_BUDGET):
    attached, skipped = pick_email_attachments(files, budget)
    review = f"https://hiraia.org/admin/tala-reports#{row['id']}"
    lines = [
        f"New Tala report: {row['category']}",
        f"Teacher: {row['teacher_name'] or '—'}",
        f"School: {row['school_name'] or '—'}",
        f"Class: {row['class_name'] or '—'}",
        f"Received: {_utc(row['received_at'])}",
        f"Device: {row['device_id']}",
        "",
        "Details:",
        row["details"] or "(no details)",
        "",
        f"Attachments stored: {row['media_count']}",
    ]
    if attached:
        lines.append("Attached to this email: " + ", ".join(item["filename"] for item in attached))
    if skipped:
        lines.append("Not attached (see the dashboard): " + "; ".join(skipped))
    if not attached and not skipped and row["media_count"]:
        lines.append("Files are on the dashboard only.")
    lines.extend(["", f"Review: {review}"])
    text = "\n".join(lines)
    html_details = html.escape(row["details"] or "(no details)").replace("\n", "<br>")
    html_body = (
        f"<p><strong>{html.escape(row['category'])}</strong></p>"
        f"<p>Teacher: {html.escape(row['teacher_name'] or '—')}<br>"
        f"School: {html.escape(row['school_name'] or '—')}<br>"
        f"Class: {html.escape(row['class_name'] or '—')}<br>"
        f"Received: {_utc(row['received_at'])}</p>"
        f"<p><strong>Details</strong></p><p>{html_details}</p>"
        f"<p>{len(attached)} file(s) attached to this email"
        + (f"; not attached: {html.escape('; '.join(skipped))}" if skipped else "")
        + f".</p><p><a href=\"{html.escape(review, quote=True)}\">Open in admin</a></p>"
    )
    payload = {
        "from": "Hiraia Tala <feedback@hiraia.org>",
        "to": [],
        "subject": f"Hiraia Tala report: {row['category']}",
        "text": text,
        "html": html_body,
    }
    if attached:
        payload["attachments"] = attached
    return payload


def notify(report_id, config):
    with _db() as conn:
        row = conn.execute("SELECT * FROM reports WHERE id=?", (report_id,)).fetchone()
        if row is None or row["notified_at"]:
            return row is not None
        api_key = config.get("resend_api_key", "")
        recipient = config.get("notify_email", "")
        if not api_key or not recipient:
            conn.execute("UPDATE reports SET notify_error=? WHERE id=?",
                         ("Resend not configured", report_id))
            return False
        payload = email_payload(dict(row), _load_media_files(report_id))
        payload["from"] = config.get("tala_notify_from", payload["from"])
        payload["to"] = [recipient]
        request = urllib.request.Request("https://api.resend.com/emails",
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
                     "Idempotency-Key": f"tala-report-{report_id}",
                     "User-Agent": "HiraiaTala/0.4.2"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status not in (200, 201):
                    raise RuntimeError(f"Resend returned {response.status}")
            conn.execute("UPDATE reports SET notified_at=?,notify_error='' WHERE id=?",
                         (int(time.time() * 1000), report_id))
            return True
        except (urllib.error.URLError, RuntimeError) as error:
            conn.execute("UPDATE reports SET notify_error=? WHERE id=?", (str(error)[:200], report_id))
            return False


def attachment(report_id, media_id):
    if not _uuid(report_id) or not _uuid(media_id):
        return None
    with _db() as conn:
        row = conn.execute("SELECT name,mime,path FROM media WHERE report_id=? AND id=?",
                           (report_id, media_id)).fetchone()
        if row is None:
            return None
        with open(row["path"], "rb") as file:
            return row["mime"], row["name"], file.read()


def delete_report(report_id):
    if not _uuid(report_id):
        return False
    with _lock:
        with _db() as conn:
            result = conn.execute("DELETE FROM reports WHERE id=?", (report_id,))
            conn.execute("DELETE FROM media WHERE report_id=?", (report_id,))
        if result.rowcount:
            shutil.rmtree(os.path.join(MEDIA_DIR, report_id), ignore_errors=True)
            return True
    return False


def page_body(mount, csrf):
    with _db() as conn:
        reports = conn.execute("SELECT * FROM reports ORDER BY received_at DESC LIMIT 500").fetchall()
        attachments = {row["id"]: conn.execute("SELECT id,name,mime,size FROM media WHERE report_id=?",
                                                (row["id"],)).fetchall() for row in reports}
    cards = []
    for row in reports:
        report_id = row["id"]
        received = datetime.fromtimestamp(row["received_at"] / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        notified = "Email sent" if row["notified_at"] else f"Email pending: {row['notify_error'] or 'not sent'}"
        links = " ".join(
            f'<a href="{html.escape(mount, quote=True)}/tala-reports/media/{report_id}/{media["id"]}">'
            f'{html.escape(media["name"])} ({media["size"] // 1024} KB)</a>'
            for media in attachments[report_id]
        ) or "No attachments"
        retry = "" if row["notified_at"] else (
            f'<form method="post" action="{html.escape(mount, quote=True)}/tala-reports/{report_id}/retry">'
            f'<input type="hidden" name="csrf" value="{html.escape(csrf, quote=True)}">'
            '<button type="submit" class="refresh">Retry email</button></form>'
        )
        delete = (
            f'<form method="post" action="{html.escape(mount, quote=True)}/tala-reports/{report_id}/delete" '
            'onsubmit="return confirm(\'Permanently delete this report and its media?\')">'
            f'<input type="hidden" name="csrf" value="{html.escape(csrf, quote=True)}">'
            '<button type="submit" class="btn-danger">Delete report</button></form>'
        )
        cards.append(
            f'<article class="report" id="{html.escape(report_id, quote=True)}">'
            f'<div class="kicker">{html.escape(row["category"])} · {received}</div>'
            f'<h2>{html.escape(row["school_name"])} · {html.escape(row["class_name"])} · {html.escape(row["teacher_name"])}</h2>'
            f'<p class="details">{html.escape(row["details"])}</p>'
            f'<p class="media">{links}</p><p class="note">{html.escape(notified)}</p>'
            f'<div class="report-actions">{retry}{delete}</div></article>'
        )
    empty = '<div class="panel">No reports yet.</div>'
    return (
        f'<h1>Tala reports</h1>'
        f'<p class="lede">{len(reports)} most recent reports. Media stays on this server and is only '
        f'available after sign-in.</p>'
        + "".join(cards or [empty])
        + '<p class="foot">Classroom issue reports from Tala. The alert email includes the report text and attaches files that fit.</p>'
    )
