import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit_images.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.j = a.job('visual', 'image.png', 'a' * 64, {}, 'b' * 64)
        self.v = {'job_id': self.j['id'], 'image_sha256': self.j['image_sha256'],
                  'description': 'One adult animal and one calf are visible.',
                  'checks': {k: {'status': 'pass', 'evidence': 'Visible coherent drawing.'} for k in a.VISUAL}}

    def test_reject_and_uncertainty_override_other_passes(self):
        self.v['checks']['anatomy']['status'] = 'reject'
        self.assertEqual(a.validate(self.j, self.v), 'reject')
        self.v['checks']['anatomy']['status'] = 'uncertain'
        self.assertEqual(a.validate(self.j, self.v), 'uncertain')

    def test_invalid_results_cannot_be_counted_as_pass(self):
        for mutate in [lambda v: v['checks'].pop('anatomy'),
                       lambda v: v.update(image_sha256='other'),
                       lambda v: v.update(job_id='other'),
                       lambda v: v['checks']['anatomy'].update(status='match'),
                       lambda v: v['checks']['anatomy'].update(status=[]),
                       lambda v: v['checks']['anatomy'].update(evidence=''),
                       lambda v: v['checks']['legibility'].update(status='not_applicable'),
                       lambda v: v.update(description='')]:
            v = copy.deepcopy(self.v)
            mutate(v)
            with self.assertRaises(ValueError): a.validate(self.j, v)

    def test_calibration_gate_requires_anatomy_rejection(self):
        snap = {'calibration_id': self.j['id']}
        a.ensure_gate(snap, {}, {}, self.j['id'])
        with self.assertRaises(ValueError): a.ensure_gate(snap, {}, {}, 'corpus')
        with self.assertRaises(ValueError):
            a.ensure_gate(snap, {}, {self.j['id']: ('pass', {'verdict': self.v})}, 'corpus')
        self.v['checks']['anatomy']['status'] = 'reject'
        a.ensure_gate(snap, {}, {self.j['id']: ('reject', {'verdict': self.v})}, 'corpus')

    def test_job_identity_changes_with_image_rubric_or_claim(self):
        for j in [a.job('visual', 'image.png', 'c' * 64, {}, 'b' * 64),
                  a.job('visual', 'image.png', 'a' * 64, {}, 'c' * 64),
                  a.job('alignment', 'image.png', 'a' * 64, {'en': 'Changed claim'}, 'b' * 64)]:
            self.assertNotEqual(j['id'], self.j['id'])

    def test_visual_prompt_does_not_supply_expected_subject(self):
        text = a.prompt(a.job('calibration', 'bad-carabao.png', 'a' * 64, {}, 'b' * 64), 'Rubric')
        self.assertNotIn('carabao', text)
        self.assertNotIn('rejected', text)
        self.assertNotIn('calibration', text)

    def test_api_payload_disables_default_thinking(self):
        payload = a.api_payload(self.j, 'Rubric', b'\x89PNG\r\n\x1a\n', 'qwen3.8-omni-flash')
        self.assertIs(payload['enable_thinking'], False)
        self.assertEqual(payload['model'], 'qwen3.8-omni-flash')
        self.assertTrue(payload['stream'])

    def test_streaming_and_chat_results_and_truncation(self):
        raw = json.dumps(self.v)
        events = [{'choices': [{'delta': {'content': raw[:30]}, 'finish_reason': None}]},
                  {'choices': [{'delta': {'content': raw[30:]}, 'finish_reason': 'stop'}]},
                  {'choices': [], 'usage': {'total_tokens': 100}}]
        sse = '\n\n'.join('data: ' + json.dumps(e) for e in events) + '\n\ndata: [DONE]\n'
        self.assertEqual(a.decode_response(sse), self.v)
        response = {'choices': [{'message': {'content': raw}, 'finish_reason': 'stop'}]}
        self.assertEqual(a.decode_response(json.dumps(response)), self.v)
        response['choices'][0]['finish_reason'] = 'length'
        self.assertEqual(a.decode_response(json.dumps(response)), self.v)
        with self.assertRaises(ValueError): a.decode_response('data: ' + json.dumps(events[0]))
        with self.assertRaises(ValueError): a.decode_response('Looks fine!')
        fenced = '```json\n' + raw + '\n```'
        self.assertEqual(a.decode_response(fenced), self.v)
        self.assertEqual(a.decode_response(raw[:-1]), self.v)
        stamped = a.normalize_verdict(self.j, {**self.v, 'job_id': 'nope', 'image_sha256': 'c' * 64})
        self.assertEqual(stamped['job_id'], self.j['id'])
        self.assertEqual(stamped['image_sha256'], self.j['image_sha256'])
        self.assertEqual(a.validate(self.j, stamped), 'pass')

    def test_exact_download_and_bundled_suffix_resolution(self):
        self.assertEqual(a.resolve_slug('animal-g5', {'animal', 'animal-g5'}, {'animal'}), 'animal-g5')
        self.assertEqual(a.resolve_slug('animal-g5', {'animal'}, {'animal'}), 'animal')
        self.assertIsNone(a.resolve_slug('missing', {'animal'}, {'animal'}))

    def test_inventory_includes_both_source_directories_and_detects_stale_tail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            gen = root / 'packages/mobile/src/generated'; gen.mkdir(parents=True)
            images = root / 'packages/images'
            (images / 'assets-png/biology').mkdir(parents=True)
            (images / 'cards-png').mkdir()
            (images / 'assets-png/biology/a.png').write_bytes(b'original')
            blob = b'downloaded'
            path = images / 'cards-png/b.png'; path.write_bytes(blob)
            (gen / 'imageMap.ts').write_text('  "a": require("../../../images/assets-png/biology/a.png"),\n')
            (gen / 'bundledArt.generated.json').write_text(json.dumps({'images': [['a', 512, 512]]}))
            shards = root / 'rag/pipeline/art-shards'; shards.mkdir(parents=True)
            (shards / 'index.json').write_text(json.dumps({'shards': [{'file': 'one.json'}], 'tail': {'images': 1}}))
            (shards / 'one.json').write_text(json.dumps({'images': [{'slug': 'b', 'file': 'cards-png/b.png',
                'bytes': len(blob), 'md5': a.hashlib.md5(blob).hexdigest()}]}))
            actual, bundled = a.inventory(root)
            self.assertEqual(set(actual), {'a', 'b'})
            self.assertEqual(bundled, {'a'})
            self.assertEqual(actual['a'][1], 'bundled')
            self.assertEqual(actual['b'][1], 'downloadable')
            path.write_bytes(b'edited')
            with self.assertRaisesRegex(ValueError, 'Stale downloadable'): a.inventory(root)

    def test_modified_image_and_duplicate_result_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'image.png').write_bytes(b'bytes')
            j = a.job('visual', 'image.png', a.digest(b'bytes'), {}, 'b')
            self.assertEqual(a.verify_image(root, j), b'bytes')
            (root / 'image.png').write_bytes(b'other')
            with self.assertRaises(ValueError): a.verify_image(root, j)
            p = root / 'result.json'
            a.write_json(p, {})
            with self.assertRaises(FileExistsError): a.write_json(p, {})


