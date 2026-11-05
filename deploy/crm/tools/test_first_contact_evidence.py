"""First-contact evidence extraction over synthetic self-monitor databases (same table/column names).

    python3 -m unittest discover -s deploy/crm/tools -p 'test_first_contact_evidence.py' -v
"""
import io
import json
import os
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import first_contact_evidence as fce

MANILA = ZoneInfo("Asia/Manila")
TARGET = "mbp-harvestd:https://hiraia.org/api/crm"
SECRET = "SECRET-TEXT call 0917 000 0009"
OBS = """
CREATE TABLE captures (id INTEGER PRIMARY KEY AUTOINCREMENT, captured_at TEXT NOT NULL, app TEXT, bundle_id TEXT, window_title TEXT, status TEXT NOT NULL, error TEXT, ax_json TEXT);
CREATE TABLE conversations (id TEXT PRIMARY KEY, app TEXT NOT NULL, thread_name TEXT NOT NULL, normalized_name TEXT NOT NULL, first_seen TEXT NOT NULL, capture_id INTEGER NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender TEXT, ts TEXT, text_hash TEXT NOT NULL, raw_text TEXT NOT NULL, first_seen TEXT NOT NULL, capture_id INTEGER NOT NULL);
CREATE TABLE validated_message_sightings (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL, capture_id INTEGER NOT NULL, profile_hash TEXT NOT NULL, seen_at TEXT NOT NULL);
"""
CRM = """
CREATE TABLE thread_links (conversation_id TEXT NOT NULL, contact_id TEXT NOT NULL, platform TEXT NOT NULL, PRIMARY KEY(conversation_id, contact_id));
CREATE TABLE crm_remote_contacts (target TEXT NOT NULL, contact_id TEXT NOT NULL, remote_id INTEGER NOT NULL, platform TEXT NOT NULL, original_name TEXT NOT NULL, PRIMARY KEY(target, contact_id));
CREATE TABLE crm_remote_threads (target TEXT NOT NULL, conversation_id TEXT NOT NULL, contact_id TEXT NOT NULL, remote_id INTEGER NOT NULL, remote_contact_id INTEGER NOT NULL, original_name TEXT NOT NULL, PRIMARY KEY(target, conversation_id, contact_id));
CREATE TABLE group_conversations (conversation_id TEXT PRIMARY KEY, platform TEXT NOT NULL, confirmed_at TEXT NOT NULL, allow_model_stage_updates INTEGER NOT NULL DEFAULT 0);
CREATE TABLE group_participant_bindings (conversation_id TEXT NOT NULL, participant_key TEXT NOT NULL, contact_id TEXT NOT NULL);
CREATE TABLE active_evidence_profiles (platform TEXT PRIMARY KEY, source TEXT NOT NULL, profile_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
"""


def z(local_text):
    """'2026-10-29 10:00' Manila -> ISO UTC with Z."""
    return fce.iso(datetime.strptime(local_text, "%Y-%m-%d %H:%M").replace(tzinfo=MANILA))


