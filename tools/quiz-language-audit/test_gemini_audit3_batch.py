"""Offline Audit-3 cloud request, provenance, accounting and recovery checks."""
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import gemini_audit3_batch as R


def diagnosis(job, status='pass'):
    content = job['content']
    fields = ['q', *[f'options[{i}]' for i in range(len(content['target']['options']))], 'explanation']
    checks = {name: {'status': 'ok', 'quote': '', 'finding': ''} for name in fields}
    if status == 'flagged':
        checks['q'] = {'status': 'issue', 'quote': content['target']['q'], 'finding': 'Fixture confirmed mismatch.'}
    result = {'checks': checks, 'correct_index': content['answer'],
        'verdict': 'fix' if status == 'flagged' else 'pass', 'whole_quiz': {'status': 'ok', 'finding': ''}}
    return {'model': R.C.CANONICAL_MODEL, 'provider': 'Google',
        'usage': {'prompt_tokens': 100, 'completion_tokens': 20,
                  'completion_tokens_details': {'reasoning_tokens': 5}},
        'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant',
                    'reasoning': 'PRIVATE_REASONING_IS_NOT_JSON', 'content': json.dumps(result)}}]}


class OfflineCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name); self.out = self.root / 'audit3'; self.out.mkdir()
        self.capture = mock.patch('sys.stdout', new_callable=io.StringIO)
        self.capture.start(); self.addCleanup(self.capture.stop)
        patch = mock.patch('urllib.request.urlopen', side_effect=AssertionError('No real provider calls'))
        patch.start(); self.addCleanup(patch.stop)
        self.sourcefile = self.root / 'source.json'
        self.original = []
        self.candidates = []
        rows = []
        for n in range(1, 13):
            lang = 'tl' if n % 2 else 'bis'
            english = {'q': f'Which object {n}?', 'options': ['Ball', 'Box', 'Board'], 'explanation': 'It is a ball.'}
            target = {'q': f'Tanong {n}?', 'options': ['Bola', 'Kahon', 'Tabla'], 'explanation': 'Bola ito.'}
            row = {'id': n, 'q': {'en': english['q'], lang: target['q']},
                'options': [{'en': a, lang: b} for a, b in zip(english['options'], target['options'])],
                'explanation': {'en': english['explanation'], lang: target['explanation']}, 'answer': 0}
            rows.append(row)
            content = {'english': english, 'target': copy.deepcopy(target), 'answer': 0,
                'grades': [5], 'language': lang, 'source_fact': {'en': 'An object.', 'tl': 'SECRET_NONENGLISH'}}
            ref = {'path': str(self.sourcefile), 'row': n - 1, 'id': n, 'row_hash': R.digest(row)}
            candidate = {'key': 'job-' + str(n), 'content': content, 'refs': [ref],
                'generator_note': 'SECRET_GENERATOR_NOTE', 'prior_audit': 'SECRET_AUDIT'}
            old = copy.deepcopy(candidate); old['content']['target']['q'] = 'OLD_TARGET_PRIVATE'
            self.original.append(old); self.candidates.append(candidate)
        self.sourcefile.write_text(json.dumps(rows))
        self.sourcejobs = self.root / 'original.jsonl'
        self.sourcejobs.write_text(''.join(json.dumps(j) + '\n' for j in self.original))
        self.jobsfile = self.root / 'jobs.jsonl'
        self.jobsfile.write_text(''.join(json.dumps(j) + '\n' for j in self.candidates))
        self.manifest = self.root / 'integration.json'
        self.integration = {'jobs_sha256': R.sha(self.jobsfile), 'source_jobs': str(self.sourcejobs),
            'source_jobs_sha256': R.sha(self.sourcejobs), 'jobs': {j['key']: {
                'source_job_sha256': R.digest(old), 'candidate_target_sha256': R.digest(j['content']['target'])}
                for old, j in zip(self.original, self.candidates)},
            'source_files': {str(self.sourcefile): {'before_sha256': 'historical',
                'after_sha256': R.sha(self.sourcefile), 'backup_path': 'historical'}}}
        R.write(self.manifest, self.integration)
        R.prepare(self.out, self.jobsfile, self.manifest, 151.04344425)
        self.config, self.jobs, self.plan = R.frozen(self.out)
        self.posts = []; self.gets = []

    def network(self, url, data=None, timeout=None):
        if data is not None:
            request = json.loads(data)
            self.posts.append(request)
            return 202, {'id': f'batch-{len(self.posts)}', 'model': R.C.CANONICAL_MODEL,
                'endpoint': '/v1/chat/completions', 'status': 'validating',
                'request_counts': {'total': len(request['requests']), 'completed': 0, 'failed': 0}}
        self.gets.append(url)
        batch_id = url.rsplit('/', 1)[1]
        directory = next(d for d in R.batch_dirs(self.out) if R.read(d / 'accepted.json')['id'] == batch_id)
        return 200, self.terminal(directory)

    def terminal(self, directory):
        envelope = R.read(directory / 'request.json'); accepted = R.read(directory / 'accepted.json')
        rows = envelope['requests']; n = len(rows)
        return {'id': accepted['id'], 'model': R.C.CANONICAL_MODEL, 'endpoint': '/v1/chat/completions',
            'status': 'completed', 'error': None, 'request_counts': {'total': n, 'completed': n, 'failed': 0},
            'usage': {'prompt_tokens': 100 * n, 'completion_tokens': 20 * n, 'cost': .000075 * n, 'is_byok': False},
            'results': [{'custom_id': row['custom_id'], 'response': {'status_code': 200,
                'body': diagnosis(self.jobs[row['custom_id']])}, 'error': None} for row in rows]}

    def submit_canary(self):
        return R.submit(self.out, self.jobs, ['job-1', 'job-2'], network=self.network)

    def finish_canary(self):
        d = self.submit_canary()
        R.write(d / 'terminal.json', self.terminal(d), immutable=True)
        R.collect_terminal(self.out, d, self.jobs)
        proof = R.read(self.out / 'canary-passed.json')
        R.write(self.out / 'CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': proof['terminal_sha256'], 'config_sha256': R.sha(self.out / 'config.json')}, immutable=True)
        return d


