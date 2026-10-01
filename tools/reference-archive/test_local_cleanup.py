"""Destructive behavior is tested only in disposable temporary fixtures."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import local_cleanup as cleanup


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "sources"
        self.source.mkdir()
        self.evidence = self.root / "evidence"
        self.evidence.mkdir()
        self.state = self.root / "state"
        self.file = self.source / "original.png"
        self.file.write_bytes(b"exact original payload")
        self.plan_path = self.root / "plan.json"
        self.make_plan()

    def tearDown(self):
        self.temp.cleanup()

    def write_json(self, name, value):
        p = self.evidence / name
        p.write_text(json.dumps(value, sort_keys=True))
        return p

    def make_plan(self, provider=False):
        payload = self.file.read_bytes()
        item = {"source_id": "images", "path": self.file.name,
                "sha256": cleanup.sha(payload), "bytes": len(payload)}
        archived = [item]
        if provider:
            archived = [{"source_id": "metadata", "path": "compact.jsonl",
                         "sha256": cleanup.sha(b"compact fields"), "bytes": 14},
                        {"source_id": "images", "path": "recovered.png",
                         "sha256": cleanup.sha(b"native image bytes"), "bytes": 18}]
        manifest = self.write_json("manifest.json", {"snapshot_id": "snapshot", "files": archived})
        receipt = self.write_json("receipt.json", {"snapshot_id": "snapshot", "manifest": {
            "bytes": manifest.stat().st_size, "sha256": cleanup.sha(manifest.read_bytes())}})
        remote = self.write_json("remote.json", {"status": "matched", "snapshots": [{
            "snapshot_id": "snapshot", "manifest_sha256": cleanup.sha(manifest.read_bytes()),
            "receipt_sha256": cleanup.sha(receipt.read_bytes()), "remote_manifest_and_receipt": "matched",
            "prior_full_restore": "all files restored into a fresh directory, zero errors"}]})
        row = {"path": str(self.file), "sha256": item["sha256"], "bytes": item["bytes"],
               "stat": cleanup.fingerprint(self.file.stat()),
               "archive": {"kind": "exact-file", "snapshot_id": "snapshot"}}
        if provider:
            proof = {"path": str(self.file), "sha256": item["sha256"], "bytes": item["bytes"],
                "decision": "eligible-after-final-reader-and-stat-check",
                "all_nonpayload_json_fields_preserved": True, "all_image_bytes_match_restored_archive": True,
                "source_before_after_fingerprints_match": True, "source_matches_prior_recovery_sha256": True,
                "source_json_duplicate_keys_accepted": False, "errors": [],
                "raw_json_reconstruction": {"byte_identical_reconstruction_verified": True,
                                            "reconstructed_sha256": item["sha256"]},
                "proof": {"json_records": 1, "semantically_identical_records": 1, "images": 1, "errors": 0},
                "archived_compact_metadata": {"snapshot_id": "snapshot", **archived[0]},
                "image_payload_archive_proofs": [{"snapshot_id": "snapshot", "sha256": archived[1]["sha256"],
                                                 "bytes": archived[1]["bytes"]}], "unique_payloads": 1}
            pp = self.evidence / "provider-proof.jsonl"
            pp.write_text(json.dumps(proof) + "\n")
            row["archive"] = {"kind": "provider-fields", "proof_path": str(pp),
                              "proof_sha256": cleanup.sha(pp.read_bytes())}
        self.plan = {"schema": 1, "allowed_roots": [str(self.source)],
                     "protected_paths": [str(self.source / "shipping")],
                     "remote_verification": {"path": str(remote), "sha256": cleanup.sha(remote.read_bytes())},
                     "snapshots": [{"manifest_path": str(manifest), "receipt_path": str(receipt)}], "files": [row]}
        self.save_plan()

    def save_plan(self):
        self.plan_path.write_text(json.dumps(self.plan))
        self.pin = cleanup.sha(self.plan_path.read_bytes())

    def execute(self, apply=True):
        return cleanup.execute(self.plan_path, self.pin, apply, self.state)

    def claim(self):
        return self.source / (".hiraia-cleanup-" + self.pin + "-" + cleanup.sha(str(self.file).encode()) + ".claim")

    def journal_path(self):
        return self.state / self.pin / "journal.jsonl"

    def assert_code(self, code, function=None):
        with self.assertRaises(cleanup.CleanupError) as caught:
            (function or self.execute)()
        self.assertEqual(caught.exception.code, code)

    def test_default_dry_run_does_not_create_journal_or_mutate_sources(self):
        before = cleanup.fingerprint(self.file.stat())
        result = cleanup.execute(self.plan_path, state_dir=self.state)
        self.assertEqual(result["eligible"], 1)
        self.assertEqual(cleanup.fingerprint(self.file.stat()), before)
        self.assertFalse(self.state.exists())

    def test_apply_deletes_only_reviewed_file_and_resume_is_idempotent(self):
        other = self.source / "unreviewed.png"
        other.write_bytes(b"keep me")
        self.assertEqual(self.execute()["deleted"], 1)
        self.assertEqual(other.read_bytes(), b"keep me")
        self.assertTrue(self.source.is_dir())
        self.assertFalse(self.file.exists())
        self.assertEqual(self.execute()["already_deleted"], 1)

    def test_apply_requires_correct_plan_pin(self):
        self.assert_code("apply_requires_plan_sha256", lambda: cleanup.execute(self.plan_path, applying=True))
        self.assert_code("plan_hash_mismatch", lambda: cleanup.execute(self.plan_path, "0" * 64, True))
        self.assertTrue(self.file.exists())
        self.assertFalse(self.state.exists())

    def test_modified_content_and_changed_stat_are_refused(self):
        self.file.write_bytes(b"changed original data")
        self.assert_code("stat_changed")
        self.assertTrue(self.file.exists())
        self.assertFalse(self.claim().exists())

    def test_hash_mismatch_is_detected_even_with_reviewed_current_stat(self):
        self.file.write_bytes(b"different bytes")
        self.plan["files"][0]["stat"] = cleanup.fingerprint(self.file.stat())
        self.plan["files"][0]["bytes"] = self.file.stat().st_size
        # Keep size equal to archived payload so validation reaches the byte hash.
        self.file.write_bytes(b"X" * len(b"exact original payload"))
        self.plan["files"][0]["stat"] = cleanup.fingerprint(self.file.stat())
        self.plan["files"][0]["bytes"] = self.file.stat().st_size
        self.save_plan()
        self.assert_code("hash_mismatch")

    def test_file_symlink_and_ancestor_symlink_are_refused(self):
        self.file.unlink()
        target = self.root / "untouched.png"
        target.write_bytes(b"outside original")
        self.file.symlink_to(target)
        self.assert_code("not_regular")
        self.assertEqual(target.read_bytes(), b"outside original")
        self.file.unlink()
        self.source.rename(self.root / "original-directory")
        self.source.symlink_to(self.root / "original-directory", target_is_directory=True)
        with self.assertRaises(OSError):
            self.execute()

    def test_hardlink_is_refused(self):
        os.link(self.file, self.source / "second-link.png")
        self.assert_code("hardlinked")
        self.assertEqual(self.file.stat().st_nlink, 2)

    def test_path_escape_protected_path_and_marker_are_refused(self):
        saved = deepcopy(self.plan)
        for candidate, code in [(str(self.root / "elsewhere.png"), "outside_allowed_roots"),
                                (str(self.source) + "/../elsewhere.png", "path_not_absolute_normalized"),
                                (str(self.source / "shipping/a.png"), "protected_path"),
                                (str(self.source / ".hiraia-archive-offloaded.json"), "reserved_path")]:
            self.plan = deepcopy(saved)
            self.plan["files"][0]["path"] = candidate
            self.save_plan()
            self.assert_code(code)
        self.assertTrue(self.file.exists())

    def test_evidence_tampering_is_refused_before_claim(self):
        (self.evidence / "manifest.json").write_text("{}")
        with self.assertRaises((KeyError, cleanup.CleanupError)):
            self.execute()
        self.assertTrue(self.file.exists())
        self.assertFalse(self.state.exists())

    def test_provider_proof_does_not_require_raw_response_object(self):
        self.make_plan(provider=True)
        self.assertEqual(self.execute()["deleted"], 1)

    def test_unpreserved_provider_field_is_refused(self):
        self.make_plan(provider=True)
        p = self.evidence / "provider-proof.jsonl"
        proof = json.loads(p.read_text())
        proof["all_nonpayload_json_fields_preserved"] = False
        p.write_text(json.dumps(proof) + "\n")
        self.plan["files"][0]["archive"]["proof_sha256"] = cleanup.sha(p.read_bytes())
        self.save_plan()
        self.assert_code("provider_fields_not_proven")
        self.assertTrue(self.file.exists())

    def test_semantic_only_provider_reconstruction_is_refused(self):
        self.make_plan(provider=True)
        p = self.evidence / "provider-proof.jsonl"
        proof = json.loads(p.read_text())
        proof["raw_json_reconstruction"]["byte_identical_reconstruction_verified"] = False
        p.write_text(json.dumps(proof) + "\n")
        self.plan["files"][0]["archive"]["proof_sha256"] = cleanup.sha(p.read_bytes())
        self.save_plan()
        self.assert_code("provider_fields_not_proven")

    def test_native_exclusive_rename_never_overwrites(self):
        second = self.source / "existing"
        second.write_bytes(b"unrelated")
        with cleanup.directory(self.source) as fd:
            with self.assertRaises(FileExistsError):
                cleanup.rename_exclusive(fd, self.file.name, second.name)
        self.assertEqual(second.read_bytes(), b"unrelated")
        self.assertTrue(self.file.exists())

    def test_source_replacement_race_is_rolled_back_without_deletion(self):
        rename = cleanup.rename_exclusive
        raced = False

        def replace_source(fd, source, destination):
            nonlocal raced
            if not raced:
                raced = True
                replacement = self.source / "replacement.tmp"
                replacement.write_bytes(b"concurrent generation")
                os.replace(replacement, self.file)
            return rename(fd, source, destination)

        with patch.object(cleanup, "rename_exclusive", side_effect=replace_source):
            self.assert_code("stat_changed")
        self.assertEqual(self.file.read_bytes(), b"concurrent generation")
        self.assertFalse(self.claim().exists())

    def test_rollback_does_not_overwrite_recreated_source(self):
        rename = cleanup.rename_exclusive
        calls = 0

        def corrupt_claim_and_recreate(fd, source, destination):
            nonlocal calls
            calls += 1
            result = rename(fd, source, destination)
            if calls == 1:
                self.claim().write_bytes(b"concurrent claim change")
                self.file.write_bytes(b"new source generation")
            return result

        with patch.object(cleanup, "rename_exclusive", side_effect=corrupt_claim_and_recreate):
            self.assert_code("rollback_blocked_claim_preserved")
        self.assertEqual(self.file.read_bytes(), b"new source generation")
        self.assertEqual(self.claim().read_bytes(), b"concurrent claim change")

    def test_claim_changed_after_hash_is_not_unlinked(self):
        append = cleanup.Journal.append

        def change_at_intent(journal, event, **fields):
            append(journal, event, **fields)
            if event == "unlink_intent":
                self.claim().write_bytes(b"writer changed claimed file")

        with patch.object(cleanup.Journal, "append", change_at_intent):
            self.assert_code("claim_changed_before_unlink")
        self.assertEqual(self.file.read_bytes(), b"writer changed claimed file")

    def test_interrupt_keeps_claim_and_resume_verifies_then_deletes(self):
        append = cleanup.Journal.append

        def interrupt(journal, event, **fields):
            append(journal, event, **fields)
            if event == "claimed":
                raise KeyboardInterrupt

        with patch.object(cleanup.Journal, "append", interrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.execute()
        self.assertFalse(self.file.exists())
        self.assertEqual(self.claim().read_bytes(), b"exact original payload")
        self.assertEqual(self.execute(False)["recoverable_claim"], 1)
        self.assertEqual(self.execute()["deleted"], 1)

    def test_real_crash_after_rename_before_claim_journal_is_resumable(self):
        code = """import os,sys
