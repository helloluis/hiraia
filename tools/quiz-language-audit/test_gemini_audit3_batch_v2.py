"""Offline wire-equivalence, predecessor quarantine and cumulative-budget checks."""
import copy
import json
from pathlib import Path
import unittest
from unittest import mock

import gemini_audit3_batch_v2 as R
import test_gemini_audit3_batch as OLD


class V2Case(OLD.OfflineCase):
    def setUp(self):
        super().setUp()
        self.prior = self.out
        directory = OLD.R.submit(self.prior, self.jobs, ['job-11', 'job-12'], network=self.network)
        accepted = R.read(directory / 'accepted.json')
        R.write(directory / 'terminal.json', {**accepted, 'status': 'failed',
            'request_counts': {'total': 2, 'completed': 0, 'failed': 2},
            'usage': None, 'results': None,
            'error': {'message': 'The provider rejected the batch input file.'}}, immutable=True)
        OLD.R.block(self.prior, 'Unreconciled rejected input; never resubmit attempted IDs')
        R.write(self.prior / 'process.json', {'status': 'stopped', 'pid': 999999, 'reason': 'Rejected input'})
        self.prior_cost = OLD.R.accounting(self.prior)
        self.out = self.root / 'audit3-v2'; self.out.mkdir()
        R.prepare(self.out, self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.config, self.jobs, self.plan = R.frozen(self.out)
        self.posts = []; self.gets = []

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


class Audit3V2Tests(V2Case):
    def test_wire_adds_only_implied_string_types_and_never_changes_messages(self):
        job = self.jobs['job-1']
        before = OLD.R.payload(job); after = R.payload(job)
        self.assertEqual(after['messages'], before['messages'])
        self.assertEqual({k: v for k, v in after.items() if k != 'response_format'},
                         {k: v for k, v in before.items() if k != 'response_format'})
        self.assertEqual({k: v for k, v in after['response_format']['json_schema'].items() if k != 'schema'},
                         {k: v for k, v in before['response_format']['json_schema'].items() if k != 'schema'})
        original = before['response_format']['json_schema']['schema']
        encoded = after['response_format']['json_schema']['schema']
        changes = []
        def compare(a, b, path=()):
            if isinstance(a, dict):
                added = 'type' not in a and isinstance(a.get('enum'), list) and a['enum'] and all(isinstance(x, str) for x in a['enum'])
                self.assertEqual(set(b), set(a) | ({'type'} if added else set()))
                if added:
                    self.assertEqual(b['type'], 'string'); changes.append(path)
                for k in a:
                    compare(a[k], b[k], (*path, k))
            elif isinstance(a, list):
                self.assertEqual(len(a), len(b))
                for i, (x, y) in enumerate(zip(a, b)):
                    compare(x, y, (*path, i))
            else:
                self.assertEqual(a, b)
        compare(original, encoded)
        self.assertEqual(len(changes), 7)  # q, three options, explanation, whole, verdict.
        self.assertEqual(json.loads(after['messages'][1]['content'])['response_schema'], original)
        self.assertEqual(OLD.R.payload(job), before)  # Source builder was not mutated.
        for secret in ('SECRET_GENERATOR_NOTE', 'SECRET_AUDIT', 'SECRET_NONENGLISH', 'OLD_TARGET_PRIVATE'):
            self.assertNotIn(secret, R.canonical(after))
        self.assertNotIn('answer', json.loads(after['messages'][1]['content'])['quiz'])

    def test_equivalent_accepted_json_values_and_unchanged_semantic_validator(self):
        # At every changed node enum membership already implies string, including
        # nonstring JSON values which the newly explicit type must still reject.
        original = OLD.R.payload(self.jobs['job-1'])['response_format']['json_schema']['schema']
        encoded = R.payload(self.jobs['job-1'])['response_format']['json_schema']['schema']
        def accepts(value, schema):
            try:
                R.A.e.validate(value, schema); return True
            except ValueError:
                return False
        def check_nodes(old, new):
            if isinstance(old, dict):
                if 'enum' in old:
                    for value in [*old['enum'], '', 'other', 0, 1, -1, 1.5, None, True, False, [], {}, ['pass']]:
                        self.assertEqual(accepts(value, old), accepts(value, new))
                for k in old:
                    check_nodes(old[k], new[k])
            elif isinstance(old, list):
                for a, b in zip(old, new):
                    check_nodes(a, b)
        check_nodes(original, encoded)
        raw = OLD.diagnosis(self.jobs['job-1'])
        value = json.loads(raw['choices'][0]['message']['content'])
        variants = [value, {**value, 'correct_index': -1}, {**value, 'correct_index': True},
                    {**value, 'correct_index': 3}, {**value, 'verdict': 'invalid'},
                    {**value, 'extra': 'forbidden'}, {**value, 'checks': {}},
                    {k: v for k, v in value.items() if k != 'whole_quiz'}]
        for candidate in variants:
            self.assertEqual(accepts(candidate, original), accepts(candidate, encoded))
        self.assertIs(R.A.validate, OLD.R.A.validate)
        self.assertEqual(R.A.validate(raw, R.clean_content(self.jobs['job-1'])),
                         OLD.R.A.validate(raw, OLD.R.clean_content(self.jobs['job-1'])))
        odd = {'anyOf': [{'enum': []}, {'enum': [1, 'a']}, {'enum': ['a'], 'type': 'integer'}]}
        self.assertEqual(R.explicit_enum_strings(odd), odd)

    def test_full_integration_frozen_while_plan_and_new_canary_exclude_prior_attempts(self):
        self.assertEqual(self.config['selected'], 12)
        self.assertEqual(self.config['eligible_selected'], 10)
        self.assertEqual(self.config['schema_encoding'], 'explicit_enum_string_type_v2')
        self.assertEqual(self.config['prompt_sha256'], OLD.R.read(self.prior / 'config.json')['prompt_sha256'])
        self.assertEqual(self.config['excluded_keys'], ['job-11', 'job-12'])
        self.assertEqual(len(self.jobs), 12)
        self.assertEqual([p['key'] for p in self.plan], ['job-' + str(i) for i in range(1, 11)])
        self.assertEqual(R.next_keys(self.out, self.jobs, self.plan), ['job-1', 'job-2'])
        self.assertEqual(R.check_ledger(self.out, self.jobs), {'job-11', 'job-12'})
        for keys in (['job-11', 'job-12'], ['job-1', 'job-11']):
            with self.assertRaisesRegex(ValueError, 'attempted'):
                R.submit(self.out, self.jobs, keys, network=self.network)
        self.assertEqual(self.posts, [])
        record = R.verify_predecessor(self.out)
        names = record['files_sha256']
        for p in (self.prior / 'config.json', self.prior / 'BLOCKED.json', self.prior / 'process.json', Path(OLD.R.__file__),
                  self.prior / 'batches/000001/manifest.json', self.prior / 'batches/000001/request.json',
                  self.prior / 'batches/000001/accepted.json', self.prior / 'batches/000001/terminal.json'):
            self.assertIn(str(p.resolve()), names)
        self.assertIn(str(Path(OLD.R.__file__).resolve()), self.config['dependencies_sha256'])
        self.assertEqual(self.config['integration_manifest_sha256'], OLD.R.read(self.prior / 'config.json')['integration_manifest_sha256'])

    def test_prior_unknown_exposure_counted_once_at_prepare_pending_and_settlement(self):
        reserved = self.prior_cost['uncertain_charge_reserved_usd']
        cost = R.accounting(self.out)
        self.assertGreater(reserved, 0)
        self.assertEqual(cost['received_cost_usd'], 0)
        self.assertEqual(cost['budget_accounted_usd'], reserved)
        self.assertEqual(cost['combined_accounted_usd'], 151.04344425 + reserved)
        self.assertEqual(cost['predecessor_accounting']['uncertain_charge_reserved_usd'], reserved)
        self.assertEqual(cost['current_accounting']['budget_accounted_usd'], 0)
        d = self.submit_canary()
        next_reserved = R.read(d / 'manifest.json')['reserved_usd']
        pending = R.accounting(self.out)
        self.assertEqual(pending['uncertain_charge_reserved_usd'], reserved)
        self.assertEqual(pending['active_reserved_usd'], next_reserved)
        self.assertAlmostEqual(pending['budget_accounted_usd'], reserved + next_reserved)
        R.write(d / 'terminal.json', self.terminal(d)); R.collect_terminal(self.out, d, self.jobs)
        settled = R.accounting(self.out); charge = self.terminal(d)['usage']['cost']
        self.assertEqual(settled['received_cost_usd'], charge)
        self.assertEqual(settled['uncertain_charge_reserved_usd'], reserved)
        self.assertEqual(settled['active_reserved_usd'], 0)
        self.assertEqual(settled['budget_accounted_usd'], reserved + charge)
        R.collect_terminal(self.out, d, self.jobs)
        self.assertEqual(R.accounting(self.out), settled)

    def test_prior_reservation_reduces_both_admission_limits(self):
        original = R.reservation
        # Current work would fit by itself; predecessor uncertainty pushes over.
        next_total = R.BUDGET - self.prior_cost['budget_accounted_usd'] / 2
        with mock.patch.object(R, 'reservation', return_value=next_total / 2):
            with self.assertRaises(R.BudgetCapacity):
                R.next_keys(self.out, self.jobs, self.plan)
            with self.assertRaises(R.BudgetCapacity):
                self.submit_canary()
        self.assertEqual(self.posts, [])
        with mock.patch.object(R, 'accounting', return_value={'budget_accounted_usd': 0., 'combined_accounted_usd': 249.999}):
            with self.assertRaises(R.BudgetCapacity):
                R.next_keys(self.out, self.jobs, self.plan)
        self.assertIs(R.reservation, original)

    def test_prior_artifact_or_later_attempt_changes_block_new_submission(self):
        path = self.prior / 'batches/000001/terminal.json'
        saved = path.read_bytes(); path.write_bytes(saved + b' ')
        with self.assertRaisesRegex(ValueError, 'predecessor artifact changed'):
            R.frozen(self.out)
        with self.assertRaisesRegex(ValueError, 'predecessor artifact changed'):
            self.submit_canary()
        path.write_bytes(saved)
        R.write(self.prior / 'batches/000002/submission-intent.json', {'attempt': True})
        with self.assertRaisesRegex(ValueError, 'new batches'):
            self.submit_canary()
        self.assertEqual(self.posts, [])

    def test_running_predecessor_cannot_be_migrated_despite_blocked_marker(self):
        output = self.root / 'running-prior-test'; output.mkdir()
        R.write(self.prior / 'process.json', {'status': 'running', 'pid': 999999})
        with self.assertRaisesRegex(ValueError, 'process must be stopped'):
            R.prepare(output, self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.assertFalse((output / 'config.json').exists())
        with self.assertRaisesRegex(ValueError, 'predecessor artifact changed'):
            R.check_ledger(self.out, self.jobs)

    def test_unknown_prior_is_never_reclassified_as_zero_and_live_epoch_is_rejected(self):
        fresh = self.root / 'other-v2'; fresh.mkdir()
        p = self.prior / 'batches/000001/terminal.json'; saved = p.read_bytes(); p.unlink()
        with self.assertRaisesRegex(ValueError, 'live or ambiguous'):
            R.prepare(fresh, self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.assertFalse((fresh / 'config.json').exists())
        p.write_bytes(saved)
        raw = R.read(p); raw['usage'] = {'cost': 0}; R.write(p, raw)
        with self.assertRaisesRegex(ValueError, 'entirely rejected'):
            R.prepare(fresh, self.jobsfile, self.manifest, 151.04344425, self.prior)
        self.assertFalse((fresh / 'config.json').exists())

    def test_current_attempts_never_retry_after_restart_or_ambiguous_post(self):
        d = self.submit_canary()
        with mock.patch.object(R.time, 'time', return_value=R.read(d / 'poll.json')['accepted_at'] + 30):
            R.run(self.out, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1)
        self.assertEqual(self.gets, [])
        with self.assertRaisesRegex(ValueError, 'attempted'):
            self.submit_canary()
        R.write(d / 'terminal.json', self.terminal(d)); R.collect_terminal(self.out, d, self.jobs)
        proof = R.read(self.out / 'canary-passed.json')
        R.write(self.out / 'CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': proof['terminal_sha256'], 'config_sha256': R.sha(self.out / 'config.json')})
        def ambiguous(*args, **kwargs):
            raise RuntimeError('Lost POST response')
        with self.assertRaisesRegex(RuntimeError, 'Lost POST'):
            R.submit(self.out, self.jobs, ['job-3'], network=ambiguous)
        with self.assertRaisesRegex(ValueError, 'blocked'):
            R.run(self.out, once=True, network=self.network)
        self.assertGreater(R.accounting(self.out)['uncertain_charge_reserved_usd'], self.prior_cost['budget_accounted_usd'])
        self.assertEqual(len(self.posts), 1)

    def test_canary_gate_four_outstanding_stop_and_collect_only_are_retained(self):
        d = self.submit_canary()
        with self.assertRaisesRegex(ValueError, 'gate is closed'):
            R.submit(self.out, self.jobs, ['job-3'], network=self.network)
        R.write(d / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        R.run(self.out, collect_only=True, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1)
        proof = R.read(self.out / 'canary-passed.json')
        R.write(self.out / 'CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': proof['terminal_sha256'], 'config_sha256': R.sha(self.out / 'config.json')})
        for n in range(3, 7):
            R.submit(self.out, self.jobs, ['job-' + str(n)], network=self.network)
        with self.assertRaisesRegex(ValueError, 'window is full'):
            R.submit(self.out, self.jobs, ['job-7'], network=self.network)
        (self.out / 'STOP').touch()
        for batch in R.active_batches(self.out):
            R.write(batch / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        R.run(self.out, once=True, network=self.network)
        self.assertEqual(len(self.posts), 5)
        self.assertEqual(R.accounting(self.out)['active_reserved_usd'], 0)

    def test_completion_reports_prior_failures_but_does_not_leave_them_pending(self):
        self.finish_canary()
        d = R.submit(self.out, self.jobs, ['job-' + str(n) for n in range(3, 11)], network=self.network)
        R.write(d / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        process = R.run(self.out, network=self.network)
        self.assertEqual(process['status'], 'finished')
        summary = R.read(self.out / 'report.json')
        self.assertEqual(summary['selected'], 12)
        self.assertEqual(summary['eligible_selected'], 10)
        self.assertEqual(summary['completed'], 10)
        self.assertEqual(summary['counts']['prior_errors'], 2)
        self.assertEqual(summary['counts']['errors'], 0)
        self.assertEqual(summary['counts']['unsubmitted'], 0)
        self.assertEqual(summary['counts']['cloud_pending'], 0)
        self.assertEqual(summary['prior_unresolved_requests'], 2)
        self.assertEqual(summary['request_failure_rate'], 2 / 12)
        self.assertEqual(summary['current_request_failure_rate'], 0)
        self.assertEqual(len((self.out / 'diagnoses.jsonl').read_text().splitlines()), 10)
        self.assertEqual(len(self.posts), 2)

    def test_schema_config_mutation_or_orphan_attempt_cannot_expand_plan(self):
        config = R.read(self.out / 'config.json'); config['schema_encoding'] = 'original'
        R.write(self.out / 'config.json', config)
        with self.assertRaisesRegex(ValueError, 'v2 settings'):
            R.frozen(self.out)
        R.write(self.out / 'config.json', self.config)
        R.write(self.out / 'results/job-5/started.json', {'time': 1})
        with self.assertRaisesRegex(ValueError, 'Orphan current'):
            self.submit_canary()
        self.assertEqual(self.posts, [])

    def test_diagnosis_wrong_answer_and_quoted_old_target_still_use_original_validator(self):
        d = self.submit_canary(); raw = self.terminal(d)
        message = raw['results'][0]['response']['body']['choices'][0]['message']
        value = json.loads(message['content']); value['correct_index'] = 1
        message['content'] = json.dumps(value)
        R.write(d / 'terminal.json', raw); R.collect_terminal(self.out, d, self.jobs)
        self.assertEqual(R.read(self.out / 'results/job-1/final.json')['status'], 'needs_review')
        candidate = OLD.diagnosis(self.jobs['job-1'], status='flagged')
        message = candidate['choices'][0]['message']; value = json.loads(message['content'])
        value['checks']['q']['quote'] = 'OLD_TARGET_PRIVATE'; message['content'] = json.dumps(value)
        with self.assertRaisesRegex(ValueError, 'Evidence quote absent'):
            R.A.validate(candidate, R.clean_content(self.jobs['job-1']))

    def test_persistent_technical_failure_and_output_lock_remain_enforced(self):
        self.finish_canary()
        d = self.out / 'batches/000002'
        R.write(d / 'manifest.json', {'keys': ['job-3', 'job-4', 'job-5', 'job-6']})
        R.write(d / 'collected.json', {'jobs': 4})
        for key in ('job-3', 'job-4', 'job-5'):
            R.write(self.out / 'results' / key / 'error.json', {'error': 'technical'})
        R.write(self.out / 'results/job-6/final.json', {'status': 'needs_review'})
        with self.assertRaisesRegex(ValueError, 'Persistent technical failure'):
            R.guard_admission(self.out)
        with R.exclusive_lock(self.out):
            with self.assertRaises(BlockingIOError):
                with R.exclusive_lock(self.out):
                    self.fail('duplicate runner acquired lock')


if __name__ == '__main__':
    unittest.main()
