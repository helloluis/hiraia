import copy
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.target = {'q': 'Unsa?', 'options': ['Usa', 'Duha', 'Tulo'], 'explanation': 'Usa kini.'}
        self.job = {'key': 'a'*64, 'content': {'language': 'bis', 'english': self.target,
                    'target': self.target, 'answer': 0}, 'preflight': [], 'refs': []}
        self.args = SimpleNamespace(pass_sample=0)
        self.fixed = {**self.target, 'q': 'Unsa kini?'}
        self.fix = {'verdict': 'fix', 'severity': 'major', 'issues': ['q: mistranslation'], 'proposed': self.fixed}

    def test_only_language_text_can_change(self):
        bad = copy.deepcopy(self.fix)
        bad['proposed']['answer'] = 1
        with self.assertRaises(ValueError):
            audit.validate(bad, 'audit', self.job['content'])

    def test_option_count_and_duplicates_rejected(self):
        for opts in [['Usa', 'Duha'], ['Usa', 'Usa', 'Tulo']]:
            bad = copy.deepcopy(self.fix)
            bad['proposed']['options'] = opts
            with self.assertRaises(ValueError):
                audit.validate(bad, 'audit', self.job['content'])

    def test_fix_requires_changed_text(self):
        with self.assertRaises(ValueError):
            audit.validate({**self.fix, 'proposed': self.target}, 'audit', self.job['content'])

    def test_contradictory_pass_rejected(self):
        with self.assertRaises(ValueError):
            audit.validate({**self.fix, 'verdict': 'pass', 'proposed': None}, 'audit', self.job['content'])

    def test_source_problem_not_rewritten(self):
        with self.assertRaises(ValueError):
            audit.validate({**self.fix, 'verdict': 'source_issue'}, 'audit', self.job['content'])

    def test_blind_answer_mismatch_requires_review(self):
        with patch.object(audit, 'call', side_effect=[self.fix, {'acceptable': True, 'correct_index': 1, 'issues': []}]):
            result = audit.review_job(self.args, self.job, self.root)
        self.assertEqual(result['status'], 'needs_review')

    def test_two_pass_candidate_and_resume(self):
        with patch.object(audit, 'call', side_effect=[self.fix, {'acceptable': True, 'correct_index': 0, 'issues': []}]) as call:
            result = audit.review_job(self.args, self.job, self.root)
            self.assertEqual(result['status'], 'candidate')
            audit.review_job(self.args, self.job, self.root)
            self.assertEqual(call.call_count, 2)
        self.assertEqual(self.job['content']['target'], self.target)

    def test_error_is_resumable_not_a_pass(self):
        with patch.object(audit, 'call', side_effect=RuntimeError('timeout')):
            self.assertEqual(audit.review_job(self.args, self.job, self.root)['status'], 'error')
        self.assertFalse((self.root/'results'/self.job['key']/'final.json').exists())
        passed = {'verdict': 'pass', 'severity': 'none', 'issues': [], 'proposed': None}
        with patch.object(audit, 'call', return_value=passed):
            self.assertEqual(audit.review_job(self.args, self.job, self.root)['status'], 'pass')

    def test_missing_translation_cannot_be_clean_pass(self):
        self.job['preflight'] = ['missing translation']
        with patch.object(audit, 'call', return_value={'verdict': 'pass', 'severity': 'none', 'issues': [], 'proposed': None}):
            self.assertEqual(audit.review_job(self.args, self.job, self.root)['status'], 'needs_review')

    def test_supplement_dictionary_adapter(self):
        p = self.root/'supplement.json'
        p.write_text(json.dumps({'questions': {'fact-id': {'f': 'fact-id'}}}))
        self.assertEqual(audit.read_rows(p), [{'f': 'fact-id'}])

    def test_incomplete_output_records_usage_and_no_completion(self):
        args = SimpleNamespace(model=audit.MODEL, max_tokens=100, retries=3, timeout=1, reasoning_effort='none')
        raw = {'choices': [{'finish_reason': 'length', 'message': {'content': '{}'}}], 'usage': {'prompt_tokens': 9, 'completion_tokens': 10}}
        from io import BytesIO
        with patch.dict('os.environ', {'FIREWORKS_API_KEY': 'test-only'}), patch.object(audit.urllib.request, 'urlopen', return_value=BytesIO(json.dumps(raw).encode())) as call:
            with self.assertRaises(audit.TokenLimitError):
                audit.call(args, self.job, 'audit', self.target, self.root)
        self.assertEqual(call.call_count, 1)  # Truncation never retries an unchanged budget.
        self.assertFalse((self.root/'audit.json').exists())
        self.assertEqual(len(list(self.root.glob('audit-response-*.json'))), 1)

    def test_verifier_does_not_receive_answer_or_first_rationale(self):
        args = SimpleNamespace(model=audit.MODEL, max_tokens=100, retries=3, timeout=1, reasoning_effort='none')
        raw = {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'acceptable': True, 'correct_index': 0, 'issues': []})}}]}
        from io import BytesIO
        with patch.dict('os.environ', {'FIREWORKS_API_KEY': 'test-only'}), patch.object(audit.urllib.request, 'urlopen', return_value=BytesIO(json.dumps(raw).encode())) as call:
            audit.call(args, self.job, 'verify', self.fixed, self.root)
            payload = json.loads(call.call_args.args[0].data)
        quiz = json.loads(payload['messages'][1]['content'])['quiz']
        self.assertNotIn('answer', quiz)
        self.assertNotIn('issues', quiz)
        self.assertEqual(quiz['target'], self.fixed)

    def test_prepare_deduplicates_mirrors_and_rejects_changed_snapshot(self):
        bank = self.root/'rag/bank/quiz-bank.jsonl'
        bank.parent.mkdir(parents=True)
        row = {'id': 'q1', 'factId': 'f1', 'grades': [5], 'topic': 'Matter',
               'q': {'en': 'Which?', 'tl': 'Alin?', 'bis': 'Hain?'},
               'options': [{'en': 'One', 'tl': 'Isa', 'bis': 'Usa'}, {'en': 'Two', 'tl': 'Dalawa', 'bis': 'Duha'}],
               'answer': 0, 'explanation': {'en': 'One.', 'tl': 'Isa.', 'bis': 'Usa.'}}
        bank.write_text(json.dumps(row) + '\n')
        mirror = self.root/'mirror.json'
        mirror.write_text(json.dumps({'questions': [{'f': 'f1', 'q': row['q'], 'o': row['options'], 'a': 0, 'e': row['explanation']}]}))
        args = SimpleNamespace(repo=self.root, input=[bank, mirror], facts=None, out=self.root/'out')
        before = bank.read_bytes()
        with patch('builtins.print'):
            audit.prepare(args)
        jobs = audit.read_rows(args.out/'jobs.jsonl')
        self.assertEqual(len(jobs), 2)
        self.assertTrue(all(len(j['refs']) == 2 for j in jobs))
        self.assertEqual(bank.read_bytes(), before)
        row['q']['tl'] = 'Alin dito?'
        bank.write_text(json.dumps(row) + '\n')
        with self.assertRaises(ValueError):
            audit.prepare(args)

    def test_reasoning_is_separate_from_json(self):
        args = SimpleNamespace(model=audit.MODEL, max_tokens=100, retries=0, timeout=1, reasoning_effort='high')
        result = {'verdict': 'pass', 'severity': 'none', 'issues': [], 'proposed': None}
        raw = {'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(result), 'reasoning_content': 'Non-JSON reasoning {not a result}'}}]}
        from io import BytesIO
        with patch.dict('os.environ', {'FIREWORKS_API_KEY': 'test-only'}), patch.object(audit.urllib.request, 'urlopen', return_value=BytesIO(json.dumps(raw).encode())) as call:
            self.assertEqual(audit.call(args, self.job, 'audit', self.target, self.root), result)
            self.assertEqual(json.loads(call.call_args.args[0].data)['reasoning_effort'], 'high')

    def test_runaway_diagnosis_is_rejected(self):
        with self.assertRaises(ValueError):
            audit.validate({**self.fix, 'issues': ['q: ' + 'repeated ' * 30]}, 'audit', self.job['content'])
        with self.assertRaises(ValueError):
            audit.validate({**self.fix, 'issues': ['q: grammar'] * 7}, 'audit', self.job['content'])


if __name__ == '__main__':
    unittest.main()
