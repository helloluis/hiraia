"""Offline checks for paid-submission boundaries and safe local collection."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import gemini_fresh_bulk_queue_v2 as R


class BulkQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)

    def save(self, name, value):
        R.write(self.out / name, value)

    def release_canary(self):
        self.save('bulk-v2/canary-passed.json', {'terminal_sha256': 'terminal'})
        self.save('bulk-v2/CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': 'terminal', 'audit2_selected_sample_ids': [1]})

    def recovery_fixture(self):
        root = self.out / 'bulk-v2/recovery'
        root.mkdir(parents=True)
        (root / 'runner-before-recovery.py').write_text('frozen original runner')
        runner = str(Path(R.__file__).resolve())
        config = {'dependencies_sha256': {runner: R.sha(root / 'runner-before-recovery.py')}}
        self.save('bulk-v2/config.json', config)
        self.save('bulk-v2/BLOCKED.json', {'reason': 'RuntimeError: HTTP 404: batch-known not found'})
        status = {'id': 'batch-known', 'model': 'gemini', 'endpoint': '/chat/completions',
                  'status': 'in_progress', 'request_counts': {'total': 2}}
        self.save('bulk-v2/recovery/visible-batch-status.json', status)
        self.save('bulk-v2/batches/000001/accepted.json', status)
        self.save('bulk-v2/recovery/authorization.json', {
            'kind': 'accepted_batch_read_visibility', 'batch_id': 'batch-known',
            'config_sha256': R.sha(self.out / 'bulk-v2/config.json'),
            'blocked_sha256': R.sha(self.out / 'bulk-v2/BLOCKED.json'),
            'old_runner_sha256': config['dependencies_sha256'][runner],
            'new_runner_sha256': R.sha(Path(R.__file__)),
            'status_sha256': R.sha(root / 'visible-batch-status.json')})
        return config

    def test_recovery_binds_original_freeze_and_same_visible_batch(self):
        config = self.recovery_fixture()
        self.assertEqual(R.validate_polling_recovery(self.out, config)['batch_id'], 'batch-known')
        self.save('bulk-v2/batches/000001/accepted.json', {'id': 'other-batch'})
        with self.assertRaisesRegex(ValueError, 'same accepted batch'):
            R.validate_polling_recovery(self.out, config)

    def test_recovery_rejects_unrelated_dependency_or_changed_evidence(self):
        config = self.recovery_fixture()
        with self.assertRaisesRegex(ValueError, 'Unverified polling recovery'):
            R.validate_polling_recovery(self.out, config, {str(Path(R.__file__).resolve()), 'other.py'})
        self.save('bulk-v2/BLOCKED.json', {'reason': 'different failure'})
        with self.assertRaisesRegex(ValueError, 'Unverified polling recovery'):
            R.validate_polling_recovery(self.out, config)

    def test_consumed_recovery_cannot_restart_or_submit(self):
        config = self.recovery_fixture()
        self.save('bulk-v2/recovery/consumed.json', {'pid': 1})
        with patch.object(R, 'frozen_entries', return_value=(config, [], {}, 'prompt')), \
                patch.object(R.B, 'network') as network:
            with self.assertRaisesRegex(ValueError, 'already used'):
                R.run(self.out, resume_known_batches=True)
            network.assert_not_called()

    def test_recovery_refuses_unknown_outstanding_submission(self):
        config = self.recovery_fixture()
        self.save('bulk-v2/batches/000002/submission-intent.json', {})
        with patch.object(R, 'frozen_entries', return_value=(config, [], {}, 'prompt')), \
                patch.object(R.B, 'network') as network:
            with self.assertRaisesRegex(ValueError, 'Unexpected outstanding'):
                R.run(self.out, resume_known_batches=True)
            network.assert_not_called()
        self.assertFalse((self.out / 'bulk-v2/recovery/consumed.json').exists())

    def test_multiple_batches_submit_before_any_completion_then_wait_for_budget(self):
        self.release_canary()
        outstanding = []
        def accepted(out, items, prompt):
            path = self.out / str(items[0])
            outstanding.append(path)
            return path
        with patch.object(R, 'active_batches', side_effect=lambda out: outstanding), \
                patch.object(R, 'next_items', side_effect=[[1], [2], R.BudgetCapacity('reserved')]), \
                patch.object(R, 'submit', side_effect=accepted):
            added, exhausted, waiting = R.fill_window(self.out, {}, '', {'maximum_outstanding_batches': 4})
        self.assertEqual(len(added), 2)
        self.assertFalse(exhausted)
        self.assertEqual(waiting, 'budget_reserved_for_outstanding_work')

    def test_provider_window_prevents_fifth_outstanding_upload(self):
        self.release_canary()
        with patch.object(R, 'active_batches', return_value=[1, 2, 3, 4]), \
                patch.object(R, 'submit') as submit:
            added, exhausted, waiting = R.fill_window(self.out, {}, '', {'maximum_outstanding_batches': 4})
        self.assertEqual(added, [])
        self.assertEqual(waiting, 'outstanding_batch_limit')
        submit.assert_not_called()

    def test_no_second_canary_submission_while_first_is_outstanding(self):
        with patch.object(R, 'batch_dirs', return_value=[self.out/'first']), \
                patch.object(R, 'submit') as submit:
            result = R.fill_window(self.out, {}, '', {'maximum_outstanding_batches': 4})
        self.assertEqual(result, ([], False, 'canary_result'))
        submit.assert_not_called()

    def test_signal_during_first_upload_prevents_second_upload(self):
        self.release_canary()
        outstanding = []
        with patch.object(R, 'active_batches', side_effect=lambda out: outstanding), \
                patch.object(R, 'next_items', return_value=[1]), \
                patch.object(R, 'submit', side_effect=lambda *args: outstanding.append(1) or 1) as submit:
            R.fill_window(self.out, {}, '', {'maximum_outstanding_batches': 4},
                          should_stop=lambda: bool(outstanding))
        self.assertEqual(submit.call_count, 1)

    def test_budget_cannot_be_ignored_when_no_outstanding_work_can_settle(self):
        self.release_canary()
        with patch.object(R, 'active_batches', return_value=[]), \
                patch.object(R, 'next_items', side_effect=R.BudgetCapacity('ceiling')), \
                patch.object(R, 'submit') as submit:
            with self.assertRaises(R.BudgetCapacity):
                R.fill_window(self.out, {}, '', {'maximum_outstanding_batches': 4})
        submit.assert_not_called()

    def test_immutable_import_refuses_conflict(self):
        path = self.out / 'result.json'
        R.ensure(path, {'q': 'original'})
        R.ensure(path, {'q': 'original'})
        with self.assertRaises(ValueError):
            R.ensure(path, {'q': 'changed'})
        self.assertEqual(json.loads(path.read_text()), {'q': 'original'})

    def test_canary_waits_for_verified_downstream_handover(self):
        self.assertTrue(R.canary_release_ready(self.out))
        self.save('bulk-v2/canary-passed.json', {'terminal_sha256': 'real-terminal'})
        self.assertFalse(R.canary_release_ready(self.out))
        self.save('bulk-v2/CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': 'real-terminal', 'audit2_selected_sample_ids': [100]})
        self.assertTrue(R.canary_release_ready(self.out))

    def test_canary_release_rejects_different_receipt_or_absent_downstream(self):
        self.save('bulk-v2/canary-passed.json', {'terminal_sha256': 'real-terminal'})
        for receipt, selected in [('other-terminal', [100]), ('real-terminal', [])]:
            self.save('bulk-v2/CANARY-REVIEWED.json', {'approved': True,
                'terminal_sha256': receipt, 'audit2_selected_sample_ids': selected})
            with self.assertRaisesRegex(ValueError, 'handover approval'):
                R.canary_release_ready(self.out)

    def test_pending_submissions_reserve_whole_batch_once(self):
        self.save('bulk-v2/config.json', {'baseline': {
            'received_cost_usd': 12, 'uncertain_and_active_reserved_usd': .2}})
        self.save('bulk-v2/batches/000001/manifest.json', {'reserved_usd': 9})
        self.save('bulk-v2/batches/000001/submission-intent.json', {})
        self.assertEqual(R.accounting(self.out)['budget_accounted_usd'], 21.2)
        self.save('bulk-v2/batches/000001/billing.json', {'received_cost_usd': .4})
        current = R.accounting(self.out)
        self.assertAlmostEqual(current['budget_accounted_usd'], 12.6)
        self.assertEqual(current['active_reserved_usd'], 0)

    def test_prepared_but_unsubmitted_batch_is_not_charged(self):
        self.save('bulk-v2/config.json', {'baseline': {
            'received_cost_usd': 12, 'uncertain_and_active_reserved_usd': .2}})
        self.save('bulk-v2/batches/000001/manifest.json', {'reserved_usd': 9})
        self.assertEqual(R.accounting(self.out)['budget_accounted_usd'], 12.2)

    def test_ambiguous_submission_never_reposts(self):
        directory = self.out / 'bulk-v2/batches/000001'
        self.save('bulk-v2/batches/000001/submission-intent.json', {})
        with patch.object(R, 'frozen_entries', return_value=({}, [], {}, 'prompt')), \
                patch.object(R.B, 'network') as network:
            with self.assertRaisesRegex(ValueError, 'unfinished batch'):
                R.run(self.out)
            network.assert_not_called()
        self.assertIn(directory, R.active_batches(self.out))

    def test_canary_selection_excludes_attempted_and_held_and_mixed_schema(self):
        by_id = {n: {'sample_id': n, 'job': {'key': str(n)}} for n in range(1, 8)}
        self.save('bulk-v2/plan.json', [{'sample_id': n} for n in by_id])
        self.save('source-blocks.json', {'2': 'source issue'})
        self.save('config.json', {'audit_budget_log': 'audit.log'})
        def payload(item, prompt):
            return {'response_format': {'schema': item['sample_id'] % 2}}
        with patch.object(R.C, 'batch_payload', side_effect=payload), \
                patch.object(R.T, 'attempted', side_effect=lambda out, item: item['sample_id'] == 1), \
                patch.object(R.T, 'reservation', return_value=1), \
                patch.object(R, 'accounting', return_value={'budget_accounted_usd': 12}), \
                patch.object(R.Q, 'latest_audit_budget', return_value={'accounted_usd': 20, 'inflight_reserved_usd': 0}):
            chosen = R.next_items(self.out, by_id, 'prompt')
        self.assertEqual([item['sample_id'] for item in chosen], [3, 5])

    def test_budget_limits_admitted_cloud_work(self):
        by_id = {n: {'sample_id': n, 'job': {'key': str(n)}} for n in range(1, 6)}
        self.save('bulk-v2/plan.json', [{'sample_id': n} for n in by_id])
        self.save('bulk-v2/canary-passed.json', {})
        self.save('source-blocks.json', {})
        self.save('config.json', {'audit_budget_log': 'audit.log'})
        with patch.object(R.C, 'batch_payload', return_value={'response_format': {}}), \
                patch.object(R.T, 'attempted', return_value=False), \
                patch.object(R.T, 'reservation', return_value=1), \
                patch.object(R, 'accounting', return_value={'budget_accounted_usd': 28}), \
                patch.object(R.Q, 'latest_audit_budget', return_value={'accounted_usd': 20, 'inflight_reserved_usd': 0}):
            self.assertEqual(len(R.next_items(self.out, by_id, 'prompt')), 2)

    def test_non_200_body_never_becomes_proposal_and_local_import_is_idempotent(self):
        directory = self.out / 'bulk-v2/batches/000001'
        self.save('bulk-v2/batches/000001/request.json', {'requests': [{'custom_id': '1', 'body': {}}]})
        self.save('bulk-v2/batches/000001/terminal.json', {'finalized_at': 123})
        self.save('bulk-v2/canary-passed.json', {})
        self.save('results/1/batch-origin.json', {})
        checked = {'received_cost_usd': .01, 'usage': {}, 'results': {
            '1': {'response': {'status_code': 503, 'body': {'looks_like': 'success'}}, 'error': None}}}
        with patch.object(R.C, 'validate_batch', return_value=checked), \
                patch.object(R.C, 'make_receipt', return_value={'allocated_received_cost_usd': .01}), \
                patch.object(R.T, 'validate') as content_validator, \
                patch.object(R.Q, 'load_entries', return_value=[]), \
                patch.object(R.Q, 'failure_state', return_value={}), \
                patch.object(R.Q, 'stopped_for_failures', return_value=False), \
                patch.object(R, 'emit'):
            R.collect(self.out, directory, {1: {'sample_id': 1, 'job': {'key': 'one'}}})
            R.collect(self.out, directory, {1: {'sample_id': 1, 'job': {'key': 'one'}}})
        content_validator.assert_not_called()
        self.assertTrue((self.out / 'results/1/error.json').exists())
        self.assertFalse((self.out / 'results/1/final.json').exists())
        self.assertEqual(json.loads((self.out / 'outcomes/1.json').read_text())['status'], 'error')


if __name__ == '__main__':
    unittest.main()
