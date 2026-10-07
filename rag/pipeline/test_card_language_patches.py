import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("card_language_patches", Path(__file__).with_name("card_language_patches.py"))
mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(mod)


class LanguagePatchTests(unittest.TestCase):
    def setUp(self):
        self.card = {"id": "dcard-00001", "factId": "fixture", "slug": "art", "terms": ["water"],
                     "fact": {"en": "First; second.", "tl": "Una; pangalawa.", "bis": "Una; ikaduha."},
                     "title": {"en": "Two", "tl": "Dalawa", "bis": "Duha"},
                     "emphasis": {"bis": ["Una"]}}
        before = mod.context(self.card)
        after = copy.deepcopy(before)
        after["fact"]["bis"] = "Una. Ikaduha."
        self.entry = {"before": before, "after": after, "review": {"reviewer": "fixture"}}
        self.registry = {self.card["id"]: self.entry}

    def apply(self, cards=None, **kwargs):
        return mod.apply_patches([self.card] if cards is None else cards, registry=self.registry, **kwargs)

    def test_source_overlay_is_idempotent_and_preserves_nontext(self):
        result = self.apply()
        self.assertEqual(self.apply(result), result)
        self.assertEqual(result[0]["slug"], "art")
        self.assertEqual(result[0]["terms"], ["water"])
        self.assertEqual(self.card["fact"]["bis"], "Una; ikaduha.")

    def test_db_preflight_rejects_old_pool_accepts_applied_pool(self):
        with self.assertRaisesRegex(ValueError, "not applied"):
            self.apply(require_applied=True)
        self.apply(self.apply(), require_applied=True)

    def test_source_drift_fails_for_each_protected_context(self):
        for field, lang in [("fact", "en"), ("fact", "tl"), ("fact", "bis"), ("title", "bis"), ("title", "en")]:
            with self.subTest(field=field, lang=lang):
                card = copy.deepcopy(self.card)
                card[field][lang] += " changed"
                with self.assertRaisesRegex(ValueError, "source drift"):
                    self.apply([card])
        card = copy.deepcopy(self.card)
        card["factId"] = "reused-ID"
        with self.assertRaisesRegex(ValueError, "source drift"):
            self.apply([card])

    def test_duplicate_and_missing_ids_fail(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            self.apply([self.card, self.card])
        with self.assertRaisesRegex(ValueError, "absent"):
            self.apply([])

    def test_patch_cannot_edit_english_or_drop_emphasis(self):
        after = copy.deepcopy(self.entry["after"])
        after["fact"]["en"] = "New science"
        with self.assertRaisesRegex(ValueError, "protected"):
            mod.check_edit(self.entry["before"], after)
        after = copy.deepcopy(self.entry["after"])
        after["fact"]["bis"] = "Ikaduha."
        with self.assertRaisesRegex(ValueError, "emphasis"):
            mod.check_edit(self.entry["before"], after)

    def test_late_bad_row_never_mutates_earlier_card(self):
        saved = copy.deepcopy(self.card)
        with self.assertRaises(ValueError):
            self.apply([self.card, self.card])
        self.assertEqual(self.card, saved)

    def test_registry_rejects_duplicate_provenance_free_and_unexpected_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "registry.json"
            for entries in ([self.entry, self.entry], [{**self.entry, "review": {}}],
                            [{**self.entry, "before": {**self.entry["before"], "slug": "unreviewed"}}]):
                path.write_text(json.dumps({"schema": mod.SCHEMA, "patches": entries}))
                with self.assertRaises(ValueError):
                    mod.load_registry(path)


class ApprovalProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="hiraia-language-approval-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "repo"
        (self.root / "reviews").mkdir(parents=True)
        root_patch = patch.object(mod, "ROOT", self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.before = {
            "id":"ffct-00001", "factId":"fixture", "slug":"old-art",
            "fact":{"en":"First; second.", "tl":"Una; pangalawa.", "bis":"Una; ikaduha."},
            "title":{"en":"Two", "tl":"Dalawa", "bis":"Duha"},
            "emphasis":{"bis":["Una"]},
        }
        self.after = copy.deepcopy(self.before)
        self.after["fact"]["bis"] = "Una. Ikaduha."
        self.row = {
            "card_id":self.before["id"], "decision":"apply_reviewed_cebuano_edit",
            "before_card":self.before, "after_card":self.after,
            "source_card_sha256":self.card_hash(self.before),
            "candidate_card_sha256":self.card_hash(self.after),
        }
        self.review = {"schema":"hiraia.cebuano-readability-reviewed-edits/v1",
                       "status":"reviewed_for_local_application", "accepted":[self.row]}
        self.review_path = self.root / "reviews/approval.json"
        self.entry = {"before":mod.context(self.before), "after":mod.context(self.after)}
        self.registry_path = self.root / "registry.json"
        self.save_review()

    @staticmethod
    def card_hash(card):
        raw = (json.dumps(card, ensure_ascii=False, indent=2) + "\n").encode()
        return hashlib.sha256(raw).hexdigest()

    def save_review(self, raw=None):
        if raw is None:
            raw = (json.dumps(self.review, ensure_ascii=False, indent=2) + "\n").encode()
        self.review_path.write_bytes(raw)
        self.entry["review"] = {"path":"reviews/approval.json", "bytes":len(raw),
                                "sha256":hashlib.sha256(raw).hexdigest()}

    def load(self, entries=None):
        self.registry_path.write_text(json.dumps({"schema":mod.SCHEMA,
            "patches":[self.entry] if entries is None else entries}), encoding="utf-8")
        return mod.load_registry(self.registry_path)

    def test_valid_pinned_review_binds_exact_context(self):
        entries = self.load()
        self.assertEqual(entries[self.before["id"]], self.entry)
        applied = mod.apply_patches([self.before], registry=entries)
        self.assertEqual(applied, [self.after])

    def test_registry_change_with_same_valid_review_is_unapproved(self):
        self.entry["after"]["fact"]["bis"] = "Una. Lain nga ikaduha."
        with self.assertRaisesRegex(ValueError, "does not match its accepted"):
            self.load()

    def test_tampered_review_bytes_fail_even_with_valid_json(self):
        self.review_path.write_bytes(self.review_path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "byte pin mismatch"):
            self.load()

    def test_wrong_size_rejected_even_with_correct_sha(self):
        self.entry["review"]["bytes"] += 1
        with self.assertRaisesRegex(ValueError, "byte pin mismatch"):
            self.load()

    def test_missing_review_is_not_a_descriptive_provenance_fallback(self):
        self.review_path.unlink()
        with self.assertRaisesRegex(ValueError, "cannot read language patch review"):
            self.load()
        self.entry["review"] = {"reviewer":"someone"}
        with self.assertRaisesRegex(ValueError, "complete review"):
            self.load()

    def test_rehashed_draft_review_cannot_approve_an_overlay(self):
        self.review["status"] = "proposed"
        self.save_review()
        with self.assertRaisesRegex(ValueError, "not an approved local edit plan"):
            self.load()

    def test_rehashed_wrong_schema_cannot_approve_an_overlay(self):
        self.review["schema"] = "another-review/v1"
        self.save_review()
        with self.assertRaisesRegex(ValueError, "not an approved local edit plan"):
            self.load()

    def test_rehashed_hold_row_is_not_accepted(self):
        self.row["decision"] = "hold"
        self.save_review()
        with self.assertRaisesRegex(ValueError, "unapproved or inconsistent"):
            self.load()

    def test_review_row_must_be_uniquely_accepted(self):
        self.review["accepted"] = [self.row, copy.deepcopy(self.row)]
        self.save_review()
        with self.assertRaisesRegex(ValueError, "duplicate accepted"):
            self.load()
        self.review["accepted"] = []
        self.save_review()
        with self.assertRaisesRegex(ValueError, "does not match its accepted"):
            self.load()

    def test_registry_duplicates_still_fail_with_real_valid_provenance(self):
        with self.assertRaisesRegex(ValueError, "duplicate language patch ID"):
            self.load([self.entry, self.entry])

    def test_rehashed_approval_cannot_hide_broken_full_card_pins(self):
        self.row["candidate_card_sha256"] = "0" * 64
        self.save_review()
        with self.assertRaisesRegex(ValueError, "inconsistent full-card"):
            self.load()

    def test_review_cannot_change_unrepresented_metadata_even_after_rehashing(self):
        # slug is not part of the overlay context, but the full approval must still
        # be a Cebuano-only edit. A valid hash does not authorize protected changes.
        self.after["slug"] = "unapproved-new-art"
        self.row["candidate_card_sha256"] = self.card_hash(self.after)
        self.save_review()
        with self.assertRaisesRegex(ValueError, "protected fields"):
            self.load()

    def test_review_path_cannot_escape_repository_directly_or_via_symlink(self):
        outside = self.base / "outside.json"
        outside.write_bytes(self.review_path.read_bytes())
        self.entry["review"]["path"] = "../outside.json"
        with self.assertRaisesRegex(ValueError, "within the repository"):
            self.load()
        link = self.root / "reviews/link.json"
        link.symlink_to(outside)
        self.entry["review"]["path"] = "reviews/link.json"
        with self.assertRaisesRegex(ValueError, "within the repository"):
            self.load()

    def test_duplicate_keys_in_rehashed_review_are_rejected(self):
        raw = json.dumps(self.review)[:-1] + ', "status":"reviewed_for_local_application"}'
        self.save_review(raw.encode())
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            self.load()


if __name__ == "__main__":
    unittest.main()
