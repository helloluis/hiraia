"""CRM contact cards: config, read client, projection and the authenticated admin routes.

Everything runs on loopback against a scripted stand-in for the CRM API; no network, no real data.
    python3 -m unittest discover -s deploy/vps-monitor -p 'test_crm_contacts.py' -v
"""
import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import admin_app
import crm_contacts

KEY = "hcrm_hiraia-admin_" + "A1b2C3d4E5" * 4 + "xyz"
SYNC = "2026-11-01T00:00:00.000Z"


def contact(cid, name, platform="messenger", threads=(), latest=None, **fields):
    """A row exactly as GET /api/crm/contacts?include=threads,latest_extract returns it."""
    row = {"id": cid, "name": name, "platform": platform, "aliases": [], "role": None, "school": None,
           "stage": "unknown", "notes": None, "first_seen": None, "last_contact": None, "is_test": False,
           "created_at": SYNC, "updated_at": SYNC, "thread_count": len(threads),
           "extract_count": 1 if latest else 0, "last_extract_at": latest["created_at"] if latest else None,
           "threads": list(threads), "latest_extract": latest,
           # CRM API 1.2.0 fields (contact_points included on request)
           "organization": None, "organization_source": None, "department": None, "department_source": None,
           "job_title": None, "job_title_source": None, "location": None, "location_source": None,
           "first_contact": None, "first_contact_quality": None, "first_contact_basis": None,
           "first_contact_platform": None, "first_contact_thread_id": None, "first_contact_conversation_kind": None,
           "phones": [], "emails": []}
    row.update(fields)
    return row


def thread(tid, cid, app, label, last_seen=None, updated=SYNC):
    return {"id": tid, "contact_id": cid, "app": app, "thread_name": label, "last_seen": last_seen,
            "created_at": SYNC, "updated_at": updated}


def extract(eid, cid, tid, created, **fields):
    """harvestd's extracted_json: exactly these keys (self-snooper sync.py)."""
    body = {"summary": "", "next_action": None, "dates": [], "classified_stage": "unknown",
            "export_id": "e" * 64, "policy_version": "school-business-v4", "source_checkpoint": "c" * 64,
            "classification_run": 41, "last_contact_approximate": False}
    body.update(fields)
    return {"id": eid, "contact_id": cid, "thread_id": tid, "source_thread": "conv_7Hq2opaque",
            "extracted_json": body, "model_version": "qwen2.5:14b-instruct", "created_at": created}


class FakeCrm:
    """Loopback stand-in for the CRM API. Records each request; `respond` scripts the reply."""

    def __init__(self, respond=None):
        self.requests = []
        self.respond = respond or (lambda request: (200, {"contacts": [], "total": 0}, {}))
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                request = {"path": self.path, "authorization": self.headers.get("Authorization"),
                           "user_agent": self.headers.get("User-Agent")}
                fake.requests.append(request)
                status, body, headers = fake.respond(request)
                raw = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.base = f"{self.origin}/api/crm"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class CrmTestCase(unittest.TestCase):
    def setUp(self):
        crm_contacts._key_cache.update(path=None, sig=None, key="")
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.key_file = os.path.join(self.folder.name, "crm-admin.key")
        with open(self.key_file, "w") as f:
            f.write(KEY + "\n")

    def use(self, fake, **extra):
        env = {"HIRAIA_CRM_API_KEY_FILE": self.key_file, "HIRAIA_CRM_BASE_URL": fake.base, **extra}
        patcher = patch.dict(os.environ, env)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(fake.close)
        return fake


