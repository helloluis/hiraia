"""Offline lossless label mapping, native provenance and three-epoch quarantine."""
import copy
import json
from pathlib import Path
import unittest
from unittest import mock

import gemini_audit3_batch_v4 as R
import test_gemini_audit3_batch_v3 as PREVIOUS_TESTS


class V4Case(PREVIOUS_TESTS.V3Case):
    def setUp(self):
        super().setUp()
        self.oldest = self.ancestor
        self.middle = self.prior
        self.prior = self.out
        directory = R.PREV.submit(self.prior, self.jobs, ['job-7', 'job-8'], network=self.network)
        accepted = R.read(directory / 'accepted.json')
        R.write(directory / 'terminal.json', {**accepted, 'status': 'failed',
            'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
            'usage': None, 'results': None, 'error': {'message': 'Rejected v3 protocol'}}, immutable=True)
        R.PREV.block(self.prior, 'Rejected v3 input; no retry')
        R.write(self.prior / 'process.json', {'status': 'stopped', 'pid': 999997, 'reason': 'Rejected v3'})
        self.history_cost = R.PREV.accounting(self.prior)
        self.out = self.root / 'audit3-v4'; self.out.mkdir()
        R.prepare(self.out, self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.config, self.jobs, self.plan = R.frozen(self.out)
        self.posts = []; self.gets = []

    def terminal(self, directory):
        terminal = super().terminal(directory)
        # Before v4 exists this method is not used in fixture setup; all prior
        # responses are explicit terminal input failures with null results.
        if self.out.name == 'audit3-v4':
            for result in terminal['results']:
                message = result['response']['body']['choices'][0]['message']
                original = json.loads(message['content'])
                count = len(self.jobs[result['custom_id']]['content']['target']['options'])
                message['content'] = json.dumps(R.K.to_wire_diagnosis(original, count), ensure_ascii=False, indent=3)
        return terminal

    def submit_canary(self):
        return R.submit(self.out, self.jobs, ['job-1', 'job-2'], network=self.network)

    def finish_canary(self):
        directory = self.submit_canary()
        R.write(directory / 'terminal.json', self.terminal(directory), immutable=True)
        R.collect_terminal(self.out, directory, self.jobs)
        proof = R.read(self.out / 'canary-passed.json')
        R.write(self.out / 'CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': proof['terminal_sha256'], 'config_sha256': R.sha(self.out / 'config.json')}, immutable=True)
        return directory