class Fixture:
    def __init__(self, folder):
        self.dir = folder
        self.obs = sqlite3.connect(os.path.join(folder, "observations.sqlite"))
        self.crm = sqlite3.connect(os.path.join(folder, "crm.sqlite"))
        self.obs.executescript(OBS)
        self.crm.executescript(CRM)
        for platform, source in (("messenger", "ax"), ("telegram", "ocr"), ("viber", "ocr")):
            self.crm.execute("INSERT INTO active_evidence_profiles VALUES(?,?,?,?)", (platform, source, f"active-{platform}", "x"))
        self.n = 0

    def capture(self, at_local, app="messenger"):
        cur = self.obs.execute("INSERT INTO captures(captured_at, app, status) VALUES(?,?,'ok')", (z(at_local), app))
        return cur.lastrowid

    def conversation(self, conv, app, title="Title not used"):
        cap = self.capture("2026-10-01 00:00", app)
        self.obs.execute("INSERT INTO conversations VALUES(?,?,?,?,?,?)", (conv, app, title, title.lower(), z("2026-10-01 00:00"), cap))

    def message(self, conv, ts, capture, sender="Contact", first_seen=None, validated=True, profile=None, sightings=1):
        self.n += 1
        mid = f"m{self.n}"
        seen = first_seen or self.obs.execute("SELECT captured_at FROM captures WHERE id=?", (capture,)).fetchone()[0]
        self.obs.execute("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)", (mid, conv, sender, ts, f"h{self.n}", SECRET, seen, capture))
        app = self.obs.execute("SELECT app FROM conversations WHERE id=?", (conv,)).fetchone()[0]
        if validated:
            for _ in range(sightings):
                self.obs.execute("INSERT INTO validated_message_sightings(message_id, capture_id, profile_hash, seen_at) VALUES(?,?,?,?)",
                                 (mid, capture, profile or f"active-{app}", seen))
        return mid

    def contact(self, local, remote_id, name, platform="messenger"):
        self.crm.execute("INSERT INTO crm_remote_contacts VALUES(?,?,?,?,?)", (TARGET, local, remote_id, platform, name))

    def link(self, conv, local, platform="messenger", crm_thread=None, remote_id=None):
        self.crm.execute("INSERT INTO thread_links VALUES(?,?,?)", (conv, local, platform))
        if crm_thread:
            self.crm.execute("INSERT INTO crm_remote_threads VALUES(?,?,?,?,?,?)", (TARGET, conv, local, crm_thread, remote_id, "label"))

    def group(self, conv, platform="messenger"):
        self.crm.execute("INSERT INTO group_conversations VALUES(?,?,?,0)", (conv, platform, "x"))

    def bind(self, conv, roster_name, local):
        self.crm.execute("INSERT INTO group_participant_bindings VALUES(?,?,?)", (conv, fce.speaker_key(conv, roster_name), local))

    def done(self):
        self.obs.commit()
        self.crm.commit()
        self.obs.close()
        self.crm.close()