class ConfigTests(CrmTestCase):
    def test_key_file_is_preferred_reread_on_rotation_and_validated(self):
        with patch.dict(os.environ, {"HIRAIA_CRM_API_KEY_FILE": self.key_file, "HIRAIA_CRM_API_KEY": "hcrm_env_" + "z" * 40}):
            self.assertEqual(crm_contacts.api_key(), KEY)
            rotated = "hcrm_hiraia-admin_" + "R" * 43
            with open(self.key_file, "w") as f:
                f.write(rotated)
            os.utime(self.key_file, ns=(time.time_ns(), time.time_ns() + 1_000_000))
            self.assertEqual(crm_contacts.api_key(), rotated)       # no restart needed
            for bad in ("", "short", "hcrm_with space_" + "x" * 30, "hcrm_\x00_" + "x" * 30):
                with open(self.key_file, "w") as f:
                    f.write(bad)
                os.utime(self.key_file, ns=(time.time_ns(), time.time_ns() + 2_000_000))
                self.assertEqual(crm_contacts.api_key(), "", repr(bad))
        with patch.dict(os.environ, {"HIRAIA_CRM_API_KEY_FILE": os.path.join(self.folder.name, "missing")}):
            self.assertEqual(crm_contacts.api_key(), "")

    def test_env_key_is_the_fallback(self):
        with patch.dict(os.environ, {"HIRAIA_CRM_API_KEY": f"  {KEY}\n"}):
            os.environ.pop("HIRAIA_CRM_API_KEY_FILE", None)
            self.assertEqual(crm_contacts.api_key(), KEY)

    def test_base_url_requires_https_except_on_loopback(self):
        good = {"": "https://hiraia.org/api/crm", "https://hiraia.org/api/crm/": "https://hiraia.org/api/crm",
                "http://127.0.0.1:8137/api/crm": "http://127.0.0.1:8137/api/crm",
                "http://localhost:9/api/crm": "http://localhost:9/api/crm", "http://[::1]:9/api/crm": "http://[::1]:9/api/crm"}
        for raw, expected in good.items():
            with patch.dict(os.environ, {"HIRAIA_CRM_BASE_URL": raw}):
                self.assertEqual(crm_contacts.base_url(), expected)
        for raw in ("http://hiraia.org/api/crm", "ftp://hiraia.org/x", "https://user:pw@hiraia.org/api/crm",
                    "https://hiraia.org/api/crm?key=1", "https://hiraia.org:99999/api/crm", "hiraia.org/api/crm"):
            with patch.dict(os.environ, {"HIRAIA_CRM_BASE_URL": raw}):
                with self.assertRaises(crm_contacts.CrmError) as caught:
                    crm_contacts.base_url()
                self.assertEqual(caught.exception.code, "crm_misconfigured", raw)


