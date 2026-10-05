"""Known-bad controls for review guards; not a measure of scientific recall."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-full-year.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
original_read = audit.read


class ReviewGuards(unittest.TestCase):
    def altered(self, filename, mutate):
        def read(path):
            data = original_read(path)
            if path == filename:
                mutate(data)
            return data
        return patch.object(audit, 'read', read)

    def test_unreviewed_reserve_is_rejected(self):
        path = 'packages/mobile/src/generated/grade3Lessons.generated.json'
        with self.altered(path, lambda d: d['lessons'][0]['cardIds'].append('ffct-09588')):
            with self.assertRaisesRegex(AssertionError, 'Unreviewed reserve'):
                audit.inventory()

    def test_missing_quiz_anchor_is_rejected(self):
        path = 'rag/pipeline/full-year-review.json'
        with self.altered(path, lambda d: d['units']['G3-M-3:ruler']['quizCardIds'].clear()):
            with self.assertRaisesRegex(AssertionError, 'G3-M-3:ruler'):
                audit.inventory()

    def test_changed_english_invalidates_frozen_review(self):
        path = 'packages/mobile/src/data/grade3LessonSupplement.json'
        def wrong_science(data):
            next(c for c in data['cards'] if c['id'] == 'g3-year-measure-length')['fact']['en'] = 'A centimeter equals a meter.'
        with self.altered(path, wrong_science):
            lock, _ = audit.inventory()
        saved = original_read(audit.LOCK)
        self.assertNotEqual(saved['englishContentHashes']['g3-year-measure-length'], lock['englishContentHashes']['g3-year-measure-length'])

    def test_replaced_pdf_is_rejected(self):
        path = 'packages/shared/src/curriculum/three-term-2026.json'
        with self.altered(path, lambda d: d['sources'][0].update(sha256='0' * 64)):
            with self.assertRaises(AssertionError):
                audit.inventory()


if __name__ == '__main__':
    unittest.main()
