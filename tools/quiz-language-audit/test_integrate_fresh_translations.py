import copy
import json
from pathlib import Path
import tempfile
import unittest

import integrate_fresh_translations as I


class IntegrationTests(unittest.TestCase):
    def row(self):
        return {'id': 'row1', 'answer': 1, 'grades': [4],
                'q': {'en': 'Question?', 'tl': 'Old TL?', 'bis': 'Old BIS?'},
                'options': [{'en': 'No', 'tl': 'Hindi', 'bis': 'Dili'},
                            {'en': 'Yes', 'tl': 'Oo', 'bis': 'Oo'}],
                'explanation': {'en': 'Because.', 'tl': 'Old TL.', 'bis': 'Old BIS.'}}

    def target(self, marker):
        return {'q': marker + '?', 'options': [marker + ' A', marker + ' B'], 'explanation': marker + '.'}

    def test_two_languages_compose_without_changing_english_key_or_metadata(self):
        before = self.row(); after = copy.deepcopy(before)
        for lang in ('tl', 'bis'):
            I.replace_target(after, lang, self.target(lang))
        I.assert_translation_only(before, after, {'tl', 'bis'})
        self.assertEqual(I.A.localized(after, 'tl'), self.target('tl'))
        self.assertEqual(I.A.localized(after, 'bis'), self.target('bis'))
        self.assertEqual(after['answer'], 1)

    def test_reject_option_loss_and_duplicate_options(self):
        for options in [['one'], ['same', 'same']]:
            with self.subTest(options=options), self.assertRaises(ValueError):
                I.replace_target(self.row(), 'tl', {**self.target('new'), 'options': options})

    def test_guard_detects_protected_metadata_and_unapproved_language_changes(self):
        before = self.row()
        for field in ('answer', 'id'):
            after = copy.deepcopy(before); after[field] = 'changed'
            with self.assertRaises(ValueError):I.assert_translation_only(before, after, {'tl'})
        after = copy.deepcopy(before); after['q']['bis'] = 'unapproved'
        with self.assertRaises(ValueError):I.assert_translation_only(before, after, {'tl'})

    def test_supplement_dictionary_preserves_membership_and_metadata(self):
        doc = {'cards': [{'id': 'card'}], 'questions': {'first': self.row()}, 'competencies': {'first': ['x']}}
        before = copy.deepcopy(doc); rows = I.rows_of(doc)
        I.replace_target(rows[0], 'bis', self.target('new'))
        self.assertEqual(list(doc['questions']), ['first'])
        self.assertEqual(doc['cards'], before['cards'])
        self.assertEqual(doc['competencies'], before['competencies'])
        I.assert_translation_only(before['questions']['first'], doc['questions']['first'], {'bis'})

    def test_jsonl_preserves_untouched_rows_and_blank_lines(self):
        row = self.row(); raw = (' ' + json.dumps(row) + '\n\n' + json.dumps(row) + '\n').encode()
        doc = [copy.deepcopy(row), copy.deepcopy(row)]
        I.replace_target(doc[1], 'tl', self.target('new'))
        rendered = I.render_document(Path('bank.jsonl'), raw, doc, {1})
        self.assertEqual(rendered.splitlines(keepends=True)[:2], raw.splitlines(keepends=True)[:2])
        self.assertEqual(json.loads(rendered.splitlines()[2]), doc[1])

    def test_live_drift_blocks_plan_before_any_source_write(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp); source = out / 'source.json'; staged = out / 'stage.json'; backup = out / 'backup.json'
            source.write_text('changed externally'); backup.write_text('before'); staged.write_text('after')
            for name in ('jobs.jsonl', 'integration-ledger.jsonl', 'holds.json'):(out / name).write_text('[]')
            manifest = {'evidence_files_sha256': {}, 'jobs_sha256': I.sha(out / 'jobs.jsonl'),
                        'ledger_sha256': I.sha(out / 'integration-ledger.jsonl'), 'holds_sha256': I.sha(out / 'holds.json'),
                        'source_files': {str(source): {'before_sha256': I.sha(backup), 'after_sha256': I.sha(staged),
                                                     'backup_path': str(backup), 'staged_path': str(staged)}}}
            I.write(out / 'manifest.json', manifest)
            with self.assertRaises(ValueError):I.verify_plan(out)
            self.assertEqual(source.read_text(), 'changed externally')


if __name__ == '__main__':unittest.main()