class FetchTests(CrmTestCase):
    def test_reads_every_page_with_embeds_using_the_read_key(self):
        rows = [contact(i, f"Contact {i:03}") for i in range(1, 451)]

        def respond(request):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(request["path"]).query)
            offset, limit = int(query["offset"][0]), int(query["limit"][0])
            return 200, {"contacts": rows[offset:offset + limit], "total": len(rows), "limit": limit, "offset": offset}, {}

        fake = self.use(FakeCrm(respond))
        payload = crm_contacts.directory()
        self.assertEqual((payload["total"], len(payload["contacts"]), payload["truncated"]), (450, 450, False))
        self.assertEqual([r["path"] for r in fake.requests], [
            f"/api/crm/contacts?include=threads%2Clatest_extract%2Ccontact_points&limit=200&offset={o}" for o in (0, 200, 400)])
        self.assertTrue(all(r["authorization"] == f"Bearer {KEY}" for r in fake.requests))
        self.assertTrue(all(r["user_agent"].startswith("hiraia-admin/") for r in fake.requests))
        self.assertNotIn(KEY, json.dumps(payload))

    def test_a_row_repeated_across_pages_is_deduplicated_and_flagged(self):
        pages = {0: [contact(i, f"C{i}") for i in range(1, 201)], 200: [contact(200, "C200"), contact(201, "C201")]}
        self.use(FakeCrm(lambda request: (200, {"contacts": pages[int(request["path"].rsplit("=", 1)[1])], "total": 202}, {})))
        payload = crm_contacts.directory()
        self.assertEqual((len(payload["contacts"]), payload["truncated"]), (201, True))

    def test_upstream_failures_become_fixed_codes(self):
        cases = [
            ((401, {"error": "unauthorized", "message": "secret detail"}, {}), "crm_auth_failed", 502, None),
            ((403, {"error": "forbidden"}, {}), "crm_auth_failed", 502, None),
            ((429, {"error": "rate_limited"}, {"Retry-After": "7"}), "crm_rate_limited", 503, 7),
            ((500, {"error": "internal_error"}, {}), "crm_unavailable", 502, None),
            ((404, {"error": "not_found"}, {}), "crm_unavailable", 502, None),
            ((200, b"<html>oops</html>", {}), "crm_bad_response", 502, None),
            ((200, [1, 2], {}), "crm_bad_response", 502, None),
            ((200, {"contacts": "x", "total": 1}, {}), "crm_bad_response", 502, None),
            ((200, {"contacts": [{"id": 1, "name": "No embeds"}], "total": 1}, {}), "crm_outdated", 502, None),
            ((400, {"error": "invalid_query", "details": {"param": "include"}}, {}), "crm_outdated", 502, None),
        ]
        for reply, code, status, retry in cases:
            fake = FakeCrm(lambda request, reply=reply: reply)
            with patch.dict(os.environ, {"HIRAIA_CRM_API_KEY_FILE": self.key_file, "HIRAIA_CRM_BASE_URL": fake.base}):
                got_status, body, headers = crm_contacts.api_response()
            fake.close()
            self.assertEqual((got_status, body["error"], body.get("retry_after")), (status, code, retry), reply)
            self.assertEqual(body["ok"], False)
            self.assertNotIn("secret detail", json.dumps(body))
            self.assertEqual(headers, [("Retry-After", "7")] if retry else [])

    def test_unreachable_crm_and_missing_key(self):
        fake = FakeCrm()
        fake.close()                                     # nothing listens on that port any more
        with patch.dict(os.environ, {"HIRAIA_CRM_API_KEY_FILE": self.key_file, "HIRAIA_CRM_BASE_URL": fake.base}):
            self.assertEqual(crm_contacts.api_response()[1]["error"], "crm_unavailable")
        with patch.dict(os.environ, {"HIRAIA_CRM_BASE_URL": fake.base}):
            os.environ.pop("HIRAIA_CRM_API_KEY_FILE", None)
            os.environ.pop("HIRAIA_CRM_API_KEY", None)
            self.assertEqual(crm_contacts.api_response()[:2], (503, {"ok": False, "error": "crm_not_configured"}))

    def test_redirects_are_refused_so_the_key_is_never_resent(self):
        elsewhere = FakeCrm()
        self.addCleanup(elsewhere.close)
        self.use(FakeCrm(lambda request: (302, b"", {"Location": f"{elsewhere.base}/contacts"})))
        self.assertEqual(crm_contacts.api_response()[1]["error"], "crm_unavailable")
        self.assertEqual(elsewhere.requests, [])


