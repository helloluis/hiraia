"""Offline tests for Repair-2 spending, field restrictions and native receipts."""
import collections
import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

import gemini_repair2_batch as R


class RepairBatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name) / 'repair'; self.out.mkdir()
        source = Path(R.ROOT / 'runs/2026-09-14/gemini-repair2-batch-v1/repair-input.jsonl')
        fixture = json.loads(source.read_text().splitlines()[0])
        self.items = {}
        for i in range(14):
            item = copy.deepcopy(fixture); key = 'job-' + str(i)
            item['key'] = key; item['job']['key'] = key
            checks = item['audit']['diagnosis']['checks']
            for field in checks:
                checks[field] = {'status': 'ok', 'quote': '', 'finding': ''}
            checks['q'] = {'status': 'issue', 'quote': item['job']['content']['target']['q'], 'finding': 'Repair question grammar.'}
            self.items[key] = item
        self.config = {'kind': 'repair', 'stage': 'Repair-2', 'schema_encoding': R.ENCODING,
                       'prior_pair_usd': 0., 'baseline_combined_usd': 180.74659725}
        R.write(self.out / 'config.json', self.config)
        self.posts = []; self.gets = []
        self.no_real = mock.patch('urllib.request.urlopen', side_effect=AssertionError('No live API in tests'))
        self.no_real.start(); self.addCleanup(self.no_real.stop)

    def network(self, url, data=None, timeout=None):
        if data is not None:
            body = json.loads(data); self.posts.append(body)
            return 202, {'id': 'mock-' + str(len(self.posts)), 'model': R.C.CANONICAL_MODEL,
                         'endpoint': '/v1/chat/completions', 'status': 'queued',
                         'request_counts': {'total': len(body['requests']), 'completed': 0, 'failed': 0}}
        self.gets.append(url)
        raise AssertionError('Unexpected GET')

    def corrected(self, item):
        proposed = copy.deepcopy(item['job']['content']['target'])
        proposed['q'] = 'Tin-ayo nga pangutana.'
        return {'status': 'corrected', 'proposed': proposed, 'note': 'Corrected the question grammar.'}

    def terminal(self, d):
        requests = R.read(d / 'request.json')['requests']; n = len(requests)
        accepted = R.read(d / 'accepted.json'); results = []
        for row in requests:
            raw = {'model': R.C.CANONICAL_MODEL, 'provider': 'Google',
                   'usage': {'prompt_tokens': 100, 'completion_tokens': 20},
                   'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(self.corrected(self.items[row['custom_id']]))}}]}
            results.append({'custom_id': row['custom_id'], 'response': {'status_code': 200, 'body': raw}, 'error': None})
        return {**accepted, 'status': 'completed', 'request_counts': {'total': n, 'completed': n, 'failed': 0},
                'usage': {'prompt_tokens': 100*n, 'completion_tokens': 20*n, 'cost': .000075*n, 'is_byok': False},
                'results': results, 'error': None}

    def first(self):
        R.submit(self.out, self.config, self.items, ['job-0', 'job-1'], network=self.network)
        return self.out / 'batches/000001'

    def finish(self, d):
        R.ensure(d / 'terminal.json', self.terminal(d))
        R.collect_terminal(self.out, d, self.items, self.config)

    def release(self):
        d = self.first(); self.finish(d)
        with mock.patch.object(R, 'frozen', return_value=(self.config, self.items, [])):
            R.review_canary(self.out)
        return d

    def test_wire_schema_and_private_answer(self):
        value = R.payload(self.items['job-0']); data = R.read_json if hasattr(R, 'read_json') else None
        message = R.K.parse_json(value['messages'][1]['content'])
        schema = value['response_format']['json_schema']['schema']
        self.assertNotIn('service_tier', value); self.assertNotIn('provider', value)
        self.assertNotIn('answer', message['quiz']); self.assertNotIn('correct_index', message['quiz']['audit'])
        self.assertEqual(schema, message['response_schema'])
        self.assertEqual(schema['properties']['proposed']['type'], ['object', 'null'])
        self.assertEqual(schema['properties']['status']['type'], 'string')
        self.assertEqual(schema['properties']['proposed']['properties']['options']['minItems'], 3)
        self.assertTrue(value['response_format']['json_schema']['strict'])

    def test_unflagged_field_change_is_quarantined(self):
        d = self.first(); terminal = self.terminal(d)
        raw = terminal['results'][0]['response']['body']; result = self.corrected(self.items['job-0'])
        result['proposed']['explanation'] += ' unrelated'
        raw['choices'][0]['message']['content'] = json.dumps(result)
        R.ensure(d / 'terminal.json', terminal)
        with self.assertRaisesRegex(ValueError, 'Canary failed'):
            R.collect_terminal(self.out, d, self.items, self.config)
        error = R.read(self.out/'results/job-0/error.json')
        self.assertIn('unflagged', error['error']); self.assertFalse((self.out/'canary-passed.json').exists())

    def test_hold_preserved_but_gate_requires_proposal(self):
        d = self.first(); terminal = self.terminal(d)
        terminal['results'][0]['response']['body']['choices'][0]['message']['content'] = json.dumps({'status':'hold','proposed':None,'note':'Term uncertain.'})
        R.ensure(d/'terminal.json',terminal); R.collect_terminal(self.out,d,self.items,self.config)
        self.assertEqual(R.read(self.out/'results/job-0/final.json')['status'],'held')
        self.assertFalse(R.gate(self.out))
        with self.assertRaisesRegex(ValueError,'gate closed'):
            R.submit(self.out,self.config,self.items,['job-2'],network=self.network)
        self.assertEqual(len(self.posts),1)

    def test_unknown_submission_reserved_and_never_reposted(self):
        with self.assertRaisesRegex(RuntimeError, 'connection lost'):
            R.submit(self.out,self.config,self.items,['job-0','job-1'],network=lambda *a,**k: (_ for _ in ()).throw(RuntimeError('connection lost')))
        value=R.snapshot(self.out,self.config,self.items)
        self.assertGreater(value['unknown_reserved_usd'],0); self.assertEqual(value['active_reserved_usd'],0)
        with self.assertRaises(ValueError): R.submit(self.out,self.config,self.items,['job-0','job-1'],network=self.network)
        with self.assertRaises(ValueError): R.submit(self.out,self.config,self.items,['job-2','job-3'],network=self.network)
        self.assertEqual(len(self.posts),0)

    def test_native_charge_counted_once_and_tampering_rejected_before_post(self):
        d=self.release(); raw=R.read(d/'terminal.json')['results'][0]['response']['body']
        self.assertEqual(R.read(self.out/'results/job-0/response.json'),raw)
        for _ in range(2):
            value=R.snapshot(self.out,self.config,self.items,True)
            self.assertAlmostEqual(value['received_cost_usd'],.00015)
        local=self.out/'results/job-0/final.json'; saved=local.read_bytes()
        x=R.read(local); x['changes'][0]['after']='tampered'; R.write(local,x)
        with self.assertRaisesRegex(ValueError,'provenance changed'):
            R.submit(self.out,self.config,self.items,['job-2'],network=self.network)
        self.assertEqual(len(self.posts),1); local.write_bytes(saved)
        receipts=[R.read(self.out/f'results/job-{i}/batch-receipt.json')['allocated_received_cost_usd'] for i in range(2)]
        self.assertAlmostEqual(sum(receipts),.00015)

    def test_aggregate_billing_mismatch_stops_canary(self):
        d=self.first(); terminal=self.terminal(d); terminal['usage']['is_byok']=True
        R.ensure(d/'terminal.json',terminal)
        with self.assertRaises(ValueError): R.collect_terminal(self.out,d,self.items,self.config)
        self.assertFalse((d/'billing.json').exists()); self.assertFalse(R.gate(self.out))

    def test_first_get_waits_sixty_seconds(self):
        d=self.first(); R.poll(self.out,d,self.items,self.config,network=self.network)
        self.assertEqual(self.gets,[])
        schedule=R.read(d/'poll.json'); schedule.update(accepted_at=time.time()-61,next_poll_at=time.time()-1); R.write(d/'poll.json',schedule)
        calls=[]
        def get(url,data=None,timeout=None):
            self.assertIsNone(data); calls.append(url); return 200,self.terminal(d)
        R.poll(self.out,d,self.items,self.config,network=get)
        self.assertEqual(len(calls),1); self.assertTrue((d/'collected.json').exists())

    def test_four_job_window_and_budget(self):
        self.release()
        for i in range(2,6):
            R.submit(self.out,self.config,self.items,['job-'+str(i)],network=self.network)
        with self.assertRaisesRegex(ValueError,'window full'):
            R.submit(self.out,self.config,self.items,['job-6'],network=self.network)
        self.assertEqual(len(self.posts),5)
        another=Path(self.tmp.name)/'budget';another.mkdir();config={**self.config,'baseline_combined_usd':249.99};R.write(another/'config.json',config)
        with self.assertRaisesRegex(ValueError,'authorized budgets'):
            R.submit(another,config,self.items,['job-0','job-1'],network=self.network)
        self.assertEqual(len(self.posts),5)

    def test_completed_peer_imports_while_older_batch_is_running(self):
        self.release()
        for i in (2,3): R.submit(self.out,self.config,self.items,['job-'+str(i)],network=self.network)
        slow=self.out/'batches/000002'; fast=self.out/'batches/000003'
        for d in (slow,fast):
            schedule=R.read(d/'poll.json'); schedule.update(accepted_at=time.time()-61,next_poll_at=time.time()-1); R.write(d/'poll.json',schedule)
        def get(url,data=None,timeout=None):
            self.assertIsNone(data)
            if url.endswith('mock-2'):
                return 200,{**R.read(slow/'accepted.json'),'status':'in_progress'}
            return 200,self.terminal(fast)
        R.poll(self.out,slow,self.items,self.config,network=get)
        R.poll(self.out,fast,self.items,self.config,network=get)
        self.assertFalse((slow/'collected.json').exists()); self.assertTrue((fast/'collected.json').exists())

    def test_audit4_handover_excludes_holds_and_keeps_key_private(self):
        self.release(); R.submit(self.out,self.config,self.items,['job-2'],network=self.network)
        d=self.out/'batches/000002'; terminal=self.terminal(d)
        terminal['results'][0]['response']['body']['choices'][0]['message']['content']=json.dumps({'status':'hold','proposed':None,'note':'Term uncertain.'})
        R.ensure(d/'terminal.json',terminal); R.collect_terminal(self.out,d,self.items,self.config)
        self.config['evidence_sha256']={}; R.write(self.out/'config.json',self.config)
        # Existing batches bind the pre-handover config, so preserve its bytes.
        self.config.pop('evidence_sha256'); R.write(self.out/'config.json',self.config)
        passed_config={**self.config,'evidence_sha256':{}}
        R.write(self.out/'plan.json',[]);R.write(self.out/'authorization.json',{'user_authorization':'Repair-2 followed by Audit-4; $60 total.'})
        R.write(self.out/'process.json',{'status':'finished'})
        audit=self.out.parent/'audit4'
        subset={k:self.items[k] for k in ('job-0','job-1','job-2')}
        with mock.patch.object(R,'frozen',return_value=(passed_config,subset,[])):
            value=R.prepare_audit(self.out,audit)
        self.assertEqual(value['selected'],2)
        config,items,_=R.frozen(audit)
        self.assertAlmostEqual(config['prior_pair_usd'],.000225)
        self.assertNotIn('job-2',items)
        for item in items.values():
            body=R.payload(item,'audit'); user=R.K.parse_json(body['messages'][1]['content'])
            self.assertNotIn('answer',user['quiz']); self.assertNotIn('audit',user['quiz'])
            self.assertEqual(user['quiz']['target']['q'],'Tin-ayo nga pangutana.')


if __name__=='__main__': unittest.main()
