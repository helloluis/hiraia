"""CRM contact cards for the authenticated admin: page /admin/crm, data /admin/api/crm/contacts.

Read-only. The admin server calls the private CRM API (deploy/crm; contract in
docs/mbp-crm-integration.md) with its own read-scoped bearer key and hands the signed-in
browser an allowlisted projection of each contact. The key never leaves this process: it is
not rendered, logged, put in a URL or echoed in an error, and redirects are refused so it is
never re-sent to another host.

The CRM holds extracted summaries only (raw messages are never synced). This projection also
drops what a card does not need: thread labels, opaque source/export/checkpoint IDs, model
versions and the classifier's private extract fields.

Configuration, from hiraia-admin.service's environment (systemd/crm-cards.conf):
  HIRAIA_CRM_API_KEY_FILE  root-only file holding the hiraia-admin *read* key (preferred; it is
                           re-read when the file changes, so a rotation needs no restart)
  HIRAIA_CRM_API_KEY       the key itself (fallback, e.g. for a local preview)
  HIRAIA_CRM_BASE_URL      default https://hiraia.org/api/crm; plain http only for loopback
"""
import html
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.client import HTTPException
from pathlib import Path

import admin_chrome

DEFAULT_BASE_URL = "https://hiraia.org/api/crm"
PAGE_SIZE = 200                  # the API's largest page
MAX_CONTACTS = 5000              # paging bound: at most 25 requests per refresh
MAX_PAGE_BYTES = 48 * 1024 * 1024
TIMEOUT_S = 15
UA = "hiraia-admin/1.0 (crm-cards)"
STAGES = ("intro", "pilot", "active", "dormant", "unknown")
INCLUDE = "threads,latest_extract"   # CRM API >= 1.1.0
HERE = Path(__file__).resolve().parent

# Text limits mirror the CRM/harvestd contracts; longer values are cut, never rejected.
LIMITS = {"name": 200, "alias": 200, "aliases": 50, "role": 200, "school": 200, "notes": 8000,
          "summary": 8000, "next_action": 1000, "date": 100, "dates": 32}
_PLATFORM = re.compile(r"[a-z0-9][a-z0-9._-]{0,31}")
# harvestd names every group link `Group <opaque conversation ID>` (self-snooper
# docs/group-participants.md) and a direct thread after the reviewed contact name.
_GROUP_THREAD = re.compile(r"Group [A-Za-z0-9_-]{1,128}")
_KEY = re.compile(r"[\x21-\x7e]{16,512}")
_LOOPBACK = frozenset({"127.0.0.1", "::1", "localhost"})
_key_lock = threading.Lock()
_key_cache = {"path": None, "sig": None, "key": ""}


