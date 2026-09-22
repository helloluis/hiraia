import base64
import io
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

import tala_reports


def report(device=None, attachments=None):
    return json.dumps({
        "id": str(uuid.uuid4()), "device_id": device or str(uuid.uuid4()),
        "category": "App problem", "details": "The lesson froze",
        "created_at": int(time.time() * 1000), "class_name": "Perseverance",
        "school_name": "Calapacuan", "teacher_name": "Jannie",
        "attachments": attachments or [],
    }).encode()


class TalaReportTests(unittest.TestCase):
    def setUp(self):
        self.sandbox = patch.dict(os.environ, {"HIRAIA_MEDIA_ALLOW_UNSANDBOXED": "1"})
        self.sandbox.start()
        self.addCleanup(self.sandbox.stop)
        self.folder = tempfile.TemporaryDirectory()
        self.paths = patch.multiple(tala_reports, STATE_DIR=self.folder.name,
                                    DB_PATH=os.path.join(self.folder.name, "reports.db"),
                                    MEDIA_DIR=os.path.join(self.folder.name, "media"))
        self.paths.start()
        self.addCleanup(self.paths.stop)
        self.addCleanup(self.folder.cleanup)
        self.notification = patch.object(tala_reports, "notify", return_value=True)
        self.notification.start()
        self.addCleanup(self.notification.stop)

    def test_keyless_report_idempotency_and_device_cooldown(self):
        device = str(uuid.uuid4())
        raw = report(device)
        self.assertEqual(tala_reports.receive(raw, {}, "192.0.2.10")[0], 200)
        self.assertEqual(tala_reports.receive(raw, {}, "192.0.2.10")[0], 200)
        self.assertEqual(tala_reports.receive(report(device), {}, "192.0.2.10"),
                         (429, {"error": "report_cooldown", "retry_after": 30}))
        self.assertEqual(tala_reports.receive(report(), {}, "192.0.2.10")[0], 200)

    def test_attempts_limit_bad_requests_and_persist(self):
        for _ in range(tala_reports.ATTEMPT_MINUTE_LIMIT):
            self.assertEqual(tala_reports.allow_request("192.0.2.11"), (True, 0))
        self.assertEqual(tala_reports.allow_request("192.0.2.11"), (False, 60))
        self.assertEqual(tala_reports.allow_request("192.0.2.12"), (True, 0))

    def test_text_and_request_limits(self):
        raw = json.loads(report())
        raw["details"] = "Bad\x00text"
        self.assertEqual(tala_reports.receive(json.dumps(raw).encode(), {})[0], 400)
        raw["details"] = "\ufb03" * 1000
        self.assertEqual(tala_reports.receive(json.dumps(raw).encode(), {})[0], 400)
        self.assertEqual(tala_reports.receive(b" " * (tala_reports.MAX_REQUEST + 1), {})[0], 413)

    def test_preexisting_report_database_upgrades_without_losing_rows(self):
        with sqlite3.connect(tala_reports.DB_PATH) as conn:
            conn.execute("""CREATE TABLE reports(id TEXT PRIMARY KEY,payload_sha256 TEXT NOT NULL,
                device_id TEXT NOT NULL,category TEXT NOT NULL,details TEXT NOT NULL,
                created_at INTEGER NOT NULL,received_at INTEGER NOT NULL,class_name TEXT NOT NULL,
                school_name TEXT NOT NULL,teacher_name TEXT NOT NULL,media_count INTEGER NOT NULL,
                notified_at INTEGER NOT NULL DEFAULT 0,notify_error TEXT NOT NULL DEFAULT '')""")
            conn.execute("INSERT INTO reports VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                str(uuid.uuid4()), "digest", str(uuid.uuid4()), "Other", "Prior report",
                1, 1, "Class", "School", "Teacher", 0, 0, ""))
        self.assertEqual(tala_reports.receive(report(), {}, "192.0.2.10")[0], 200)
        with sqlite3.connect(tala_reports.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0], 2)
            self.assertIn("source_ip", {row[1] for row in conn.execute("PRAGMA table_info(reports)")})

    def test_invalid_image_rejected_without_storing_report(self):
        attachment = {"id": str(uuid.uuid4()), "mime": "image/png",
                      "data": base64.b64encode(b"\x89PNG\r\n\x1a\nnot an image").decode()}
        code, _ = tala_reports.receive(report(attachments=[attachment]), {})
        self.assertEqual(code, 400)
        with sqlite3.connect(tala_reports.DB_PATH) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0], 0)

    def test_clean_image_saved_privately_and_retrievable(self):
        from PIL import Image
        source = io.BytesIO()
        Image.new("RGB", (4, 4), "yellow").save(source, "PNG")
        media_id = str(uuid.uuid4())
        attachment = {"id": media_id, "mime": "image/png",
                      "data": base64.b64encode(source.getvalue()).decode()}
        raw = report(attachments=[attachment])
        self.assertEqual(tala_reports.receive(raw, {}, "192.0.2.10")[0], 200)
        media = tala_reports.attachment(json.loads(raw)["id"], media_id)
        self.assertEqual(media[0], "image/png")
        with Image.open(io.BytesIO(media[2])) as decoded:
            self.assertEqual(decoded.size, (4, 4))
        self.assertEqual(tala_reports.receive(raw, {}, "192.0.2.10")[0], 200)

    def test_missing_processor_does_not_store_media(self):
        attachment = {"id": str(uuid.uuid4()), "mime": "video/mp4",
                      "data": base64.b64encode(b"not a real video").decode()}
        with patch.object(tala_reports, "_process_media", side_effect=tala_reports.ProcessorUnavailable()):
            self.assertEqual(tala_reports.receive(report(attachments=[attachment]), {})[0], 503)

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg is unavailable")
    def test_valid_mp4_is_decoded_and_remuxed(self):
        source = os.path.join(self.folder.name, "test.mp4")
        subprocess.run(["/usr/bin/ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi",
                        "-i", "color=c=red:s=32x32:d=1", "-c:v", "mpeg4", "-y", source],
                       check=True, timeout=15)
        with open(source, "rb") as video:
            attachment = {"id": str(uuid.uuid4()), "mime": "video/mp4",
                          "data": base64.b64encode(video.read()).decode()}
        raw = report(attachments=[attachment])
        self.assertEqual(tala_reports.receive(raw, {})[0], 200)
        video = tala_reports.attachment(json.loads(raw)["id"], attachment["id"])
        self.assertEqual(video[0], "video/mp4")
        self.assertLessEqual(len(video[2]), tala_reports.MAX_MEDIA)

    def test_notify_email_includes_details_and_fitting_attachment(self):
        self.notification.stop()
        report_id = str(uuid.uuid4())
        media_id = str(uuid.uuid4())
        png = b"fake-jpeg-bytes"
        folder = os.path.join(tala_reports.MEDIA_DIR, report_id)
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "attachment-1.jpg")
        with open(path, "wb") as file:
            file.write(png)
        now = int(time.time() * 1000)
        with tala_reports._db() as conn:
            conn.execute("""INSERT INTO reports
                (id,payload_sha256,device_id,category,details,created_at,received_at,
                 class_name,school_name,teacher_name,media_count,source_ip)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (report_id, "x", str(uuid.uuid4()), "App problem", "The lesson froze",
                 now, now, "Perseverance", "Calapacuan", "Jannie", 1, "192.0.2.10"))
            conn.execute("INSERT INTO media VALUES(?,?,?,?,?,?)",
                         (media_id, report_id, "attachment-1.jpg", "image/jpeg", len(png), path))
        captured = {}

        class Fake:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self):
                return b'{"id":"re_test"}'

        def fake_urlopen(request, timeout=20):
            captured["payload"] = json.loads(request.data)
            return Fake()

        with patch("urllib.request.urlopen", fake_urlopen):
            self.assertTrue(tala_reports.notify(report_id, {
                "resend_api_key": "re_test", "notify_email": "ops@example.com"}))
        payload = captured["payload"]
        self.assertIn("The lesson froze", payload["text"])
        self.assertIn("Calapacuan", payload["text"])
        self.assertIn("Perseverance", payload["text"])
        self.assertIn("Jannie", payload["text"])
        self.assertIn("The lesson froze", payload["html"])
        self.assertEqual(payload["to"], ["ops@example.com"])
        self.assertEqual(len(payload["attachments"]), 1)
        self.assertTrue(payload["attachments"][0]["filename"].endswith(".jpg"))
        self.assertIn("content", payload["attachments"][0])

    def test_oversized_attachment_is_named_not_attached(self):
        files = [{"name": "tiny.jpg", "mime": "image/jpeg", "data": b"abc"},
                 {"name": "huge.mp4", "mime": "video/mp4", "data": b"x" * 5000}]
        attached, skipped = tala_reports.pick_email_attachments(files, budget=100)
        self.assertEqual([item["filename"] for item in attached], ["tiny.jpg"])
        self.assertTrue(any("huge.mp4" in item for item in skipped))
        row = {"id": str(uuid.uuid4()), "category": "App problem", "teacher_name": "Jannie",
               "school_name": "Calapacuan", "class_name": "Pilot", "details": "image is nonsense",
               "received_at": 1_700_000_000_000, "device_id": "dev", "media_count": 2}
        payload = tala_reports.email_payload(row, files, budget=100)
        self.assertIn("image is nonsense", payload["text"])
        self.assertIn("huge.mp4", payload["text"])
        self.assertEqual(payload["attachments"][0]["filename"], "tiny.jpg")

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg is unavailable")
    def test_mp4_header_without_valid_stream_is_rejected(self):
        attachment = {"id": str(uuid.uuid4()), "mime": "video/mp4",
                      "data": base64.b64encode(b"\x00\x00\x00\x18ftypmp42" + b"bad data" * 20).decode()}
        self.assertEqual(tala_reports.receive(report(attachments=[attachment]), {})[0], 400)


if __name__ == "__main__":
    unittest.main()
