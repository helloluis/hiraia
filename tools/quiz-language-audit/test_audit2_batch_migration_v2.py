"""Offline version-dispatch and immutable two-step migration checks."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import gemini_reaudit_queue as R
import fresh_result_selection as S


def first_record(original, intermediate, original_sha):
    return {'schema_version': 1, 'kind': 'fresh_batch_v1',
        'original_config_sha256': original_sha,
        'dependencies': {p: {'old_sha256': original['dependencies_sha256'].get(p),
                             'new_sha256': intermediate['dependencies_sha256'][p]}
                         for p in R.MIGRATION_FILES}}


class MigrationChainTests(unittest.TestCase):
    def setUp(self):
        self.original = {'poll_seconds': 60, 'budget_usd': 30, 'prompt_sha256': 'e' * 64,
            'dependencies_sha256': {p: 'a' * 64 for p in R.MIGRATION_FILES
                                    if p != R.MIGRATION_CONTRACT}}
        self.original['dependencies_sha256']['/unchanged/audit.py'] = 'd' * 64
        self.intermediate = copy.deepcopy(self.original)
        self.intermediate['dependencies_sha256'].update({p: 'b' * 64 for p in R.MIGRATION_FILES})
        self.first = first_record(self.original, self.intermediate, 'e' * 64)
        self.current = copy.deepcopy(self.intermediate)
        self.current['dependencies_sha256'].update({p: 'c' * 64 for p in R.MIGRATION_V2_FILES})
        self.second = R.make_dependency_migration_v2(self.original, self.current, self.first, 'e' * 64, 'f' * 64)

    def verify(self, current=None, first=None, second=None):
        return R.validate_dependency_migration_v2(self.original, current or self.current,
            first or self.first, second or self.second, 'e' * 64, 'f' * 64)

    def test_valid_chain_preserves_v1_contract(self):
        self.assertTrue(self.verify())
        self.assertEqual(R.migration_v1_config(self.original, self.first, 'e' * 64), self.intermediate)
        self.assertNotIn(R.MIGRATION_CONTRACT, self.second['dependencies'])
        self.assertIsNone(self.second['dependencies'][R.MIGRATION_V2_CONTRACT]['old_sha256'])

    def test_missing_or_invalid_first_step_rejected(self):
        with self.assertRaises(ValueError):
            R.make_dependency_migration_v2(self.original, self.current, None, 'e' * 64, 'f' * 64)
        bad = copy.deepcopy(self.first)
        bad['dependencies'][R.MIGRATION_CONTRACT]['old_sha256'] = 'a' * 64
        with self.assertRaises(ValueError): self.verify(first=bad)

    def test_both_anchors_are_required(self):
        for field in ('original_config_sha256', 'previous_migration_sha256'):
            with self.subTest(field=field):
                bad = copy.deepcopy(self.second); bad[field] = '0' * 64
                with self.assertRaisesRegex(ValueError, 'unbound'): self.verify(second=bad)

    def test_cannot_change_v1_contract_other_code_or_runtime_config(self):
        for change in ('v1_contract', 'other_code', 'poll_seconds', 'budget_usd', 'prompt_sha256'):
            with self.subTest(change=change):
                bad = copy.deepcopy(self.current)
                if change == 'v1_contract': bad['dependencies_sha256'][R.MIGRATION_CONTRACT] = '0' * 64
                elif change == 'other_code': bad['dependencies_sha256']['/unchanged/audit.py'] = '0' * 64
                else: bad[change] = 'changed'
                with self.assertRaises(ValueError): self.verify(current=bad)

    def test_extra_missing_and_tampered_v2_declarations(self):
        for change in ('extra', 'missing', 'old_hash', 'new_hash'):
            with self.subTest(change=change):
                bad = copy.deepcopy(self.second)
                target = next(p for p in R.MIGRATION_V2_FILES if p != R.MIGRATION_V2_CONTRACT)
                if change == 'extra': bad['dependencies'][R.MIGRATION_CONTRACT] = {'old_sha256': 'b' * 64, 'new_sha256': 'b' * 64}
                elif change == 'missing': del bad['dependencies'][target]
                else: bad['dependencies'][target]['old_sha256' if change == 'old_hash' else 'new_sha256'] = '0' * 64
                with self.assertRaises(ValueError): self.verify(second=bad)

    def test_freeze_requires_both_records_and_never_rewrites_them(self):
        with tempfile.TemporaryDirectory(prefix='audit2-chain-') as name:
            root = Path(name); out = root / 'audit2'; out.mkdir()
            target, prior = out / 'config.json', out / R.MIGRATION_NAME
            args = SimpleNamespace(budget=30, concurrency=2, batch_size=50, poll_seconds=60,
                other_budget_log=[], combined_budget=None, jobs=root / 'jobs.jsonl',
                fresh_out=root / 'fresh', fresh_process=root / 'fresh/process.json', out=out)
            def sha(path):
                p = Path(path)
                return hashlib.sha256(p.read_bytes() if p in (target, prior) and p.exists() else str(p).encode()).hexdigest()
            with patch.object(R, 'file_sha', side_effect=sha):
                current = R.freeze_config(args, R.PROMPT, [None])
                original = copy.deepcopy(current)
                for p in (R.MIGRATION_CONTRACT, R.MIGRATION_V2_CONTRACT): original['dependencies_sha256'].pop(p)
                for p in R.MIGRATION_FILES - {R.MIGRATION_CONTRACT}: original['dependencies_sha256'][p] = 'a' * 64
                original_bytes = json.dumps(original, indent=2).encode() + b'\n'; target.write_bytes(original_bytes)
                with self.assertRaisesRegex(ValueError, 'without a migration attestation'):
                    R.freeze_config(args, R.PROMPT, [None])
                intermediate = copy.deepcopy(original)
                intermediate['dependencies_sha256'].update({p: 'b' * 64 for p in R.MIGRATION_FILES})
                intermediate['dependencies_sha256'][R.MIGRATION_CONTRACT] = current['dependencies_sha256'][R.MIGRATION_CONTRACT]
                record = first_record(original, intermediate, sha(target))
                first_bytes = json.dumps(record, indent=2).encode() + b'\n'; prior.write_bytes(first_bytes)
                with self.assertRaisesRegex(ValueError, 'without a v2 migration attestation'):
                    R.freeze_config(args, R.PROMPT, [None])
                second = R.make_dependency_migration_v2(original, current, record, sha(target), sha(prior))
                (out / R.MIGRATION_V2_NAME).write_text(json.dumps(second))
                self.assertEqual(R.freeze_config(args, R.PROMPT, [None]), current)
                self.assertEqual(target.read_bytes(), original_bytes)
                self.assertEqual(prior.read_bytes(), first_bytes)
                args.poll_seconds = 5
                with self.assertRaisesRegex(ValueError, 'nondependency'):
                    R.freeze_config(args, R.PROMPT, [None])
                self.assertEqual(target.read_bytes(), original_bytes)
                self.assertEqual(prior.read_bytes(), first_bytes)


class VersionedSelectorTests(unittest.TestCase):
    def setUp(self):
        S._verified.clear()
        self.temp = tempfile.TemporaryDirectory(prefix='audit2-v2-selector-'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.result = self.root / 'results/1'; self.result.mkdir(parents=True)
        (self.root / 'queue').mkdir(); self.prompt = 'Translate faithfully.'
        english = {'q': 'What causes a higher pitch?', 'options': ['Fast vibrations', 'Slow vibrations', 'Soft vibrations'],
                   'explanation': 'Faster vibrations produce a higher pitch.'}
        self.original = {'key': 'a' * 64, 'content': {'english': english, 'target': copy.deepcopy(english),
            'answer': 0, 'language': 'bis', 'grades': [6], 'source_fact': {'en': english['explanation']}},
            'refs': [], 'preflight': []}
        self.snapshot = {self.original['key']: {'sample_id': 1, 'job': self.original}}
        self.entry = S.Q.clean_item(self.original, 1)
        self.entry.update(source_refs=[], source_job_sha256=S.T.digest(self.original),
                          request_sha256=S.T.digest(S.T.payload(self.entry, self.prompt)))
        proposed = {'q': 'Unsay makapataas sa tono?', 'options': ['Paspas nga pag-uyog', 'Hinay nga pag-uyog', 'Mahuyang nga pag-uyog'],
                    'explanation': 'Ang paspas nga pag-uyog makapataas sa tono.'}
        self.raw = {'model': S.T.MODEL, 'service_tier': 'flex', 'choices': [{'finish_reason': 'stop',
            'message': {'content': json.dumps({'status': 'translated', 'note': 'Faithful.', 'proposed': proposed})}}],
            'usage': {'prompt_tokens': 10, 'completion_tokens': 10, 'cost': .00001, 'is_byok': False}}
        self.put(self.root / 'queue/1.json', self.entry)
        self.put(self.result / 'request.json', S.T.payload(self.entry, self.prompt))
        self.put(self.result / 'response.json', self.raw)
        self.put(self.result / 'final.json', S.T.validate(self.raw, self.entry))

    @staticmethod
    def put(path, data): path.write_text(json.dumps(data))

    def verify(self): return S.verify_candidate(self.root, self.snapshot, self.prompt, 1)

    def test_legacy_flex_without_origin_still_uses_flex_billing(self):
        with patch.object(S.T.flex, 'validate_billing', wraps=S.T.flex.validate_billing) as billing:
            candidate = self.verify()
        billing.assert_called_once(); self.assertNotIn('fresh_batch_version', candidate['selection'])

    def test_missing_unsupported_and_boolean_version_rejected(self):
        for version in (None, 3, True):
            with self.subTest(version=version):
                self.put(self.result / 'batch-origin.json', {'kind': 'cloud_batch', 'version': version})
                with self.assertRaisesRegex(ValueError, 'version'): self.verify()

    def test_explicit_version_dispatch_and_origin_cache_invalidation(self):
        origin = self.result / 'batch-origin.json'; receipt = self.root / 'receipt.json'; self.put(receipt, {})
        modules = {name: SimpleNamespace(immutable_dependency_paths=Mock(return_value=[origin, receipt]),
                   verify_saved_candidate=Mock(return_value=self.raw))
                   for name in ('fresh_batch_contract', 'fresh_batch_contract_v2')}
        with patch.dict('sys.modules', modules), patch.object(S.T.flex, 'validate_billing', side_effect=AssertionError('Flex called')):
            for version, name in [(1, 'fresh_batch_contract'), (2, 'fresh_batch_contract_v2')]:
                self.put(origin, {'kind': 'cloud_batch', 'version': version})
                candidate = self.verify()
                self.assertEqual(candidate['selection']['fresh_batch_version'], version)
                modules[name].verify_saved_candidate.assert_called_once()
            self.verify(); modules['fresh_batch_contract_v2'].verify_saved_candidate.assert_called_once()
            self.put(receipt, {'changed': True})
            modules['fresh_batch_contract_v2'].verify_saved_candidate.side_effect = ValueError('Receipt changed')
            with self.assertRaisesRegex(ValueError, 'Receipt changed'): self.verify()

    def real_fixture(self, contract, directory_name):
        d = self.root / directory_name / 'batches/000001'; d.mkdir(parents=True)
        request = contract.batch_payload(self.entry, self.prompt)
        self.put(d / 'request.json', {'endpoint': '/v1/chat/completions', 'model': contract.MODEL,
            'requests': [{'custom_id': '1', 'body': request}]})
        accepted = {'id': 'batch-fixture', 'endpoint': '/v1/chat/completions', 'model': contract.CANONICAL_MODEL,
                    'request_counts': {'total': 1}}
        self.put(d / 'accepted.json', accepted)
        raw = copy.deepcopy(self.raw); raw.pop('service_tier'); raw['model'] = contract.CANONICAL_MODEL
        raw['provider'] = 'Google AI Studio'
        self.put(d / 'terminal.json', {**accepted, 'status': 'completed', 'usage': raw['usage'],
            'request_counts': {'total': 1, 'completed': 1, 'failed': 0},
            'results': [{'custom_id': '1', 'response': {'status_code': 200, 'body': raw}}]})
        origin = contract.make_origin(self.entry, d)
        self.put(self.result / 'batch-origin.json', origin)
        self.put(self.result / 'batch-receipt.json', contract.make_receipt(origin))
        self.put(self.result / 'request.json', request); self.put(self.result / 'response.json', raw)
        self.put(self.result / 'final.json', S.T.validate(raw, self.entry))
        return d, raw

    def test_real_v1_provenance_remains_supported(self):
        import fresh_batch_contract as C
        self.real_fixture(C, 'bulk')
        self.assertEqual(self.verify()['selection']['fresh_batch_version'], 1)

    def test_real_v2_nullable_schema_and_untouched_response(self):
        import fresh_batch_contract_v2 as C
        directory, raw = self.real_fixture(C, 'bulk-v2')
        before = (self.result / 'response.json').read_bytes()
        with patch.object(S.T.flex, 'validate_billing', side_effect=AssertionError('Flex called')):
            candidate = self.verify()
        self.assertEqual(candidate['selection']['fresh_batch_version'], 2)
        self.assertEqual((self.result / 'response.json').read_bytes(), before)
        self.assertEqual(candidate['job']['content']['target'], S.T.validate(raw, self.entry)['result']['proposed'])
        self.put(directory / 'accepted.json', {'id': 'tampered'})
        with self.assertRaises(ValueError): self.verify()


if __name__ == '__main__': unittest.main()
