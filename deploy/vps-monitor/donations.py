"""Donations — /admin/donations: crypto donations confirmed on hiraia.org, with a "thanked" marker.

Source of truth is the website's private SQLite database (HIRAIA_DB_PATH, the same file the
telemetry pages read). Rows arrive from thirdweb's signed checkout webhook
(packages/web/src/app/api/donations/webhook, `source` = 'checkout'); the chain watcher will add
direct transfers later as `source` = 'direct'. This page only reads them and records whether Luis
has thanked an identified donor (`thanked_at`, `thank_note`).

Privacy: donor emails are volunteered only so Luis can say thanks. They are never exported, shared
or shown outside this signed-in page. Retention matches the website: email sessions that never paid
are deleted after 7 days; a donation's email and thank-you note are cleared 180 days after it
was confirmed (the row stays, anonymous). Both are enforced here on every read as well, so nothing
outlives the window just because the website was quiet.
"""
import html
import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import admin_chrome

HERE = Path(__file__).resolve().parent
SESSION_TTL_DAYS = 7
EMAIL_TTL_DAYS = 180
NOTE_MAX = 500
LIMIT = 1000
CHAINS = {
    1: ("Ethereum", "https://etherscan.io"),
    8453: ("Base", "https://basescan.org"),
    42161: ("Arbitrum", "https://arbiscan.io"),
}
_PAYMENT_ID = re.compile(r"[\x21-\x7e]{1,200}")
_TX = re.compile(r"0x[0-9a-fA-F]{64}")


class DonationsError(Exception):
    def __init__(self, code, status=503):
        super().__init__(code)
        self.code, self.status = code, status


def _db_path():
    path = os.environ.get("HIRAIA_DB_PATH")
    if not path:
        raise DonationsError("donations_not_configured")
    return path


def _connect(write=False):
    path = Path(_db_path()).resolve()
    if not path.exists():
        raise DonationsError("donations_unavailable")
    uri = path.as_uri() + ("" if write else "?mode=ro")
    db = sqlite3.connect(uri, uri=True, timeout=3)
    db.row_factory = sqlite3.Row
    return db


def _columns(db):
    return {r["name"] for r in db.execute("PRAGMA table_info(donations)")}


def purge():
    """Retention, mirrored from the website (src/server/donations.ts)."""
    db = _connect(write=True)
    try:
        if not _columns(db):
            return
        with db:
            db.execute("DELETE FROM donation_sessions WHERE created_at < datetime('now', ?)", (f"-{SESSION_TTL_DAYS} days",))
            note = ", thank_note = NULL" if "thank_note" in _columns(db) else ""
            db.execute(f"UPDATE donations SET email = NULL{note} WHERE email IS NOT NULL AND confirmed_at < datetime('now', ?)",
                       (f"-{EMAIL_TTL_DAYS} days",))
    finally:
        db.close()


def _iso(text):
    # SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS" in UTC.
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError):
        return None


def _project(row, cols):
    name, explorer = CHAINS.get(row["chain_id"], (f"Chain {row['chain_id']}", None))
    try:
        txs = [t for t in json.loads(row["tx_hashes"] or "[]") if _TX.fullmatch(str(t.get("transactionHash", "")))]
    except (ValueError, AttributeError):
        txs = []
    tx = txs[-1]["transactionHash"] if txs else None
    get = lambda c, default=None: row[c] if c in cols else default  # noqa: E731
    return {
        "id": row["payment_id"],
        "email": row["email"],
        "amount": row["amount"],
        "token": row["token_symbol"],
        "network": name,
        "chain_id": row["chain_id"],
        "tx": tx,
        "tx_url": f"{explorer}/tx/{tx}" if tx and explorer else None,
        "confirmed_at": _iso(row["confirmed_at"]),
        "source": get("source", "checkout") or "checkout",
        "test": bool(get("test", 0)),
        "alert": row["notified"],
        "thanked_at": _iso(get("thanked_at")),
        "thank_note": get("thank_note") or "",
    }


