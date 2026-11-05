#!/usr/bin/env python3
"""First-contact evidence from the self-monitor's local capture databases. Read-only; runs on the MBP.

For every CRM contact the harvestd sync knows (crm_remote_contacts), find the earliest recorded message
across every conversation linked to it, on every platform, and write:

  * a coverage report on stdout: per contact, the derived first contact or "unavailable", which platform
    and conversation it came from, how good it is, and any ambiguity. Never message text, conversation
    titles or phone numbers.
  * --out FILE: an evidence bundle (format hiraia-first-contact-evidence/1) for
    `node maintenance.cjs apply-first-contact FILE` on the origin. It holds only CRM ids, opaque
    per-conversation keys, UTC timestamps and quality labels.

Evidence rules
  * Only messages validated under the platform's active parser profile count.
  * Direct conversation: any message, incoming or outgoing. Group conversation: only messages whose
    sender maps to the contact's participant key (self-snooper's own "group-speaker" digest, AX only).
    OCR group messages carry no sender, so a group-only participant is reported unattributable.
  * A message's time, strongest first:
      exact        an absolute timestamp in the source (calibrated calendar label, ISO with offset);
      approximate  a relative label ("Wednesday 9:41am", "9:41 AM", "Yesterday 10:42") resolved against
                   the capture that recorded it, in --label-timezone;
      approximate  no timestamp at all (or an unreadable one): the time the message was first observed,
                   an upper bound for when it was sent.
    Record bookkeeping (contact/conversation first_seen, extract times, imports) is never used.
  * "Earliest recorded": capture only sees what was on screen, so history before capture began is
    unknown. The report flags conversations whose earliest message was already on screen in their first
    capture.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sqlite3
import sys
import unicodedata
import urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

BUNDLE_FORMAT = "hiraia-first-contact-evidence/1"
DEFAULT_DATA = os.path.expanduser("~/Library/Application Support/HiraiaSelfMonitor")
DEFAULT_TARGET = "mbp-harvestd:https://hiraia.org/api/crm"
EARLIEST = datetime(2004, 2, 4, tzinfo=timezone.utc)
SELF_SENDERS = {"You", "You sent"}
QUALITY_RANK = {"exact": 0, "approximate": 1}
BASIS_RANK = {"message_timestamp": 0, "relative_label": 1, "first_observed": 2}
WEEKDAYS = {name: i for i, names in enumerate([("monday", "mon"), ("tuesday", "tue", "tues"), ("wednesday", "wed"),
                                               ("thursday", "thu", "thur", "thurs"), ("friday", "fri"),
                                               ("saturday", "sat"), ("sunday", "sun")]) for name in names}
MONTHS = {name: i + 1 for i, names in enumerate([("january", "jan"), ("february", "feb"), ("march", "mar"), ("april", "apr"),
                                                 ("may",), ("june", "jun"), ("july", "jul"), ("august", "aug"),
                                                 ("september", "sep", "sept"), ("october", "oct"), ("november", "nov"),
                                                 ("december", "dec")]) for name in names}
TIME = r"(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([ap])\.?\s*m\.?)?"


def digest(*parts):
    """Mirror of self_snooper.observations.digest (stable JSON, SHA-256)."""
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def speaker_key(conversation_id, sender):
    """Mirror of self_snooper.groups._speaker's id for an AX sender label."""
    name = unicodedata.normalize("NFC", " ".join(sender.split()))
    return digest("group-speaker", conversation_id, name)


def evidence_key(conversation_id):
    return "fm1:" + hashlib.sha256(f"hiraia-first-message-v1|{conversation_id}".encode()).hexdigest()[:40]


