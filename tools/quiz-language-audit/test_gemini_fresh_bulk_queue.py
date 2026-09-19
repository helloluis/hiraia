"""Offline checks for paid-submission boundaries and safe local collection."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import gemini_fresh_bulk_queue as R


class BulkQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)

    def save(self, name, value):
        R.write(self.out / name, value)

    def test_immutable_import_refuses_conflict(self):
        path = self.out / 'result.json'
        R.ensure(path, {'q': 'original'})
        R.ensure(path, {'q': 'original'})
        with self.assertRaises(ValueError):
            R.ensure(path, {'q': 'changed'})
        self.assertEqual(json.loads(path.read_text()), {'q': 'original'})

    def test_canary_waits_for_verified_downstream_handover(self):
        self.assertTrue(R.canary_release_ready(self.out))
        self.save('bulk/canary-passed.json', {'terminal_sha256': 'real-terminal'})
        self.assertFalse(R.canary_release_ready(self.out))
        self.save('bulk/CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': 'real-terminal', 'audit2_selected_sample_ids': [100]})
        self.assertTrue(R.canary_release_ready(self.out))

    def test_canary_release_rejects_different_receipt_or_absent_downstream(self):
        self.save('bulk/canary-passed.json', {'terminal_sha256': 'real-terminal'})
        for receipt, selected in [('other-terminal', [100]), ('real-terminal', [])]:
            self.save('bulk/CANARY-REVIEWED.json', {'approved': True,
                'terminal_sha256': receipt, 'audit2_selected_sample_ids': selected})
            with self.assertRaisesRegex(ValueError, 'handover approval'):
                R.canary_release_ready(self.out)

    def test_pending_submissions_reserve_whole_batch_once(self):
        self.save('bulk/config.json', {'baseline': {
            'received_cost_usd': 12, 'uncertain_and_active_reserved_usd': .2}})
        self.save('bulk/batches/000001/manifest.json', {'reserved_usd': 9})
        self.save('bulk/batches/000001/submission-intent.json', {})
        self.assertEqual(R.accounting(self.out)['budget_accounted_usd'], 21.2)
        self.save('bulk/batches/000001/billing.json', {'received_cost_usd': .4})
        current = R.accounting(self.out)
        self.assertAlmostEqual(current['budget_accounted_usd'], 12.6)
        self.assertEqual(current['active_reserved_usd'], 0)

    def test_prepared_but_unsubmitted_batch_is_not_charged(self):
        self.save('bulk/config.json', {'baseline': {
            'received_cost_usd': 12, 'uncertain_and_active_reserved_usd': .2}})
        self.save('bulk/batches/000001/manifest.json', {'reserved_usd': 9})
        self.assertEqual(R.accounting(self.out)['budget_accounted_usd'], 12.2)

    def test_ambiguous_submission_never_reposts(self):
        directory = self.out / 'bulk/batches/000001'
        self.save('bulk/batches/000001/submission-intent.json', {})
        with patch.object(R, 'frozen_entries', return_value=({}, [], {}, 'prompt')), \
                patch.object(R.B, 'network') as network:
            with self.assertRaisesRegex(ValueError, 'unfinished batch'):
                R.run(self.out)
            network.assert_not_called()
        self.assertIn(directory, R.active_batches(self.out))

    def test_canary_selection_excludes_attempted_and_held_and_mixed_schema(self):
        by_id = {n: {'sample_id': n, 'job': {'key': str(n)}} for n in range(1, 8)}
        self.save('bulk/plan.json', [{'sample_id': n} for n in by_id])
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
        self.save('bulk/plan.json', [{'sample_id': n} for n in by_id])
        self.save('bulk/canary-passed.json', {})
        self.save('source-blocks.json', {})
        self.save('config.json', {'audit_budget_log': 'audit.log'})
        with patch.object(R.C, 'batch_payload', return_value={'response_format': {}}), \
                patch.object(R.T, 'attempted', return_value=False), \
                patch.object(R.T, 'reservation', return_value=1), \
                patch.object(R, 'accounting', return_value={'budget_accounted_usd': 28}), \
                patch.object(R.Q, 'latest_audit_budget', return_value={'accounted_usd': 20, 'inflight_reserved_usd': 0}):
            self.assertEqual(len(R.next_items(self.out, by_id, 'prompt')), 2)

    def test_non_200_body_never_becomes_proposal_and_local_import_is_idempotent(self):
        directory = self.out / 'bulk/batches/000001'
        self.save('bulk/batches/000001/request.json', {'requests': [{'custom_id': '1', 'body': {}}]})
        self.save('bulk/batches/000001/terminal.json', {'finalized_at': 123})
        self.save('bulk/canary-passed.json', {})
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
