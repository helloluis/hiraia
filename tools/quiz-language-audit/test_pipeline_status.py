"""Offline monitoring checks for legacy requests and real Fresh cloud batches."""
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

import pipeline_status as status


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


class PipelineStatusTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / 'fresh'
        self.root.mkdir()
        self.now = time.time()
        self.running = {'running': True, 'state': 'running', 'started': self.now - 1800}
        status.WARNINGS.clear()
        patch = mock.patch('urllib.request.urlopen',
                           side_effect=AssertionError('A monitor must never contact a provider'))
        self.network = patch.start()
        self.addCleanup(patch.stop)

    def directory(self, sample_id):
        return self.root / 'results' / str(sample_id)

    def enqueue(self, sample_id):
        put(self.root / 'queue' / f'{sample_id}.json', {
            'sample_id': sample_id,
            'job': {'key': f'{sample_id:064x}', 'content': {'language': 'tl'}}})

    def cloud_batch(self, number, sample_ids, remote='in_progress', accepted=True, namespace='bulk'):
        directory = self.root / namespace / 'batches' / f'{number:06d}'
        mode = 'cloud_batch_v2' if namespace == 'bulk-v2' else 'cloud_batch'
        capacity = 4 if namespace == 'bulk-v2' else 1
        put(self.root / namespace / 'config.json', {'mode': mode, 'maximum_outstanding_batches': capacity})
        put(self.root / namespace / 'summary.json', {'time': self.now, 'mode': mode,
            'batch_size': 500, 'maximum_outstanding_batches': capacity, 'poll_seconds': 60})
        put(directory / 'manifest.json', {'number': number, 'sample_ids': sample_ids})
        put(directory / 'submission-intent.json', {'time': self.now - 4000})
        provider_id = f'batch-{number}' if namespace == 'bulk' else f'batch-v2-{number}'
        if accepted:
            put(directory / 'accepted.json', {'id': provider_id, 'status': 'validating'})
            put(directory / 'status.json', {'id': provider_id, 'status': remote,
                                            'request_counts': {'total': len(sample_ids), 'completed': 0}})
        for sample_id in sample_ids:
            self.enqueue(sample_id)
            put(self.directory(sample_id) / 'started.json', {
                'kind': 'cloud_batch', 'batch_dir': str(directory),
                'time': self.now - 4000, 'reserved_usd': .03})
            if accepted:
                put(self.directory(sample_id) / 'batch-origin.json', {
                    'batch_id': provider_id, 'version': 2 if namespace == 'bulk-v2' else 1})
        return directory

    def test_legacy_received_cost_and_unknown_request_age_remain_unchanged(self):
        first = self.directory(1)
        put(first / 'started.json', {'time': self.now - 30, 'reserved_usd': .02})
        put(first / 'response.json', {'usage': {'cost': .003}})
        put(first / 'final.json', {'status': 'proposal'})
        received = status.attempt(self.root, 1, self.running, self.now)
        self.assertEqual((received['status'], received['received_cost_usd'],
                          received['uncertain_or_active_reserved_usd']), ('proposal', .003, 0.))
        second = self.directory(2)
        put(second / 'started.json', {'time': self.now - 1200, 'reserved_usd': .02})
        interrupted = status.attempt(self.root, 2, self.running, self.now)
        self.assertEqual(interrupted['status'], 'interrupted_unknown')
        self.assertEqual(interrupted['uncertain_or_active_reserved_usd'], .02)
        self.network.assert_not_called()

    def test_legacy_recent_request_pace_remains_available_with_a_measured_window(self):
        events = [{'time': self.now - 590 + index * 10, 'event': 'completed', 'status': 'proposal'}
                  for index in range(60)]
        (self.root / 'process.log').write_text(''.join(json.dumps(event) + '\n' for event in events))
        pace = status.recent_pace(self.root, self.running, self.now, 120)
        self.assertIsNotNone(pace['requests_per_minute'])
        self.assertIsNotNone(pace['backlog_eta_seconds'])

    def test_batch_receipt_accounting_replaces_raw_cost_without_changing_provider_artifacts(self):
        directory = self.directory(1)
        put(directory / 'batch-origin.json', {'batch_id': 'batch-1'})
        put(directory / 'started.json', {'kind': 'cloud_batch', 'time': self.now - 1800,
                                        'reserved_usd': .03})
        # The contract owns accounting even when a raw provider cost field exists.
        put(directory / 'response.json', {'usage': {'cost': 99., 'completion_tokens': 300}})
        put(directory / 'final.json', {'status': 'proposal'})
        before = {path: path.read_bytes() for path in directory.iterdir()}
        with mock.patch.object(status, 'batch_charge', return_value=(.004, 0.)) as charge:
            observed = status.attempt(self.root, 1, self.running, self.now)
        charge.assert_called_once_with(directory)
        self.assertEqual(observed['received_cost_usd'], .004)
        self.assertEqual(observed['uncertain_or_active_reserved_usd'], 0.)
        self.assertEqual(observed['status'], 'proposal')
        self.assertEqual({path: path.read_bytes() for path in directory.iterdir()}, before)

    def test_unavailable_batch_ledger_exposes_accounting_warning_and_retains_reservation(self):
        directory = self.directory(1)
        put(directory / 'batch-origin.json', {'batch_id': 'batch-1'})
        put(directory / 'started.json', {'kind': 'cloud_batch', 'reserved_usd': .03})
        with mock.patch.object(status, 'batch_charge', side_effect=ValueError('Ledger mismatch')):
            observed = status.attempt(self.root, 1, self.running, self.now)
        self.assertTrue(observed['accounting_error'])
        self.assertEqual(observed['uncertain_or_active_reserved_usd'], .03)
        self.assertEqual(observed['received_cost_usd'], 0.)
        self.assertTrue(any('accounting unavailable' in warning for warning in status.WARNINGS))

    def test_accepted_cloud_work_survives_old_age_and_stopped_local_coordinator(self):
        directory = self.cloud_batch(1, [1], remote='validating')
        stopped = {'running': False, 'state': 'stopped', 'started': self.now - 1800}
        queued = status.attempt(self.root, 1, stopped, self.now)
        self.assertEqual(queued['status'], 'cloud_queued')
        self.assertGreater(queued['cloud_age_seconds'], 900)
        self.assertEqual(queued['uncertain_or_active_reserved_usd'], .03)
        self.assertFalse(queued['accounting_error'])
        put(directory / 'status.json', {'id': 'batch-1', 'status': 'in_progress'})
        active = status.attempt(self.root, 1, stopped, self.now)
        self.assertEqual(active['status'], 'cloud_inflight')
        put(directory / 'status.json', {'id': 'batch-1', 'status': 'completed'})
        completed = status.attempt(self.root, 1, stopped, self.now)
        self.assertEqual(completed['status'], 'cloud_awaiting_import')
        self.network.assert_not_called()

    def test_ambiguous_submission_is_not_reported_as_provider_accepted(self):
        self.cloud_batch(1, [1], accepted=False)
        with mock.patch.object(status, 'batch_charge', return_value=(0., .03)):
            observed = status.attempt(self.root, 1, self.running, self.now)
        self.assertEqual(observed['status'], 'cloud_submission_unknown')
        batches = status.cloud_batches(self.root, self.now)
        self.assertEqual(batches['submitted_batches'], 0)
        self.assertEqual(batches['ambiguous_submissions'], 1)

    def test_cloud_counts_and_receipt_costs_stay_separate_from_local_manifests_and_suppress_burst_eta(self):
        batch = self.cloud_batch(1, [2, 3])
        self.enqueue(1)
        first = self.directory(1)
        put(first / 'response.json', {'usage': {'cost': .003}})
        put(first / 'final.json', {'status': 'proposal'})
        put(self.directory(2) / 'response.json', {'usage': {'completion_tokens': 300}})
        put(self.directory(2) / 'final.json', {'status': 'proposal'})
        put(self.root / 'batches/000001.json', {'batch_id': 1, 'items': [{'sample_id': 1}]})
        put(self.root / 'batches/000002.json', {'batch_id': 2, 'items': [{'sample_id': 2}, {'sample_id': 3}]})
        # Old-style row completion events can appear in imports; they are not cloud throughput.
        events = [{'time': self.now - 590 + index * 10, 'event': 'completed', 'status': 'proposal'}
                  for index in range(60)]
        (self.root / 'process.log').write_text(''.join(json.dumps(event) + '\n' for event in events))

        def charge(directory):
            return (.004, 0.) if directory.name == '2' else (0., .03)

        with mock.patch.object(status, 'batch_charge', side_effect=charge), \
                mock.patch.object(status, 'process_state', return_value=self.running):
            stage, _, _ = status.queue_stage(self.root, 'Fresh-1', self.now)
            report = status.collect(self.root.parent / 'audit1', self.root, self.root.parent / 'audit2')
            rendered = status.markdown(report)
        self.assertEqual(stage['batches'], {'done': 1, 'total': 2})
        self.assertEqual(stage['cloud_batches']['submitted_batches'], 1)
        self.assertEqual(stage['cloud_batches']['closed_batches'], 0)
        self.assertEqual(stage['cloud_batches']['outstanding_batches'], 1)
        self.assertEqual(stage['cloud_inflight'], 1)
        self.assertEqual(stage['inflight'], 0)
        self.assertEqual(stage['interrupted_unknown'], 0)
        self.assertEqual(stage['completed'], 2)
        self.assertAlmostEqual(stage['received_cost_usd'], .007)
        self.assertEqual(stage['uncertain_or_active_reserved_usd'], .03)
        self.assertIsNone(stage['recent']['requests_per_minute'])
        self.assertIsNone(stage['recent']['backlog_eta_seconds'])
        self.assertEqual(stage['recent']['mode'], 'cloud_batch')
        self.assertGreaterEqual(stage['recent']['closed_request_events'], 30)
        self.assertIn('1/2 local; 0/1 cloud', rendered)
        self.assertIn('1 active cloud', rendered)
        self.assertIn('cloud ETA unavailable', rendered)

    def test_cloud_manifests_do_not_change_audit_two_cohort_membership(self):
        self.cloud_batch(1, [1, 2])
        put(self.root / 'batches/000001.json', {'batch_id': 1, 'items': [{'sample_id': 1}]})
        records = [{'sample_id': '1', 'key': 'a', 'language': 'tl', 'raw_status': 'pass',
                    'terminal': True, 'blocked': False, 'audit1_matched_flagged': True}]
        batches, cohorts = status.batches_and_cohorts(self.root, records, audit2=True)
        self.assertEqual(batches, {'done': 1, 'total': 1})
        self.assertEqual(len(cohorts), 1)
        self.assertEqual(cohorts[0]['assigned'], 1)
        self.assertEqual(cohorts[0]['matched_unblocked_pass'], 1)

    def test_v2_and_reconciled_v1_accounting_dispatch_to_v2_contract_without_legacy_repricing(self):
        old = self.cloud_batch(1, [1], remote='failed')
        self.cloud_batch(1, [2], namespace='bulk-v2')
        put(self.directory(1) / 'batch-failure-receipt.json', {'kind': 'cloud_batch_failure_reconciliation'})
        v2 = SimpleNamespace(charge_state=mock.Mock(side_effect=[(0., 0., {}), (.007, 0., {})]))
        import fresh_batch_contract
        with mock.patch.dict(sys.modules, {'fresh_batch_contract_v2': v2}), \
                mock.patch.object(fresh_batch_contract, 'charge_state', side_effect=AssertionError('Wrong contract')):
            self.assertEqual(status.batch_charge(self.directory(1)), (0., 0.))
            self.assertEqual(status.batch_charge(self.directory(2)), (.007, 0.))
        self.assertEqual([call.args[0] for call in v2.charge_state.call_args_list],
                         [self.directory(1), self.directory(2)])

    def test_both_namespaces_preserve_failed_v1_jobs_and_four_pending_v2_batches_without_double_accounting(self):
        old = self.cloud_batch(1, [1, 2], remote='in_progress')
        # Immutable terminal state takes precedence over an older mutable poll.
        put(old / 'terminal.json', {'id': 'batch-1', 'status': 'failed'})
        for identifier in (1, 2):
            put(self.directory(identifier) / 'error.json', {'error': 'Old schema rejected before generation'})
            put(self.directory(identifier) / 'batch-failure-receipt.json', {'verified': 'fixture'})
        for number in range(1, 5):
            self.cloud_batch(number, [number * 2 + 1, number * 2 + 2], namespace='bulk-v2')
        self.enqueue(11)
        put(self.directory(11) / 'response.json', {'usage': {'cost': .003}})
        put(self.directory(11) / 'final.json', {'status': 'proposal'})
        put(self.root / 'process.json', {'mode': 'cloud_batch_v2', 'bulk_dir': 'bulk-v2'})

        def charge(directory):
            return (0., 0.) if int(directory.name) <= 2 else (0., .03)

        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        with mock.patch.object(status, 'batch_charge', side_effect=charge), \
                mock.patch.object(status, 'process_state', return_value={'running': False, 'state': 'stopped'}):
            stage, _, _ = status.queue_stage(self.root, 'Fresh-1', self.now)
        self.assertEqual(stage['raw_counts']['cloud_failed'], 2)
        self.assertEqual(stage['cloud_terminal_failures'], 2)
        self.assertEqual(stage['request_failures'], 2)
        self.assertEqual(stage['cloud_awaiting_import'], 0)
        self.assertEqual(stage['cloud_inflight'], 8)
        cloud = stage['cloud_batches']
        self.assertEqual(cloud['submitted_batches'], 5)
        self.assertEqual(cloud['outstanding_batches'], 4)
        self.assertEqual(cloud['terminal_failed_batches'], 1)
        self.assertEqual(cloud['active_namespace'], 'bulk-v2')
        self.assertEqual(cloud['maximum_outstanding_batches'], 4)
        self.assertEqual(cloud['by_namespace']['bulk']['submitted_batches'], 1)
        self.assertEqual(cloud['by_namespace']['bulk-v2']['submitted_batches'], 4)
        self.assertEqual(len({batch['batch_label'] for batch in cloud['batches']}), 5)
        self.assertAlmostEqual(stage['received_cost_usd'], .003)
        self.assertAlmostEqual(stage['uncertain_or_active_reserved_usd'], .24)
        self.assertIsNone(stage['recent']['backlog_eta_seconds'])
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()})

    def test_active_process_selects_configuration_without_hiding_other_version_batches(self):
        self.cloud_batch(1, [1])
        self.cloud_batch(1, [2], namespace='bulk-v2')
        put(self.root / 'process.json', {'mode': 'cloud_batch'})
        first = status.cloud_batches(self.root, self.now)
        self.assertEqual(first['active_namespace'], 'bulk')
        self.assertEqual(first['maximum_outstanding_batches'], 1)
        self.assertEqual(first['submitted_batches'], 2)
        put(self.root / 'process.json', {'mode': 'cloud_batch', 'bulk_dir': str(self.root / 'bulk-v2')})
        second = status.cloud_batches(self.root, self.now)
        self.assertEqual(second['active_namespace'], 'bulk-v2')
        self.assertEqual(second['maximum_outstanding_batches'], 4)
        self.assertEqual(second['submitted_batches'], 2)


if __name__ == '__main__':
    unittest.main()
