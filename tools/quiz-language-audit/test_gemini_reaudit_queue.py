"""Offline provenance, measurement, and spending guards for Fresh-1 -> Audit-2."""
import concurrent.futures
import copy
import io
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

import fresh_result_selection as selection
import gemini_flex_auditor as flex
import gemini_reaudit_queue as reaudit
import gemini_translation_queue as fresh_queue
import gemini_translator as translator

from test_gemini_translation_queue import job, provider_response, put


def fresh_job(source=None):
    result = copy.deepcopy(source or job())
    result['content']['target'] = json.loads(
        provider_response()['choices'][0]['message']['content'])['proposed']
    return result


def audit_response(item, status='pass', correct_index=None, quote=None):
    content = item['job']['content']
    checks = {field: {'status': 'ok', 'quote': '', 'finding': ''}
              for field in ('q', 'options[0]', 'options[1]', 'options[2]', 'explanation')}
    if status in ('flagged', 'needs_review'):
        checks['q'] = {
            'status': 'issue' if status == 'flagged' else 'uncertain',
            'quote': quote or content['target']['q'], 'finding': 'Fixture diagnosis evidence.'}
    diagnosis = {'checks': checks, 'correct_index': content['answer'] if correct_index is None else correct_index,
                 'verdict': {'pass': 'pass', 'flagged': 'fix', 'needs_review': 'uncertain',
                             'source_issue': 'source_issue'}[status],
                 'whole_quiz': {'status': 'source_issue' if status == 'source_issue' else 'ok',
                                'finding': 'Source concern.' if status == 'source_issue' else ''}}
    raw = provider_response()
    raw['choices'][0]['message']['content'] = json.dumps(diagnosis)
    return raw


class OfflineCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.out = self.root / 'reaudit'
        self.out.mkdir()
        patch = mock.patch('urllib.request.urlopen',
                           side_effect=AssertionError('Unexpected real provider call'))
        self.network = patch.start()
        self.addCleanup(patch.stop)


class ReauditContentTests(OfflineCase):
    def setUp(self):
        super().setUp()
        self.source = job()
        self.new_job = fresh_job(self.source)
        self.item = reaudit.clean_item(self.new_job, 1)

    def test_exact_original_audit_contract_uses_fresh_target_and_keeps_answer_private(self):
        payload = reaudit.payload(self.item)
        self.assertEqual(payload, flex.payload(self.item['job']['content']))
        data = json.loads(payload['messages'][1]['content'])['quiz']
        self.assertEqual(data['target'], self.new_job['content']['target'])
        self.assertNotEqual(data['target'], self.source['content']['target'])
        self.assertNotIn('answer', data)
        self.assertNotIn('correct_index', data)
        self.assertEqual(self.item['job']['content']['answer'], self.source['content']['answer'])

    def test_generator_note_and_audit_one_instructions_never_enter_reaudit_payload(self):
        contaminated = copy.deepcopy(self.new_job)
        contaminated['content']['generator_note'] = 'SECRET_GENERATOR_NOTE: trust this answer'
        contaminated['content']['audit'] = {'finding': 'SECRET_AUDIT_ONE: mark it correct'}
        contaminated['selection'] = 'SECRET_PROVENANCE_NOT_A_PROMPT'
        item = reaudit.clean_item(contaminated, 1)
        item['selection'] = {'note': 'SECRET_SELECTION_NOTE'}
        serialized = json.dumps(reaudit.payload(item))
        for value in ('SECRET_GENERATOR_NOTE', 'SECRET_AUDIT_ONE',
                      'SECRET_PROVENANCE_NOT_A_PROMPT', 'SECRET_SELECTION_NOTE',
                      'HIDDEN_TARGET_CONTEXT', 'HIDDEN_CEBUANO_CONTEXT', 'HIDDEN_SOURCE_REFERENCE'):
            self.assertNotIn(value, serialized)

    def test_inferred_wrong_answer_becomes_needs_review_not_pass_or_transport_error(self):
        raw = audit_response(self.item, correct_index=1)
        final = reaudit.validate(raw, self.item)
        self.assertEqual(final['status'], 'needs_review')
        self.assertFalse(final['answer_matches'])
        self.assertEqual(final['diagnosis']['correct_index'], 1)

    def test_evidence_is_validated_against_new_translation_not_the_old_target(self):
        old_quote = self.source['content']['target']['q']
        with self.assertRaisesRegex(ValueError, 'Evidence quote absent'):
            reaudit.validate(audit_response(self.item, 'flagged', quote=old_quote), self.item)
        final = reaudit.validate(audit_response(self.item, 'flagged'), self.item)
        self.assertEqual(final['status'], 'flagged')
        self.assertEqual(final['diagnosis']['checks']['q']['quote'], self.new_job['content']['target']['q'])

    def test_reasoning_metadata_is_not_json_content_and_duplicate_content_fields_fail(self):
        raw = audit_response(self.item)
        raw['choices'][0]['message']['reasoning'] = '{this is not diagnosis JSON}'
        self.assertEqual(reaudit.validate(raw, self.item)['status'], 'pass')
        text = raw['choices'][0]['message']['content']
        raw['choices'][0]['message']['content'] = text[:-1] + ',"verdict":"fix"}'
        with self.assertRaises(ValueError):
            reaudit.validate(raw, self.item)


