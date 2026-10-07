import copy
import hashlib
import json
import unittest

from apply_review import prepare


class ReviewGuardTests(unittest.TestCase):
    def setUp(self):
        self.doc = {'q': {'en': 'Move right?', 'tl': 'Kumanan?', 'bis': 'Lakaw?'},
                    'o': [{'en': 'Slows', 'tl': 'Bumabagal', 'bis': 'Mohinay'}], 'a': 0}
        self.raw = json.dumps(self.doc).encode()
        self.plan = {'source_pins': {'source.json': {'sha256': hashlib.sha256(self.raw).hexdigest()}},
                     'changes': [{'file': 'source.json', 'pointer': '/q/bis', 'fact_id': 'test',
                                  'english': 'Move right?', 'before': 'Lakaw?', 'after': 'Lihok?'}]}

    def test_preserves_full_question_and_answer_context(self):
        before, after = prepare(self.plan, {'source.json': self.raw})
        expected = copy.deepcopy(self.doc)
        expected['q']['bis'] = 'Lihok?'
        self.assertEqual(after['source.json'], expected)
        self.assertEqual(before['source.json'], self.doc)

    def test_changed_source_rejected_before_application(self):
        with self.assertRaisesRegex(AssertionError, 'Stale source'):
            prepare(self.plan, {'source.json': self.raw+b' '})

    def test_wrong_english_context_rejected(self):
        self.plan['changes'][0]['english'] = 'Move left?'
        with self.assertRaisesRegex(AssertionError, 'English context'):
            prepare(self.plan, {'source.json': self.raw})

    def test_wrong_cebuano_context_rejected(self):
        self.plan['changes'][0]['before'] = 'Other'
        with self.assertRaisesRegex(AssertionError, 'Cebuano context'):
            prepare(self.plan, {'source.json': self.raw})

    def test_english_edit_rejected(self):
        self.plan['changes'][0]['pointer'] = '/q/en'
        with self.assertRaisesRegex(AssertionError, 'Only bis'):
            prepare(self.plan, {'source.json': self.raw})

    def test_answer_edit_rejected(self):
        self.plan['changes'][0]['pointer'] = '/a'
        with self.assertRaisesRegex(AssertionError, 'Only bis'):
            prepare(self.plan, {'source.json': self.raw})

    def test_missing_pointer_rejected(self):
        self.plan['changes'][0]['pointer'] = '/missing/bis'
        with self.assertRaises(KeyError):
            prepare(self.plan, {'source.json': self.raw})

    def test_duplicate_edit_rejected(self):
        self.plan['changes'] *= 2
        with self.assertRaisesRegex(AssertionError, 'Duplicate edit'):
            prepare(self.plan, {'source.json': self.raw})


if __name__ == '__main__':
    unittest.main()