class Audit3Tests(OfflineCase):
    def test_original_diagnosis_contract_and_private_prompt_fields(self):
        job = self.jobs['job-1']; original = R.A.payload(R.clean_content(job)); original.pop('provider')
        self.assertEqual(R.payload(job), original)
        body = R.payload(job); user = json.loads(body['messages'][1]['content'])['quiz']
        self.assertEqual(user['target'], job['content']['target'])
        self.assertNotIn('answer', user); self.assertNotIn('provider', body); self.assertNotIn('service_tier', body)
        for secret in ('SECRET_NONENGLISH', 'SECRET_GENERATOR_NOTE', 'SECRET_AUDIT', 'OLD_TARGET_PRIVATE'):
            self.assertNotIn(secret, json.dumps(body))
        self.assertEqual(body['reasoning'], {'effort': 'low', 'exclude': True})
        self.assertEqual(body['max_tokens'], 8000)

    def test_integration_checks_current_source_row_and_target(self):
        R.validate_integration(self.jobsfile, self.manifest, self.jobs)
        changed = copy.deepcopy(self.jobs); changed['job-1']['content']['target']['q'] = 'Changed'
        with self.assertRaisesRegex(ValueError, 'candidate provenance'):
            R.validate_integration(self.jobsfile, self.manifest, changed)
        rows = json.loads(self.sourcefile.read_text()); rows[0]['answer'] = 1
        self.sourcefile.write_text(json.dumps(rows))
        with self.assertRaisesRegex(ValueError, 'source file changed'):
            R.frozen(self.out)
        self.integration['source_files'][str(self.sourcefile)]['after_sha256'] = R.sha(self.sourcefile)
        R.write(self.manifest, self.integration)
        with self.assertRaisesRegex(ValueError, 'source row'):
            R.validate_integration(self.jobsfile, self.manifest, self.jobs)

    def test_frozen_jobs_manifest_and_dependencies_fail_closed(self):
        with mock.patch.object(R, 'dependency_hashes', return_value={}):
            with self.assertRaisesRegex(ValueError, 'Frozen code'):
                R.frozen(self.out)
        self.manifest.write_text(self.manifest.read_text() + ' ')
        with self.assertRaisesRegex(ValueError, 'integration_manifest changed'):
            R.frozen(self.out)

    def test_canary_gates_larger_batches_and_is_locally_releasable(self):
        with self.assertRaisesRegex(ValueError, 'exactly two'):
            R.submit(self.out, self.jobs, ['job-1'], network=self.network)
        d = self.submit_canary()
        with self.assertRaisesRegex(ValueError, 'gate is closed'):
            R.submit(self.out, self.jobs, ['job-3'], network=self.network)
        R.write(d / 'terminal.json', self.terminal(d), immutable=True)
        R.collect_terminal(self.out, d, self.jobs)
        self.assertFalse(R.canary_ready(self.out))
        proof = R.read(self.out / 'canary-passed.json')
        R.write(self.out / 'CANARY-REVIEWED.json', {'approved': True,
            'terminal_sha256': proof['terminal_sha256'], 'config_sha256': R.sha(self.out / 'config.json')})
        self.assertTrue(R.canary_ready(self.out))
        R.submit(self.out, self.jobs, ['job-3'], network=self.network)
        release = R.read(self.out / 'CANARY-REVIEWED.json'); release['terminal_sha256'] = 'wrong'
        R.write(self.out / 'CANARY-REVIEWED.json', release)
        with self.assertRaisesRegex(ValueError, 'not bound'):
            R.canary_ready(self.out)

    def test_first_get_and_each_resumed_get_wait_full_minute(self):
        d = self.submit_canary(); schedule = R.read(d / 'poll.json'); start = schedule['accepted_at']
        self.assertFalse(R.poll_batch(self.out, d, self.jobs, network=self.network, now=start + 59.9))
        self.assertEqual(self.gets, [])
        with mock.patch.object(R.time, 'time', return_value=start + 30):
            R.run(self.out, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1); self.assertEqual(self.gets, [])
        self.assertTrue(R.poll_batch(self.out, d, self.jobs, network=self.network, now=start + 60))
        self.assertEqual(len(self.gets), 1)

    def test_crash_after_acceptance_without_schedule_waits_from_recovery(self):
        d = self.submit_canary(); (d / 'poll.json').unlink()
        self.assertFalse(R.poll_batch(self.out, d, self.jobs, network=self.network, now=1000))
        self.assertEqual(R.read(d / 'poll.json')['next_poll_at'], 1060)
        self.assertFalse(R.poll_batch(self.out, d, self.jobs, network=self.network, now=1059))
        self.assertEqual(self.gets, [])

    def test_collect_only_cannot_post_even_with_untouched_pending_jobs(self):
        d = self.submit_canary(); R.write(d / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        R.run(self.out, collect_only=True, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1); self.assertEqual(len(self.gets), 1)
        self.assertEqual(R.read(self.out / 'report.json')['completed'], 2)
        R.run(self.out, collect_only=True, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1); self.assertEqual(len(self.gets), 1)

    def test_ambiguous_post_blocks_all_further_spending_and_reserves_cost(self):
        def ambiguous(*args, **kwargs):
            raise RuntimeError('Connection ended after POST')
        with self.assertRaisesRegex(RuntimeError, 'Connection ended'):
            R.submit(self.out, self.jobs, ['job-1', 'job-2'], network=ambiguous)
        cost = R.accounting(self.out)
        self.assertGreater(cost['uncertain_charge_reserved_usd'], 0)
        self.assertEqual(cost['received_cost_usd'], 0)
        with self.assertRaisesRegex(ValueError, 'blocked'):
            R.run(self.out, once=True, network=self.network)
        self.assertEqual(self.posts, [])

    def test_mismatched_acceptance_is_saved_but_never_treated_as_retryable(self):
        def wrong(url, data=None, timeout=None):
            code, raw = self.network(url, data, timeout); raw['model'] = 'other/model'; return code, raw
        with self.assertRaisesRegex(ValueError, 'identity'):
            self.submit_with(wrong)
        d = R.batch_dirs(self.out)[0]
        self.assertTrue((d / 'submission-response.json').exists())
        self.assertFalse((d / 'accepted.json').exists())
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            R.check_ledger(self.out, self.jobs)

    def submit_with(self, network):
        return R.submit(self.out, self.jobs, ['job-1', 'job-2'], network=network)

    def test_budget_and_outstanding_window_are_enforced_again_at_submission(self):
        self.finish_canary()
        for n in range(3, 7):
            R.submit(self.out, self.jobs, ['job-' + str(n)], network=self.network)
        self.assertEqual(len(R.active_batches(self.out)), 4)
        with self.assertRaisesRegex(ValueError, 'window is full'):
            R.submit(self.out, self.jobs, ['job-7'], network=self.network)
        cost = R.accounting(self.out)
        self.assertLessEqual(cost['budget_accounted_usd'], 30)
        self.assertLessEqual(cost['combined_accounted_usd'], 250)
        with mock.patch.object(R, 'accounting', return_value={'budget_accounted_usd': 29.999, 'combined_accounted_usd': 249.999}):
            with self.assertRaises(R.BudgetCapacity):
                R.next_keys(self.out, self.jobs, self.plan)

    def test_batch_cost_is_allocated_once_without_forged_response_cost(self):
        d = self.finish_canary(); terminal = R.read(d / 'terminal.json')
        amounts = []
        for key in ('job-1', 'job-2'):
            result = self.out / 'results' / key
            raw = R.read(result / 'response.json')
            self.assertNotIn('cost', raw['usage']); self.assertNotIn('service_tier', raw)
            receipt = R.read(result / 'batch-receipt.json')
            amounts.append(receipt['allocated_received_cost_usd'])
            self.assertEqual(receipt['received_usage']['completion_tokens'], 20)
            self.assertEqual(receipt['received_usage']['reasoning_tokens'], 5)
        self.assertEqual(sum(amounts), terminal['usage']['cost'])
        self.assertEqual(R.accounting(self.out)['received_cost_usd'], terminal['usage']['cost'])
        R.collect_terminal(self.out, d, self.jobs)
        self.assertEqual(R.accounting(self.out)['received_cost_usd'], terminal['usage']['cost'])

    def test_billing_provenance_and_price_caps_fail_closed(self):
        d = self.submit_canary(); good = self.terminal(d)
        for mutate in (lambda x: x['usage'].update(is_byok=True),
                       lambda x: x['usage'].update(cost=.5),
                       lambda x: x.update(id='different-batch'),
                       lambda x: x['results'][0].update(custom_id='unknown')):
            raw = copy.deepcopy(good); mutate(raw); R.write(d / 'terminal.json', raw)
            with self.assertRaises(ValueError):
                R.collect_terminal(self.out, d, self.jobs)
            self.assertFalse((d / 'billing.json').exists())
            self.assertGreater(R.accounting(self.out)['uncertain_charge_reserved_usd'], 0)
        R.write(d / 'terminal.json', good); R.collect_terminal(self.out, d, self.jobs)
        bill = R.read(d / 'billing.json'); bill['received_cost_usd'] = 0; R.write(d / 'billing.json', bill)
        with self.assertRaisesRegex(ValueError, 'billing provenance'):
            R.accounting(self.out)

    def test_independent_polling_collects_other_ids_even_if_one_get_fails(self):
        self.finish_canary()
        first = R.submit(self.out, self.jobs, ['job-3'], network=self.network)
        second = R.submit(self.out, self.jobs, ['job-4'], network=self.network)
        for d in (first, second):
            R.write(d / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        def one_fails(url, data=None, timeout=None):
            if url.endswith('batch-2'):
                raise RuntimeError('HTTP 401: provider auth error')
            return self.network(url, data, timeout)
        with self.assertRaisesRegex(ValueError, '401'):
            R.step(self.out, self.jobs, self.plan, collect_only=True, network=one_fails)
        self.assertTrue((second / 'collected.json').exists())
        self.assertFalse((first / 'collected.json').exists())
        self.assertEqual(len(self.posts), 3)

    def test_transient_visibility_404_uses_get_only_until_narrow_deadline(self):
        d = self.submit_canary(); R.write(d / 'poll.json', {'accepted_at': 1000, 'next_poll_at': 1060})
        def invisible(*args, **kwargs):
            raise RuntimeError('HTTP 404: accepted ID not yet visible')
        self.assertFalse(R.poll_batch(self.out, d, self.jobs, network=invisible, now=1060))
        with self.assertRaisesRegex(RuntimeError, '404'):
            R.poll_batch(self.out, d, self.jobs, network=invisible, now=1961)
        self.assertEqual(len(self.posts), 1)

    def test_stop_drains_accepted_work_without_submitting_pending(self):
        self.submit_canary(); (self.out / 'STOP').touch()
        d = R.batch_dirs(self.out)[0]; R.write(d / 'poll.json', {'accepted_at': 0, 'next_poll_at': 0})
        process = R.run(self.out, once=True, network=self.network)
        self.assertEqual(process['remote_batches_pending'], 0)
        self.assertEqual(len(self.posts), 1); self.assertEqual(len(self.gets), 1)
        self.assertEqual(R.read(self.out / 'report.json')['counts']['unsubmitted'], 10)

    def test_invalid_canary_json_is_quarantined_and_cannot_release(self):
        d = self.submit_canary(); raw = self.terminal(d)
        raw['results'][0]['response']['body']['choices'][0]['message']['content'] = '{}'
        R.write(d / 'terminal.json', raw)
        with self.assertRaisesRegex(ValueError, 'canary failed'):
            R.collect_terminal(self.out, d, self.jobs)
        self.assertTrue((self.out / 'results/job-1/error.json').exists())
        self.assertFalse((self.out / 'canary-passed.json').exists())
        self.assertEqual(R.accounting(self.out)['received_cost_usd'], raw['usage']['cost'])
        report = R.report(self.out, self.jobs)
        self.assertEqual(report['counts']['errors'], 1)
        self.assertEqual(report['counts']['pass'], 1)

    def test_wrong_answer_is_content_review_not_request_failure(self):
        d = self.submit_canary(); raw = self.terminal(d)
        message = raw['results'][0]['response']['body']['choices'][0]['message']
        value = json.loads(message['content']); value['correct_index'] = 1; message['content'] = json.dumps(value)
        R.write(d / 'terminal.json', raw); R.collect_terminal(self.out, d, self.jobs)
        report = R.report(self.out, self.jobs)
        self.assertEqual(report['counts']['needs_review'], 1)
        self.assertEqual(report['counts']['errors'], 0)

    def test_receipt_or_final_tampering_is_rejected_without_replacing_artifacts(self):
        d = self.finish_canary()
        path = self.out / 'results/job-1/batch-receipt.json'
        receipt = R.read(path); receipt['allocated_received_cost_usd'] = 99
        R.write(path, receipt)
        with self.assertRaisesRegex(ValueError, 'Conflicting immutable'):
            R.collect_terminal(self.out, d, self.jobs)
        self.assertEqual(R.read(path)['allocated_received_cost_usd'], 99)
        self.assertFalse((self.out / 'results/job-1/error.json').exists())

    def test_schema_groups_never_mix_different_option_counts(self):
        self.finish_canary()
        job = copy.deepcopy(self.jobs['job-3'])
        job['content']['english']['options'].append('Other')
        job['content']['target']['options'].append('Iba')
        mixed = {**self.jobs, 'job-3': job}
        with self.assertRaisesRegex(ValueError, 'response_format must be identical'):
            R.submit(self.out, mixed, ['job-3', 'job-4'], network=self.network)
        self.assertEqual(len(self.posts), 1)

    def test_signal_stops_admission_between_cloud_uploads(self):
        self.finish_canary()
        seen = []
        def stopped():
            seen.append(True)
            return len(seen) >= 3
        keys = [['job-3'], ['job-4'], ['job-5']]
        with mock.patch.object(R, 'next_keys', side_effect=keys):
            R.step(self.out, self.jobs, self.plan, network=self.network, should_stop=stopped)
        self.assertEqual(len(self.posts), 2)
        self.assertEqual(len(R.active_batches(self.out)), 1)

    def test_lock_excludes_another_runner_and_collection_process(self):
        with R.exclusive_lock(self.out):
            with self.assertRaises(BlockingIOError):
                with R.exclusive_lock(self.out):
                    self.fail('second process acquired active run lock')

    def test_orphan_local_preparation_stops_before_spending(self):
        d = self.submit_canary()
        (d / 'submission-intent.json').unlink()
        with self.assertRaisesRegex(ValueError, 'Incomplete local batch'):
            R.check_ledger(self.out, self.jobs)
        self.assertEqual(len(self.posts), 1)

    def test_persistent_guard_detects_three_consecutive_even_before_later_successes(self):
        self.finish_canary()
        directory = self.out / 'batches/000002'
        R.write(directory / 'manifest.json', {'keys': ['job-3', 'job-4', 'job-5', 'job-6']})
        R.write(directory / 'collected.json', {'jobs': 4})
        for key in ('job-3', 'job-4', 'job-5'):
            R.write(self.out / 'results' / key / 'error.json', {'error': 'technical'})
        R.write(self.out / 'results/job-6/final.json', {'status': 'source_issue'})
        state = R.failure_state(self.out)
        self.assertEqual(state['consecutive_errors'], 0)
        self.assertEqual(state['first_trigger_at_closed_request'], 5)
        self.assertTrue(state['threshold_reached'])
        with self.assertRaisesRegex(ValueError, 'Persistent technical failure'):
            R.guard_admission(self.out)
        self.assertTrue((self.out / 'BLOCKED.json').exists())
        with self.assertRaisesRegex(ValueError, 'blocked'):
            R.run(self.out, once=True, network=self.network)
        self.assertEqual(len(self.posts), 1)

    def test_guard_uses_manifest_order_and_does_not_count_model_uncertainty(self):
        directory = self.out / 'batches/000001'
        keys = ['key-' + str(i) for i in range(100)]
        R.write(directory / 'manifest.json', {'keys': keys})
        R.write(directory / 'collected.json', {'jobs': 100})
        # Deliberately create files in reverse order; only sealed order matters.
        for i in reversed(range(100)):
            d = self.out / 'results' / keys[i]
            if i % 10 == 0:
                R.write(d / 'error.json', {'error': 'technical'})
            else:
                R.write(d / 'final.json', {'status': 'needs_review' if i % 2 else 'source_issue'})
        state = R.failure_state(self.out)
        self.assertEqual(state['latest_errors'], 10)
        self.assertEqual(state['first_trigger_at_closed_request'], 91)
        self.assertEqual(state['consecutive_errors'], 0)
        self.assertTrue(state['threshold_reached'])
        (self.out / 'results/key-0/error.json').unlink()
        R.write(self.out / 'results/key-0/final.json', {'status': 'needs_review'})
        self.assertFalse(R.failure_state(self.out)['threshold_reached'])

    def test_process_identity_preserves_python_interpreter_flags(self):
        original = ['python3', '-B', str(Path(R.__file__).resolve()), 'collect', '--out', str(self.out), '--once']
        with mock.patch.object(R.sys, 'orig_argv', original):
            process = R.run(self.out, collect_only=True, once=True, network=self.network)
        self.assertEqual(process['original_argv'], original)
        self.assertEqual(process['exact_command'], R.shlex.join(original))
        self.assertEqual(self.posts, [])

    def test_report_distinguishes_all_valid_and_decisive_denominators(self):
        for key, status in zip(list(self.jobs)[:4], ('pass', 'flagged', 'needs_review', 'source_issue')):
            R.write(self.out / 'results' / key / 'final.json',
                    {'status': status, 'answer_matches': True, 'diagnosis': {}})
        report = R.report(self.out, self.jobs)
        self.assertEqual(report['all_valid_content_flag_rate'], .25)
        self.assertEqual(report['decisive_content_flag_rate'], .5)
        self.assertEqual(report['technical_failure_guard']['latest_errors'], 0)

    def test_duplicate_diagnosis_json_keys_are_not_accepted(self):
        d = self.submit_canary(); raw = self.terminal(d)
        message = raw['results'][0]['response']['body']['choices'][0]['message']
        message['content'] = message['content'][:-1] + ',"verdict":"pass"}'
        R.write(d / 'terminal.json', raw)
        with self.assertRaisesRegex(ValueError, 'canary failed'):
            R.collect_terminal(self.out, d, self.jobs)


if __name__ == '__main__':
    unittest.main()