class PipelineFixture(OfflineCase):
    def setUp(self):
        super().setUp()
        self.sources = [job(number, 'tl' if number <= 6 else 'bis') for number in range(1, 13)]
        self.jobs = self.root / 'jobs.jsonl'
        self.jobs.write_text(''.join(json.dumps(value) + '\n' for value in self.sources))
        self.snapshot = fresh_queue.load_snapshot(self.jobs)
        self.fresh = self.root / 'fresh'
        (self.fresh / 'results').mkdir(parents=True)
        self.fresh_prompt = 'Translate only the English into clear learner-friendly language.'
        (self.fresh / 'prompt.txt').write_text(self.fresh_prompt)
        put(self.fresh / 'config.json', {
            'jobs_sha256': fresh_queue.file_sha(self.jobs),
            'prompt_sha256': translator.digest(self.fresh_prompt),
            'model': translator.MODEL, 'service_tier': 'flex'})
        fresh_queue.ingest(self.fresh, self.snapshot, [
            {'key': source['key'], 'job': source,
             'selection': {'audit_path': 'PRIVATE_AUDIT_ONE_PATH',
                           'audit_sha256': 'PRIVATE_AUDIT_ONE_HASH', 'issue_fields': ['q'],
                           'reason': 'PRIVATE_AUDIT_ONE_DIAGNOSIS'}} for source in self.sources], self.fresh_prompt)
        self.fresh_entries = fresh_queue.load_entries(self.fresh)
        put(self.fresh / 'process.json', {'status': 'finished'})
        self.args = SimpleNamespace(
            jobs=self.jobs, fresh_out=self.fresh, fresh_process=self.fresh / 'process.json',
            out=self.out, prompt_file=None, budget=30., concurrency=2, batch_size=2,
            poll_seconds=60, limit=None, other_budget_log=[], combined_budget=None)

    def produce(self, number, status='proposal'):
        entry = self.fresh_entries[number - 1]
        result = translator.directory(self.fresh, entry)
        request = translator.payload(entry, self.fresh_prompt)
        put(result / 'request.json', request)
        put(result / 'started.json', {'reserved_usd': translator.reservation(request)})
        if status in ('pending', 'error'):
            if status == 'error':
                put(result / 'error.json', {'error': 'Unknown provider outcome', 'fatal': False})
            return result
        raw = provider_response()
        raw['model'] = translator.MODEL
        parsed = json.loads(raw['choices'][0]['message']['content'])
        parsed['note'] = 'PRIVATE_GENERATOR_CONFIDENCE: perfectly translated'
        if status == 'held':
            parsed.update(status='hold', proposed=None)
        raw['choices'][0]['message']['content'] = json.dumps(parsed)
        put(result / 'response.json', raw)
        final = translator.validate(raw, entry)
        if status == 'rejected':
            final = {'status': 'rejected', 'reason': 'Invalid translation schema',
                     'changes': [], 'result': None}
        put(result / 'final.json', final)
        return result

    def select(self, seen=None):
        return selection.ingest_candidates(self.jobs, self.fresh, seen or set())

    def prepared(self, count):
        for number in range(1, count + 1):
            self.produce(number)
        candidates, _ = self.select()
        reaudit.ingest(self.out, self.snapshot, candidates, reaudit.PROMPT)
        entries = reaudit.load_entries(self.out)
        batches = reaudit.seal_batches(self.out, entries, reaudit.PROMPT, 2, allow_partial=True)
        return entries, batches


