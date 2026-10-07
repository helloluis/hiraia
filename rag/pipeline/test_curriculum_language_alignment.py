import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from card_language_patches import apply_patches, context
from content_corrections import correct_cards


def wire_module():
    spec = importlib.util.spec_from_file_location('wire_alignment_test', Path(__file__).with_name('wire-app-pool.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ArtInventoryTests(unittest.TestCase):
    def test_downloadable_slug_survives_a_small_bundle(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'index.json').write_text(json.dumps({'shards': [{'file': 'tail.json', 'images': 1}]}))
            (root/'tail.json').write_text(json.dumps({'images': [{'slug': 'downloadable-figure'}]}))
            available = wire_module().available_art({'bundled-figure'}, root/'index.json')
            self.assertEqual(available, {'bundled-figure', 'downloadable-figure'})
            self.assertNotIn('invented-figure', available)

    def test_incomplete_manifest_is_not_treated_as_complete(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'index.json').write_text(json.dumps({'shards': [{'file': 'tail.json', 'images': 2}]}))
            (root/'tail.json').write_text(json.dumps({'images': [{'slug': 'only-one'}]}))
            with self.assertRaisesRegex(ValueError, 'count mismatch'):
                wire_module().available_art(set(), root/'index.json')


class SciencePrecedenceTests(unittest.TestCase):
    def test_science_change_invalidates_an_old_language_approval(self):
        before = {'id': 'ffct-00001', 'factId': 'fixture',
                  'fact': {'en': 'Original science.', 'tl': 'Orihinal.', 'bis': 'Daang teksto.'},
                  'title': {'en': 'Title', 'tl': 'Pamagat', 'bis': 'Titulo'}}
        after = copy.deepcopy(before)
        after['fact']['bis'] = 'Bag-ong teksto.'
        registry = {before['id']: {'before': context(before), 'after': context(after)}}
        correction = {'id': before['id'], 'factId': before['factId'],
                      'fact': {**before['fact'], 'en': 'New audited science.'}}
        cards = [copy.deepcopy(before)]
        with patch('content_corrections.corrections', return_value=[correction]):
            correct_cards(cards)
        with self.assertRaisesRegex(ValueError, 'source drift'):
            apply_patches(cards, registry=registry)


if __name__ == '__main__':
    unittest.main()