if __name__ == '__main__':
    unittest.main()

# The live runner is exercised with a fake streaming transport; no network/key needed.
import contextlib
import io
import sys
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parent))
import run_qwen as runner


class RunnerTests(unittest.TestCase):
    def test_endpoint_and_key_loading(self):
        runner.endpoint_ok(runner.DEFAULT_ENDPOINT)
        for value in ['http://dashscope-intl.aliyuncs.com/chat/completions',
                      'https://evil.test/chat/completions',
                      'https://dashscope-intl.aliyuncs.com.evil.test/chat/completions']:
            with self.assertRaises(ValueError): runner.endpoint_ok(value)
        with tempfile.TemporaryDirectory() as tmp, patch.dict(runner.os.environ, {}, clear=True):
            path = Path(tmp) / '.env'
            path.write_text('export ALIBABACLOUD_API_KEY="test-placeholder"\n')
            self.assertEqual(runner.credential(path), 'test-placeholder')

    def test_bounded_requests_resume_and_unknown_attempt_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); out = root / 'audit'; out.mkdir(); (out / 'results').mkdir()
            (root / 'image.png').write_bytes(b'fake fixture for transport test')
            sha = a.digest((root / 'image.png').read_bytes())
            (out / 'rubric.md').write_text('Test rubric')
            rh = a.digest((out / 'rubric.md').read_bytes())
            jobs = [a.job('calibration', 'image.png', sha, {}, rh), a.job('visual', 'image.png', sha, {}, rh)]
            (out / 'jobs.jsonl').write_text(''.join(json.dumps(j) + '\n' for j in jobs))
            a.write_json(out / 'inventory.json', [{'image': 'image.png', 'sha256': sha,
                'sources': [{'slug': 'test', 'path': 'image.png'}], 'cards': []}])
            for rel in ['packages/mobile/src/generated/cardsIndex.generated.json', 'packages/mobile/assets/data/cards.db']:
                p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'fixed input')
            a.write_json(out / 'snapshot.json', {'root': str(root), 'rubric_sha256': rh,
                'jobs_sha256': a.digest((out / 'jobs.jsonl').read_bytes()),
                'inventory_sha256': a.digest((out / 'inventory.json').read_bytes()),
                'cards_index_sha256': a.digest(b'fixed input'), 'cards_db_sha256': a.digest(b'fixed input'),
                'calibration_id': jobs[0]['id']})
            args = SimpleNamespace(out=out, limit=1, endpoint=runner.DEFAULT_ENDPOINT, model='qwen3.8-omni-flash',
                                   slug=None, env_file=root / '.env', workers=1, kind=None, job_id=None)
            calls = []
            def fake_open(req, timeout):
                payload = json.loads(req.data)
                v = json.loads(payload['messages'][0]['content'][1]['text'].split('Required shape:\n')[1])
                v['description'] = 'A visible animal drawing.'
                for k, c in v['checks'].items():
                    c['status'] = 'reject' if v['job_id'] == jobs[0]['id'] and k == 'anatomy' else 'pass'
                    c['evidence'] = 'The adult head is replaced with a tail.' if c['status'] == 'reject' else 'Coherent visible structures.'
                calls.append(v['job_id'])
                stream = 'data: ' + json.dumps({'choices': [{'delta': {'content': json.dumps(v)}, 'finish_reason': 'stop'}]}) + '\n\ndata: [DONE]\n'
                return io.BytesIO(stream.encode())
            fake = SimpleNamespace(open=fake_open)
            with patch.object(runner, 'credential', return_value='fake-key'), patch.object(runner.urllib.request, 'build_opener', return_value=fake), contextlib.redirect_stdout(io.StringIO()):
                runner.run(args)
                self.assertEqual(calls, [jobs[0]['id']])
                runner.run(args)
                self.assertEqual(calls, [j['id'] for j in jobs])
                runner.run(args)
                self.assertEqual(len(calls), 2)
                (out / 'attempts' / 'interrupted').mkdir()
                runner.run(args)
                self.assertEqual(len(calls), 2)

    def _snapshot(self, tmp, extra_jobs=0):
        root = Path(tmp); out = root / 'audit'; out.mkdir(); (out / 'results').mkdir()
        (root / 'image.png').write_bytes(b'fake fixture for transport test')
        sha = a.digest((root / 'image.png').read_bytes())
        (out / 'rubric.md').write_text('Test rubric')
        rh = a.digest((out / 'rubric.md').read_bytes())
        jobs = [a.job('calibration', 'image.png', sha, {}, rh), a.job('visual', 'image.png', sha, {}, rh)]
        for i in range(extra_jobs):
            jobs.append(a.job('alignment', 'image.png', sha, {'en': f'claim-{i}'}, rh))
        (out / 'jobs.jsonl').write_text(''.join(json.dumps(j) + '\n' for j in jobs))
        a.write_json(out / 'inventory.json', [{'image': 'image.png', 'sha256': sha,
            'sources': [{'slug': 'test', 'path': 'image.png'}], 'cards': []}])
        for rel in ['packages/mobile/src/generated/cardsIndex.generated.json', 'packages/mobile/assets/data/cards.db']:
            p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_bytes(b'fixed input')
        a.write_json(out / 'snapshot.json', {'root': str(root), 'rubric_sha256': rh,
            'jobs_sha256': a.digest((out / 'jobs.jsonl').read_bytes()),
            'inventory_sha256': a.digest((out / 'inventory.json').read_bytes()),
            'cards_index_sha256': a.digest(b'fixed input'), 'cards_db_sha256': a.digest(b'fixed input'),
            'calibration_id': jobs[0]['id']})
        args = SimpleNamespace(out=out, limit=1, endpoint=runner.DEFAULT_ENDPOINT, model='qwen3.8-omni-flash',
                               slug=None, env_file=root / '.env', workers=1, kind=None, job_id=None)
        return root, out, jobs, args

    def _open_ok(self, jobs, calls, fail_after=None):
        fail_after = fail_after or {}
        counts = {k: 0 for k in fail_after}
        def fake_open(req, timeout):
            payload = json.loads(req.data)
            v = json.loads(payload['messages'][0]['content'][1]['text'].split('Required shape:\n')[1])
            v['description'] = 'A visible animal drawing.'
            for k, c in v['checks'].items():
                c['status'] = 'reject' if v['job_id'] == jobs[0]['id'] and k == 'anatomy' else 'pass'
                c['evidence'] = 'The adult head is replaced with a tail.' if c['status'] == 'reject' else 'Coherent visible structures.'
            job_id = v['job_id']
            if job_id in fail_after and counts[job_id] < fail_after[job_id]:
                counts[job_id] += 1
                raise urllib.error.HTTPError(
                    req.full_url, 400, 'Bad Request', None, io.BytesIO(b'{"error":"bad"}'))
            calls.append(job_id)
            stream = 'data: ' + json.dumps({'choices': [{'delta': {'content': json.dumps(v)}, 'finish_reason': 'stop'}]}) + '\n\ndata: [DONE]\n'
            return io.BytesIO(stream.encode())
        return SimpleNamespace(open=fake_open), counts

    def test_retry_once_then_succeeds(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, out, jobs, args = self._snapshot(tmp)
            calls = []
            fake, counts = self._open_ok(jobs, calls, fail_after={jobs[0]['id']: 1})
            with patch.object(runner, 'credential', return_value='fake-key'), \
                    patch.object(runner.urllib.request, 'build_opener', return_value=fake), \
                    patch.object(runner, 'RETRY_SLEEP', 0), patch.object(runner, 'RATE_LIMIT_SLEEP', 0), \
                    contextlib.redirect_stdout(io.StringIO()):
                runner.run(args)
            self.assertEqual(counts[jobs[0]['id']], 1)
            self.assertEqual(calls, [jobs[0]['id']])
            saved = json.loads((out / 'results' / (jobs[0]['id'] + '.json')).read_text())
            self.assertEqual(saved['try'], 2)

    def test_two_failures_file_error_and_continue(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, out, jobs, args = self._snapshot(tmp, extra_jobs=1)
            args.limit = 3
            calls = []
            fake, counts = self._open_ok(jobs, calls, fail_after={jobs[1]['id']: 2})
            with patch.object(runner, 'credential', return_value='fake-key'), \
                    patch.object(runner.urllib.request, 'build_opener', return_value=fake), \
                    patch.object(runner, 'RETRY_SLEEP', 0), patch.object(runner, 'RATE_LIMIT_SLEEP', 0), \
                    contextlib.redirect_stdout(io.StringIO()):
                runner.run(args)
            self.assertEqual(counts[jobs[1]['id']], 2)
            self.assertEqual(calls, [jobs[0]['id'], jobs[2]['id']])
            err = json.loads((out / 'results' / (jobs[1]['id'] + '.json')).read_text())
            self.assertIsNone(err['verdict'])
            self.assertEqual(err['error']['tries'], 2)
            self.assertEqual(err['error']['http_status'], 400)
            found = a.results(out, {j['id']: j for j in jobs})
            self.assertEqual(found[jobs[1]['id']][0], 'error')
            self.assertEqual(found[jobs[2]['id']][0], 'pass')

    def test_workers_cover_calibration_then_corpus(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, out, jobs, args = self._snapshot(tmp, extra_jobs=2)
            args.limit = 4
            args.workers = 3
            calls = []
            fake, _ = self._open_ok(jobs, calls)
            with patch.object(runner, 'credential', return_value='fake-key'), \
                    patch.object(runner.urllib.request, 'build_opener', return_value=fake), \
                    contextlib.redirect_stdout(io.StringIO()):
                runner.run(args)
            self.assertEqual(set(calls), {j['id'] for j in jobs})
            self.assertEqual(len(list((out / 'results').glob('*.json'))), 4)