class ProjectionTests(unittest.TestCase):
    def test_allowlist_drops_thread_labels_opaque_ids_and_private_extract_fields(self):
        row = contact(7, "Rowena Dimaculangan", threads=[thread(70, 7, "viber", "Group 4c1f9a2e7b")],
                      latest=extract(700, 7, 70, "2026-11-02T03:00:00.000Z", summary="Agreed to a pilot.",
                                     next_action="Send the guides", dates=["Nov 9"]),
                      notes="Agreed to a pilot.", role="Principal", school="Mabuhay Hills ES")
        card = crm_contacts.project(row)
        text = json.dumps(card)
        for secret in ("4c1f9a2e7b", "conv_7Hq2opaque", "e" * 64, "c" * 64, "school-business", "qwen2.5",
                       "classification_run", "export_id", "thread_name", "is_test", "extracted_json"):
            self.assertNotIn(secret, text)
        self.assertEqual(set(card), {"id", "name", "aliases", "role", "school", "stage", "notes", "summary",
                                     "next_action", "dates", "summary_at", "thread_count", "extract_count",
                                     "last_contact", "first_seen", "updated_at", "activity", "channels",
                                     "organization", "organization_source", "department", "department_source",
                                     "job_title", "job_title_source", "location", "location_source",
                                     "phones", "emails", "first_contact"})
        self.assertEqual((card["summary"], card["next_action"], card["dates"]), ("Agreed to a pilot.", "Send the guides", ["Nov 9"]))

    def test_channels_cover_every_thread_platform_plus_the_record_platform(self):
        row = contact(3, "Ma. Lourdes Peñaflor", platform="messenger", aliases=["Ma'am Lou"], threads=[
            thread(30, 3, "telegram", "Ma. Lourdes Peñaflor", "2026-10-25T01:00:00.000Z"),
            thread(31, 3, "viber", "Group 4c1f9a2e7b"),
            thread(32, 3, "messenger", "ma.  lourdes peñaflor", "2026-11-01T09:00:00.000Z"),
            thread(33, 3, "viber", "Group 99ab"),
            thread(34, 3, "messenger", "Ma'am Lou"),
            thread(35, 3, "messenger", "Pilot coordination"),
            thread(36, 3, "Bad App!", "x"),
        ])
        channels = crm_contacts.project(row)["channels"]
        self.assertEqual([(c["platform"], c["record"]) for c in channels],
                         [("messenger", True), ("telegram", False), ("viber", False)])
        self.assertEqual([t["kind"] for t in channels[0]["threads"]], ["direct", "direct", "conversation"])
        self.assertEqual(channels[0]["threads"][0]["last_seen"], "2026-11-01T09:00:00.000Z")
        self.assertEqual([t["kind"] for t in channels[2]["threads"]], ["group", "group"])
        record_only = crm_contacts.project(contact(4, "Josefina Bautista", platform="viber"))["channels"]
        self.assertEqual(record_only, [{"platform": "viber", "record": True, "threads": []}])
        whatsapp = crm_contacts.project(contact(5, "Analyn Sison", platform="whatsapp"))["channels"]
        self.assertEqual(whatsapp[0]["platform"], "whatsapp")

    def test_exact_activity_comes_from_last_contact_or_a_newer_thread(self):
        by_contact = crm_contacts.project(contact(1, "A", last_contact="2026-11-03T04:07:00+00:00",
                                                  threads=[thread(10, 1, "messenger", "A", "2026-11-01T00:00:00Z")]))
        self.assertEqual(by_contact["activity"], {"state": "exact", "at": "2026-11-03T04:07:00.000Z",
                                                  "basis": "last_contact", "source_approximate": False})
        by_thread = crm_contacts.project(contact(2, "B", last_contact="2026-10-01T00:00:00Z",
                                                 threads=[thread(20, 2, "viber", "B", "2026-11-02T08:30:00.000Z")]))
        self.assertEqual((by_thread["activity"]["at"], by_thread["activity"]["basis"]), ("2026-11-02T08:30:00.000Z", "thread"))

    def test_approximate_activity_uses_the_crm_sync_time_and_keeps_the_source_flag(self):
        row = contact(8, "Jonathan Pacquing", platform="viber",
                      threads=[thread(80, 8, "viber", "Jonathan Pacquing", None, "2026-10-30T00:00:00.000Z")],
                      latest=extract(800, 8, 80, "2026-11-03T02:15:00.000Z", summary="Approved the tablets.",
                                     last_contact_approximate=True))
        self.assertEqual(crm_contacts.project(row)["activity"], {
            "state": "approximate", "at": "2026-11-03T02:15:00.000Z", "basis": "summary_synced", "source_approximate": True})
        threads_only = crm_contacts.project(contact(9, "No summary yet", threads=[thread(90, 9, "telegram", "x", None, "2026-10-31T00:00:00Z")]))
        self.assertEqual(threads_only["activity"], {"state": "approximate", "at": "2026-10-31T00:00:00.000Z",
                                                    "basis": "thread_synced", "source_approximate": False})

    def test_record_only_contacts_have_no_activity_and_nothing_is_invented(self):
        card = crm_contacts.project(contact(11, "  Liezl Domingo ", stage="won", role=42, school="",
                                            aliases=["liezl  domingo", "Ma'am Liezl", None, "MA'AM  LIEZL"],
                                            last_contact="yesterday", first_seen="0001-01-01T00:00:00+01:00"))
        self.assertEqual(card["activity"], {"state": "none", "at": None, "basis": None, "source_approximate": False})
        self.assertEqual((card["name"], card["stage"], card["role"], card["school"]), ("Liezl Domingo", "unknown", None, None))
        self.assertEqual(card["aliases"], ["Ma'am Liezl"])
        self.assertEqual((card["last_contact"], card["first_seen"], card["summary"], card["next_action"]), (None, None, None, None))
        self.assertEqual((card["dates"], card["thread_count"], card["extract_count"]), ([], 0, 0))