class LabelTests(unittest.TestCase):
    anchor = datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc)   # Thursday 10:00 in Manila

    def parse(self, label, anchor=None):
        result = fce.parse_label(label, anchor or self.anchor, MANILA)
        return None if result is None else (result[0].astimezone(MANILA).strftime("%a %Y-%m-%d %H:%M"), result[1], result[2], result[3])

    def test_absolute_iso_is_exact(self):
        self.assertEqual(self.parse("2026-10-12T07:45:00.000000Z")[:3], ("Mon 2026-10-12 15:45", "exact", "message_timestamp"))
        self.assertEqual(self.parse("2026-10-12T15:45:00+08:00")[:3], ("Mon 2026-10-12 15:45", "exact", "message_timestamp"))

    def test_messenger_relative_labels_resolve_against_the_capture(self):
        self.assertEqual(self.parse("Wednesday 9:41am")[:3], ("Wed 2026-10-28 09:41", "approximate", "relative_label"))
        self.assertEqual(self.parse("Monday 12:05pm")[0], "Mon 2026-10-26 12:05")
        self.assertEqual(self.parse("9:41 AM")[0], "Thu 2026-10-29 09:41")
        self.assertEqual(self.parse("Wednesday\n9:41 am")[0], "Wed 2026-10-28 09:41")       # multiline, NBSP
        self.assertEqual(self.parse("Yesterday 10:42")[0], "Wed 2026-10-28 10:42")
        thursday = self.parse("Thursday 8:00am")
        self.assertEqual(thursday[0], "Thu 2026-10-22 08:00")                                      # same weekday: a week back
        self.assertIn("weekday label on its capture day read as one week earlier", thursday[3])

    def test_time_labels_crossing_midnight_move_to_the_previous_day(self):
        after_midnight = datetime(2026, 10, 29, 16, 5, tzinfo=timezone.utc)   # Friday 00:05 in Manila
        parsed = self.parse("11:58 PM", after_midnight)
        self.assertEqual(parsed[0], "Thu 2026-10-29 23:58")
        self.assertIn("time label crossed midnight", parsed[3])

    def test_calendar_labels_without_offset_are_approximate(self):
        self.assertEqual(self.parse("October 12, 2026, 3:45 PM")[:3], ("Mon 2026-10-12 15:45", "approximate", "message_timestamp"))
        self.assertIn("date only", self.parse("12 October 2026")[3])

    def test_unreadable_labels(self):
        for label in ("Wedn 9:61am", "13:61", "25:00", "Someday 9:00", "9:41 XM", "Octember 3, 2026"):
            self.assertIsNone(self.parse(label), label)


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        f = self.f = Fixture(self.folder.name)
        thu = f.capture("2026-10-29 10:00")
        # A: direct Messenger with a CRM thread: exact calendar timestamp is the earliest.
        f.conversation("m1", "messenger"); f.contact("l1", 3, "Noel Abarca"); f.link("m1", "l1", crm_thread=7, remote_id=3)
        f.message("m1", "Wednesday 9:41am", thu, sender="You")
        f.message("m1", "2026-10-12T07:45:00.000000Z", thu, sender="Noel Abarca")
        f.message("m1", "9:41 AM", thu, sender="You", sightings=3)                               # duplicate sightings
        # B: relative labels only, no CRM thread.
        f.conversation("m2", "messenger"); f.contact("l2", 4, "Jocelyn Tabora"); f.link("m2", "l2")
        f.message("m2", "Thursday 8:00am", thu, sender="You")
        f.message("m2", "Wednesday 9:41am", thu, sender="Jocelyn Tabora")
        # C: Telegram OCR: no timestamps, no senders; a malformed label and an implausible date fall back.
        f.conversation("t1", "telegram"); f.contact("l3", 6, "Rogelio Dimalanta", "telegram"); f.link("t1", "l3", "telegram")
        late = f.capture("2026-10-25 09:00", "telegram")
        f.message("t1", None, f.capture("2026-10-20 13:00", "telegram"), sender=None)
        f.message("t1", "Wedn 9:61am", late, sender=None)
        f.message("t1", "2001-01-01T00:00:00Z", late, sender=None)
        # D: two platforms for one contact: an earlier Telegram observation beats a later Messenger timestamp.
        f.conversation("m3", "messenger"); f.conversation("t2", "telegram"); f.contact("l4", 8, "Emmy Lou")
        f.link("m3", "l4", crm_thread=4, remote_id=8); f.link("t2", "l4", "telegram")
        f.message("m3", "2026-10-15T01:00:00.000000Z", thu)
        f.message("t2", None, f.capture("2026-10-10 08:00", "telegram"), sender=None)
        # E: registered group: only the bound participant's attributed messages count.
        f.conversation("g1", "messenger"); f.group("g1")
        f.contact("l5", 9, "Ana Cruz"); f.link("g1", "l5"); f.bind("g1", "Ana Cruz", "l5")
        f.contact("l6", 10, "Cristina Joy Navarro"); f.link("g1", "l6"); f.bind("g1", "Cristina Joy Navarro", "l6")
        f.message("g1", "2026-10-05T02:00:00.000000Z", thu, sender="Ana Cruz")
        f.message("g1", "2026-10-01T02:00:00.000000Z", thu, sender="Ben")
        f.message("g1", "2026-10-02T02:00:00.000000Z", thu, sender="Carla")                   # display label != roster name
        # F: an earlier message that only an old parser profile validated is ignored.
        f.message("m1", "2026-09-01T00:00:00.000000Z", thu, profile="old-profile")
        f.message("m1", "2026-09-02T00:00:00.000000Z", thu, validated=False)
        # G: a group-only Telegram participant (OCR, no senders).
        f.conversation("tg", "telegram"); f.group("tg", "telegram")
        f.contact("l7", 12, "Bembol", "telegram"); f.link("tg", "l7", "telegram"); f.bind("tg", "Bembol", "l7")
        f.message("tg", None, f.capture("2026-10-21 08:00", "telegram"), sender=None)
        f.done()
        manual = os.path.join(self.folder.name, "manual-crm")
        os.mkdir(manual)
        with open(os.path.join(manual, "2026-11-05-rosario-new-verified.json"), "w") as h:
            json.dump({"saved": {"contact": {"id": 21, "name": "Rosario Villaflor", "platform": "viber", "notes": SECRET, "is_test": False}, "threads": []}}, h)
        self.rows, self.items = fce.build(self.folder.name, TARGET, "Asia/Manila", manual)
        self.by_id = {r["id"]: r for r in self.rows}

    def winner(self, cid):
        w = self.by_id[cid]["winner"]
        return None if not w else (w["best"]["at"].astimezone(MANILA).strftime("%Y-%m-%d %H:%M"), w["best"]["quality"], w["best"]["basis"], w["platform"], w["kind"], w.get("thread"))

    def test_direct_conversation_earliest_exact_message_wins(self):
        self.assertEqual(self.winner(3), ("2026-10-12 15:45", "exact", "message_timestamp", "messenger", "direct", 7))
        stats = self.by_id[3]["evaluated"][0]["stats"]
        self.assertEqual((stats["considered"], stats["unvalidated"]), (3, 2))                 # old-profile and unvalidated ignored

    def test_relative_only_conversation_is_approximate_and_flagged(self):
        self.assertEqual(self.winner(4), ("2026-10-22 08:00", "approximate", "relative_label", "messenger", "direct", None))
        self.assertIn("weekday label on its capture day read as one week earlier", fce.notes_for(self.by_id[4]["evaluated"][0]))

    def test_telegram_without_timestamps_uses_first_observed_and_counts_bad_labels(self):
        self.assertEqual(self.winner(6), ("2026-10-20 13:00", "approximate", "first_observed", "telegram", "direct", None))
        self.assertEqual(self.by_id[6]["evaluated"][0]["stats"]["malformed"], 2)

    def test_minimum_across_platforms_and_thread_ids_only_for_exported_conversations(self):
        self.assertEqual(self.winner(8), ("2026-10-10 08:00", "approximate", "first_observed", "telegram", "direct", None))
        items = [i for i in self.items if i["contact_id"] == 8]
        self.assertEqual(sorted((i["platform"], i.get("thread_id")) for i in items), [("messenger", 4), ("telegram", None)])

    def test_groups_count_only_attributed_messages(self):
        self.assertEqual(self.winner(9), ("2026-10-05 10:00", "exact", "message_timestamp", "messenger", "group", None))
        self.assertIsNone(self.winner(10))                                                    # "Carla" is not the roster name
        self.assertIn("none attributable", " ".join(fce.notes_for(self.by_id[10]["evaluated"][0])))
        self.assertIsNone(self.winner(12))
        self.assertIn("OCR messages carry no sender", " ".join(fce.notes_for(self.by_id[12]["evaluated"][0])))

    def test_manual_contacts_are_reported_unavailable(self):
        self.assertTrue(self.by_id[21].get("manual"))
        self.assertIsNone(self.by_id[21]["winner"])

    def test_bundle_shape_is_deterministic_and_text_free(self):
        rows, again = fce.build(self.folder.name, TARGET, "Asia/Manila", os.path.join(self.folder.name, "manual-crm"))
        self.assertEqual(again, self.items)
        self.assertEqual({tuple(sorted(i)) for i in self.items} - {tuple(sorted(i)) for i in self.items if "thread_id" in i},
                         {("basis", "contact_id", "contact_name", "conversation_kind", "direction", "evidence_key", "first_message_at", "platform", "quality")})
        self.assertTrue(all(i["evidence_key"].startswith("fm1:") and len(i["evidence_key"]) == 44 for i in self.items))
        out = io.StringIO()
        counts = fce.report(self.rows, "Asia/Manila", TARGET, out)
        text = out.getvalue() + json.dumps(self.items)
        for leak in ("SECRET", "0917", "000 0009", "Title not used", "m1", "t1", "g1"):
            self.assertNotIn(leak, text.replace("fm1:", ""), leak)
        self.assertEqual(counts, {"exact": 2, "approximate": 3, "unavailable": 3})

    def test_cli_writes_a_private_bundle(self):
        out = os.path.join(self.folder.name, "bundle.json")
        with open(os.devnull, "w") as sink:
            import contextlib
            with contextlib.redirect_stdout(sink):
                fce.main(["--data-dir", self.folder.name, "--out", out])
        self.assertEqual(os.stat(out).st_mode & 0o777, 0o600)
        with open(out) as h:
            bundle = json.load(h)
        self.assertEqual((bundle["format"], len(bundle["items"])), (fce.BUNDLE_FORMAT, len(self.items)))


if __name__ == "__main__":
    unittest.main()
