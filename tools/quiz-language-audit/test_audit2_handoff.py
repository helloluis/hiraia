"""Offline checks for the live, external Audit-2 review reference."""
import copy
import datetime
import io
import json
from pathlib import Path
import unittest
from unittest import mock

import audit2_handoff as handoff
import gemini_reaudit_queue as reaudit
import gemini_translator as translator
from test_gemini_reaudit_queue import PipelineFixture, audit_response, put


class HandoffTests(PipelineFixture):
    def setUp(self):
        super().setUp()
        self.destination = self.root / 'handoff'
        self.entries, _ = self.prepared(6)
        reaudit.freeze_config(self.args, reaudit.PROMPT, self.snapshot)
        for entry, status in zip(self.entries, ('flagged', 'pass', 'needs_review', 'source_issue')):
            directory = translator.directory(self.out, entry)
            raw = audit_response(entry, status)
            raw['model'] = reaudit.F.MODEL
            put(directory / 'request.json', reaudit.payload(entry))
            put(directory / 'response.json', raw)
            put(directory / 'final.json', reaudit.validate(raw, entry))
        put(translator.directory(self.out, self.entries[5]) / 'error.json',
            {'kind': 'transport', 'error': 'Fixture timeout', 'fatal': False})

    def export(self):
        return handoff.export(self.out, self.fresh, self.destination)

    def records(self):
        return [json.loads(line) for line in
                (self.destination / 'audit-2-flagged.jsonl').read_text().splitlines()]

    def files(self, roots):
        return {path: path.read_bytes() for root in roots for path in root.rglob('*') if path.is_file()}

    def test_only_flagged_results_export_self_contained_cards_with_stable_identity_and_provenance(self):
        summary = self.export()
        self.assertEqual(summary['flagged'], 1)
        self.assertEqual(summary['audit2_observed_statuses'],
                         {'flagged': 1, 'pass': 1, 'needs_review': 1, 'source_issue': 1})
        record, = self.records()
        entry = self.entries[0]
        content = entry['job']['content']
        self.assertEqual((record['sample_id'], record['key']), (entry['sample_id'], entry['job']['key']))
        self.assertEqual(record['audit2_batch_id'], 1)
        self.assertEqual(record['english'], content['english'])
        self.assertEqual(record['fresh_translation'], content['target'])
        self.assertEqual(record['english_context'], content['source_fact']['en'])
        self.assertEqual(record['original_answer_index_zero_based'], content['answer'])
        self.assertEqual((record['language'], record['grades']), (content['language'], content['grades']))
        self.assertEqual(record['source_refs'], entry['source_refs'])
        self.assertEqual(record['provenance']['snapshot_sha256'], handoff.sha(self.jobs))
        self.assertEqual(record['provenance']['audit2_queue_file_sha256'],
                         handoff.sha(self.out / 'queue' / '1.json'))
        self.assertEqual(record['provenance']['audit2_final_file_sha256'],
                         handoff.sha(self.out / 'results' / '1' / 'final.json'))
        self.assertEqual(record['audit2']['diagnosis']['checks']['q']['quote'], content['target']['q'])
        self.assertTrue(record['eligible_for_language_repair'])
        encoded = json.dumps(record)
        self.assertNotIn('PRIVATE_GENERATOR_CONFIDENCE', encoded)
        self.assertNotIn('PRIVATE_AUDIT_ONE_DIAGNOSIS', encoded)

    def test_live_source_holds_change_revision_and_eligibility_without_removing_the_flagged_reference(self):
        self.export()
        before, = self.records()
        key = before['key']
        put(self.fresh / 'source-blocks.json', {key: 'Fresh source review hold'})
        put(self.out / 'source-blocks.json', {key: 'Audit source review hold'})
        summary = self.export()
        after, = self.records()
        self.assertEqual((summary['flagged'], summary['eligible'], summary['source_held']), (1, 0, 1))
        self.assertEqual(summary['held_keys'], [key])
        self.assertEqual(after['key'], key)
        self.assertEqual(after['audit2']['status'], 'flagged')
        self.assertFalse(after['eligible_for_language_repair'])
        self.assertEqual(after['source_hold_reasons'], ['Audit source review hold', 'Fresh source review hold'])
        self.assertNotEqual(after['revision_sha256'], before['revision_sha256'])
        self.assertEqual(after['fresh_translation'], before['fresh_translation'])

    def test_record_revision_is_independent_of_export_clock(self):
        stamps = [datetime.datetime(2026, 9, 13, hour, tzinfo=datetime.timezone.utc) for hour in (1, 2)]
        with mock.patch.object(handoff.dt, 'datetime') as clock:
            clock.now.side_effect = stamps
            first = self.export()
            first_bytes = (self.destination / 'audit-2-flagged.jsonl').read_bytes()
            second = self.export()
        self.assertNotEqual(first['exported_at'], second['exported_at'])
        self.assertEqual(first['record_revisions'], second['record_revisions'])
        self.assertEqual(first['snapshot_sha256'], second['snapshot_sha256'])
        self.assertEqual(first_bytes, (self.destination / 'audit-2-flagged.jsonl').read_bytes())
        record, = self.records()
        without_revision = copy.deepcopy(record)
        del without_revision['revision_sha256']
        self.assertEqual(record['revision_sha256'], translator.digest(without_revision))

    def test_files_are_atomically_replaced_and_manifest_is_published_last_with_matching_hashes(self):
        replacements = []
        original_replace = Path.replace

        def replace(temporary, target):
            self.assertEqual(temporary.parent, target.parent)
            self.assertTrue(temporary.name.endswith('.tmp'))
            text = temporary.read_text()
            if target.name.endswith('.jsonl'):
                self.assertEqual(len([json.loads(line) for line in text.splitlines()]), 1)
            if target.name == 'manifest.json':
                manifest = json.loads(text)
                for name, digest in manifest['files_sha256'].items():
                    self.assertEqual(handoff.sha(target.parent / name), digest)
            replacements.append(target.name)
            return original_replace(temporary, target)

        with mock.patch.object(Path, 'replace', autospec=True, side_effect=replace):
            summary = self.export()
        self.assertEqual(replacements, ['audit-2-flagged.jsonl', 'audit-2-flagged.md', 'manifest.json'])
        manifest = translator.read(self.destination / 'manifest.json')
        self.assertEqual(manifest, summary)
        self.assertEqual(summary['snapshot_sha256'], translator.digest(self.records()))
        self.assertFalse(list(self.destination.glob('*.tmp')))

    def test_conflicting_or_malformed_upstream_input_leaves_previous_export_intact(self):
        self.export()
        previous = self.files([self.destination])
        directory = self.out / 'results' / '1'
        put(directory / 'error.json', {'error': 'Conflicting active error'})
        with self.assertRaisesRegex(ValueError, 'Final/error conflict'):
            self.export()
        self.assertEqual(self.files([self.destination]), previous)
        (directory / 'error.json').unlink()
        (directory / 'response.json').write_text('{malformed JSON')
        with self.assertRaises(ValueError):
            self.export()
        self.assertEqual(self.files([self.destination]), previous)

    def test_cli_rejects_overlapping_output_and_export_never_changes_source_artifacts(self):
        original = self.files([self.out, self.fresh])
        for destination in (self.out, self.out / 'handoff', self.fresh, self.root):
            with self.subTest(destination=destination):
                argv = ['audit2_handoff.py', 'export', '--audit-out', str(self.out),
                        '--fresh-out', str(self.fresh), '--out', str(destination)]
                with mock.patch('sys.argv', argv), mock.patch('sys.stderr', new=io.StringIO()), \
                        mock.patch.object(handoff, 'export', side_effect=AssertionError('Unsafe dispatch')):
                    with self.assertRaises(SystemExit) as failure:
                        handoff.main()
                self.assertEqual(failure.exception.code, 2)
        self.export()
        self.assertEqual(self.files([self.out, self.fresh]), original)
        self.network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
