"""Small offline integration fixtures; no provider calls or production data writes."""
import copy
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

import integrate_fresh_translations as I


class SelectionAndApplicationTests(unittest.TestCase):
    def fixture(self, root):
        root = root.resolve()
        source_repo = root / 'source'
        source_repo.mkdir()
        source = source_repo / 'quiz.jsonl'
        facts = source_repo / 'rag/bank/science-facts.jsonl'
        facts.parent.mkdir(parents=True)
        facts.write_text('{}\n')
        rows = []
        for number in range(3):
            rows.append({'id': f'row-{number}', 'answer': 1, 'grades': [4],
                         'q': {lang: f'{lang} question {number}' for lang in ('en', 'tl', 'bis')},
                         'options': [{lang: f'{lang} {option} {number}' for lang in ('en', 'tl', 'bis')}
                                     for option in ('A', 'B')],
                         'explanation': {lang: f'{lang} explanation {number}' for lang in ('en', 'tl', 'bis')},
                         'metadata': {'unchanged': number}})
        source.write_text(''.join(json.dumps(row) + '\n' for row in rows))
        paths = {name: root / name for name in ('snapshot', 'fresh', 'audit', 'review', 'reference')}
        for path in paths.values():
            path.mkdir()
        snapshot, candidates, identities = {}, [], {}
        for number, row in enumerate(rows):
            for language in ('tl', 'bis'):
                sample_id = len(candidates) + 1
                content = {'english': I.A.localized(row, 'en'), 'target': I.A.localized(row, language),
                           'language': language, 'answer': 1, 'grades': [4], 'source_fact': {'en': None}}
                key = I.A.digest(content)
                ref = {'path': str(source), 'row': number, 'id': row['id'], 'row_hash': I.A.digest(row)}
                original = {'key': key, 'content': content, 'refs': [ref], 'preflight': []}
                snapshot[key] = {'sample_id': sample_id, 'job': original}
                job = copy.deepcopy(original)
                proposed = {'q': f'Fresh {language} question {number}',
                            'options': [f'Fresh {language} A {number}', f'Fresh {language} B {number}'],
                            'explanation': f'Fresh {language} explanation {number}'}
                job['content']['target'] = proposed
                candidates.append({'key': key, 'sample_id': sample_id, 'job': job,
                                   'selection': {'fresh_proposed_sha256': I.A.digest(proposed)}})
                identities[number, language] = key
        jobs = paths['snapshot'] / 'jobs.jsonl'
        jobs.write_text(''.join(I.A.canonical(item['job']) + '\n' for item in snapshot.values()))
        I.write(jobs.parent / 'manifest.json', {'inputs': [{'path': str(source), 'sha256': I.sha(source)}],
                                               'facts_sha256': I.sha(facts)})
        for name in ('fresh', 'audit'):
            I.write(paths[name] / 'source-blocks.json', {})
            I.write(paths[name] / 'process.json', {'status': 'finished'})
        I.write(paths['fresh'] / 'config.json', {})
        (paths['fresh'] / 'prompt.txt').write_text('frozen test prompt')
        (paths['review'] / 'decisions.jsonl').write_text('')
        I.write(paths['reference'] / 'manifest.json', {})
        (paths['reference'] / 'audit-2-flagged.jsonl').write_text('')
        held = next(c for c in candidates if c['key'] == identities[1, 'tl'])
        result_dir = paths['audit'] / 'results' / str(held['sample_id'])
        I.write(result_dir / 'final.json', {'status': 'source_issue'})
        I.write(result_dir / 'response.json', {})
        I.write(paths['audit'] / 'queue' / f"{held['sample_id']}.json", held)
        corrected = {'q': 'External corrected question', 'options': ['External A', 'External B'],
                     'explanation': 'External corrected explanation'}
        decisions = {
            identities[0, 'tl']: {'decision': 'needs_review', 'proposed': None},
            identities[0, 'bis']: {'decision': 'already_ok', 'proposed': None},
            identities[2, 'tl']: {'decision': 'corrected', 'proposed': corrected}}
        args = SimpleNamespace(out=root / 'integration', jobs=jobs, fresh_out=paths['fresh'],
                               audit_out=paths['audit'], review=paths['review'],
                               reference=paths['reference'], source_repo=source_repo)
        return args, source, rows, snapshot, candidates, identities, decisions

    def prepared(self, root):
        fixture = self.fixture(root)
        args, _, _, snapshot, candidates, _, decisions = fixture
        with patch.object(I, 'validated_decisions', return_value=decisions), \
                patch.object(I.S, 'source_config', return_value=(snapshot, 'prompt')), \
                patch.object(I.S, 'ingest_candidates', return_value=(candidates, {
                    'invalid_proposals': {}, 'unknown_result_directories': 0})), \
                patch.object(I.R.F, 'validate_billing'), \
                patch.object(I.R, 'validate', return_value={'status': 'source_issue'}), \
                redirect_stdout(io.StringIO()):
            I.prepare(args)
        return fixture

    def test_selection_source_hold_propagation_and_exact_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            args, source, before, _, candidates, keys, decisions = self.prepared(Path(temp))
            manifest = I.read(args.out / 'manifest.json')
            self.assertEqual(manifest['counts']['integrated'], 3)
            self.assertEqual(manifest['counts']['held'], 3)
            self.assertEqual({k: manifest['counts'][k] for k in ('fresh', 'frontier_corrected', 'frontier_already_ok')},
                             {'fresh': 1, 'frontier_corrected': 1, 'frontier_already_ok': 1})
            held = {x['key'] for x in I.read(args.out / 'holds.json')}
            self.assertEqual(held, {keys[0, 'tl'], keys[1, 'tl'], keys[1, 'bis']})
            self.assertEqual(I.A.read_rows(source), before, 'prepare must not apply anything')
            record = manifest['source_files'][str(source)]
            staged = I.A.read_rows(Path(record['staged_path']))
            self.assertEqual(I.A.localized(staged[0], 'tl'), I.A.localized(before[0], 'tl'))
            self.assertEqual(staged[1], before[1], 'source issue holds both languages')
            self.assertEqual(I.A.localized(staged[2], 'tl'), decisions[keys[2, 'tl']]['proposed'])
            jobs = [json.loads(line) for line in (args.out / 'jobs.jsonl').read_text().splitlines()]
            self.assertEqual({j['key'] for j in jobs}, {keys[0, 'bis'], keys[2, 'tl'], keys[2, 'bis']})
            for job in jobs:
                for ref in job['refs']:
                    self.assertEqual(ref['row_hash'], I.A.digest(staged[ref['row']]))
                    self.assertEqual(job['content']['target'], I.A.localized(staged[ref['row']], job['content']['language']))
            for index in range(3):
                I.assert_translation_only(before[index], staged[index], {'tl', 'bis'})

    def test_apply_is_idempotent_and_binds_actual_sources_to_audit_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            args, source, _, _, _, _, _ = self.prepared(Path(temp))
            with redirect_stdout(io.StringIO()):
                I.apply(args.out)
                first = source.read_bytes()
                I.apply(args.out)
            self.assertEqual(source.read_bytes(), first)
            self.assertEqual(I.read(args.out / 'applied.json')['status'], 'applied_and_verified')
            self.assertEqual(I.verify_applied(args.out)['counts']['integrated'], 3)
            changed = I.A.read_rows(source)
            changed[2]['q']['tl'] = 'Unexpected post-application edit'
            source.write_text(''.join(json.dumps(row) + '\n' for row in changed))
            with self.assertRaisesRegex(ValueError, 'Live source changed'):
                I.verify_applied(args.out)


if __name__ == '__main__':
    unittest.main()