class FreshProvenanceTests(PipelineFixture):
    def test_verified_proposal_replaces_old_target_and_keeps_original_identity(self):
        result = self.produce(1)
        candidates, _ = self.select()
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual(candidate['key'], self.sources[0]['key'])
        self.assertEqual(candidate['sample_id'], 1)
        self.assertEqual(candidate['job']['content']['answer'], self.sources[0]['content']['answer'])
        final = translator.read(result / 'final.json')
        self.assertEqual(candidate['job']['content']['target'], final['result']['proposed'])
        self.assertEqual(candidate['selection']['fresh_final_sha256'], fresh_queue.file_sha(result / 'final.json'))
        serialized = json.dumps(reaudit.payload(reaudit.clean_item(candidate['job'], 1)))
        for marker in ('PRIVATE_GENERATOR_CONFIDENCE', 'PRIVATE_AUDIT_ONE_DIAGNOSIS',
                       'HIDDEN_TARGET_CONTEXT', self.sources[0]['content']['target']['q']):
            self.assertNotIn(marker, serialized)

    def test_held_rejected_error_and_unfinished_outputs_are_not_candidates(self):
        for number, status in enumerate(('proposal', 'held', 'rejected', 'error', 'pending'), 1):
            self.produce(number, status)
        candidates, _ = self.select()
        self.assertEqual([item['sample_id'] for item in candidates], [1])

    def test_mutated_final_raw_billing_and_request_provenance_fail_closed(self):
        first, second, third = [self.produce(number) for number in (1, 2, 3)]
        final = translator.read(first / 'final.json')
        final['result']['proposed']['q'] = 'Edited after provider output'
        put(first / 'final.json', final)
        raw = translator.read(second / 'response.json')
        raw['service_tier'] = 'default'
        put(second / 'response.json', raw)
        request = translator.read(third / 'request.json')
        request['messages'][0]['content'] = 'Unapproved prompt'
        put(third / 'request.json', request)
        candidates, summary = self.select()
        self.assertEqual(candidates, [])
        self.assertTrue({source['key'] for source in self.sources[:3]} <= set(summary['blocked_keys']))

    def test_queue_source_hash_and_identity_cannot_be_forged(self):
        self.produce(1)
        entry_path = self.fresh / 'queue' / '1.json'
        entry = translator.read(entry_path)
        entry['source_job_sha256'] = '0' * 64
        put(entry_path, entry)
        candidates, summary = self.select()
        self.assertEqual(candidates, [])
        self.assertIn(self.sources[0]['key'], summary['blocked_keys'])

    def test_active_error_coexisting_with_a_proposal_is_not_a_success(self):
        result = self.produce(1)
        put(result / 'error.json', {'error': 'Unreconciled upstream failure'})
        candidates, summary = self.select()
        self.assertEqual(candidates, [])
        self.assertIn(self.sources[0]['key'], summary['blocked_keys'])

    def test_cached_verification_does_not_hide_late_source_hold_for_seen_key(self):
        self.produce(1)
        first, _ = self.select()
        self.assertEqual(len(first), 1)
        key = first[0]['key']
        put(self.fresh / 'source-blocks.json', {key: 'Late English source defect'})
        newer, summary = self.select({key})
        self.assertEqual(newer, [])
        self.assertIn(key, summary['blocked_keys'])

    def test_repeated_polls_deduplicate_and_discover_new_outputs_before_producer_finishes(self):
        put(self.fresh / 'process.json', {'status': 'running', 'pid': 12345})
        self.produce(1)
        first, _ = self.select()
        seen = {item['key'] for item in first}
        self.assertEqual(len(first), 1)
        self.assertEqual(self.select(seen)[0], [])
        self.produce(2)
        second, _ = self.select(seen)
        self.assertEqual([item['sample_id'] for item in second], [2])
        reaudit.ingest(self.out, self.snapshot, first + second, reaudit.PROMPT)
        restored_seen = {entry['job']['key'] for entry in reaudit.load_entries(self.out)}
        self.assertEqual(self.select(restored_seen)[0], [])

    def test_export_reports_are_not_selection_inputs_and_empty_live_output_is_valid(self):
        put(self.fresh / 'summary.json', {'counts': {'proposal': 999}})
        (self.fresh / 'proposals.jsonl').write_text(json.dumps({'sample_id': 1, 'status': 'proposal'}) + '\n')
        self.assertEqual(self.select()[0], [])

    def test_frozen_fresh_prompt_and_snapshot_are_required(self):
        self.produce(1)
        (self.fresh / 'prompt.txt').write_text('Changed fresh prompt')
        with self.assertRaisesRegex(ValueError, 'frozen configuration'):
            self.select()