class CrmError(Exception):
    """A fixed, browser-safe failure code. Never carries an upstream body, URL or key."""

    def __init__(self, code, status=502, retry_after=None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.retry_after = retry_after


# ------------------------------------------------------------------------------- configuration
def api_key():
    """The read key, or '' when unset/unreadable/malformed (reported as not configured)."""
    path = os.environ.get("HIRAIA_CRM_API_KEY_FILE", "").strip()
    if not path:
        key = os.environ.get("HIRAIA_CRM_API_KEY", "").strip()
        return key if _KEY.fullmatch(key) else ""
    try:
        st = os.stat(path)
    except OSError:
        return ""
    sig = (st.st_ino, st.st_mtime_ns, st.st_size)
    with _key_lock:
        if _key_cache["path"] != path or _key_cache["sig"] != sig:
            try:
                with open(path, encoding="utf-8") as f:
                    key = f.read(1024).strip()
            except (OSError, UnicodeDecodeError):
                key = ""
            _key_cache.update(path=path, sig=sig, key=key if _KEY.fullmatch(key) else "")
        return _key_cache["key"]


def base_url():
    raw = os.environ.get("HIRAIA_CRM_BASE_URL", "").strip() or DEFAULT_BASE_URL
    try:
        parts = urllib.parse.urlsplit(raw)
        host = (parts.hostname or "").lower()
        has_credentials = bool(parts.username or parts.password)
        _ = parts.port                      # a malformed port raises ValueError here
    except ValueError:
        raise CrmError("crm_misconfigured", 503) from None
    secure = parts.scheme == "https" and host
    loopback = parts.scheme == "http" and host in _LOOPBACK
    if not (secure or loopback) or has_credentials or parts.query or parts.fragment:
        raise CrmError("crm_misconfigured", 503)
    return raw.rstrip("/")


# ------------------------------------------------------------------------------------ transport
class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    """A redirect would re-send the bearer key to wherever it points; fail closed instead."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), _RefuseRedirects())


def _retry_after(headers):
    try:
        return max(1, min(3600, int((headers or {}).get("Retry-After", "60"))))
    except (TypeError, ValueError):
        return 60


def _get(base, key, path, params):
    request = urllib.request.Request(
        f"{base}{path}?{urllib.parse.urlencode(params)}",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json", "User-Agent": UA})
    try:
        with _OPENER.open(request, timeout=TIMEOUT_S) as response:
            raw = response.read(MAX_PAGE_BYTES + 1)
    except urllib.error.HTTPError as error:
        status, retry = error.code, _retry_after(error.headers)
        error.close()                       # the body is never read or forwarded
        if status in (401, 403):
            raise CrmError("crm_auth_failed", 502) from None
        if status == 429:
            raise CrmError("crm_rate_limited", 503, retry) from None
        raise CrmError("crm_unavailable", 502) from None
    except (urllib.error.URLError, HTTPException, OSError, ValueError):
        raise CrmError("crm_unavailable", 502) from None
    if len(raw) > MAX_PAGE_BYTES:
        raise CrmError("crm_bad_response", 502)
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise CrmError("crm_bad_response", 502) from None
    if not isinstance(data, dict):
        raise CrmError("crm_bad_response", 502)
    return data


def _count(value):
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None


def fetch_contacts(base, key):
    """Every non-test contact with its threads and latest extract: (rows, total, truncated)."""
    rows, seen, offset, total = [], set(), 0, 0
    for _ in range(MAX_CONTACTS // PAGE_SIZE + 1):
        data = _get(base, key, "/contacts", {"include": INCLUDE, "limit": PAGE_SIZE, "offset": offset})
        page, total = data.get("contacts"), _count(data.get("total"))
        if not isinstance(page, list) or total is None:
            raise CrmError("crm_bad_response", 502)
        for row in page:
            if not isinstance(row, dict) or _count(row.get("id")) is None:
                raise CrmError("crm_bad_response", 502)
            if "threads" not in row or "latest_extract" not in row:
                raise CrmError("crm_outdated", 502)    # an API older than 1.1.0 ignores `include`
            if row["id"] not in seen:                  # offset paging can repeat a row that moved
                seen.add(row["id"])
                rows.append(row)
        offset += len(page)
        if not page or offset >= total or len(rows) >= MAX_CONTACTS:
            break
    # Fewer unique rows than the total: the cap, or a row that moved past us between pages.
    return rows, total, len(rows) < total


# ----------------------------------------------------------------------------------- projection
def _text(value, limit):
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None


def _time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        return None


def _iso(moment):
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z") if moment else None


def _same_name(value):
    return " ".join(value.split()).casefold()


def _thread_kind(label, names):
    if not isinstance(label, str):
        return "conversation"
    if _same_name(label) in names:
        return "direct"
    if _GROUP_THREAD.fullmatch(label.strip()):
        return "group"
    return "conversation"


def _channels(row, threads, names):
    """One entry per platform: the platform of every thread plus the contact record's own."""
    channels = {}
    for thread in threads:
        app = thread.get("app") if isinstance(thread, dict) else None
        if not isinstance(app, str) or not _PLATFORM.fullmatch(app):
            continue
        channel = channels.setdefault(app, {"platform": app, "record": False, "threads": []})
        channel["threads"].append({"kind": _thread_kind(thread.get("thread_name"), names),
                                   "last_seen": _iso(_time(thread.get("last_seen")))})
    platform = row.get("platform")
    if isinstance(platform, str) and _PLATFORM.fullmatch(platform):
        channels.setdefault(platform, {"platform": platform, "record": False, "threads": []})["record"] = True
    # Normalized ISO strings sort chronologically. Stable sorts: newest first, undated last;
    # channels with equal recency keep "record platform first, then by name".
    for channel in channels.values():
        channel["threads"].sort(key=lambda t: t["last_seen"] or "", reverse=True)
    ordered = sorted(channels.values(), key=lambda c: (not c["record"], c["platform"]))
    ordered.sort(key=lambda c: max((t["last_seen"] for t in c["threads"] if t["last_seen"]), default=""), reverse=True)
    return ordered


def _activity(row, threads, latest, extracted):
    """Latest contact time, and how much it can be trusted.

    exact        contact.last_contact or a thread's last_seen (harvestd sends these only when the
                 source had an absolute message timestamp).
    approximate  a conversation exists but no exact time does. `at` is then the CRM's own latest
                 activity for the contact — when it last received a summary (or thread) — which is
                 an upper bound, never presented as the message time.
    none         nothing synced beyond the contact record (e.g. a group-roster member).
    """
    last_contact = _time(row.get("last_contact"))
    seen = [moment for moment in (_time(t.get("last_seen")) for t in threads if isinstance(t, dict)) if moment]
    exact = max([moment for moment in [last_contact] + seen if moment], default=None)
    flagged = isinstance(extracted, dict) and extracted.get("last_contact_approximate") is True
    if exact:
        basis = "last_contact" if last_contact and last_contact == exact else "thread"
        return {"state": "exact", "at": _iso(exact), "basis": basis, "source_approximate": flagged}
    summary_at = _time(latest.get("created_at")) if isinstance(latest, dict) else None
    thread_sync = max([moment for moment in (_time(t.get("updated_at")) or _time(t.get("created_at"))
                                             for t in threads if isinstance(t, dict)) if moment], default=None)
    evidence = bool(threads) or isinstance(latest, dict) or bool(_count(row.get("thread_count"))) \
        or bool(_count(row.get("extract_count")))
    if not evidence:
        return {"state": "none", "at": None, "basis": None, "source_approximate": False}
    if summary_at and (not thread_sync or summary_at >= thread_sync):
        return {"state": "approximate", "at": _iso(summary_at), "basis": "summary_synced", "source_approximate": flagged}
    return {"state": "approximate", "at": _iso(thread_sync), "basis": "thread_synced" if thread_sync else None,
            "source_approximate": flagged}


def project(row):
    """The allowlisted card for one CRM contact row (with `threads` and `latest_extract`)."""
    name = _text(row.get("name"), LIMITS["name"]) or "Unnamed contact"
    aliases, known = [], {_same_name(name)}
    for alias in row.get("aliases") if isinstance(row.get("aliases"), list) else []:
        alias = _text(alias, LIMITS["alias"])
        if alias and _same_name(alias) not in known:     # the CRM unions aliases case-insensitively too
            known.add(_same_name(alias))
            aliases.append(alias)
    aliases = aliases[:LIMITS["aliases"]]
    threads = [t for t in row["threads"] if isinstance(t, dict)] if isinstance(row.get("threads"), list) else []
    latest = row.get("latest_extract") if isinstance(row.get("latest_extract"), dict) else None
    extracted = latest.get("extracted_json") if latest and isinstance(latest.get("extracted_json"), dict) else {}
    dates = extracted.get("dates") if isinstance(extracted.get("dates"), list) else []
    stage = row.get("stage") if row.get("stage") in STAGES else "unknown"
    names = {_same_name(name)} | {_same_name(alias) for alias in aliases}
    return {
        "id": row["id"],
        "name": name,
        "aliases": aliases,
        "role": _text(row.get("role"), LIMITS["role"]),
        "school": _text(row.get("school"), LIMITS["school"]),
        "stage": stage,
        "notes": _text(row.get("notes"), LIMITS["notes"]),
        "summary": _text(extracted.get("summary"), LIMITS["summary"]),
        "next_action": _text(extracted.get("next_action"), LIMITS["next_action"]),
        "dates": [d for d in (_text(d, LIMITS["date"]) for d in dates) if d][:LIMITS["dates"]],
        "summary_at": _iso(_time(latest.get("created_at"))) if latest else None,
        "thread_count": _count(row.get("thread_count")) or 0,
        "extract_count": _count(row.get("extract_count")) or 0,
        "last_contact": _iso(_time(row.get("last_contact"))),
        "first_seen": _iso(_time(row.get("first_seen"))),
        "updated_at": _iso(_time(row.get("updated_at"))),
        "activity": _activity(row, threads, latest, extracted),
        "channels": _channels(row, threads, names),
    }


def directory(now=None):
    """The browser payload. Raises CrmError with a fixed code on any failure."""
    key = api_key()
    if not key:
        raise CrmError("crm_not_configured", 503)
    rows, total, truncated = fetch_contacts(base_url(), key)
    fetched = now or datetime.now(timezone.utc)
    return {"ok": True, "fetched_at": _iso(fetched), "total": total, "truncated": truncated,
            "contacts": [project(row) for row in rows]}


def api_response(now=None):
    """(status, json body, extra headers) for GET /admin/api/crm/contacts."""
    try:
        return 200, directory(now), []
    except CrmError as error:
        body = {"ok": False, "error": error.code}
        headers = []
        if error.retry_after:
            body["retry_after"] = error.retry_after
            headers.append(("Retry-After", str(error.retry_after)))
        return error.status, body, headers


# ----------------------------------------------------------------------------------------- page
def _inline_safe(source, tag):
    # Client code and styles are inlined into <script>/<style>; neither may close its element early.
    if re.search(rf"</{tag}|<!--", source, re.I):
        raise ValueError(f"cannot inline this {tag} safely")
    return source


def page(mount, csrf):
    body = (HERE / "crm_contacts.html").read_text(encoding="utf-8")
    script = _inline_safe((HERE / "crm_contacts.js").read_text(encoding="utf-8"), "script")
    config = json.dumps({"mount": mount, "endpoint": mount.rstrip("/") + "/api/crm/contacts"}).replace("<", "\\u003c")
    body = body.replace("__CRM_CONFIG__", html.escape(config, quote=True)).replace("__CRM_JS__", script)
    css = _inline_safe((HERE / "crm_contacts.css").read_text(encoding="utf-8"), "style")
    return admin_chrome.wrap("CRM contacts", "School relationships", "crm", mount, csrf, body, extra_css=css)