def utc(value):
    """A tz-aware ISO string -> aware UTC datetime, else None."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def iso(moment):
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean_label(value):
    text = unicodedata.normalize("NFKC", value)
    return " ".join(text.replace(" ", " ").replace(" ", " ").split())


def _clock(hour, minute, meridiem):
    hour, minute = int(hour), int(minute)
    if minute > 59:
        return None
    if meridiem:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12 + (12 if meridiem.lower() == "p" else 0)
    elif hour > 23:
        return None
    return hour, minute


def parse_label(raw, anchor, zone):
    """One message's own time. Returns (utc datetime, quality, basis, flags) or None when unreadable.

    `anchor` is when the capture that recorded the label was taken (aware UTC); relative labels are read
    in `zone` as of that moment.
    """
    if raw is None or not str(raw).strip():
        return None
    text = clean_label(str(raw))
    flags = []
    absolute = utc(text)
    if absolute:
        return absolute, "exact", "message_timestamp", flags
    try:  # an ISO string without an offset: the moment is exact only up to the assumed zone
        naive = datetime.fromisoformat(text)
        return naive.replace(tzinfo=zone).astimezone(timezone.utc), "approximate", "message_timestamp", ["timezone assumed"]
    except ValueError:
        pass
    local = anchor.astimezone(zone)
    lower = text.lower()

    m = re.fullmatch(TIME, lower)
    if m:
        clock = _clock(*m.groups())
        if not clock:
            return None
        moment = local.replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)
        if moment > local + timedelta(minutes=5):        # rendered before midnight, captured after it
            moment -= timedelta(days=1)
            flags.append("time label crossed midnight")
        return moment.astimezone(timezone.utc), "approximate", "relative_label", flags

    m = re.fullmatch(r"(today|yesterday)\s*,?\s*(?:at\s+)?" + TIME, lower)
    if m:
        clock = _clock(*m.groups()[1:])
        if not clock:
            return None
        day = local.date() - timedelta(days=1 if m.group(1) == "yesterday" else 0)
        moment = datetime(day.year, day.month, day.day, clock[0], clock[1], tzinfo=zone)
        return moment.astimezone(timezone.utc), "approximate", "relative_label", flags

    m = re.fullmatch(r"([a-z]+)\s*,?\s*(?:at\s+)?" + TIME, lower)
    if m and m.group(1) in WEEKDAYS:
        clock = _clock(*m.groups()[1:])
        if not clock:
            return None
        back = (local.weekday() - WEEKDAYS[m.group(1)]) % 7
        if back == 0:                                     # today shows a bare time, so this is a week ago
            back = 7
            flags.append("weekday label on its capture day read as one week earlier")
        day = local.date() - timedelta(days=back)
        moment = datetime(day.year, day.month, day.day, clock[0], clock[1], tzinfo=zone)
        return moment.astimezone(timezone.utc), "approximate", "relative_label", flags

    m = re.fullmatch(r"([a-z]+)\.? (\d{1,2}),? (\d{4})(?:,?\s*(?:at\s+)?" + TIME + ")?", lower) or \
        re.fullmatch(r"(\d{1,2}) ([a-z]+)\.?,? (\d{4})(?:,?\s*(?:at\s+)?" + TIME + ")?", lower)
    if m:
        a, b, year = m.group(1), m.group(2), int(m.group(3))
        month, day = (MONTHS.get(a), b) if a in MONTHS else (MONTHS.get(b), a)
        if not month:
            return None
        clock = (0, 0)
        if m.group(4):
            clock = _clock(m.group(4), m.group(5), m.group(6))
            if not clock:
                return None
        else:
            flags.append("date only")
        try:
            moment = datetime(year, month, int(day), clock[0], clock[1], tzinfo=zone)
        except ValueError:
            return None
        flags.append("timezone assumed")
        return moment.astimezone(timezone.utc), "approximate", "message_timestamp", flags
    return None


def plausible(moment, anchor):
    return EARLIEST <= moment <= anchor + timedelta(days=1)


def rank(candidate):
    return candidate["at"], QUALITY_RANK[candidate["quality"]], BASIS_RANK[candidate["basis"]]


def open_ro(path):
    db = sqlite3.connect(f"file:{urllib.parse.quote(path)}?mode=ro", uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def evaluate_conversation(obs, conversation_id, profile, source, zone, participant_keys=None):
    """Earliest recorded message of one conversation (optionally only one participant's messages)."""
    stats = {"messages": 0, "considered": 0, "unvalidated": 0, "malformed": 0, "unattributed": 0}
    first_capture = obs.execute("SELECT MIN(capture_id) FROM messages WHERE conversation_id=?", (conversation_id,)).fetchone()[0]
    rows = obs.execute(
        "SELECT m.id, m.sender, m.ts, m.first_seen, m.capture_id, c.captured_at, "
        "(SELECT MIN(v.seen_at) FROM validated_message_sightings v WHERE v.message_id=m.id AND v.profile_hash=?) AS validated_at "
        "FROM messages m JOIN captures c ON c.id=m.capture_id WHERE m.conversation_id=?", (profile, conversation_id)).fetchall()
    best = None
    for row in rows:
        stats["messages"] += 1
        if row["validated_at"] is None:
            stats["unvalidated"] += 1
            continue
        if participant_keys is not None:
            if source != "ax" or not isinstance(row["sender"], str) or speaker_key(conversation_id, row["sender"]) not in participant_keys:
                stats["unattributed"] += 1
                continue
        stats["considered"] += 1
        anchor = utc(row["captured_at"])
        observed = min(t for t in (utc(row["first_seen"]), utc(row["validated_at"]), anchor) if t is not None)
        parsed = parse_label(row["ts"], anchor or observed, zone) if row["ts"] not in (None, "") else None
        if parsed and not plausible(parsed[0], anchor or observed):
            parsed = None
            stats["malformed"] += 1
        elif parsed is None and row["ts"] not in (None, ""):
            stats["malformed"] += 1
        if parsed:
            at, quality, basis, flags = parsed
        else:
            at, quality, basis, flags = observed, "approximate", "first_observed", []
        sender = row["sender"]
        candidate = {"at": at, "quality": quality, "basis": basis, "flags": flags,
                     "direction": "outgoing" if sender in SELF_SENDERS else "incoming" if sender else "unknown",
                     "first_capture": row["capture_id"] == first_capture}
        if best is None or rank(candidate) < rank(best):
            best = candidate
    return best, stats


def manual_contacts(directory):
    """Contacts created or edited by hand (manual-crm audit snapshots): id -> (name, platform, threads)."""
    found = {}
    for path in sorted(glob.glob(os.path.join(directory, "*-verified.json"))):
        try:
            with open(path, encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError):
            continue
        saved = data.get("saved") if isinstance(data, dict) else None
        if isinstance(saved, dict) and isinstance(saved.get("contact"), dict):
            c = saved["contact"]
            if isinstance(c.get("id"), int) and not c.get("is_test"):
                found[c["id"]] = (c.get("name"), c.get("platform"), len(saved.get("threads") or []))
    return found


def build(data_dir, target, zone_name, manual_dir=None):
    zone = ZoneInfo(zone_name)
    crm = open_ro(os.path.join(data_dir, "crm.sqlite"))
    obs = open_ro(os.path.join(data_dir, "observations.sqlite"))
    try:
        profiles = {r["platform"]: (r["profile_hash"], r["source"]) for r in crm.execute("SELECT platform, profile_hash, source FROM active_evidence_profiles")}
        groups = {r[0] for r in crm.execute("SELECT conversation_id FROM group_conversations")}
        keys = {}
        for r in crm.execute("SELECT conversation_id, participant_key, contact_id FROM group_participant_bindings"):
            keys.setdefault((r["conversation_id"], r["contact_id"]), set()).add(r["participant_key"])
        remote = {}
        for r in crm.execute("SELECT contact_id, remote_id, platform, original_name FROM crm_remote_contacts WHERE target=?", (target,)):
            entry = remote.setdefault(r["remote_id"], {"name": r["original_name"], "platform": r["platform"], "local": []})
            entry["local"].append(r["contact_id"])
        threads = {(r["conversation_id"], r["remote_contact_id"]): r["remote_id"]
                   for r in crm.execute("SELECT conversation_id, remote_id, remote_contact_id FROM crm_remote_threads WHERE target=?", (target,))}
        links = {}
        for r in crm.execute("SELECT conversation_id, contact_id, platform FROM thread_links"):
            links.setdefault(r["contact_id"], []).append((r["conversation_id"], r["platform"]))
        rows, items = [], []
        for remote_id in sorted(remote):
            entry = remote[remote_id]
            # One evaluation per conversation, even when several local contacts map to this CRM contact.
            convs = {}
            for local in entry["local"]:
                for conv, platform in links.get(local, []):
                    convs.setdefault(conv, (platform, set()))[1].add(local)
            evaluated = []
            for conv in sorted(convs):
                platform, locals_ = convs[conv]
                app_row = obs.execute("SELECT app FROM conversations WHERE id=?", (conv,)).fetchone()
                app = app_row["app"] if app_row else platform
                profile, source = profiles.get(app, (None, None))
                kind = "group" if conv in groups else "direct"
                participant = set().union(*(keys.get((conv, local), set()) for local in locals_)) if kind == "group" else None
                if profile is None:
                    evaluated.append({"conv": conv, "platform": app, "kind": kind, "best": None, "stats": {}, "note": "no active parser profile for this platform"})
                    continue
                best, stats = evaluate_conversation(obs, conv, profile, source, zone, participant)
                evaluated.append({"conv": conv, "platform": app, "kind": kind, "best": best, "stats": stats,
                                  "thread": threads.get((conv, remote_id)), "source": source})
            usable = [e for e in evaluated if e["best"]]
            for e in usable:
                b = e["best"]
                item = {"contact_id": remote_id, "contact_name": entry["name"], "evidence_key": evidence_key(e["conv"]),
                        "platform": e["platform"], "conversation_kind": e["kind"], "first_message_at": iso(b["at"]),
                        "quality": b["quality"], "basis": b["basis"], "direction": b["direction"]}
                if e["thread"]:
                    item["thread_id"] = e["thread"]
                items.append(item)
            winner = min(usable, key=lambda e: rank(e["best"])) if usable else None
            rows.append({"id": remote_id, "name": entry["name"], "evaluated": evaluated, "winner": winner})
        manual = manual_contacts(manual_dir) if manual_dir and os.path.isdir(manual_dir) else {}
        for mid, (name, platform, n_threads) in sorted(manual.items()):
            if mid not in remote:
                rows.append({"id": mid, "name": name, "evaluated": [], "winner": None, "manual": True, "platform": platform, "threads": n_threads})
        rows.sort(key=lambda r: r["id"])
        items.sort(key=lambda i: (i["contact_id"], i["evidence_key"]))
        return rows, items
    finally:
        crm.close()
        obs.close()


def notes_for(e):
    notes = []
    b, s = e.get("best"), e.get("stats") or {}
    if e.get("note"):
        notes.append(e["note"])
    if e["kind"] == "group" and not b:
        notes.append(f"group conversation: {s.get('unattributed', 0)} message(s), none attributable to this participant"
                     + (" (OCR messages carry no sender)" if e.get("source") == "ocr" else ""))
    elif e["kind"] == "group":
        notes.append("group conversation: only this participant's attributed messages count")
    if b:
        if b["basis"] == "relative_label":
            notes.append("relative label resolved against its capture time")
        if b["basis"] == "first_observed":
            notes.append("no timestamp in the source; time first observed (an upper bound)")
        notes.extend(b["flags"])
        if b["first_capture"]:
            notes.append("already on screen in the first capture (older history may exist)")
    if s.get("malformed"):
        notes.append(f"{s['malformed']} unreadable timestamp(s) ignored")
    if s.get("unvalidated"):
        notes.append(f"{s['unvalidated']} message(s) outside the active parser profile ignored")
    return notes


def report(rows, zone_name, target, out=None):
    out = out or sys.stdout          # resolved per call, so redirected stdout is honoured
    zone = ZoneInfo(zone_name)
    label = {"message_timestamp": "message timestamp", "relative_label": "relative label", "first_observed": "first observed"}
    counts = {"exact": 0, "approximate": 0, "unavailable": 0}
    out.write(f"First-contact coverage — dry run, nothing sent · target {target} · labels read in {zone_name}\n\n")
    for r in rows:
        w = r["winner"]
        head = f"#{r['id']:<3} {(r['name'] or '?')[:30]:<30} "
        if w:
            b = w["best"]
            local = b["at"].astimezone(zone)
            when = local.strftime("%Y-%m-%d %H:%M") if b["quality"] == "exact" else ("≈ " if b["basis"] != "first_observed" else "by ") + local.strftime("%Y-%m-%d")
            where = f"{w['platform'].capitalize()} {w['kind']} " + (f"(CRM thread #{w['thread']})" if w.get("thread") else "(local conversation, no CRM thread)")
            out.write(f"{head}{when:<18} {b['quality']} · {label[b['basis']]} · {where}\n")
            counts[b["quality"]] += 1
        else:
            counts["unavailable"] += 1
            reason = "manual record; no linked conversation in the local capture" if r.get("manual") else "no attributable message evidence"
            out.write(f"{head}{'unavailable':<18} {reason}\n")
        for e in r["evaluated"]:
            mark = "*" if w is e else "-"
            b = e.get("best")
            desc = f"{e['platform']} {e['kind']}" + (f", CRM thread #{e['thread']}" if e.get("thread") else "")
            when = b["at"].astimezone(zone).strftime("%Y-%m-%d %H:%M") + f" {b['quality']}/{label[b['basis']]}" if b else "no evidence"
            notes = notes_for(e)
            out.write(f"      {mark} {desc:<34} {when:<40} {'; '.join(notes)}\n")
    total = sum(counts.values())
    out.write(f"\nCoverage: {total} contacts · {counts['exact']} exact · {counts['approximate']} approximate · {counts['unavailable']} unavailable\n")
    out.write("Earliest *recorded* message: capture sees only what was on screen, so earlier history may exist.\n")
    return counts


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", default=DEFAULT_DATA)
    parser.add_argument("--target", default=DEFAULT_TARGET, help="crm_remote_contacts target (harvestd's)")
    parser.add_argument("--label-timezone", default="Asia/Manila", help="zone the chat apps rendered relative labels in")
    parser.add_argument("--manual-crm-dir", default=None, help="manual-crm audit folder (default: DATA_DIR/manual-crm)")
    parser.add_argument("--out", help="write the evidence bundle here (mode 600)")
    args = parser.parse_args(argv)
    manual_dir = args.manual_crm_dir or os.path.join(args.data_dir, "manual-crm")
    rows, items = build(args.data_dir, args.target, args.label_timezone, manual_dir)
    report(rows, args.label_timezone, args.target)
    if args.out:
        bundle = {"format": BUNDLE_FORMAT, "generated_at": iso(datetime.now(timezone.utc)), "target": args.target,
                  "label_timezone": args.label_timezone, "items": items}
        fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(bundle, handle, indent=1, ensure_ascii=False)
            handle.write("\n")
        print(f"\nbundle: {len(items)} item(s) -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