class ReauditPersistenceTests(PipelineFixture):
    def test_valid_fresh_card_can_replace_malformed_obsolete_target(self):
        source = copy.deepcopy(self.sources[0])
        source['content']['target'] = {'q': '', 'options': [], 'explanation': ''}
        snapshot = {source['key']: {'sample_id': 1, 'job': source}}
        candidate = {'key': source['key'], 'sample_id': 1,
                     'job': fresh_job(source), 'selection': {}}
        self.assertEqual(reaudit.ingest(self.out, snapshot, [candidate], reaudit.PROMPT), 1)
        reaudit.validate_entries(reaudit.load_entries(self.out), snapshot, reaudit.PROMPT)

    def test_ingest_deduplicates_and_rejects_changed_original_answer_or_english(self):
        self.produce(1)
        candidates, _ = self.select()
        self.assertEqual(reaudit.ingest(self.out, self.snapshot, candidates * 2, reaudit.PROMPT), 1)
        self.assertEqual(reaudit.ingest(self.out, self.snapshot, candidates, reaudit.PROMPT), 0)
        for field, value in (('answer', 1), ('english', {'q': 'Changed', 'options': ['A', 'B', 'C'], 'explanation': 'Changed'})):
            with self.subTest(field=field):
                bad = copy.deepcopy(candidates[0])
                bad['job']['content'][field] = value
                with self.assertRaisesRegex(ValueError, 'original English'):
                    reaudit.ingest(self.out, self.snapshot, [bad], reaudit.PROMPT)

    def test_persisted_proposal_or_provenance_edits_are_rejected_before_resume(self):
        entries, _ = self.prepared(1)
        reaudit.validate_entries(entries, self.snapshot, reaudit.PROMPT)
        for mutation in ('target', 'selection'):
            with self.subTest(mutation=mutation):
                changed = copy.deepcopy(entries)
                if mutation == 'target':
                    changed[0]['job']['content']['target']['q'] = 'Changed selected proposal'
                else:
                    changed[0]['selection']['fresh_final_sha256'] = 'changed'
                with self.assertRaisesRegex(ValueError, 'provenance changed'):
                    reaudit.validate_entries(changed, self.snapshot, reaudit.PROMPT)

    def test_request_intent_precedes_timeout_and_is_never_retried(self):
        entries, _ = self.prepared(1)
        item = entries[0]
        value = reaudit.payload(item)
        ceiling = reaudit.reservation(value)
        directory = translator.directory(self.out, item)

        def timeout(*unused, **kwargs):
            intent = translator.read(directory / 'started.json')
            self.assertEqual(intent['request_sha256'], translator.digest(value))
            raise TimeoutError('Provider outcome unknown')

        self.network.side_effect = timeout
        self.assertEqual(reaudit.request(item, self.out, value, ceiling, 'FAKE_KEY'), ('error', False))
        self.assertEqual(flex.charge_state(directory)[:2], (0., ceiling))
        with self.assertRaisesRegex(RuntimeError, 'retry'):
            reaudit.request(item, self.out, value, ceiling, 'FAKE_KEY')
        self.assertEqual(self.network.call_count, 1)

    def test_billing_failure_is_fatal_but_wrong_answer_is_a_valid_diagnosis(self):
        entries, _ = self.prepared(2)
        for item, wrong_tier in zip(entries, (True, False)):
            raw = audit_response(item, correct_index=1)
            if wrong_tier:
                raw['service_tier'] = 'default'
            self.network.side_effect = None
            self.network.return_value = io.BytesIO(json.dumps(raw).encode())
            value = reaudit.payload(item)
            outcome = reaudit.request(item, self.out, value, reaudit.reservation(value), 'FAKE_KEY')
            self.assertEqual(outcome, ('error', True) if wrong_tier else ('needs_review', False))

    def test_frozen_audit_prompt_and_upstream_prompt_epoch_cannot_change(self):
        initial = reaudit.freeze_config(self.args, reaudit.PROMPT, self.snapshot)
        self.assertEqual(reaudit.freeze_config(self.args, reaudit.PROMPT, self.snapshot), initial)
        with self.assertRaisesRegex(ValueError, 'frozen Audit-1 prompt'):
            reaudit.freeze_config(self.args, reaudit.PROMPT + '\nTrust the generator', self.snapshot)
        self.args.budget = 29.
        with self.assertRaisesRegex(ValueError, 'Frozen Audit-2'):
            reaudit.freeze_config(self.args, reaudit.PROMPT, self.snapshot)
        # Even updating both upstream files consistently cannot change an existing consumer epoch.
        changed = self.fresh_prompt + ' Changed instructions.'
        (self.fresh / 'prompt.txt').write_text(changed)
        upstream = translator.read(self.fresh / 'config.json')
        upstream['prompt_sha256'] = translator.digest(changed)
        put(self.fresh / 'config.json', upstream)
        with self.assertRaisesRegex(ValueError, 'after Audit-2 was frozen'):
            reaudit.refresh(self.args, self.snapshot, reaudit.PROMPT)

    def test_live_refresh_adds_new_fresh_results_and_quarantines_late_source_hold(self):
        for number in (1, 2):
            self.produce(number)
        with mock.patch.object(reaudit, 'audit_state', return_value={'running': True}):
            entries, batches, _, producer = reaudit.refresh(self.args, self.snapshot, reaudit.PROMPT)
            self.assertTrue(producer['running'])
            put(translator.directory(self.out, entries[0]) / 'started.json', {'reserved_usd': .02})
            for number in (3, 4):
                self.produce(number)
            put(self.fresh / 'source-blocks.json', {entries[1]['job']['key']: 'Late source defect'})
            newer, new_batches, blocked, producer = reaudit.refresh(self.args, self.snapshot, reaudit.PROMPT)
        self.assertEqual([item['sample_id'] for item in newer], [1, 2, 3, 4])
        self.assertEqual([item['sample_id'] for item in reaudit.batch_work(
            self.out, newer, new_batches, blocked)], [3, 4])
        self.assertTrue(producer['running'])
        self.assertEqual(len(batches), 1)


