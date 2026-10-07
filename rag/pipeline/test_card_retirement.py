"""Retirement regressions using temporary inventories and sentinel outputs only.

Run: python3 -m unittest discover -s rag/pipeline -p test_card_retirement.py
No provider calls, live pool writes or database build are performed.
"""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

import card_retirement as retirement


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load_script(filename, name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RetirementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='hiraia-card-retirement-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.card = {
            'id': 'dcard-00001', 'factId': 'fixture-retired', 'domain': 'MATTER',
            'topic': 'fixture', 'terms': ['fixture'], 'slug': '',
            'fact': {'en': 'This exact English is retired.', 'tl': 'Orihinal na teksto.',
                     'bis': 'Orihinal nga teksto.'},
            'title': {'en': 'Old card', 'tl': 'Lumang card', 'bis': 'Daang card'},
        }
        self.active = {**copy.deepcopy(self.card), 'id': 'ffct-00002', 'factId': 'fixture-active'}
        self.identity = {
            'card_id': self.card['id'], 'fact_id': self.card['factId'],
            'original_english_sha256': digest(self.card['fact']['en'].encode()),
        }
        self.snapshot = self.base / 'original.json'
        self.snapshot.write_bytes(encoded(self.card))
        self.tombstone = self.base / 'tombstone.json'
        self.tombstone.write_bytes(encoded({
            'schema': 'hiraia.card-retirement-tombstone/v1', **self.identity,
            'decision': 'retired', 'scope': 'all_languages', 'id_reuse_forbidden': True,
        }))
        self.entry = {**self.identity,
            'original_card': {'file': self.snapshot.name, 'sha256': digest(self.snapshot.read_bytes())},
            'tombstone': {'file': self.tombstone.name, 'sha256': digest(self.tombstone.read_bytes())}}
        self.registry = self.base / 'registry.json'
        self.write_registry([self.entry])

    def write_registry(self, entries):
        self.registry.write_bytes(encoded({'schema': 'hiraia.card-retirements/v1', 'retirements': entries}))

    def ledger(self):
        return retirement.load_retirements(self.registry)

    def test_registry_and_full_trilingual_original_are_pinned(self):
        self.assertEqual(set(self.ledger()), {self.card['id']})
        self.assertEqual(json.loads(self.snapshot.read_bytes()), self.card)

    def test_assembly_removes_whole_card_without_mutating_or_reordering_input(self):
        other = {**self.active, 'id': 'ffct-00003'}
        cards = [self.active, self.card, other]
        before = copy.deepcopy(cards)
        result = retirement.exclude_retired_cards(cards, retirements=self.ledger())
        self.assertEqual(result, [self.active, other])
        self.assertIs(result[0], self.active)
        self.assertEqual(cards, before)

    def test_changed_translations_do_not_escape_whole_card_retirement(self):
        changed = copy.deepcopy(self.card)
        changed['fact']['bis'] = 'A later translated draft.'
        changed['title']['tl'] = 'Another title'
        self.assertEqual(retirement.exclude_retired_cards([changed], retirements=self.ledger()), [])

    def test_changed_fact_identity_fails_in_both_consumers(self):
        changed = {**self.card, 'factId': 'a-new-fact'}
        for fn in (retirement.exclude_retired_cards, retirement.assert_no_retired_cards):
            with self.subTest(fn=fn.__name__), self.assertRaisesRegex(retirement.CardRetirementError, 'identity changed'):
                fn([changed], retirements=self.ledger())

    def test_changed_english_including_whitespace_is_not_silently_rebound(self):
        for replacement in ('A corrected English card.', self.card['fact']['en'] + ' '):
            changed = copy.deepcopy(self.card)
            changed['fact']['en'] = replacement
            with self.subTest(replacement=replacement), self.assertRaisesRegex(retirement.CardRetirementError, 'identity changed'):
                retirement.exclude_retired_cards([changed], retirements=self.ledger())

    def test_missing_english_is_not_silently_excluded(self):
        changed = copy.deepcopy(self.card)
        del changed['fact']['en']
        with self.assertRaisesRegex(retirement.CardRetirementError, 'identity changed'):
            retirement.exclude_retired_cards([changed], retirements=self.ledger())

    def test_duplicate_retired_and_active_input_ids_fail(self):
        for card in (self.card, self.active):
            with self.subTest(card=card['id']), self.assertRaisesRegex(retirement.CardRetirementError, 'duplicate card ID'):
                retirement.exclude_retired_cards([card, copy.deepcopy(card)], retirements=self.ledger())

    def test_reintroduced_retired_id_rejected_by_database_preflight(self):
        with self.assertRaisesRegex(retirement.CardRetirementError, 'remain in the app pool'):
            retirement.assert_no_retired_cards([self.active, self.card], retirements=self.ledger())

    def test_clean_input_accepted_without_any_rewrite(self):
        cards = [self.active]
        before = encoded(cards)
        self.assertIsNone(retirement.assert_no_retired_cards(cards, retirements=self.ledger()))
        self.assertEqual(encoded(cards), before)

    def test_duplicate_ledger_entries_fail(self):
        self.write_registry([self.entry, self.entry])
        with self.assertRaisesRegex(retirement.CardRetirementError, 'duplicate retired card ID'):
            self.ledger()

    def test_missing_and_empty_registry_fail_closed(self):
        self.registry.unlink()
        with self.assertRaisesRegex(retirement.CardRetirementError, 'required card retirement registry'):
            self.ledger()
        self.write_registry([])
        with self.assertRaisesRegex(retirement.CardRetirementError, 'historical retirements'):
            self.ledger()

    def test_snapshot_corruption_is_rejected(self):
        self.snapshot.write_bytes(self.snapshot.read_bytes() + b' ')
        with self.assertRaisesRegex(retirement.CardRetirementError, 'original card hash mismatch'):
            self.ledger()

    def test_rehashed_snapshot_cannot_change_pinned_identity(self):
        changed = {**self.card, 'factId': 'different-fact'}
        self.snapshot.write_bytes(encoded(changed))
        self.entry['original_card']['sha256'] = digest(self.snapshot.read_bytes())
        self.write_registry([self.entry])
        with self.assertRaisesRegex(retirement.CardRetirementError, 'identity changed'):
            self.ledger()

    def test_tombstone_cannot_silently_narrow_to_one_language(self):
        obj = json.loads(self.tombstone.read_bytes())
        obj['scope'] = 'bis_only'
        self.tombstone.write_bytes(encoded(obj))
        self.entry['tombstone']['sha256'] = digest(self.tombstone.read_bytes())
        self.write_registry([self.entry])
        with self.assertRaisesRegex(retirement.CardRetirementError, 'inconsistent retirement tombstone'):
            self.ledger()

    def test_tombstone_corruption_and_duplicate_json_keys_fail(self):
        self.tombstone.write_bytes(b'{}')
        with self.assertRaisesRegex(retirement.CardRetirementError, 'tombstone hash mismatch'):
            self.ledger()
        self.registry.write_bytes(b'{"schema":"hiraia.card-retirements/v1","retirements":[],"retirements":[]}')
        with self.assertRaisesRegex(retirement.CardRetirementError, 'duplicate JSON key'):
            self.ledger()

    def test_snapshot_path_escape_fails(self):
        self.entry['original_card']['file'] = '../outside.json'
        self.write_registry([self.entry])
        with self.assertRaisesRegex(retirement.CardRetirementError, 'within the registry directory'):
            self.ledger()

    def wire_fixture(self, cards):
        module = load_script('wire-app-pool.py', 'test_retirement_wire')
        paths = {k: self.base / filename for k, filename in {
            'SRC':'merged.json', 'ED':'editorial.json', 'ART':'art.json',
            'IMAGEMAP':'imageMap.ts', 'OUT':'app.json'}.items()}
        paths['SRC'].write_bytes(encoded({'cards':cards, 'taxonomy':[]}))
        # Even an editorial rewrite of the retired English must not restore this ID.
        paths['ED'].write_bytes(encoded({self.card['id']:{'concise':{
            'en':'Editorial replacement.', 'tl':'Pinalitan.', 'bis':'Gipulihan.'}}}))
        paths['ART'].write_text('{}')
        paths['IMAGEMAP'].write_text('')
        paths['OUT'].write_bytes(b'previous pool sentinel')
        for key, path in paths.items():
            setattr(module, key, str(path))
        return module, paths

    def test_wire_integration_cannot_resurrect_via_editorial_and_is_repeatable(self):
        module, paths = self.wire_fixture([self.active, self.card])
        input_before = paths['SRC'].read_bytes()
        # This small fixture has no reviewed language edits. Use an empty fixture
        # ledger through the real overlay, not the checkout's unrelated pilot IDs.
        with patch.object(retirement, 'REGISTRY', self.registry), \
                patch('card_language_patches.load_registry', return_value={}), \
                redirect_stdout(io.StringIO()):
            module.main()
            first = paths['OUT'].read_bytes()
            module.main()
        self.assertEqual(paths['OUT'].read_bytes(), first)
        self.assertEqual([r['id'] for r in json.loads(first)['cards']], [self.active['id']])
        self.assertEqual(paths['SRC'].read_bytes(), input_before)

    def test_wire_identity_mismatch_and_duplicates_leave_previous_pool_untouched(self):
        changed = {**self.card, 'factId':'reused-id'}
        for cards, message in [([changed], 'identity changed'), ([self.card,self.card], 'duplicate card ID')]:
            module, paths = self.wire_fixture(cards)
            with self.subTest(message=message), patch.object(retirement, 'REGISTRY', self.registry):
                with self.assertRaisesRegex(SystemExit, message):
                    module.main()
            self.assertEqual(paths['OUT'].read_bytes(), b'previous pool sentinel')

    def test_db_integration_refuses_before_every_output_or_tala_touch(self):
        module = load_script('build-cards-db.py', 'test_retirement_db')
        pool = self.base/'app.json'
        pool.write_bytes(encoded({'cards':[self.active,self.card],'taxonomy':[]}))
        module.POOL = str(pool)
        outputs=[]
        for key in ('OUT_DB','OUT_IDX','OUT_TOKENS'):
            path=self.base/key
            path.write_bytes(('previous '+key).encode())
            outputs.append((path,path.read_bytes()))
            setattr(module,key,str(path))
        with patch.object(retirement, 'REGISTRY', self.registry), \
                patch.object(module.os, 'makedirs', side_effect=AssertionError('output directory touched')), \
                patch.object(module.os, 'remove', side_effect=AssertionError('existing output deleted')), \
                patch.object(module.sqlite3, 'connect', side_effect=AssertionError('DB opened')), \
                patch.object(module._tala_catalog, 'main', side_effect=AssertionError('Tala touched')):
            with self.assertRaisesRegex(SystemExit, 'retired card.*remain'):
                module.main()
        for path,before in outputs:
            self.assertEqual(path.read_bytes(),before)

    def test_tala_merge_retains_historical_retired_row(self):
        # Exercise the established pure append-only merge, without running its writer.
        spec=importlib.util.spec_from_file_location('test_retirement_tala',
            Path(__file__).resolve().parents[2]/'packages/tala/scripts/build-card-catalog.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        prior=({'matter':'Matter'},{self.card['id']:['matter']},{})
        merged=module.merge(prior,[],[],[],set())
        self.assertEqual(merged,prior)


if __name__ == '__main__':
    unittest.main()
