"""Prevent author metadata precision from blocking every assessment controller."""
from datetime import datetime
import importlib.util
from pathlib import Path
import re
import unittest
import copy

spec = importlib.util.spec_from_file_location('compiler', Path(__file__).with_name('build-assessment-bank.py'))
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)


class CompilerTimestampTests(unittest.TestCase):
    def test_microsecond_author_timestamp_is_emitted_as_native_milliseconds(self):
        source = '2026-09-29T00:15:38.678349+00:00'
        output = compiler.latest_authored_at(['2026-09-28T23:59:59.999Z', source])
        self.assertEqual('2026-09-29T00:15:38.678+00:00', output)
        self.assertRegex(output, r'T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$')
        self.assertLess(abs(datetime.fromisoformat(source).timestamp()-datetime.fromisoformat(output).timestamp()), 0.001)

    def test_latest_date_uses_instant_not_lexical_timezone_order(self):
        values = ['2026-09-29T09:00:00.001+08:00', '2026-09-29T01:01:00+00:00']
        self.assertEqual('2026-09-29T01:01:00.000+00:00', compiler.latest_authored_at(values))


class TeachingLinkHoldTests(unittest.TestCase):
    def setUp(self):
        self.item = {'provenance': {'primary': {'card_ids': ['primary'], 'fact': {'en': 'A source'}}},
                     'relationships': {'knowledge_family_id': 'family'}}

    def test_exact_snapshot_does_not_override_semantic_hold(self):
        self.item['provenance']['primary']['teaching_link_hold'] = {
            'reason': 'Source does not teach the tested claim.', 'review_receipt': 'review.json'}
        self.assertEqual([], compiler.teaching_candidates(self.item))

    def test_hold_preserves_other_reviewed_same_family_link(self):
        self.item['provenance']['primary']['teaching_link_hold'] = {
            'reason': 'Insufficient source.', 'review_receipt': 'review.json'}
        self.item['provenance']['additional_teaching_cards'] = [{
            'card_id': 'direct', 'fact': {'en': 'Direct claim'}, 'reviewed_languages': ['bis'],
            'review_status': 'author_source_checked', 'knowledge_family_id': 'family'}]
        self.assertEqual([('direct', {'en': 'Direct claim'}, ['bis'])], compiler.teaching_candidates(self.item))

    def test_malformed_hold_fails_closed(self):
        for hold in (None, False, {}, {'reason': 'Reason'}):
            with self.subTest(hold=hold), self.assertRaisesRegex(AssertionError, 'Malformed'):
                item = copy.deepcopy(self.item)
                item['provenance']['primary']['teaching_link_hold'] = hold
                compiler.teaching_candidates(item)

    def test_unheld_link_retains_language_and_family_checks(self):
        self.assertEqual([('primary', {'en': 'A source'}, list(compiler.LANGS))], compiler.teaching_candidates(self.item))
        self.item['provenance']['additional_teaching_cards'] = [{
            'card_id': 'wrong-family', 'fact': {'en': 'Other'}, 'reviewed_languages': ['bis'],
            'review_status': 'author_source_checked', 'knowledge_family_id': 'other'}]
        self.assertEqual(1, len(compiler.teaching_candidates(self.item)))


if __name__ == '__main__': unittest.main()