class ReauditMeasurementTests(PipelineFixture):
    def test_language_rates_keep_uncertainty_source_issues_and_errors_in_distinct_denominators(self):
        entries, _ = self.prepared(12)
        statuses = ['pass', 'flagged', 'needs_review', 'source_issue', 'transport', 'pending',
                    'pass', 'pass', 'flagged', 'response_validation', 'pass', 'pending']
        original_finals = {}
        for item, status in zip(entries, statuses):
            directory = translator.directory(self.out, item)
            if status in reaudit.VALID:
                raw = audit_response(item, status)
                put(directory / 'response.json', raw)
                put(directory / 'final.json', reaudit.validate(raw, item))
                original_finals[directory / 'final.json'] = (directory / 'final.json').read_bytes()
            elif status != 'pending':
                put(directory / 'started.json', {'reserved_usd': .02})
                put(directory / 'error.json', {'kind': status, 'error': 'Fixture error', 'fatal': False})
        blocked = {entries[10]['job']['key']: 'Late English issue, independently identified'}
        summary = reaudit.report(self.out, entries, blocked, budget=30.)
        rates = summary['rates']
        self.assertEqual(rates['eligible_valid_denominator'], 7)
        self.assertAlmostEqual(rates['pass_rate'], 3 / 7)
        self.assertAlmostEqual(rates['flag_rate'], 2 / 7)
        self.assertAlmostEqual(rates['nonpass_rate'], 4 / 7)
        self.assertAlmostEqual(rates['decisive_language_issue_rate'], 2 / 5)
        self.assertEqual(rates['terminal_attempts'], 10)
        self.assertAlmostEqual(rates['technical_error_rate'], 2 / 10)
        self.assertEqual(summary['counts']['pending'], 2)
        self.assertEqual(summary['counts']['requires_source_review'], 1)
        self.assertEqual(summary['raw_counts']['pass'], 4)
        self.assertEqual(summary['received_usage']['completion_tokens'], 8 * 300)
        self.assertAlmostEqual(summary['uncertain_and_active_reserved_usd'], .04)
        for language, denominator, passes, flags in (('tl', 4, 1, 1), ('bis', 3, 2, 1)):
            with self.subTest(language=language):
                language_rates = summary['by_language'][language]['rates']
                self.assertEqual(language_rates['eligible_valid_denominator'], denominator)
                self.assertAlmostEqual(language_rates['pass_rate'], passes / denominator)
                self.assertAlmostEqual(language_rates['flag_rate'], flags / denominator)
                self.assertAlmostEqual(language_rates['technical_error_rate'], .2)
        exported = [json.loads(line) for line in (self.out / 'diagnoses.jsonl').read_text().splitlines()]
        held = next(record for record in exported if record['sample_id'] == 11)
        self.assertEqual((held['status'], held['raw_status']), ('requires_source_review', 'pass'))
        for path, original in original_finals.items():
            self.assertEqual(path.read_bytes(), original)

    def test_empty_quality_denominator_is_unknown_and_diagnosed_issues_are_not_request_failures(self):
        rates = reaudit.rates({'pending': 40, 'source_held': 5})
        for name in ('pass_rate', 'flag_rate', 'nonpass_rate',
                     'decisive_language_issue_rate', 'technical_error_rate'):
            self.assertIsNone(rates[name])
        entries, _ = self.prepared(4)
        for item, status in zip(entries, ('flagged', 'needs_review', 'source_issue', 'flagged')):
            put(self.out / 'outcomes' / f"{item['sample_id']}.json", {
                'time': item['sample_id'], 'status': status, 'fatal': False})
        state = reaudit.failure_state(self.out, entries)
        self.assertEqual(state['errors'], 0)
        self.assertFalse(reaudit.stopped_for_failures(state))