class ContactFieldTests(unittest.TestCase):
    def test_a_1_1_shaped_row_reads_as_an_outdated_api(self):
        old_row = contact(1, "Old")
        for key in ("phones", "emails", "organization", "first_contact"):
            row = dict(old_row)
            row.pop(key)
            fake = FakeCrm(lambda request, row=row: (200, {"contacts": [row], "total": 1}, {}))
            try:
                with patch.dict(os.environ, {"HIRAIA_CRM_API_KEY": KEY, "HIRAIA_CRM_BASE_URL": fake.base}):
                    os.environ.pop("HIRAIA_CRM_API_KEY_FILE", None)
                    self.assertEqual(crm_contacts.api_response()[1]["error"], "crm_outdated", key)
            finally:
                fake.close()

    def test_affiliation_and_contact_details_project_with_provenance_but_never_source_refs(self):
        row = contact(21, "Rosario Villaflor", platform="viber", role="teacher", school=None,
                      organization="Department of Education (DepEd)", organization_source="manual_note",
                      job_title="Master Teacher II", job_title_source="google_contacts", location="  ", location_source="manual_note",
                      phones=[{"value": "+639000000001", "label": "mobile", "primary": False, "source": "google_contacts", "source_ref": "google-contacts:people/c1"},
                              {"value": "+639000000002", "label": None, "primary": True, "source": "manual_note", "source_ref": None},
                              {"value": "call me", "source": "x"}, {"value": "+639000000001"}, "junk"],
                      emails=[{"value": "teacher@example.org", "label": "work", "source": "Not A Source!"}, {"value": "no-at-sign"}])
        card = crm_contacts.project(row)
        self.assertEqual((card["organization"], card["organization_source"], card["school"], card["role"]),
                         ("Department of Education (DepEd)", "manual_note", None, "teacher"))
        self.assertEqual((card["job_title"], card["job_title_source"]), ("Master Teacher II", "google_contacts"))
        self.assertEqual((card["location"], card["location_source"]), (None, None))       # blank value: no source either
        self.assertEqual([(p["value"], p["primary"], p["source"]) for p in card["phones"]],
                         [("+639000000002", True, "manual_note"), ("+639000000001", False, "google_contacts")])
        self.assertEqual([(e["value"], e["label"], e["source"]) for e in card["emails"]], [("teacher@example.org", "work", None)])
        self.assertNotIn("source_ref", json.dumps(card))
        self.assertNotIn("people/c1", json.dumps(card))

    def test_first_contact_and_thread_first_messages_project_and_inconsistent_labels_are_dropped(self):
        row = contact(3, "Noel Abarca", threads=[dict(thread(7, 3, "messenger", "Noel Abarca", "2026-11-01T00:00:00Z"),
                                                     first_message_at="2026-09-05T11:25:00.000Z", first_message_quality="exact", first_message_basis="message_timestamp")],
                      first_contact="2026-09-05T11:25:00.000Z", first_contact_quality="exact", first_contact_basis="message_timestamp",
                      first_contact_platform="messenger", first_contact_thread_id=7, first_contact_conversation_kind="direct")
        card = crm_contacts.project(row)
        self.assertEqual(card["first_contact"], {"at": "2026-09-05T11:25:00.000Z", "quality": "exact", "basis": "message_timestamp",
                                                 "platform": "messenger", "conversation_kind": "direct"})
        self.assertEqual(card["channels"][0]["threads"][0]["first_message"], {"at": "2026-09-05T11:25:00.000Z", "quality": "exact", "basis": "message_timestamp"})
        for bad in ({"first_contact_quality": "exact", "first_contact_basis": "first_observed"},
                    {"first_contact_quality": "certain"}, {"first_contact": "yesterday"}, {"first_contact": None}):
            self.assertIsNone(crm_contacts.project(dict(row, **bad))["first_contact"], bad)
        # No evidence: first_contact stays empty; nothing is derived from created_at, first_seen or last_contact.
        bare = crm_contacts.project(contact(20, "Teresita Lumbad", last_contact="2026-11-01T00:00:00Z", first_seen="2026-10-01T00:00:00Z"))
        self.assertIsNone(bare["first_contact"])


