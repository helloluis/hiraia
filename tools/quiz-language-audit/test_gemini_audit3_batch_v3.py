"""Offline strict-wire completion and complete v1/v2 attempt quarantine."""
import copy
import json
from pathlib import Path
import unittest
from unittest import mock

import gemini_audit3_batch_v3 as R
import test_gemini_audit3_batch_v2 as PREVIOUS_TESTS


class V3Case(PREVIOUS_TESTS.V2Case):
    def setUp(self):
        super().setUp()
        self.ancestor = self.prior
        self.prior = self.out
        directory = R.PREV.submit(self.prior, self.jobs, ['job-9', 'job-10'], network=self.network)
        accepted = R.read(directory / 'accepted.json')
        R.write(directory / 'terminal.json', {**accepted, 'status': 'failed',
            'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
            'usage': None, 'results': None,
            'error': {'message': 'The provider rejected the batch input file.'}}, immutable=True)
        R.PREV.block(self.prior, 'Rejected v2 protocol; no retry of attempted IDs')
        R.write(self.prior / 'process.json', {'status': 'stopped', 'pid': 999998,
            'reason': 'Rejected v2 protocol'})
        self.chain_cost = R.PREV.accounting(self.prior)
        self.out = self.root / 'audit3-v3'; self.out.mkdir()
        R.prepare(self.out, self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.config, self.jobs, self.plan = R.frozen(self.out)
        self.posts = []; self.gets = []

    def network(self, url, data=None, timeout=None):
        if data is not None:
            request = json.loads(data); self.posts.append(request)
            return 202, {'id': f'{self.out.name}-batch-{len(self.posts)}', 'model': R.C.CANONICAL_MODEL,
                'endpoint': '/v1/chat/completions', 'status': 'validating',
                'request_counts': {'total': len(request['requests']), 'completed': 0, 'failed': 0}}
        return super().network(url, data=data, timeout=timeout)

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


class Audit3V3Tests(V3Case):
    def test_only_strict_true_is_added_to_v2_payload_and_original_messages_remain_exact(self):
        job = self.jobs['job-1']; before = R.PREV.payload(job); after = R.payload(job)
        self.assertNotIn('strict', before['response_format']['json_schema'])
        expected = copy.deepcopy(before); expected['response_format']['json_schema']['strict'] = True
        self.assertEqual(after, expected)
        self.assertIs(after['response_format']['json_schema']['strict'], True)
        self.assertEqual(after['messages'], R.PREV.V1.payload(job)['messages'])
        self.assertEqual(after['response_format']['json_schema']['schema'], before['response_format']['json_schema']['schema'])
        self.assertIs(R.A.validate, R.PREV.V1.A.validate)
        self.assertEqual(R.PREV.payload(job), before)
        self.assertEqual(self.config['prompt_sha256'], R.read(self.ancestor / 'config.json')['prompt_sha256'])
        for secret in ('SECRET_GENERATOR_NOTE', 'SECRET_AUDIT', 'SECRET_NONENGLISH', 'OLD_TARGET_PRIVATE'):
            self.assertNotIn(secret, R.canonical(after))
        self.assertNotIn('answer', json.loads(after['messages'][1]['content'])['quiz'])

    def test_entire_four_attempt_history_is_frozen_and_excluded_without_changing_scope(self):
        excluded = ['job-9', 'job-10', 'job-11', 'job-12']
        self.assertEqual(self.config['version'], 3)
        self.assertEqual(self.config['schema_encoding'], 'explicit_enum_string_type_strict_v3')
        self.assertEqual(self.config['selected'], 12)
        self.assertEqual(self.config['eligible_selected'], 8)
        self.assertEqual(self.config['excluded_keys'], excluded)
        self.assertEqual(R.check_ledger(self.out, self.jobs), set(excluded))
        self.assertEqual(R.next_keys(self.out, self.jobs, self.plan), ['job-1', 'job-2'])
        self.assertEqual([entry['key'] for entry in self.plan], ['job-' + str(i) for i in range(1, 9)])
        prior = R.verify_predecessor(self.out)
        self.assertEqual(prior['technical_errors'], 4)
        self.assertEqual(prior['unresolved_requests'], 4)
        self.assertEqual(prior['by_language'], {'tl': 2, 'bis': 2})
        for output in (self.prior, self.ancestor):
            for relative in ('config.json', 'process.json', 'BLOCKED.json', 'plan.json',
                             'batches/000001/manifest.json', 'batches/000001/request.json',
                             'batches/000001/accepted.json', 'batches/000001/terminal.json'):
                self.assertIn(str((output / relative).resolve()), prior['files_sha256'])
        self.assertIn(str((self.prior / 'predecessor.json').resolve()), prior['files_sha256'])
        for module in (R.PREV, R.PREV.V1):
            self.assertIn(str(Path(module.__file__).resolve()), self.config['dependencies_sha256'])
        for key in excluded:
            with self.assertRaisesRegex(ValueError, 'attempted'):
                R.submit(self.out, self.jobs, ['job-1', key], network=self.network)
        self.assertEqual(self.posts, [])

    def test_new_output_cannot_write_inside_any_frozen_ancestor(self):
        destination = self.ancestor / 'nested-v3'
        with self.assertRaisesRegex(ValueError, 'separate from all ancestor'):
            R.prepare(destination, self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.assertFalse(destination.exists())

    def test_both_prior_unknown_reservations_count_exactly_once_before_and_after_settlement(self):
        v1_unknown = R.PREV.V1.accounting(self.ancestor)['uncertain_charge_reserved_usd']
        v2_reservation = R.read(self.prior / 'batches/000001/manifest.json')['reserved_usd']
        expected_prior = v1_unknown + v2_reservation
        self.assertEqual(self.chain_cost['uncertain_charge_reserved_usd'], expected_prior)
        cost = R.accounting(self.out)
        self.assertEqual(cost['budget_accounted_usd'], expected_prior)
        self.assertEqual(cost['predecessor_accounting']['budget_accounted_usd'], expected_prior)
        self.assertEqual(cost['current_accounting']['budget_accounted_usd'], 0)
        self.assertEqual(cost['received_cost_usd'], 0)
        self.assertEqual(cost['combined_accounted_usd'], 151.04344425 + expected_prior)
        d = self.submit_canary(); pending = R.accounting(self.out)
        self.assertEqual(pending['active_reserved_usd'], R.read(d / 'manifest.json')['reserved_usd'])
        self.assertEqual(pending['uncertain_charge_reserved_usd'], expected_prior)
        R.write(d / 'terminal.json', self.terminal(d)); R.collect_terminal(self.out, d, self.jobs)
        settled = R.accounting(self.out); charge = self.terminal(d)['usage']['cost']
        self.assertEqual(settled['received_cost_usd'], charge)
        self.assertEqual(settled['uncertain_charge_reserved_usd'], expected_prior)
        self.assertEqual(settled['budget_accounted_usd'], charge + expected_prior)
        self.assertEqual(settled['combined_accounted_usd'], 151.04344425 + charge + expected_prior)
        R.collect_terminal(self.out, d, self.jobs)
        self.assertEqual(R.accounting(self.out), settled)

    def test_any_frozen_ancestor_change_or_new_attempt_prevents_admission(self):
        for output in (self.ancestor, self.prior):
            path = output / 'batches/000001/terminal.json'; original = path.read_bytes()
            path.write_bytes(original + b' ')
            with self.assertRaisesRegex(ValueError, 'predecessor artifact changed'):
                R.submit(self.out, self.jobs, ['job-1', 'job-2'], network=self.network)
            path.write_bytes(original)
        path = self.ancestor / 'batches/000002/submission-intent.json'
        R.write(path, {'request_sha256': 'new-unknown-attempt'})
        with self.assertRaisesRegex(ValueError, 'new batches'):
            self.submit_canary()
        self.assertEqual(self.posts, [])

    def test_chain_process_and_billing_changes_fail_closed_without_zero_guess(self):
        path = self.ancestor / 'process.json'; original = path.read_bytes()
        R.write(path, {'status': 'running', 'pid': 999999})
        with self.assertRaisesRegex(ValueError, 'predecessor artifact changed'):
            R.frozen(self.out)
        path.write_bytes(original)
        R.write(self.ancestor / 'batches/000001/billing.json', {'received_cost_usd': 0})
        with self.assertRaisesRegex(ValueError, 'billing changed'):
            R.accounting(self.out)
        self.assertEqual(self.posts, [])

    def test_first_canary_stops_at_gate_and_current_attempt_never_retries(self):
        d = self.submit_canary()
        with self.assertRaisesRegex(ValueError, 'gate is closed'):
            R.submit(self.out, self.jobs, ['job-3'], network=self.network)
        with mock.patch.object(R.time, 'time', return_value=R.read(d / 'poll.json')['accepted_at'] + 30):
            R.run(self.out, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1); self.assertEqual(self.gets, [])
        R.write(d / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        R.run(self.out, collect_only=True, once=True, network=self.network)
        self.assertFalse(R.canary_ready(self.out))
        R.run(self.out, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1)
        with self.assertRaisesRegex(ValueError, 'attempted'):
            self.submit_canary()
        with R.exclusive_lock(self.out):
            with self.assertRaises(BlockingIOError):
                with R.exclusive_lock(self.out):
                    self.fail('duplicate acquired lock')

    def test_rejected_v3_canary_remains_unknown_and_blocks_further_posts(self):
        d = self.submit_canary(); accepted = R.read(d / 'accepted.json')
        terminal = {**accepted, 'status': 'failed', 'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
                    'usage': None, 'results': None, 'error': {'message': 'Rejected input'}}
        R.write(d / 'terminal.json', terminal)
        with self.assertRaisesRegex(ValueError, 'reconcilable billing'):
            R.run(self.out, once=True, network=self.network)
        self.assertTrue((self.out / 'BLOCKED.json').exists())
        self.assertFalse((self.out / 'canary-passed.json').exists())
        current_reserve = R.read(d / 'manifest.json')['reserved_usd']
        cost = R.accounting(self.out)
        self.assertEqual(cost['received_cost_usd'], 0)
        self.assertEqual(cost['uncertain_charge_reserved_usd'], self.chain_cost['budget_accounted_usd'] + current_reserve)
        with self.assertRaisesRegex(ValueError, 'blocked'):
            R.run(self.out, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1)

    def test_cumulative_budget_window_guards_and_completion_denominators(self):
        # Four quarantined charges reduce current admission room in both caps.
        reservation = (R.BUDGET - self.chain_cost['budget_accounted_usd'] / 2) / 2
        with mock.patch.object(R, 'reservation', return_value=reservation):
            with self.assertRaises(R.BudgetCapacity):
                self.submit_canary()
        with mock.patch.object(R, 'accounting', return_value={'budget_accounted_usd': 0, 'combined_accounted_usd': 249.999}):
            with self.assertRaises(R.BudgetCapacity):
                R.next_keys(self.out, self.jobs, self.plan)
        self.finish_canary()
        for n in range(3, 7):
            R.submit(self.out, self.jobs, ['job-' + str(n)], network=self.network)
        with self.assertRaisesRegex(ValueError, 'window is full'):
            R.submit(self.out, self.jobs, ['job-7'], network=self.network)
        for directory in R.active_batches(self.out):
            R.write(directory / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        R.run(self.out, collect_only=True, once=True, network=self.network)
        d = R.submit(self.out, self.jobs, ['job-7', 'job-8'], network=self.network)
        R.write(d / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        process = R.run(self.out, network=self.network)
        self.assertEqual(process['status'], 'finished')
        summary = R.read(self.out / 'report.json')
        self.assertEqual(summary['selected'], 12)
        self.assertEqual(summary['completed'], 8)
        self.assertEqual(summary['prior_failed_requests'], 4)
        self.assertEqual(summary['prior_unresolved_requests'], 4)
        self.assertEqual(summary['counts']['unsubmitted'], 0)
        self.assertEqual(summary['counts']['cloud_pending'], 0)
        self.assertEqual(summary['request_failure_rate'], 4 / 12)
        self.assertEqual(summary['current_request_failure_rate'], 0)


if __name__ == '__main__':
    unittest.main()