sys.path.insert(0,sys.argv[1])
import local_cleanup as c
rename=c.rename_exclusive
def crash(fd,a,b):
    rename(fd,a,b)
    os._exit(93)
c.rename_exclusive=crash
c.execute(sys.argv[2],sys.argv[3],True,sys.argv[4])
"""
        result = subprocess.run([sys.executable, "-c", code, str(Path(cleanup.__file__).parent),
                                 str(self.plan_path), self.pin, str(self.state)], capture_output=True)
        self.assertEqual(result.returncode, 93, result.stderr)
        self.assertTrue(self.claim().exists())
        self.assertEqual(self.execute()["deleted"], 1)

    def test_interrupt_after_unlink_before_final_journal_is_resumable(self):
        unlink = os.unlink
        raised = False

        def interrupt(name, *args, **kwargs):
            nonlocal raised
            result = unlink(name, *args, **kwargs)
            if str(name).endswith(".claim") and not raised:
                raised = True
                raise KeyboardInterrupt
            return result

        with patch.object(cleanup.os, "unlink", side_effect=interrupt):
            with self.assertRaises(KeyboardInterrupt):
                self.execute()
        self.assertFalse(self.file.exists())
        self.assertFalse(self.claim().exists())
        self.assertEqual(self.execute()["already_deleted"], 1)

    def test_unowned_claim_and_missing_without_intent_are_refused(self):
        self.claim().write_bytes(self.file.read_bytes())
        self.assert_code("unowned_claim")
        self.claim().unlink()
        self.file.unlink()
        self.assert_code("missing_without_delete_intent")

    def test_journal_partial_tail_repair_and_complete_record_corruption(self):
        self.execute()
        with self.journal_path().open("ab") as f:
            f.write(b'{"partial":')
        self.assertEqual(self.execute()["already_deleted"], 1)
        data = self.journal_path().read_bytes().replace(b'"event":"deleted"', b'"event":"corrupt"')
        self.journal_path().write_bytes(data)
        self.assert_code("journal_corrupt")

    def test_loaded_journal_index_matches_durable_row_history(self):
        self.execute()
        records = [json.loads(line) for line in self.journal_path().read_text().splitlines()]
        row_id = cleanup.sha(str(self.file).encode())
        expected = [event["event"] for event in records if event.get("row_id") == row_id]
        with cleanup.open_journal(self.state, self.pin, False) as journal:
            self.assertEqual(journal.row_events(row_id), expected)
            # Reading row history must not depend on rescanning the global log.
            journal.events = None
            self.assertEqual(journal.row_events(row_id), expected)
            self.assertEqual(journal.row_events("absent"), [])

    def test_new_source_after_completed_cleanup_is_preserved(self):
        self.execute()
        self.file.write_bytes(b"future generation")
        self.assert_code("source_recreated_after_cleanup")
        self.assertEqual(self.file.read_bytes(), b"future generation")


if __name__ == "__main__":
    unittest.main()