class Audit3V4Tests(V4Case):
    def test_payload_only_renames_both_option_schema_occurrences(self):
        job = self.jobs['job-1']; before = R.PREV.payload(job); after = R.payload(job)
        reverted = copy.deepcopy(after)
        reverted['response_format']['json_schema']['schema'] = R.K.from_wire_schema(
            reverted['response_format']['json_schema']['schema'], 3)
        data = R.K.parse_json(reverted['messages'][1]['content'])
        original_data = R.K.parse_json(before['messages'][1]['content'])
        self.assertEqual(data['quiz'], original_data['quiz'])
        self.assertEqual(reverted['messages'][0], before['messages'][0])
        data['response_schema'] = R.K.from_wire_schema(data['response_schema'], 3)
        reverted['messages'][1]['content'] = R.canonical(data)
        self.assertEqual(reverted, before)
        self.assertTrue(after['response_format']['json_schema']['strict'])
        self.assertEqual(after['max_tokens'], 8000)
        self.assertNotIn('answer', data['quiz'])
        for secret in ('SECRET_GENERATOR_NOTE', 'SECRET_AUDIT', 'SECRET_NONENGLISH', 'OLD_TARGET_PRIVATE'):
            self.assertNotIn(secret, R.canonical(after))
        self.assertEqual(self.config['diagnosis_encoding'], R.K.ENCODING)
        self.assertIn(str(Path(R.K.__file__).resolve()), self.config['dependencies_sha256'])
        self.assertIs(R.K.original_auditor.validate, R.A.validate)

    def test_schema_and_diagnosis_roundtrips_preserve_constraints_for_all_option_counts(self):
        for count in range(2, 11):
            job = copy.deepcopy(self.jobs['job-1'])
            job['content']['english']['options'] = [f'Choice {i}' for i in range(count)]
            job['content']['target']['options'] = [f'Pili {i}' for i in range(count)]
            original = R.PREV.payload(job)['response_format']['json_schema']['schema']
            wire = R.K.to_wire_schema(original, count)
            self.assertEqual(R.K.from_wire_schema(wire, count), original)
            fields = ['q', *[f'options[{i}]' for i in range(count)], 'explanation']
            value = {'checks': {name: {'status': 'ok', 'quote': '', 'finding': ''} for name in fields},
                     'correct_index': 0, 'whole_quiz': {'status': 'ok', 'finding': ''}, 'verdict': 'pass'}
            encoded = R.K.to_wire_diagnosis(value, count)
            self.assertEqual(R.K.from_wire_diagnosis(encoded, count), value)
            R.A.e.validate(value, original); R.A.e.validate(encoded, wire)
            for changed in ({**encoded, 'correct_index': count}, {**encoded, 'correct_index': True},
                            {**encoded, 'unexpected': 'x'}, {**encoded, 'verdict': 'wrong'}):
                with self.assertRaises(ValueError):
                    R.A.e.validate(changed, wire)
                with self.assertRaises(ValueError):
                    R.A.e.validate(R.K.from_wire_diagnosis(changed, count), original)

    def test_raw_native_response_and_content_bytes_survive_collection_and_report(self):
        d = self.submit_canary(); terminal = self.terminal(d)
        native = copy.deepcopy(terminal['results'][0]['response']['body'])
        R.write(d / 'terminal.json', terminal)
        R.collect_terminal(self.out, d, self.jobs)
        local = self.out / 'results/job-1'
        raw_bytes = (local / 'response.json').read_bytes()
        self.assertEqual(R.read(local / 'response.json'), native)
        self.assertEqual(R.read(local / 'response.json')['choices'][0]['message']['content'],
                         native['choices'][0]['message']['content'])
        self.assertIn('option_0', native['choices'][0]['message']['content'])
        final = R.verify_result(self.out, 'job-1', self.jobs)
        self.assertIn('options[0]', final['diagnosis']['checks'])
        self.assertNotIn('option_0', final['diagnosis']['checks'])
        decoded = R.read(local / 'decoded-diagnosis.json'); origin = R.read(local / 'batch-origin.json')
        self.assertEqual(decoded['diagnosis'], final['diagnosis'])
        self.assertEqual(origin['canonical_diagnosis_sha256'], R.digest(final['diagnosis']))
        self.assertEqual(origin['response_body_sha256'], R.digest(native))
        self.assertEqual(origin['adapter_sha256'], R.sha(R.K.__file__))
        R.report(self.out, self.jobs); R.collect_terminal(self.out, d, self.jobs)
        self.assertEqual((local / 'response.json').read_bytes(), raw_bytes)
        exported = [json.loads(line) for line in (self.out / 'diagnoses.jsonl').read_text().splitlines()]
        self.assertIn('options[0]', exported[0]['diagnosis']['checks'])

    def test_reports_recompute_provenance_and_refuse_tampered_derived_or_native_files(self):
        self.finish_canary(); R.report(self.out, self.jobs)
        report_before = (self.out / 'diagnoses.jsonl').read_bytes()
        local = self.out / 'results/job-1'
        for name in ('final.json', 'decoded-diagnosis.json', 'batch-origin.json', 'batch-receipt.json', 'response.json'):
            path = local / name; saved = path.read_bytes(); value = R.read(path)
            value['tampered'] = True; R.write(path, value)
            with self.assertRaisesRegex(ValueError, 'artifact changed'):
                R.verify_result(self.out, 'job-1', self.jobs)
            with self.assertRaises(ValueError):
                R.report(self.out, self.jobs)
            self.assertEqual((self.out / 'diagnoses.jsonl').read_bytes(), report_before)
            path.write_bytes(saved)
        self.assertEqual(R.verify_result(self.out, 'job-1', self.jobs)['status'], 'pass')

    def test_released_canary_is_revalidated_before_every_new_post(self):
        self.finish_canary()
        for name in ('final.json', 'decoded-diagnosis.json', 'response.json'):
            path = self.out / 'results/job-1' / name; original = path.read_bytes()
            value = R.read(path); value['tampered'] = True; R.write(path, value)
            with self.assertRaisesRegex(ValueError, 'artifact changed'):
                R.next_keys(self.out, self.jobs, self.plan)
            with self.assertRaisesRegex(ValueError, 'artifact changed'):
                R.submit(self.out, self.jobs, ['job-3'], network=self.network)
            with self.assertRaisesRegex(ValueError, 'artifact changed'):
                R.step(self.out, self.jobs, self.plan, network=self.network)
            self.assertEqual(len(self.posts), 1)
            path.write_bytes(original)
        self.assertTrue(R.canary_ready(self.out))

    def test_cached_batch_verification_rechecks_manifest_and_durable_intent(self):
        d = self.finish_canary(); cache = {}
        R.verify_result(self.out, 'job-1', self.jobs, cache)
        for name, field, value in (('manifest.json', 'reserved_usd', 0),
                                   ('submission-intent.json', 'request_sha256', 'wrong')):
            path = d / name; original = path.read_bytes()
            data = R.read(path); data[field] = value; R.write(path, data)
            with self.assertRaises(ValueError):
                R.verify_result(self.out, 'job-1', self.jobs, cache)
            path.write_bytes(original)
        self.assertEqual(R.verify_result(self.out, 'job-2', self.jobs, cache)['status'], 'pass')

    def test_mixed_labels_duplicate_json_and_nonfinite_values_are_not_repaired(self):
        wire = R.K.parse_json(self.terminal(self.submit_canary())['results'][0]['response']['body']['choices'][0]['message']['content'])
        for mutate in (lambda d: d['checks'].update({'options[0]': d['checks']['option_0']}),
                       lambda d: d['checks'].pop('option_0'),
                       lambda d: d['checks'].update({'option_03': d['checks']['option_0']})):
            changed = copy.deepcopy(wire); mutate(changed)
            with self.assertRaisesRegex(ValueError, 'field names'):
                R.K.from_wire_diagnosis(changed, 3)
        for bad in ('{"a":1,"a":2}', '{"x":NaN}', '{"x":Infinity}'):
            with self.assertRaises(ValueError):
                R.K.parse_json(bad)

    def test_six_prior_attempts_are_quarantined_and_unknown_charges_count_once(self):
        self.assertEqual(self.config['selected'], 12)
        self.assertEqual(self.config['eligible_selected'], 6)
        expected = ['job-' + str(i) for i in range(7, 13)]
        self.assertEqual(self.config['excluded_keys'], expected)
        self.assertEqual(R.check_ledger(self.out, self.jobs), set(expected))
        self.assertEqual(R.next_keys(self.out, self.jobs, self.plan), ['job-1', 'job-2'])
        total = sum(R.read(output / 'batches/000001/manifest.json')['reserved_usd']
                    for output in (self.oldest, self.middle, self.prior))
        self.assertAlmostEqual(R.accounting(self.out)['budget_accounted_usd'], total, places=14)
        self.assertAlmostEqual(R.accounting(self.out)['combined_accounted_usd'], 151.04344425 + total, places=12)
        self.assertEqual(R.accounting(self.out)['received_cost_usd'], 0)
        for key in expected:
            with self.assertRaisesRegex(ValueError, 'attempted'):
                R.submit(self.out, self.jobs, ['job-1', key], network=self.network)
        for output in (self.oldest, self.middle, self.prior):
            with self.assertRaisesRegex(ValueError, 'separate from'):
                R.prepare(output / 'nested-v4', self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.assertEqual(self.posts, [])

    def test_terminal_input_failure_is_failed_not_pending_and_cannot_free_post_capacity(self):
        d = self.submit_canary(); accepted = R.read(d / 'accepted.json')
        terminal = {**accepted, 'status': 'failed', 'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
                    'usage': None, 'results': None, 'error': {'message': 'Rejected input'}}
        R.write(d / 'terminal.json', terminal)
        self.assertEqual(R.active_batches(self.out), [])
        self.assertEqual(R.uncollected_batches(self.out), [d])
        summary = R.report(self.out, self.jobs)
        self.assertEqual(summary['counts']['terminal_failed'], 2)
        self.assertEqual(summary['counts']['cloud_pending'], 0)
        self.assertEqual(summary['outstanding_batches'], 0)
        self.assertEqual(summary['counts']['terminal_awaiting_collection'], 0)
        self.assertGreater(summary['uncertain_charge_reserved_usd'], self.history_cost['budget_accounted_usd'])
        with self.assertRaisesRegex(ValueError, 'Terminal cloud failure'):
            R.submit(self.out, self.jobs, ['job-3'], network=self.network)
        self.assertTrue((self.out / 'BLOCKED.json').exists())
        with self.assertRaisesRegex(ValueError, 'reconcilable billing'):
            R.run(self.out, collect_only=True, once=True, network=self.network)
        self.assertEqual(R.read(self.out / 'process.json')['remote_batches_pending'], 0)
        self.assertEqual(len(self.posts), 1)

    def test_observed_failure_before_terminal_file_is_saved_is_not_active_billing(self):
        d = self.submit_canary(); status = R.read(d / 'accepted.json'); status['status'] = 'failed'
        R.write(d / 'status.json', status)
        self.assertEqual(R.active_batches(self.out), [])
        self.assertEqual(R.accounting(self.out)['active_reserved_usd'], 0)
        self.assertGreater(R.accounting(self.out)['uncertain_charge_reserved_usd'], self.history_cost['budget_accounted_usd'])
        with self.assertRaisesRegex(ValueError, 'Terminal cloud failure'):
            R.next_keys(self.out, self.jobs, self.plan)
        self.assertEqual(len(self.posts), 1)

    def test_completed_unimported_is_not_remote_pending_but_still_collected_before_gate(self):
        d = self.submit_canary(); R.write(d / 'terminal.json', self.terminal(d))
        before = R.report(self.out, self.jobs)
        self.assertEqual(before['counts']['terminal_awaiting_collection'], 2)
        self.assertEqual(before['counts']['cloud_pending'], 0)
        self.assertEqual(before['outstanding_batches'], 0)
        R.run(self.out, once=True, network=self.network)
        self.assertEqual(R.read(self.out / 'report.json')['completed'], 2)
        self.assertFalse(R.canary_ready(self.out))
        self.assertEqual(len(self.posts), 1)
        with self.assertRaisesRegex(ValueError, 'gate is closed'):
            R.submit(self.out, self.jobs, ['job-3'], network=self.network)

    def test_one_terminal_failure_does_not_starve_other_accepted_imports(self):
        self.finish_canary()
        bad = R.submit(self.out, self.jobs, ['job-3'], network=self.network)
        good = R.submit(self.out, self.jobs, ['job-4'], network=self.network)
        failed = {**R.read(bad / 'accepted.json'), 'status': 'failed',
            'request_counts': {'total': 1, 'completed': 0, 'failed': 1},
            'usage': None, 'results': None, 'error': {'message': 'Provider failed'}}
        R.write(bad / 'terminal.json', failed)
        R.write(good / 'terminal.json', self.terminal(good))
        with self.assertRaises(ValueError):
            R.step(self.out, self.jobs, self.plan, network=self.network)
        self.assertTrue((good / 'collected.json').exists())
        self.assertEqual(R.verify_result(self.out, 'job-4', self.jobs)['status'], 'pass')
        self.assertEqual(R.active_batches(self.out), [])
        self.assertEqual(len(self.posts), 3)

    def test_original_answer_and_quote_checks_remain_authoritative_after_decoding(self):
        d = self.submit_canary(); terminal = self.terminal(d)
        first = terminal['results'][0]['response']['body']['choices'][0]['message']
        value = json.loads(first['content']); value['correct_index'] = 1; first['content'] = json.dumps(value)
        second = terminal['results'][1]['response']['body']['choices'][0]['message']
        value = json.loads(second['content']); value['verdict'] = 'fix'
        value['checks']['option_0'] = {'status': 'issue', 'quote': 'OLD_TARGET_PRIVATE', 'finding': 'Mismatch'}
        second['content'] = json.dumps(value)
        R.write(d / 'terminal.json', terminal)
        with self.assertRaisesRegex(ValueError, 'canary failed'):
            R.collect_terminal(self.out, d, self.jobs)
        self.assertEqual(R.verify_result(self.out, 'job-1', self.jobs)['status'], 'needs_review')
        self.assertIsNone(R.verify_result(self.out, 'job-2', self.jobs))
        error = R.read(self.out / 'results/job-2/error.json')
        self.assertIn('Evidence quote absent from options[0]', error['error'])
        self.assertFalse((self.out / 'results/job-2/decoded-diagnosis.json').exists())
        self.assertIn('option_0', R.read(self.out / 'results/job-2/response.json')['choices'][0]['message']['content'])

    def test_ambiguous_post_is_unknown_and_never_blindly_retried(self):
        def ambiguous(*args, **kwargs):
            raise RuntimeError('Connection ended after POST')
        with self.assertRaisesRegex(RuntimeError, 'Connection ended'):
            R.submit(self.out, self.jobs, ['job-1', 'job-2'], network=ambiguous)
        summary = R.report(self.out, self.jobs)
        self.assertEqual(summary['counts']['ambiguous_submission'], 2)
        self.assertEqual(summary['counts']['cloud_pending'], 0)
        self.assertGreater(summary['uncertain_charge_reserved_usd'], self.history_cost['budget_accounted_usd'])
        with self.assertRaisesRegex(ValueError, 'blocked'):
            R.run(self.out, once=True, network=self.network)
        self.assertEqual(self.posts, [])

    def test_cumulative_budget_and_finish_exclude_all_previous_attempts(self):
        with mock.patch.object(R, 'reservation', return_value=(30 - self.history_cost['budget_accounted_usd'] / 2) / 2):
            with self.assertRaises(R.BudgetCapacity):
                self.submit_canary()
        with mock.patch.object(R, 'accounting', return_value={'budget_accounted_usd': 0, 'combined_accounted_usd': 249.999}):
            with self.assertRaises(R.BudgetCapacity):
                R.next_keys(self.out, self.jobs, self.plan)
        self.finish_canary()
        d = R.submit(self.out, self.jobs, ['job-3', 'job-4', 'job-5', 'job-6'], network=self.network)
        R.write(d / 'terminal.json', self.terminal(d))
        result = R.run(self.out, network=self.network)
        self.assertEqual(result['status'], 'finished')
        report = R.read(self.out / 'report.json')
        self.assertEqual(report['completed'], 6)
        self.assertEqual(report['counts']['prior_errors'], 6)
        self.assertEqual(report['counts']['unsubmitted'], 0)
        self.assertEqual(report['request_failure_rate'], .5)
        self.assertEqual(len(self.posts), 2)

    def test_public_submission_maximum_and_adapter_freeze_are_enforced(self):
        with self.assertRaisesRegex(ValueError, '500-request maximum'):
            R.submit(self.out, self.jobs, ['job-1'] * 501, network=self.network)
        deps = R.dependency_hashes(); deps.pop(str(Path(R.K.__file__).resolve()))
        with mock.patch.object(R, 'dependency_hashes', return_value=deps):
            with self.assertRaisesRegex(ValueError, 'Frozen code'):
                R.frozen(self.out)
        self.assertEqual(self.posts, [])


if __name__ == '__main__':
    unittest.main()
