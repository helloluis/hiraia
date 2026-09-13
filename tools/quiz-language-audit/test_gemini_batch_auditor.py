"""Offline checks for batch identity, accounting and submission safety."""
import copy
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import gemini_batch_auditor as batch


def job(key='batch-card'):
    return {
        'key': key, 'refs': [],
        'content': {
            'language': 'tl', 'answer': 0,
            'target': {'q': 'Alin?', 'options': ['Isa', 'Dalawa', 'Tatlo'],
                       'explanation': 'Isa ang sagot.'},
        },
    }


def response(key='batch-card'):
    diagnosis = {
        'checks': {field: {'status': 'ok', 'quote': '', 'finding': ''}
                   for field in ('q', 'options[0]', 'options[1]', 'options[2]', 'explanation')},
        'whole_quiz': {'status': 'ok', 'finding': ''},
        'correct_index': 0, 'verdict': 'pass',
    }
    return {
        'id': 'batch-unit', 'status': 'completed', 'model': batch.audit.MODEL,
        'request_counts': {'total': 1, 'completed': 1, 'failed': 0},
        'usage': {'cost': .125, 'is_byok': False, 'prompt_tokens': 1000,
                  'completion_tokens': 100, 'total_tokens': 1100},
        'results': [{
            'custom_id': key, 'error': None,
            'response': {'status_code': 200, 'body': {
                'model': batch.audit.MODEL,
                'choices': [{'finish_reason': 'stop',
                             'message': {'content': json.dumps(diagnosis)}}],
            }},
        }],
    }


class BatchSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.out = Path(self.temporary.name)
        (self.out / 'jobs.jsonl').write_text(json.dumps(job()) + '\n')

    def test_batch_level_usage_suffices_and_repeated_import_is_stable(self):
        raw = response()
        self.assertNotIn('usage', raw['results'][0]['response']['body'])
        self.assertEqual(batch.import_results(self.out, raw), {'pass': 1})
        original = batch.read(self.out / 'results/batch-card/final.json')
        self.assertEqual(batch.import_results(self.out, raw), {'pass': 1})
        self.assertEqual(batch.read(self.out / 'results/batch-card/final.json'), original)
        self.assertFalse((self.out / 'results/batch-card/error.json').exists())

    def test_verified_canonical_model_is_accepted_but_other_models_are_rejected(self):
        raw = response()
        raw['model'] = batch.RESOLVED_MODEL
        self.assertEqual(batch.import_results(self.out, raw), {'pass': 1})
        raw['model'] = 'google/unapproved-model'
        with self.assertRaisesRegex(RuntimeError, 'model mismatch'):
            batch.validate_results(raw, {'batch-card': job()})

    def test_duplicate_result_ids_rejected_before_import(self):
        raw = response()
        raw['results'].append(copy.deepcopy(raw['results'][0]))
        with self.assertRaisesRegex(RuntimeError, 'duplicate'):
            batch.import_results(self.out, raw)
        self.assertFalse((self.out / 'results').exists())

    def test_unknown_result_id_rejected_before_import(self):
        with self.assertRaisesRegex(RuntimeError, 'unknown'):
            batch.import_results(self.out, response('not-in-batch'))
        self.assertFalse((self.out / 'results').exists())

    def test_missing_result_rejected_before_import(self):
        raw = response()
        raw['results'] = []
        with self.assertRaisesRegex(RuntimeError, 'Missing'):
            batch.import_results(self.out, raw)
        self.assertFalse((self.out / 'results').exists())

    def test_repeated_import_refuses_changed_provider_result(self):
        raw = response()
        batch.import_results(self.out, raw)
        changed = copy.deepcopy(raw)
        changed['results'][0]['response']['body']['choices'][0]['finish_reason'] = 'length'
        with self.assertRaisesRegex(RuntimeError, 'changed'):
            batch.import_results(self.out, changed)
        self.assertEqual(batch.read(self.out / 'results/batch-card/batch-result.json'), raw['results'][0])

    def test_original_semantic_validator_quarantines_contradictory_pass(self):
        raw = response()
        message = raw['results'][0]['response']['body']['choices'][0]['message']
        diagnosis = json.loads(message['content'])
        diagnosis['checks']['q'] = {'status': 'issue', 'quote': 'Alin?', 'finding': 'Wrong question.'}
        message['content'] = json.dumps(diagnosis)
        self.assertEqual(batch.import_results(self.out, raw), {'errors': 1})
        self.assertFalse((self.out / 'results/batch-card/final.json').exists())
        error = batch.read(self.out / 'results/batch-card/error.json')
        self.assertIn('Contradictory pass', error['error'])
        self.assertFalse(error['automatic_retry'])

    def test_provider_error_is_held_without_diagnosis(self):
        raw = response()
        raw['request_counts'].update(completed=0, failed=1)
        raw['results'][0].update(response=None, error={'code': 'provider_error'})
        self.assertEqual(batch.import_results(self.out, raw), {'errors': 1})
        self.assertFalse((self.out / 'results/batch-card/final.json').exists())

    def test_aggregate_batch_charge_is_counted_once_without_standard_rate_estimate(self):
        raw = response()
        batch.import_results(self.out, raw)
        source = self.out / 'source'
        source.mkdir()
        original = job('already-completed')
        snapshot = self.out / 'source-jobs.jsonl'
        snapshot.write_text(json.dumps(original) + '\n' + json.dumps(job()) + '\n')
        oldfinal = source / 'results' / original['key'] / 'final.json'
        oldfinal.parent.mkdir(parents=True)
        batch.write(oldfinal, batch.read(self.out / 'results/batch-card/final.json'))
        batch.write(self.out / 'manifest.json', {
            'source_run': str(source), 'source_jobs': str(snapshot), 'selected_jobs': 1,
            'expected_batch_cost_usd': .2,
            'source_report': {'total': 2, 'counts': {'pass': 1, 'errors_or_unresolved': 0},
                              'received_cost_usd': 3.0, 'uncertain_charge_reserved_usd': .4},
        })
        batch.write(self.out / 'status.json', batch.metadata(raw))
        with mock.patch.object(batch.audit, 'cost', side_effect=AssertionError('Never use sync rate')):
            report = batch.report(self.out)
        self.assertEqual(report['batch_received_cost_usd'], .125)
        self.assertEqual(report['received_cost_usd'], 3.125)
        self.assertEqual(report['prior_uncertain_charge_reserved_usd'], .4)
        self.assertEqual(report['completed'], 2)
        self.assertEqual(report['pending_batch_validation'], 0)
        self.assertEqual(len((self.out / 'diagnoses.jsonl').read_text().splitlines()), 2)

    def test_ambiguous_submission_records_durable_intent_and_blocks_second_post(self):
        manifest = {'request_sha256': 'test-sha', 'expected_batch_cost_usd': .1}
        batch.write(self.out / 'authorization.json', {
            'one_batch_authorized': True, 'request_sha256': 'test-sha',
        })
        calls = []

        def network(url, data=None, timeout=120):
            calls.append((url, data))
            if data is None:
                return 200, {'data': {'total_credits': 100, 'total_usage': 1}}
            intent = batch.read(self.out / 'submission-intent.json')
            self.assertEqual(intent['status'], 'attempting_once')
            raise RuntimeError('Connection timed out after submission')

        def preflight(_):
            return manifest, {'batch-card': job()}, b'frozen-request', io.StringIO()

        with mock.patch.object(batch, 'preflight', side_effect=preflight), \
                mock.patch.object(batch, 'network', side_effect=network):
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                batch.submit(self.out)
            with self.assertRaisesRegex(RuntimeError, 'already attempted'):
                batch.submit(self.out)
        self.assertEqual(sum(data is not None for _, data in calls), 1)
        self.assertFalse(batch.read(self.out / 'submission-error.json')['automatic_retry'])
        self.assertFalse((self.out / 'submission.json').exists())

    def partition_fixture(self):
        selected = [job('card-one'), job('card-two')]
        for selected_job in selected:
            selected_job['content']['english'] = copy.deepcopy(selected_job['content']['target'])
            selected_job['content']['grades'] = [3]
        source = self.out / 'source'
        source.mkdir()
        (source / 'run.lock').touch()
        batch.write(source / 'process.json', {'status': 'stopped'})
        baseline = {
            'total': 2, 'completed': 0, 'counts': {'errors_or_unresolved': 0}, 'pending': 2,
            'received_cost_usd': 3.0, 'uncertain_charge_reserved_usd': .4,
        }
        batch.write(source / 'report.json', baseline)
        snapshot = self.out / 'source-jobs.jsonl'
        snapshot.write_text(''.join(json.dumps(j) + '\n' for j in selected))
        parent_request = {'endpoint': '/v1/chat/completions', 'model': batch.audit.MODEL,
                          'requests': [{'custom_id': j['key'], 'body': batch.audit.payload(j['content'])}
                                       for j in selected]}
        batch.write(self.out / 'request.json', parent_request)
        manifest = {
            'source_run': str(source), 'source_jobs': str(snapshot), 'source_report': baseline,
            'source_jobs_sha256': hashlib.sha256(snapshot.read_bytes()).hexdigest(),
            'request_sha256': hashlib.sha256((self.out / 'request.json').read_bytes()).hexdigest(),
            'response_format_sha256': batch.audit.e.a.digest(parent_request['requests'][0]['body']['response_format']),
            'selected_jobs': 2, 'expected_batch_cost_usd': .3,
        }
        batch.write(self.out / 'manifest.json', manifest)
        (self.out / 'jobs.jsonl').write_text(snapshot.read_text())
        parts = []
        for index, selected_job in enumerate(selected, 1):
            directory = self.out / 'parts' / str(index)
            directory.mkdir(parents=True)
            (directory / 'jobs.jsonl').write_text(json.dumps(selected_job) + '\n')
            payload = {**parent_request, 'requests': [parent_request['requests'][index - 1]]}
            batch.write(directory / 'request.json', payload)
            part_manifest = {**manifest, 'parent_out': str(self.out), 'selected_jobs': 1,
                             'request_sha256': hashlib.sha256((directory / 'request.json').read_bytes()).hexdigest()}
            batch.write(directory / 'manifest.json', part_manifest)
            parts.append({'path': str(directory.relative_to(self.out)), 'keys': [selected_job['key']],
                          'request_sha256': part_manifest['request_sha256']})
        batch.write(self.out / 'parts.json', {'parts': parts})
        return parts

    def test_disjoint_partition_preflight_covers_exact_parent_selection(self):
        parts = self.partition_fixture()
        validated = []
        for part in parts:
            _, jobs, _, lock = batch.preflight(self.out / part['path'])
            lock.close()
            validated.extend(jobs)
        self.assertCountEqual(validated, ['card-one', 'card-two'])

    def test_partition_overlap_is_rejected(self):
        parts = self.partition_fixture()
        parts[1]['keys'] = ['card-one']
        batch.write(self.out / 'parts.json', {'parts': parts})
        with self.assertRaisesRegex(RuntimeError, 'Partitions overlap'):
            batch.preflight(self.out / parts[0]['path'])

    def test_partition_gap_is_rejected(self):
        parts = self.partition_fixture()
        batch.write(self.out / 'parts.json', {'parts': parts[:1]})
        with self.assertRaisesRegex(RuntimeError, 'fail to cover'):
            batch.preflight(self.out / parts[0]['path'])

    def test_partition_parent_tamper_is_rejected(self):
        parts = self.partition_fixture()
        (self.out / 'request.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError, 'parent request changed'):
            batch.preflight(self.out / parts[0]['path'])

    def test_partition_costs_sum_once_and_pending_charge_remains_explicit(self):
        parts = self.partition_fixture()
        first = self.out / parts[0]['path']
        second = self.out / parts[1]['path']
        raw = response('card-one')
        batch.import_results(first, raw)
        batch.write(first / 'status.json', batch.metadata(raw))
        batch.write(second / 'status.json', {
            'id': 'batch-unit-two', 'status': 'in_progress', 'usage': None,
            'request_counts': {'total': 1, 'completed': 0, 'failed': 0},
        })
        partial = batch.report(self.out)
        self.assertEqual(partial['received_cost_usd'], 3.125)
        self.assertTrue(partial['batch_charge_unreported'])
        self.assertEqual(partial['pending_batch_validation'], 1)
        self.assertEqual(partial['status'], 'in_progress')
        raw_two = response('card-two')
        raw_two['id'] = 'batch-unit-two'
        raw_two['usage']['cost'] = .25
        batch.import_results(second, raw_two)
        batch.write(second / 'status.json', batch.metadata(raw_two))
        complete = batch.report(self.out)
        self.assertEqual(complete['received_cost_usd'], 3.375)
        self.assertEqual(complete['batch_received_cost_usd'], .375)
        self.assertFalse(complete['batch_charge_unreported'])
        self.assertEqual(complete['completed'], 2)
        self.assertEqual(complete['pending_batch_validation'], 0)
        self.assertEqual(complete['status'], 'completed')
        self.assertEqual(len((self.out / 'diagnoses.jsonl').read_text().splitlines()), 2)


if __name__ == '__main__':
    unittest.main()