class RouteTests(CrmTestCase):
    SECRET = "s" * 64

    def setUp(self):
        super().setUp()
        config = patch.object(admin_app, "_cfg_cache", {"t": time.time() + 10 ** 6, "v": {
            "session_secret": self.SECRET, "admin_email": "luis@example.org"}})
        config.start()
        self.addCleanup(config.stop)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), admin_app.Handler)
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02}, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.origin = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.cookie = "hiraia_sess=" + admin_app.sign_session("luis@example.org", self.SECRET)

    def get(self, path, cookie=None):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args):
                return None
        request = urllib.request.Request(self.origin + path, headers={"Cookie": cookie} if cookie else {})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
                return response.status, dict(response.headers), response.read().decode()
        except urllib.error.HTTPError as error:
            with error:
                return error.code, dict(error.headers), error.read().decode()

    def test_page_and_data_require_the_admin_session(self):
        fake = self.use(FakeCrm())
        status, headers, _ = self.get("/admin/crm")
        self.assertEqual((status, headers["Location"]), (302, "/admin/login"))
        status, _, body = self.get("/admin/api/crm/contacts")
        self.assertEqual((status, json.loads(body)), (401, {"error": "unauthenticated"}))
        forged = "hiraia_sess=" + admin_app.sign_session("luis@example.org", "wrong-secret")
        self.assertEqual(self.get("/admin/api/crm/contacts", forged)[0], 401)
        self.assertEqual(fake.requests, [])               # the CRM is never called without a session

    def test_signed_in_page_and_data(self):
        row = contact(5, "Ramon Dela Cruz", platform="telegram", stage="intro", aliases=["Sir Ramon"],
                      last_contact="2026-10-29T03:00:00.000Z",
                      threads=[thread(50, 5, "telegram", "Ramon Dela Cruz", "2026-10-29T03:00:00.000Z")])
        fake = self.use(FakeCrm(lambda request: (200, {"contacts": [row], "total": 1}, {})))
        status, headers, page = self.get("/admin/crm", self.cookie)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn('href="/admin/crm" aria-current="page"', page)
        self.assertIn("HiraiaCrm.mount", page)
        self.assertNotIn(KEY, page)
        self.assertEqual(fake.requests, [])               # the page shell does not read the CRM
        status, headers, body = self.get("/admin/api/crm/contacts", self.cookie)
        data = json.loads(body)
        self.assertEqual((status, headers["Cache-Control"], data["ok"], data["total"]), (200, "no-store", True, 1))
        self.assertEqual(data["contacts"][0]["channels"], [{"platform": "telegram", "record": True, "threads": [
            {"kind": "direct", "last_seen": "2026-10-29T03:00:00.000Z", "first_message": None}]}])
        self.assertNotIn(KEY, body)
        self.assertEqual(fake.requests[0]["authorization"], f"Bearer {KEY}")

    def test_signed_in_errors_are_codes_with_retry_after(self):
        self.use(FakeCrm(lambda request: (429, {"error": "rate_limited"}, {"Retry-After": "12"})))
        status, headers, body = self.get("/admin/api/crm/contacts", self.cookie)
        self.assertEqual((status, headers["Retry-After"], json.loads(body)), (503, "12", {"ok": False, "error": "crm_rate_limited", "retry_after": 12}))

    def test_client_script_and_styles_are_safe_to_inline(self):
        for name, tag in (("crm_contacts.js", "script"), ("crm_contacts.css", "style")):
            with open(os.path.join(os.path.dirname(crm_contacts.__file__), name), encoding="utf-8") as f:
                source = f.read()
            self.assertEqual(crm_contacts._inline_safe(source, tag), source)
        for bad, tag in (("x = '</SCRIPT>'", "script"), ("a{content:'</style>'}", "style"), ("<!-- x", "script")):
            with self.assertRaises(ValueError):
                crm_contacts._inline_safe(bad, tag)


if __name__ == "__main__":
    unittest.main()
