"""Offline monitor checks: no network, no pipeline writes, honest unknown states."""
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest import mock
import unittest

import audit3_status as S
import gemini_audit3_batch as G
from test_gemini_audit3_batch import OfflineCase


class MonitorTests(OfflineCase):
    def ps(self, *args, **kwargs):
        return SimpleNamespace(returncode=0, stdout='S ' + G.shlex.join([sys.executable, '-B',
            str(Path(G.__file__).resolve()), 'run', '--out', str(self.out)]), stderr='')

    def process(self):
        G.write(self.out / 'process.json', {'pid': 12345, 'status': 'running',
            'exact_command': G.shlex.join([sys.executable, '-B', str(Path(G.__file__).resolve()),
                                        'run', '--out', str(self.out)])})

    def test_empty_run_is_unsubmitted_and_does_not_invent_rates(self):
        value = S.inspect(self.out)
        self.assertEqual(value['completed'], 0)
        self.assertEqual(value['counts']['local_unsubmitted'], 12)
        self.assertIsNone(value['all_valid_flag_rate']); self.assertIsNone(value['eta'])
        self.assertEqual(value['process']['state'], 'not_started')
        self.assertEqual(value['cost']['received_cost_usd'], 0)
        self.assertIn('0 diagnoses', S.markdown(value))

    def test_live_queued_and_provider_counts_are_separate_from_results(self):
        d = self.submit_canary(); self.process()
        G.write(d / 'poll.json', {'accepted_at': 1, 'next_poll_at': 61, 'last_attempt_at': 1})
        before = {str(p): p.read_bytes() for p in self.out.rglob('*') if p.is_file()}
        value = S.inspect(self.out, self.ps)
        after = {str(p): p.read_bytes() for p in self.out.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.assertTrue(value['process']['running'])
        self.assertEqual(value['counts']['cloud_queued'], 2)
        self.assertEqual(value['provider_request_counts']['total'], 2)
        self.assertEqual(value['provider_request_counts']['completed'], 0)
        self.assertTrue(any('overdue' in w for w in value['warnings']))
        self.assertEqual(value['counts']['errors'], 0)

    def test_terminal_awaiting_import_failed_and_ambiguous_are_distinct(self):
        d = self.submit_canary(); raw = self.terminal(d)
        G.write(d / 'status.json', raw); G.write(d / 'terminal.json', raw)
        value = S.inspect(self.out)
        self.assertEqual(value['counts']['awaiting_import'], 2)
        self.assertEqual(value['provider_request_counts']['completed'], 2)
        self.assertEqual(value['completed'], 0)
        raw.update(status='failed', error={'message': 'Provider batch failed'})
        G.write(d / 'status.json', raw); G.write(d / 'terminal.json', raw)
        self.assertEqual(S.inspect(self.out)['counts']['terminal_failed'], 2)
        (d / 'accepted.json').unlink()
        value = S.inspect(self.out)
        self.assertEqual(value['counts']['unknown_submission'], 2)
        self.assertGreater(value['cost']['uncertain_charge_reserved_usd'], 0)
        self.assertIsNone(S.age(10, 11))

    def test_failed_input_validation_retains_unknown_bill_and_counts_provider_errors(self):
        d = self.submit_canary()
        failed = {**G.read(d / 'accepted.json'), 'status': 'failed',
            'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
            'usage': None, 'results': None, 'error': {'message': 'Input file validation failed'}}
        G.write(d / 'status.json', failed); G.write(d / 'terminal.json', failed)
        value = S.inspect(self.out)
        self.assertEqual(value['counts']['terminal_failed'], 2)
        self.assertEqual(value['counts']['cloud_inflight'], 0)
        self.assertEqual(value['observed_request_failures'], 2)
        self.assertEqual(value['request_failure_rate'], 1)
        self.assertEqual(value['cost']['received_cost_usd'], 0)
        self.assertEqual(value['cost']['active_reserved_usd'], 0)
        self.assertGreater(value['cost']['uncertain_charge_reserved_usd'], 0)
        self.assertIn('provider failures awaiting import/billing reconciliation', S.markdown(value))

    def test_received_bill_is_revalidated_and_failure_is_not_zero_cost(self):
        d = self.finish_canary()
        value = S.inspect(self.out)
        self.assertEqual(value['completed'], 2)
        self.assertEqual(value['batches_collected'], 1)
        self.assertAlmostEqual(value['cost']['received_cost_usd'], .00015)
        bill = G.read(d / 'billing.json'); bill['received_cost_usd'] = 0
        G.write(d / 'billing.json', bill)
        value = S.inspect(self.out)
        self.assertFalse(value['cost']['verified'])
        self.assertIsNone(value['cost']['received_cost_usd'])
        self.assertTrue(any('Billing validation failed' in w for w in value['warnings']))

    def test_ps_requires_same_script_and_arguments_and_rejects_reused_pid(self):
        self.process(); process = G.read(self.out / 'process.json')
        self.assertTrue(S.process_state(process, self.ps)['running'])
        other = lambda *a, **k: SimpleNamespace(returncode=0, stdout='S /usr/bin/python3 another.py', stderr='')
        self.assertFalse(S.process_state(process, other)['running'])
        absent = lambda *a, **k: SimpleNamespace(returncode=1, stdout='', stderr='')
        self.assertEqual(S.process_state(process, absent)['state'], 'stopped')
        unavailable = lambda *a, **k: SimpleNamespace(returncode=1, stdout='', stderr='permission denied')
        # A permissions error must not be interpreted as a dead process.
        self.assertEqual(S.process_state(process, unavailable)['state'], 'unverified')

    def test_macos_framework_wrapper_and_app_match_without_relaxing_arguments(self):
        root = '/opt/homebrew/Frameworks/Python.framework/Versions/3.14'
        expected = [root + '/bin/python3.14', '-B', '/repo/audit3.py', 'run', '--out', '/run']
        actual = [root + '/Resources/Python.app/Contents/MacOS/Python', '-B', '/repo/audit3.py', 'run', '--out', '/run']
        process = {'pid': 5, 'exact_command': G.shlex.join(expected)}
        fake = lambda *a, **k: SimpleNamespace(returncode=0, stdout='S ' + G.shlex.join(actual), stderr='')
        self.assertTrue(S.process_state(process, fake)['running'])
        actual[-1] = '/other-run'
        self.assertFalse(S.process_state(process, fake)['running'])

    def test_interpreter_flags_and_saved_launch_arguments_are_exact(self):
        self.process()
        process = G.read(self.out / 'process.json')
        recorded = G.shlex.split(process['exact_command'])
        without_flag = [arg for arg in recorded if arg != '-B']
        fake = lambda *a, **k: SimpleNamespace(returncode=0, stdout='S ' + G.shlex.join(without_flag), stderr='')
        self.assertFalse(S.process_state(process, fake)['running'])
        G.write(self.out / 'run-argv.json', recorded)
        self.assertTrue(S.inspect(self.out, self.ps)['process']['launch_command_matches'])
        recorded[-1] = '/different-output'
        G.write(self.out / 'run-argv.json', recorded)
        value = S.inspect(self.out, self.ps)
        self.assertFalse(value['process']['launch_command_matches'])
        self.assertTrue(any('saved run-argv' in w for w in value['warnings']))

    def test_v2_excludes_prior_failed_jobs_without_hiding_the_original_scope(self):
        d = self.submit_canary()
        failed = {**G.read(d / 'accepted.json'), 'status': 'failed',
            'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
            'usage': None, 'results': None, 'error': {'message': 'Input validation failed'}}
        G.write(d / 'status.json', failed); G.write(d / 'terminal.json', failed)
        newrun = self.root / 'audit3-v2'; newrun.mkdir()
        config = {**G.read(self.out / 'config.json'), 'version': 2,
            'schema_encoding': 'explicit_enum_string_type_v2', 'eligible_selected': 10,
            'excluded_keys': ['job-1', 'job-2'], 'predecessor_out': str(self.out)}
        G.write(newrun / 'predecessor.json', {'out': str(self.out), 'attempted_keys': ['job-1', 'job-2']})
        config['predecessor_sha256'] = G.sha(newrun / 'predecessor.json')
        G.write(newrun / 'config.json', config)
        (newrun / 'plan.json').write_bytes((self.out / 'plan.json').read_bytes())
        previous_cost = G.accounting(self.out)
        fake_runner = SimpleNamespace(accounting=lambda out: previous_cost, failure_state=G.failure_state)
        with mock.patch.object(S, 'runner_module', return_value=fake_runner):
            value = S.inspect(newrun)
        self.assertEqual(value['selected'], 12)
        self.assertEqual(value['eligible_selected'], 10)
        self.assertEqual(value['counts']['local_unsubmitted'], 10)
        self.assertEqual(value['counts']['prior_failed_requests'], 2)
        self.assertEqual(sum(value['counts'].values()), 12)
        self.assertEqual(value['observed_request_failures'], 0)
        self.assertEqual(value['historical_failed_requests'], 2)
        self.assertEqual(value['cost']['uncertain_charge_reserved_usd'], previous_cost['uncertain_charge_reserved_usd'])

    def test_real_v2_accounting_adapter_preserves_prior_unknown_charge_once(self):
        import gemini_audit3_batch_v2 as V2
        d = self.submit_canary()
        failed = {**G.read(d / 'accepted.json'), 'status': 'failed',
            'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
            'usage': None, 'results': None, 'error': {'message': 'Input validation failed'}}
        G.write(d / 'status.json', failed); G.write(d / 'terminal.json', failed)
        G.block(self.out, 'Failed provider input validation')
        G.write(self.out / 'process.json', {'pid': 12345, 'status': 'stopped',
            'reason': 'Failed provider input validation'})
        newrun = self.root / 'audit3-v2'; newrun.mkdir()
        V2.prepare(newrun, self.jobsfile, self.manifest, 151.04344425, self.out)
        value = S.inspect(newrun)
        previous = G.accounting(self.out)
        self.assertEqual(value['runner_version'], 2)
        self.assertTrue(value['cost']['verified'])
        self.assertEqual(value['counts']['prior_failed_requests'], 2)
        self.assertEqual(value['counts']['local_unsubmitted'], 10)
        self.assertEqual(value['cost']['predecessor_accounting']['uncertain_charge_reserved_usd'], previous['uncertain_charge_reserved_usd'])
        self.assertEqual(value['cost']['current_accounting']['budget_accounted_usd'], 0)
        self.assertEqual(value['cost']['combined_accounted_usd'], previous['combined_accounted_usd'])
        self.assertEqual(value['cost']['uncertain_charge_reserved_usd'], previous['uncertain_charge_reserved_usd'])

    def test_output_is_disjoint_and_does_not_change_frozen_dependency_hashes(self):
        value = S.inspect(self.out); baseline = G.dependency_hashes()
        for bad in (self.out, self.out / 'monitor', self.root):
            with self.assertRaises(ValueError):
                S.write_snapshots(self.out, bad, value)
        destination = self.root / 'monitor'
        S.write_snapshots(self.out, destination, value)
        self.assertTrue((destination / 'latest.json').exists())
        self.assertTrue((destination / 'latest.md').exists())
        self.assertEqual(G.dependency_hashes(), baseline)
        self.assertEqual(G.sha(self.manifest), self.config['integration_manifest_sha256'])


from test_gemini_audit3_batch_v3 import V3Case
import gemini_audit3_batch_v3 as V3


class ThreeEpochMonitorTests(V3Case):
    def test_complete_history_is_excluded_and_accounted_exactly_once(self):
        value = S.inspect(self.out)
        self.assertEqual(value['runner_version'], 3)
        self.assertEqual(value['selected'], 12)
        self.assertEqual(value['eligible_selected'], 8)
        self.assertEqual(value['counts']['local_unsubmitted'], 8)
        self.assertEqual(value['counts']['prior_failed_requests'], 4)
        self.assertEqual(value['counts']['prior_unresolved_requests'], 0)
        self.assertEqual(sum(value['counts'].values()), 12)
        self.assertEqual(value['predecessor']['unaudited_or_unresolved_requests'], 4)
        self.assertEqual(value['by_language']['tl']['counts']['prior_failed_requests'], 2)
        self.assertEqual(value['by_language']['bis']['counts']['prior_failed_requests'], 2)
        self.assertEqual(value['observed_request_failures'], 0)
        self.assertEqual(value['historical_failed_requests'], 4)
        self.assertTrue(value['cost']['verified'])
        self.assertEqual(value['cost']['uncertain_charge_reserved_usd'], self.chain_cost['uncertain_charge_reserved_usd'])
        self.assertEqual(value['cost']['budget_accounted_usd'], self.chain_cost['budget_accounted_usd'])
        self.assertEqual(value['cost']['combined_accounted_usd'], self.chain_cost['combined_accounted_usd'])
        self.assertEqual(value['outstanding_provider_batches'], 0)
        self.assertEqual(value['provider_request_counts'], {})
        self.assertFalse(any('lacks a visible durable attempt' in w for w in value['warnings']))

    def test_current_acceptance_and_receipt_do_not_double_count_prior_reservations(self):
        d = self.submit_canary()
        value = S.inspect(self.out)
        self.assertEqual(value['counts']['cloud_queued'], 2)
        self.assertEqual(value['counts']['local_unsubmitted'], 6)
        self.assertEqual(value['counts']['prior_failed_requests'], 4)
        self.assertEqual(value['outstanding_provider_batches'], 1)
        self.assertEqual(value['cost']['uncertain_charge_reserved_usd'], self.chain_cost['uncertain_charge_reserved_usd'])
        self.assertEqual(value['cost']['active_reserved_usd'], V3.read(d / 'manifest.json')['reserved_usd'])
        terminal = self.terminal(d)
        V3.write(d / 'terminal.json', terminal)
        V3.collect_terminal(self.out, d, self.jobs)
        value = S.inspect(self.out)
        self.assertEqual(value['completed'], 2)
        self.assertEqual(value['cost']['active_reserved_usd'], 0)
        self.assertEqual(value['cost']['received_cost_usd'], terminal['usage']['cost'])
        self.assertEqual(value['cost']['uncertain_charge_reserved_usd'], self.chain_cost['uncertain_charge_reserved_usd'])
        self.assertEqual(value['cost']['budget_accounted_usd'], self.chain_cost['budget_accounted_usd'] + terminal['usage']['cost'])
        self.assertEqual(sum(value['counts'].values()), 12)

    def test_oldest_epoch_mutation_fails_billing_verification(self):
        path = self.ancestor / 'batches/000001/terminal.json'
        raw = G.read(path); raw['error']['message'] = 'Changed old evidence'
        G.write(path, raw)
        value = S.inspect(self.out)
        self.assertFalse(value['cost']['verified'])
        self.assertIsNone(value['cost']['received_cost_usd'])
        self.assertIsNone(value['cost']['uncertain_charge_reserved_usd'])
        self.assertTrue(any('Frozen predecessor artifact changed' in w for w in value['warnings']))


if __name__ == '__main__':
    unittest.main()