def listing(now=None):
    purge()
    db = _connect()
    try:
        cols = _columns(db)
        if not cols:
            rows, pending = [], 0
        else:
            rows = db.execute("SELECT * FROM donations ORDER BY confirmed_at DESC LIMIT ?", (LIMIT,)).fetchall()
            pending = db.execute("SELECT count(*) FROM donation_sessions").fetchone()[0]
    except sqlite3.Error:
        raise DonationsError("donations_unavailable")
    finally:
        db.close()
    donations = [_project(r, cols) for r in rows]
    fetched = now or datetime.now(timezone.utc)
    return {"ok": True, "fetched_at": fetched.isoformat().replace("+00:00", "Z"), "donations": donations,
            "pending_sessions": pending, "retention": {"sessions_days": SESSION_TTL_DAYS, "email_days": EMAIL_TTL_DAYS}}


def api_response(now=None):
    """(status, json body, extra headers) for GET /admin/api/donations."""
    try:
        return 200, listing(now), []
    except DonationsError as error:
        return error.status, {"ok": False, "error": error.code}, []


def set_thanked(data):
    """POST /admin/api/donations/thanked {payment_id, thanked, note} → (status, body). CSRF checked by the caller."""
    payment_id = data.get("payment_id")
    thanked = data.get("thanked")
    note = data.get("note", "")
    if not isinstance(payment_id, str) or not _PAYMENT_ID.fullmatch(payment_id):
        return 400, {"ok": False, "error": "bad_payment_id"}
    if not isinstance(thanked, bool) or not isinstance(note, str):
        return 400, {"ok": False, "error": "bad_request"}
    note = note.strip()[:NOTE_MAX]
    try:
        db = _connect(write=True)
    except DonationsError as error:
        return error.status, {"ok": False, "error": error.code}
    try:
        if not {"thanked_at", "thank_note"} <= _columns(db):
            return 503, {"ok": False, "error": "donations_schema_old"}
        row = db.execute("SELECT email, thanked_at FROM donations WHERE payment_id = ?", (payment_id,)).fetchone()
        if row is None:
            return 404, {"ok": False, "error": "not_found"}
        if row["email"] is None:
            return 409, {"ok": False, "error": "anonymous"}
        with db:
            if thanked:
                db.execute("UPDATE donations SET thanked_at = COALESCE(thanked_at, datetime('now')), thank_note = ? WHERE payment_id = ?",
                           (note or None, payment_id))
            else:
                db.execute("UPDATE donations SET thanked_at = NULL, thank_note = ? WHERE payment_id = ?", (note or None, payment_id))
        cols = _columns(db)
        fresh = db.execute("SELECT * FROM donations WHERE payment_id = ?", (payment_id,)).fetchone()
        return 200, {"ok": True, "donation": _project(fresh, cols)}
    except sqlite3.Error:
        return 503, {"ok": False, "error": "donations_unavailable"}
    finally:
        db.close()


# ----------------------------------------------------------------------------------------- page
def _inline_safe(source, tag):
    if re.search(rf"</{tag}|<!--", source, re.I):
        raise ValueError(f"cannot inline this {tag} safely")
    return source


def page(mount, csrf):
    body = (HERE / "donations.html").read_text(encoding="utf-8")
    script = _inline_safe((HERE / "donations.js").read_text(encoding="utf-8"), "script")
    base = mount.rstrip("/")
    config = json.dumps({"endpoint": base + "/api/donations", "thankedEndpoint": base + "/api/donations/thanked",
                         "csrf": csrf, "noteMax": NOTE_MAX}).replace("<", "\\u003c")
    body = body.replace("__DON_CONFIG__", html.escape(config, quote=True)).replace("__DON_JS__", script)
    css = _inline_safe((HERE / "donations.css").read_text(encoding="utf-8"), "style")
    return admin_chrome.wrap("Donations", "Crypto donors", "donations", mount, csrf, body, extra_css=css)
