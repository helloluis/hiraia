import copy
import importlib.util
from pathlib import Path
import unittest


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


presentation = module('card_presentation_patches')
language = module('card_language_patches')


class PresentationPatchTests(unittest.TestCase):
    def setUp(self):
        self.title = {'en': 'A title', 'tl': 'Pamagat', 'bis': 'Titulo'}
        self.row = {'id': 'ffct-00001', 'factId': 'fixture',
                    'fact': {'en': 'First; second.', 'tl': 'Una; pangalawa.', 'bis': 'Una; ikaduha.'}}

    def apply(self, rows):
        return presentation.apply_presentation_patches(rows,
            titles={'ffct-00001': self.title, 'absent': self.title},
            cats={'ffct-00001': ['matter'], 'absent': ['energy']})

    def test_missing_only_backfill_does_not_mutate_input_or_add_absent_ids(self):
        before = copy.deepcopy(self.row)
        result, counts = self.apply([self.row])
        self.assertEqual(self.row, before)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['title'], self.title)
        self.assertEqual(result[0]['cats'], ['matter'])
        self.assertEqual(counts['titles_applied'], 1)
        self.assertEqual(counts['cats_applied'], 1)

    def test_existing_reviewed_title_and_categories_are_preserved(self):
        row = {**self.row, 'title': {'en': 'New', 'tl': 'Bago', 'bis': 'Bag-o'}, 'cats': ['reviewed']}
        result, counts = self.apply([row])
        self.assertEqual(result, [row])
        self.assertEqual(counts['titles_kept'], 1)
        self.assertEqual(counts['cats_kept'], 1)

    def test_partial_title_matches_established_tagalog_presence_rule(self):
        row = {**self.row, 'title': {'en': 'Partial'}}
        result, _ = self.apply([row])
        self.assertEqual(result[0]['title'], self.title)

    def test_title_restore_precedes_language_overlay_and_second_run_is_stable(self):
        before = {**self.row, 'title': self.title}
        after = copy.deepcopy(before)
        after['fact']['bis'] = 'Una. Ikaduha.'
        after['title']['bis'] = 'Klaro nga Titulo'
        registry = {before['id']: {'before': language.context(before), 'after': language.context(after)}}
        restored, _ = self.apply([self.row])
        reviewed = language.apply_patches(restored, registry=registry)
        restored_again, _ = self.apply(reviewed)
        self.assertEqual(language.apply_patches(restored_again, registry=registry), reviewed)
        self.assertEqual(reviewed[0]['title']['en'], self.title['en'])
        self.assertEqual(reviewed[0]['title']['tl'], self.title['tl'])
        self.assertEqual(reviewed[0]['title']['bis'], 'Klaro nga Titulo')

    def test_changed_source_title_still_triggers_language_review(self):
        before = {**self.row, 'title': self.title}
        after = copy.deepcopy(before); after['fact']['bis'] = 'Una. Ikaduha.'
        registry = {before['id']: {'before': language.context(before), 'after': language.context(after)}}
        changed = {**before, 'title': {**self.title, 'en': 'Changed science'}}
        rows, _ = self.apply([changed])
        with self.assertRaisesRegex(ValueError, 'source drift'):
            language.apply_patches(rows, registry=registry)

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            self.apply([self.row, self.row])


if __name__ == '__main__':
    unittest.main()
