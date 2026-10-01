"""Failure-focused archive tests. No cloud credentials, network or real bucket."""
from contextlib import contextmanager, redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import archive


class RemoteError(Exception):
    def __init__(self, code):
        super().__init__("Never print this SDK message: pretend-secret-access-key")
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self):
        self.objects, self.puts, self.gets = {}, [], []
        self.fail_put, self.corrupt_put = set(), set()
        self.lock = threading.Lock()

    def get_object(self, Bucket, Key):
        with self.lock:
            self.gets.append(Key)
            if Key not in self.objects:
                raise RemoteError("NoSuchKey")
            data = self.objects[Key]
            return {"Body": io.BytesIO(data), "ContentLength": len(data)}

    def put_object(self, **kwargs):
        with self.lock:
            key, data = kwargs["Key"], kwargs["Body"]
            assert kwargs["IfNoneMatch"] == "*", "An unconditional write would corrupt immutability"
            assert len(data) == kwargs["ContentLength"]
            self.puts.append(key)
            if key in self.fail_put:
                raise RemoteError("ServiceUnavailable")
            if key in self.objects:
                raise RemoteError("PreconditionFailed")
            self.objects[key] = b"x" * len(data) if key in self.corrupt_put else bytes(data)
            return {"ETag": '"deliberately-not-a-content-hash"'}


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "source"
        self.source.mkdir()
        self.client = FakeS3()
        self.bucket = "hiraia-archive"

    def tearDown(self):
        self.temp.cleanup()

    def plan(self, files=None, chunk_bytes=8):
        for name, data in (files or {"one.png": b"original-png-bytes"}).items():
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        result = archive.inventory({"schema": 1, "sources": [{"id": "images", "path": str(self.source),
                                   "kind": "directory", "provenance": {"generator": "original"}}]},
                                   self.root / "state", chunk_bytes)
        self.manifest_path = Path(result["manifest"])
        self.manifest, _ = archive.load_manifest(self.manifest_path)
        self.snapshot = result["snapshot_id"]
        return result

    def upload(self):
        return archive.upload_snapshot(self.client, self.bucket, self.manifest_path, workers=1)

    def assert_code(self, code, function, *args, **kwargs):
        with self.assertRaises(archive.ArchiveError) as raised:
            function(*args, **kwargs)
        self.assertEqual(raised.exception.code, code)

    def test_duplicates_keep_paths_and_deduplicate_exact_bytes(self):
        self.plan({"a.png": b"abc", "nested/b.png": b"abc"})
        self.assertEqual(self.manifest["totals"], {"files": 2, "unique_files": 1,
                         "logical_bytes": 6, "objects": 1, "stored_bytes": 3})
        result = self.upload()
        self.assertEqual(result["status"], "committed")
        self.assertEqual(result["uploaded_objects"], 1)
        self.assertEqual(len(self.client.objects), 3)  # Blob + manifest + receipt.
        self.assertEqual(archive.verify_snapshot(self.client, self.bucket, self.snapshot)["status"], "verified")
        second = self.upload()
        self.assertEqual(second["uploaded_objects"], 0)
        self.assertEqual(second["reused_objects"], 1)

    def test_changed_source_is_refused_before_any_remote_write(self):
        self.plan()
        (self.source / "one.png").write_bytes(b"new generation")
        self.assert_code("source_changed", self.upload)
        self.assertFalse(self.client.puts)

    def test_concurrent_write_during_inventory_is_detected(self):
        path = self.source / "one.png"
        path.write_bytes(b"0123456789")
        real_hash = archive.sha
        modified = False

        def hash_and_modify(data):
            nonlocal modified
            if not modified:
                modified = True
                path.write_bytes(b"abcdefghij")
            return real_hash(data)

        with patch.object(archive, "sha", side_effect=hash_and_modify):
            self.assert_code("source_changed", archive.inventory,
                             {"schema": 1, "sources": [{"id": "raw", "path": str(self.source)}]}, self.root / "state", 3)
        self.assertFalse(list((self.root / "state").glob("**/manifest.json")))

    def test_corrupt_existing_object_is_never_overwritten(self):
        self.plan({"a.png": b"abc"})
        key = archive.object_key(hashlib.sha256(b"abc").hexdigest())
        self.client.objects[key] = b"xyz"
        result = self.upload()
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["errors"][0]["code"], "remote_corrupt")
        self.assertEqual(self.client.objects[key], b"xyz")
        self.assertNotIn(key, self.client.puts)
        self.assertFalse(any(key.startswith("snapshots/") for key in self.client.objects))

    def test_full_readback_catches_corrupt_upload(self):
        self.plan({"a.png": b"abc"})
        key = archive.object_key(hashlib.sha256(b"abc").hexdigest())
        self.client.corrupt_put.add(key)
        result = self.upload()
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["errors"][0]["code"], "remote_corrupt")
        self.assertFalse(any(key.startswith("snapshots/") for key in self.client.objects))

    def test_source_changed_during_upload_read_refuses_snapshot(self):
        self.plan({"a.png": b"abc"})
        original_reader = archive.stable_reader

        @contextmanager
        def changing_reader(path, expected):
            with original_reader(path, expected) as stream:
                class Reader:
                    def seek(self, offset):
                        stream.seek(offset)

                    def read(self, length):
                        data = stream.read(length)
                        path.write_bytes(b"new")
                        return data
                yield Reader()

        with patch.object(archive, "stable_reader", changing_reader):
            result = self.upload()
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["errors"][0]["code"], "source_changed")
        self.assertFalse(self.client.puts)

    def test_manifest_upload_corruption_prevents_receipt_commit(self):
        self.plan({"a.png": b"abc"})
        key = archive.snapshot_key(self.snapshot, "manifest.json")
        self.client.corrupt_put.add(key)
        self.assert_code("remote_corrupt", self.upload)
        self.assertNotIn(archive.snapshot_key(self.snapshot, "receipt.json"), self.client.objects)
        self.assertFalse((self.manifest_path.parent / "receipt.json").exists())

    def test_locked_existing_snapshot_needs_only_read_verification(self):
        self.plan({"a.png": b"abc"})
        self.upload()
        with patch.object(self.client, "put_object", side_effect=RemoteError("AccessDenied")) as put:
            resumed = self.upload()
        self.assertEqual(resumed["status"], "committed")
        self.assertEqual(resumed["uploaded_objects"], 0)
        put.assert_not_called()

    def test_concurrent_locked_creator_is_verified_after_access_denied(self):
        key, value = archive.object_key(archive.sha(b"abc")), b"abc"

        def racing_put(**_kwargs):
            self.client.objects[key] = value
            raise RemoteError("AccessDenied")

        with patch.object(self.client, "put_object", side_effect=racing_put):
            self.assertFalse(archive.verified_create(self.client, self.bucket, key, b"abc"))
        self.client.objects.clear()
        value = b"bad"
        with patch.object(self.client, "put_object", side_effect=racing_put):
            self.assert_code("remote_corrupt", archive.verified_create, self.client, self.bucket, key, b"abc")
        self.client.objects.clear()
        with patch.object(self.client, "put_object", side_effect=RemoteError("AccessDenied")):
            self.assert_code("remote_write_failed", archive.verified_create, self.client, self.bucket, key, b"abc")

    def test_truncated_remote_body_is_not_treated_as_verified(self):
        self.assert_code("remote_corrupt", archive.consume,
                         {"Body": io.BytesIO(b"ab"), "ContentLength": 3}, archive.sha(b"abc"), 3)

    def test_interrupted_upload_resumes_and_repairs_truncated_journal(self):
        self.plan({"a.png": b"abc", "b.png": b"def"})
        key = archive.object_key(hashlib.sha256(b"def").hexdigest())
        self.client.fail_put.add(key)
        first = self.upload()
        self.assertEqual(first["status"], "incomplete")
        self.assertEqual(first["verified_objects"], 1)
        journal = self.manifest_path.parent / "journal.jsonl"
        with journal.open("ab") as stream:
            stream.write(b'{"unfinished":')
        self.client.fail_put.clear()
        second = self.upload()
        self.assertEqual(second["status"], "committed")
        self.assertEqual(second["uploaded_objects"], 1)
        self.assertEqual(second["reused_objects"], 1)
        for line in journal.read_text().splitlines():
            json.loads(line)
        self.assertGreaterEqual(self.client.gets.count(archive.object_key(hashlib.sha256(b"abc").hexdigest())), 2)

    def test_journal_success_does_not_hide_later_remote_corruption(self):
        self.plan({"a.png": b"abc", "b.png": b"def"})
        second_key = archive.object_key(hashlib.sha256(b"def").hexdigest())
        self.client.fail_put.add(second_key)
        self.upload()
        first_key = archive.object_key(hashlib.sha256(b"abc").hexdigest())
        self.client.objects[first_key] = b"bad"
        self.client.fail_put.clear()
        self.assertEqual(self.upload()["status"], "incomplete")
        self.assertNotIn(archive.snapshot_key(self.snapshot, "receipt.json"), self.client.objects)

    def test_receipt_failure_refuses_partial_snapshot_then_resumes(self):
        self.plan({"a.png": b"abc"})
        key = archive.snapshot_key(self.snapshot, "receipt.json")
        self.client.fail_put.add(key)
        self.assert_code("remote_write_failed", self.upload)
        self.assertIn(archive.snapshot_key(self.snapshot, "manifest.json"), self.client.objects)
        self.assert_code("snapshot_incomplete", archive.verify_snapshot, self.client, self.bucket, self.snapshot)
        self.assert_code("snapshot_incomplete", archive.restore_snapshot, self.client, self.bucket, self.snapshot, self.root / "restore")
        self.assertFalse((self.manifest_path.parent / "receipt.json").exists())
        self.client.fail_put.clear()
        self.assertEqual(self.upload()["status"], "committed")

    def test_corrupt_manifest_or_receipt_is_detected(self):
        self.plan({"a.png": b"abc"})
        result = self.upload()
        key = archive.snapshot_key(self.snapshot, "manifest.json")
        original = self.client.objects[key]
        self.client.objects[key] = b" " + original[1:]
        self.assert_code("remote_corrupt", archive.verify_snapshot, self.client, self.bucket, self.snapshot)
        self.client.objects[key] = original
        receipt_key = archive.snapshot_key(self.snapshot, "receipt.json")
        self.client.objects[receipt_key] = self.client.objects[receipt_key].replace(b'"committed_at"', b'"changed_time"')
        self.assert_code("remote_corrupt", archive.verify_snapshot, self.client, self.bucket, self.snapshot,
                         receipt_sha256=result["receipt_sha256"])

    def test_changed_local_manifest_pin_is_refused(self):
        self.plan()
        self.manifest_path.write_bytes(self.manifest_path.read_bytes() + b" ")
        self.assert_code("manifest_changed", self.upload)
        self.assertFalse(self.client.puts)

    def test_chunked_and_empty_file_restore_preserves_original_bytes(self):
        files = {"nested/original.png": bytes(range(256)) * 2, "empty.txt": b"", "copy.png": bytes(range(256)) * 2}
        self.plan(files, 71)
        receipt = self.upload()
        self.assertEqual(receipt["status"], "committed")
        self.assertEqual(archive.verify_snapshot(self.client, self.bucket, self.snapshot)["status"], "verified")
        target = self.root / "restore"
        result = archive.restore_snapshot(self.client, self.bucket, self.snapshot, target, receipt_sha256=receipt["receipt_sha256"])
        self.assertEqual(result["status"], "restored")
        for name, data in files.items():
            self.assertEqual((target / "images" / name).read_bytes(), data)
        again = archive.restore_snapshot(self.client, self.bucket, self.snapshot, target)
        self.assertEqual(again["existing_verified_files"], 3)
        (target / "images/copy.png").write_bytes(b"preserve me")
        failed = archive.restore_snapshot(self.client, self.bucket, self.snapshot, target)
        self.assertEqual(failed["status"], "incomplete")
        self.assertEqual((target / "images/copy.png").read_bytes(), b"preserve me")

    def test_full_file_hash_mismatch_is_detected_even_when_chunks_are_valid(self):
        self.plan({"a.png": b"abcdefghijkl"}, 3)
        self.upload()
        manifest_key = archive.snapshot_key(self.snapshot, "manifest.json")
        modified = json.loads(self.client.objects[manifest_key])
        modified["files"][0]["sha256"] = "a" * 64
        new_data = archive.canonical(modified)
        self.client.objects[manifest_key] = new_data
        receipt_key = archive.snapshot_key(self.snapshot, "receipt.json")
        receipt = json.loads(self.client.objects[receipt_key])
        receipt["manifest"].update(sha256=archive.sha(new_data), bytes=len(new_data))
        self.client.objects[receipt_key] = archive.canonical(receipt)
        result = archive.verify_snapshot(self.client, self.bucket, self.snapshot)
        self.assertEqual(result["status"], "corrupt")
        self.assertEqual(result["errors"][0]["code"], "file_hash_mismatch")

    def test_symlinks_and_path_traversal_are_refused(self):
        (self.source / "linked.png").symlink_to(self.root / "outside")
        self.assert_code("unsupported_file", archive.inventory,
                         {"schema": 1, "sources": [{"id": "raw", "path": str(self.source)}]}, self.root / "state")
        for value in ("../escape", "/absolute", "a/../escape", "a\\b", ".", "a//b"):
            self.assert_code("unsafe_path", archive.safe_relative, value)

    def test_restore_destination_symlink_is_refused(self):
        self.plan({"a.png": b"abc"})
        self.upload()
        outside = self.root / "outside"
        outside.mkdir()
        target = self.root / "restore"
        target.symlink_to(outside, target_is_directory=True)
        result = archive.restore_snapshot(self.client, self.bucket, self.snapshot, target)
        self.assertEqual(result["status"], "incomplete")
        self.assertFalse(list(outside.iterdir()))

    def test_public_bucket_refused_before_credentials_are_read(self):
        with patch.object(archive, "make_client") as make_client, redirect_stdout(io.StringIO()) as output:
            code = archive.main(["upload", "--bucket", "hiraia-assets", "--env-file", "do-not-open", "--manifest", "none"])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output.getvalue())["error"]["code"], "public_bucket_refused")
        make_client.assert_not_called()

    def test_explicit_external_sources_and_png_glob_include_root_files(self):
        external = self.root / "other-tree"
        external.mkdir()
        (external / "original.png").write_bytes(b"original")
        (external / "log.json").write_bytes(b"not selected")
        result = archive.inventory({"schema": 1, "sources": [{"id": "external", "path": str(external),
                                   "include": ["**/*.png"], "provenance": {"archive": "retired worktree"}}]}, self.root / "state")
        manifest, _ = archive.load_manifest(result["manifest"])
        self.assertEqual(manifest["totals"]["files"], 1)
        self.assertEqual(manifest["files"][0]["path"], "original.png")
        self.assertEqual(manifest["sources"][0]["provenance"]["archive"], "retired worktree")

    def test_missing_path_never_defaults_to_entire_checkout(self):
        self.assert_code("invalid_selection", archive.normalize_sources, {"schema": 1, "sources": [{"id": "oops"}]})

    def test_sdk_exception_messages_are_not_leaked(self):
        self.plan({"a.png": b"abc"})
        self.client.fail_put.add(archive.object_key(hashlib.sha256(b"abc").hexdigest()))
        result = self.upload()
        self.assertNotIn("pretend-secret", json.dumps(result))
        self.assertNotIn("pretend-secret", (self.manifest_path.parent / "journal.jsonl").read_text())

    def test_operational_files_cannot_land_in_tracked_docs(self):
        self.assert_code("tracked_state_refused", archive.operational_path, archive.REPO / "docs/archive-state")

    def test_session_token_is_passed_without_credential_output(self):
        env_file = self.root / "fake.env"
        env_file.write_text('R2_ENDPOINT=https://example.r2.cloudflarestorage.com\n'
                            'R2_ACCESS_KEY_ID=fake-key\nR2_SECRET_ACCESS_KEY=fake-secret\n'
                            'export R2_SESSION_TOKEN="fake-session-token"\n')
        model = Mock()
        model.operation_model.return_value.input_shape.members = {"IfNoneMatch": {}}
        client = SimpleNamespace(meta=SimpleNamespace(service_model=model))
        factory = Mock(return_value=client)
        config = Mock(side_effect=lambda **kwargs: kwargs)
        modules = {"boto3": SimpleNamespace(client=factory), "botocore": SimpleNamespace(),
                   "botocore.config": SimpleNamespace(Config=config)}
        with patch.dict("sys.modules", modules), redirect_stdout(io.StringIO()) as output:
            self.assertIs(archive.make_client(env_file), client)
        self.assertEqual(factory.call_args.kwargs["aws_session_token"], "fake-session-token")
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(factory.call_args.kwargs["config"]["max_pool_connections"], 16)

    def test_workers_are_bounded_and_sixteen_are_supported(self):
        self.assertEqual(list(archive.bounded_results(lambda value: value * 2, range(20), 16)), list(range(0, 40, 2)))
        self.assert_code("invalid_workers", lambda: list(archive.bounded_results(lambda value: value, [], 17)))


if __name__ == "__main__":
    unittest.main()