class ReauditCoordinatorTests(PipelineFixture):
    def fake_run(self, entries, batches, statuses, blocked=None):
        """Run the actual coordinator with durable, deterministic fake provider outcomes."""
        scheduled, rounds, calls = [], [], []
        outcomes = iter(statuses)
        blocked = blocked or {}

        class DeferredPool:
            def __init__(self, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *unused):
                pass

            def submit(self, function, *values):
                future = concurrent.futures.Future()
                scheduled.append((future, function, values))
                return future

        def request(item, out, payload, ceiling, credential):
            calls.append(item['sample_id'])
            status, fatal = next(outcomes)
            directory = translator.directory(out, item)
            put(directory / 'request.json', payload)
            put(directory / 'started.json', {'reserved_usd': ceiling})
            if status == 'error':
                put(directory / 'error.json', {'kind': 'transport', 'error': 'Fixture timeout',
                                               'fatal': fatal, 'time': len(calls)})
            else:
                raw = audit_response(item, status)
                put(directory / 'response.json', raw)
                put(directory / 'final.json', reaudit.validate(raw, item))
            return status, fatal

        def finish(active, **kwargs):
            pending, scheduled[:] = list(scheduled), []
            rounds.append(len(pending))
            for future, function, values in pending:
                future.set_result(function(*values))
            return set(active), set()

        with mock.patch.object(reaudit.concurrent.futures, 'ThreadPoolExecutor', DeferredPool), \
                mock.patch.object(reaudit.concurrent.futures, 'wait', side_effect=finish), \
                mock.patch.object(reaudit, 'request', side_effect=request), \
                mock.patch.object(translator, 'credential', return_value='FAKE_KEY'), \
                mock.patch.object(reaudit.signal, 'signal'), \
                mock.patch.object(reaudit, 'refresh', return_value=(entries, batches, blocked, {'running': False})), \
                mock.patch.object(reaudit.time, 'sleep', side_effect=AssertionError('Unexpected sleep')), \
                mock.patch('sys.stdout', new=io.StringIO()):
            summary = reaudit.run(self.args, self.snapshot, reaudit.PROMPT,
                                  entries, batches, blocked, {'running': False})
        self.network.assert_not_called()
        return summary, rounds, calls

    def test_inflight_reservations_limit_dispatch_then_received_cost_releases_capacity(self):
        entries, batches = self.prepared(2)
        self.args.budget = max(reaudit.reservation(reaudit.payload(item)) for item in entries) * 1.5
        summary, rounds, calls = self.fake_run(entries, batches, [('pass', False)] * 2)
        self.assertEqual(rounds, [1, 1])
        self.assertEqual(calls, [1, 2])
        self.assertEqual(summary['counts']['pass'], 2)

    def test_fatal_failure_stops_new_dispatch_and_refuses_restart(self):
        entries, batches = self.prepared(3)
        self.args.concurrency = 1
        summary, _, calls = self.fake_run(entries, batches, [('error', True)])
        self.assertEqual(calls, [1])
        self.assertEqual(summary['counts']['pending'], 2)
        with self.assertRaisesRegex(ValueError, 'failure threshold'):
            self.fake_run(entries, batches, [])

    def test_three_consecutive_unknown_charge_errors_stop_before_fourth_request(self):
        entries, batches = self.prepared(4)
        self.args.concurrency = 1
        summary, _, calls = self.fake_run(entries, batches, [('error', False)] * 3)
        self.assertEqual(calls, [1, 2, 3])
        self.assertEqual(summary['counts']['pending'], 1)
        self.assertGreater(summary['uncertain_and_active_reserved_usd'], 0)

    def test_restart_skips_durable_unknown_attempt_and_does_not_repeat_completed_job(self):
        entries, batches = self.prepared(3)
        put(translator.directory(self.out, entries[0]) / 'started.json', {'reserved_usd': .02})
        self.args.concurrency, self.args.limit = 1, 1
        _, _, first = self.fake_run(entries, batches, [('flagged', False)])
        summary, _, second = self.fake_run(entries, batches, [('pass', False)])
        self.assertEqual(first, [2])
        self.assertEqual(second, [3])
        self.assertEqual(summary['counts']['interrupted'], 1)
        self.assertEqual(summary['uncertain_and_active_reserved_usd'], .02)

    def test_combined_guard_counts_audit_one_fresh_one_and_audit_two_unknown_spend(self):
        entries, batches = self.prepared(2)
        put(translator.directory(self.out, entries[0]) / 'started.json', {'reserved_usd': .5})
        logs = [self.root / 'audit-one.log', self.root / 'fresh-one.log']
        for path, accounted, inflight in ((logs[0], 119., .5), (logs[1], 29.5, .5)):
            path.write_text(json.dumps({'time': time.time(), 'accounted_usd': accounted,
                                        'inflight_reserved_usd': inflight}) + '\n')
        self.args.other_budget_log, self.args.combined_budget = logs, 150.
        summary, _, calls = self.fake_run(entries, batches, [])
        self.assertEqual(calls, [])
        self.assertEqual(summary['counts']['pending'], 1)
        self.assertIn('combined pipeline budget', translator.read(self.out / 'process.json')['reason'])

    def test_stop_and_late_source_hold_block_dispatch(self):
        entries, batches = self.prepared(2)
        (self.out / 'STOP').touch()
        with mock.patch.object(translator, 'credential', side_effect=AssertionError('Too late')):
            with self.assertRaisesRegex(ValueError, 'STOP sentinel'):
                reaudit.run(self.args, self.snapshot, reaudit.PROMPT,
                            entries, batches, {}, {'running': False})
        (self.out / 'STOP').unlink()
        summary, _, calls = self.fake_run(entries, batches, [('pass', False)],
                                          blocked={entries[0]['job']['key']: 'Late source defect'})
        self.assertEqual(calls, [2])
        self.assertEqual(summary['counts']['source_held'], 1)


if __name__ == '__main__':
    unittest.main()
