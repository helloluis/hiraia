"""Offline semantic-equivalence, provenance, and zero-charge failure checks."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

import fresh_batch_contract as V1
import fresh_batch_contract_v2 as C
from test_fresh_batch_contract import item, response, terminal


def failed_terminal(requests):
    raw = terminal(requests)
    raw['request_counts'].update(completed=0, failed=len(requests))
    raw['usage'].update(prompt_tokens=0, completion_tokens=0, total_tokens=0, cost=0)
    raw['error'] = {'message': 'All requests failed upstream'}
    for record in raw['results']:
        record.update(response=None, error={'type': 'invalid_request_error',
            'message': 'Invalid response_json_schema'})
    return raw


class V2Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.entry, self.prompt = item(), 'Keep the exact original prompt.'
        self.batch = self.out / 'bulk-v2/batches/000001'
        self.result = self.out / 'results/1'
        self.requests = [{'custom_id': '1', 'body': C.batch_payload(self.entry, self.prompt)}]
        self.raw = terminal(self.requests)
        self.save(self.batch / 'request.json', {'endpoint': '/v1/chat/completions',
            'model': C.MODEL, 'requests': self.requests})
        self.save(self.batch / 'accepted.json', {**self.raw, 'status': 'validating',
            'usage': None, 'results': None})
        self.origin = C.make_origin(self.entry, self.batch)
        self.save(self.result / 'batch-origin.json', self.origin)
        self.save(self.result / 'request.json', self.requests[0]['body'])
        self.save(self.result / 'started.json', {'time': 0, 'kind': 'cloud_batch',
            'reserved_usd': .02, 'batch_dir': str(self.batch),
            'request_sha256': C.T.digest(self.requests[0]['body'])})

    def save(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))

    def finish(self):
        self.save(self.batch / 'terminal.json', self.raw)
        self.save(self.result / 'batch-receipt.json', C.make_receipt(self.origin))
        self.save(self.result / 'response.json', response())

    def test_only_wire_nullable_schema_changes(self):
        before = V1.batch_payload(self.entry, self.prompt)
        after = C.batch_payload(self.entry, self.prompt)
        new_proposed = after['response_format']['json_schema']['schema']['properties']['proposed']
        self.assertEqual(new_proposed['type'], ['object', 'null'])
        self.assertNotIn('anyOf', new_proposed)
        self.assertIs(new_proposed['additionalProperties'], False)
        after['response_format'] = before['response_format']
        self.assertEqual(after, before)
        self.assertEqual(C.T.payload(self.entry, self.prompt)['messages'], before['messages'])
        self.assertIs(C.validate_batch, V1.validate_batch)

    def test_original_and_v2_json_schema_equivalent_with_ajv(self):
        cases = []
        for count in range(2, 11):
            entry = item(); entry['job']['content']['english']['options'] = [str(i) for i in range(count)]
            original = C.T.schema(entry)
            transformed = C.batch_payload(entry, self.prompt)['response_format']['json_schema']['schema']
            proposal = {'q': 'Tanong?', 'options': [str(i) for i in range(count)], 'explanation': 'Paliwanag.'}
            proposed_values = [proposal, None, {}, [], '', 0, False,
                {**proposal, 'extra': 'bad'}, {k:v for k,v in proposal.items() if k != 'q'},
                {**proposal, 'q': None}, {**proposal, 'explanation': 1},
                {**proposal, 'options': proposal['options'][:-1]},
                {**proposal, 'options': proposal['options'] + ['extra']},
                {**proposal, 'options': [None] * count}]
            corpus = [{'status': status, 'proposed': value, 'note': 'A note.'}
                      for status in ('translated', 'hold', 'wrong', None)
                      for value in proposed_values]
            corpus += [None, [], {}, {'status': 'hold', 'proposed': None},
                {'status': 'hold', 'proposed': None, 'note': 0},
                {'status': 'hold', 'proposed': None, 'note': 'Reason', 'extra': 1}]
            cases.append({'old': original, 'new': transformed, 'corpus': corpus})
        script = '''const Ajv=require("ajv");const fs=require("fs");
const cases=JSON.parse(fs.readFileSync(0,"utf8"));const ajv=new Ajv({allErrors:true});
let checked=0,accepted=0;for(const c of cases){const a=ajv.compile(c.old),b=ajv.compile(c.new);
for(const value of c.corpus){if(a(value)!==b(value))throw Error("schema acceptance changed");
checked++;if(b(value))accepted++;}}process.stdout.write(JSON.stringify({checked,accepted}));'''
        result = subprocess.run(['node', '-e', script], input=json.dumps(cases),
            text=True, capture_output=True, check=True,
            cwd=Path(__file__).resolve().parents[2])
        summary = json.loads(result.stdout)
        self.assertEqual(summary, {'checked': 558, 'accepted': 36})

    def test_unchanged_local_validator_enforces_hold_and_full_proposal_rules(self):
        good = {'q': 'Ano ang pula?', 'options': ['Mansanas', 'Langit'],
                'explanation': 'Maaaring pula ang mansanas.'}
        def validate(value, reason='stop'):
            raw = response(); raw['choices'][0]['message']['content'] = json.dumps(value)
            raw['choices'][0]['finish_reason'] = reason
            return C.T.validate(raw, self.entry)
        self.assertEqual(validate({'status': 'translated', 'proposed': good, 'note': 'Translated'})['status'], 'proposal')
        self.assertEqual(validate({'status': 'hold', 'proposed': None, 'note': 'Source concern'})['status'], 'held')
        invalid = [{'status': 'translated', 'proposed': None, 'note': 'bad'},
            {'status': 'hold', 'proposed': good, 'note': 'bad'},
            {'status': 'translated', 'proposed': {**good, 'options': ['Same', 'Same']}, 'note': 'bad'},
            {'status': 'translated', 'proposed': {**good, 'q': '...'}, 'note': 'bad'},
            {'status': 'translated', 'proposed': good, 'note': ' '}]
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate(value)
        with self.assertRaises(ValueError):
            validate({'status': 'translated', 'proposed': good, 'note': 'done'}, 'length')

    def test_real_v2_provenance_billing_preserves_raw_body(self):
        self.finish()
        self.assertEqual(self.origin['version'], 2)
        self.assertEqual(C.verify_saved_candidate(self.out, self.entry, self.prompt), response())
        received, reserved, usage = C.charge_state(self.result)
        self.assertEqual(received, self.raw['usage']['cost'])
        self.assertEqual(reserved, 0)
        self.assertEqual(usage['completion_tokens'], 20)
        self.assertEqual(usage['reasoning_tokens'], 5)
        self.assertEqual(len(C.immutable_dependency_paths(self.out, self.entry, self.prompt)), 7)
        with self.assertRaises(ValueError):
            V1.verify_saved_candidate(self.out, self.entry, self.prompt)

    def test_v2_does_not_accept_legacy_payload_or_wrong_namespace(self):
        self.finish()
        self.save(self.result / 'request.json', V1.batch_payload(self.entry, self.prompt))
        with self.assertRaises(ValueError):
            C.verify_saved_candidate(self.out, self.entry, self.prompt)
        with self.assertRaises(ValueError):
            C._batch_dir(self.out, self.batch, version=1)

    def test_accepted_pending_retains_reservation(self):
        self.assertEqual(C.charge_state(self.result)[:2], (0, .02))

    def test_successful_validator_not_relaxed_for_failed_batches(self):
        raw = failed_terminal(self.requests)
        self.assertEqual(C.reconcile_failed_zero_cost(raw, self.requests)['received_cost_usd'], 0)
        with self.assertRaises(ValueError):
            C.validate_batch(raw, self.requests)

    def test_zero_charge_reconciliation_rejects_ambiguity(self):
        changes = [lambda r: r.update(usage=None),
            lambda r: r['usage'].update(cost=.00001),
            lambda r: r['usage'].update(prompt_tokens=1),
            lambda r: r['usage'].update(completion_tokens=1),
            lambda r: r['usage'].update(total_tokens=1),
            lambda r: r['usage'].update(is_byok=True),
            lambda r: r['results'][0].update(custom_id='unknown'),
            lambda r: r['results'].append(r['results'][0]),
            lambda r: r['results'][0].update(response={'status_code': 200, 'body': response()}),
            lambda r: r['results'][0].update(error=None),
            lambda r: r['request_counts'].update(completed=1, failed=0),
            lambda r: r.update(status='in_progress')]
        for change in changes:
            raw = failed_terminal(self.requests); change(raw)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                C.reconcile_failed_zero_cost(raw, self.requests)

    def test_v1_failed_receipt_releases_only_proven_zero_charge(self):
        old = self.out / 'bulk/batches/000001'
        requests = [{'custom_id': '1', 'body': V1.batch_payload(self.entry, self.prompt)}]
        raw = failed_terminal(requests)
        self.save(old / 'request.json', {'endpoint': '/v1/chat/completions', 'model': C.MODEL, 'requests': requests})
        self.save(old / 'accepted.json', {**raw, 'status': 'validating', 'results': None, 'usage': None})
        self.save(old / 'terminal.json', raw)
        origin = V1.make_origin(self.entry, old)
        self.save(self.result / 'batch-origin.json', origin)
        self.save(self.result / 'started.json', {'kind': 'cloud_batch', 'reserved_usd': .02,
            'batch_dir': str(old), 'request_sha256': C.T.digest(requests[0]['body'])})
        self.assertEqual(C.charge_state(self.result)[:2], (0, .02))
        receipt = C.make_failure_receipt(origin)
        self.save(self.result / 'batch-failure-receipt.json', receipt)
        self.assertEqual(C.charge_state(self.result)[:2], (0, 0))
        self.assertEqual(V1.charge_state(self.result)[:2], (0, .02))
        receipt['custom_id'] = 'another'
        self.save(self.result / 'batch-failure-receipt.json', receipt)
        with self.assertRaises(ValueError):
            C.charge_state(self.result)
        self.save(self.result / 'batch-failure-receipt.json', C.make_failure_receipt(origin))
        raw['usage']['cost'] = .00001
        self.save(old / 'terminal.json', raw)
        with self.assertRaises(ValueError):
            C.charge_state(self.result)


if __name__ == '__main__':
    unittest.main()
