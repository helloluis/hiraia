"""Offline genuine-batch billing and immutable-provenance checks; no API calls."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import fresh_batch_contract as C


def item(number=1):
    return {'sample_id': number, 'job': {'key': 'key-' + str(number), 'content': {
        'english': {'q': 'Which is red?', 'options': ['Apple', 'Sky'],
                    'explanation': 'An apple may be red.'},
        'grades': [], 'language': 'tl', 'source_fact': {'en': 'An apple is a fruit.'},
        'target': 'OLD_PRIVATE_TARGET', 'answer': 'PRIVATE_ANSWER'}},
        'selection': {'reason': 'PRIVATE_DIAGNOSIS'}}


def response():
    return {'model': C.MODEL, 'provider': 'Google', 'service_tier': None,
        'usage': {'prompt_tokens': 100, 'completion_tokens': 20,
                  'completion_tokens_details': {'reasoning_tokens': 5}},
        'choices': [{'finish_reason': 'stop', 'message': {'role': 'assistant',
            'content': json.dumps({'status': 'hold', 'proposed': None, 'note': 'Review source.'})}}]}


def terminal(requests):
    count = len(requests)
    return {'id': 'batch-test', 'model': C.CANONICAL_MODEL,
        'endpoint': '/v1/chat/completions', 'status': 'completed', 'error': None,
        'request_counts': {'total': count, 'completed': count, 'failed': 0},
        'usage': {'prompt_tokens': 100 * count, 'completion_tokens': 20 * count,
                  'cost': .000075 * count, 'is_byok': False},
        'results': [{'custom_id': row['custom_id'], 'response': {
            'status_code': 200, 'body': response()}, 'error': None} for row in requests]}


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.out = Path(self.temp.name)
        self.entry, self.prompt = item(), 'Translate the English quiz.'
        self.batch = self.out / 'bulk/batches/000001'
        self.directory = self.out / 'results/1'
        self.requests = [{'custom_id': '1', 'body': C.batch_payload(self.entry, self.prompt)}]
        self.raw = terminal(self.requests)
        self.save(self.batch / 'request.json', {'endpoint': '/v1/chat/completions',
            'model': C.MODEL, 'requests': self.requests})
        self.save(self.batch / 'accepted.json', {**self.raw, 'status': 'validating',
            'usage': None, 'results': None})
        self.origin = C.make_origin(self.entry, self.batch)
        self.save(self.directory / 'batch-origin.json', self.origin)
        self.save(self.directory / 'request.json', self.requests[0]['body'])
        self.save(self.directory / 'started.json', {'time': 0, 'kind': 'cloud_batch',
            'reserved_usd': .02, 'batch_dir': str(self.batch),
            'request_sha256': C.T.digest(self.requests[0]['body'])})

    def save(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def finish(self):
        self.save(self.batch / 'terminal.json', self.raw)
        self.save(self.directory / 'batch-receipt.json', C.make_receipt(self.origin))
        self.save(self.directory / 'response.json', response())

    def test_payload_preserves_contract_and_excludes_private_material(self):
        original = C.T.payload(self.entry, self.prompt)
        original.pop('provider'); original.pop('service_tier')
        self.assertEqual(C.batch_payload(self.entry, self.prompt), original)
        text = json.dumps(original)
        for private in ('OLD_PRIVATE_TARGET', 'PRIVATE_ANSWER', 'PRIVATE_DIAGNOSIS'):
            self.assertNotIn(private, text)

    def test_native_response_and_receipt_are_distinct(self):
        self.finish()
        raw = C.verify_saved_candidate(self.out, self.entry, self.prompt)
        self.assertEqual(raw, response())
        self.assertNotIn('cost', raw['usage'])
        self.assertIsNone(raw['service_tier'])
        self.assertEqual(C.T.validate(raw, self.entry)['status'], 'held')
        received, reserved, usage = C.charge_state(self.directory)
        self.assertEqual(received, self.raw['usage']['cost'])
        self.assertEqual(reserved, 0)
        self.assertEqual(usage['completion_tokens'], 20)
        self.assertEqual(usage['reasoning_tokens'], 5)
        self.assertEqual(len(C.immutable_dependency_paths(self.out, self.entry, self.prompt)), 7)

    def test_old_accepted_pending_keeps_reservation(self):
        self.assertEqual(C.charge_state(self.directory)[:2], (0, .02))

    def test_exact_coverage_and_billing_fail_closed(self):
        mutations = [lambda raw: raw['results'].append(raw['results'][0]),
            lambda raw: raw['results'][0].update(custom_id='unknown'),
            lambda raw: raw['usage'].update(is_byok=True),
            lambda raw: raw['usage'].update(cost=float('nan')),
            lambda raw: raw['usage'].update(cost=.001),
            lambda raw: raw.update(model='unapproved/model'),
            lambda raw: raw.update(status='failed', usage=None),
            lambda raw: raw['results'][0]['response']['body'].update(provider='Other'),
            lambda raw: raw['request_counts'].update(completed=0, failed=1)]
        for change in mutations:
            raw = copy.deepcopy(self.raw); change(raw)
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                C.validate_batch(raw, self.requests)

    def test_all_requests_share_identical_response_format(self):
        rows = copy.deepcopy(self.requests) + [{'custom_id': '2',
            'body': C.batch_payload(item(2), self.prompt)}]
        rows[1]['body']['response_format']['json_schema']['name'] = 'different'
        with self.assertRaises(ValueError):
            C.validate_batch(terminal(rows), rows)

    def test_actual_charge_allocates_once_including_failed_request(self):
        rows = [{'custom_id': str(number), 'body': C.batch_payload(item(number), self.prompt)}
                for number in range(1, 4)]
        raw = terminal(rows)
        raw['request_counts'].update(completed=2, failed=1)
        raw['results'][1].update(response=None, error={'code': 503})
        result = C.validate_batch(raw, rows)
        values = result['allocations']
        self.assertEqual(sum(value['received_cost_usd'] for value in values.values()), raw['usage']['cost'])
        self.assertEqual(values['2']['usage_basis'], 'allocated_batch_usage')
        self.assertEqual(values['2']['received_usage']['prompt_tokens'], 100)
        self.assertEqual(sum(value['received_usage']['completion_tokens'] for value in values.values()), 60)

    def test_changed_receipt_rejected(self):
        self.finish()
        receipt = C.make_receipt(self.origin); receipt['allocated_received_cost_usd'] = 0
        self.save(self.directory / 'batch-receipt.json', receipt)
        with self.assertRaises(ValueError):
            C.charge_state(self.directory)
        with self.assertRaises(ValueError):
            C.verify_saved_candidate(self.out, self.entry, self.prompt)

    def test_changed_request_response_entry_or_terminal_rejected(self):
        self.finish()
        altered = copy.deepcopy(self.entry); altered['selection']['reason'] = 'changed'
        with self.assertRaises(ValueError):
            C.verify_saved_candidate(self.out, altered, self.prompt)
        request = copy.deepcopy(self.requests[0]['body']); request['messages'][0]['content'] = 'changed'
        self.save(self.directory / 'request.json', request)
        with self.assertRaises(ValueError):
            C.verify_saved_candidate(self.out, self.entry, self.prompt)
        self.save(self.directory / 'request.json', self.requests[0]['body'])
        raw = response(); raw['choices'][0]['message']['content'] = '{}'
        self.save(self.directory / 'response.json', raw)
        with self.assertRaises(ValueError):
            C.verify_saved_candidate(self.out, self.entry, self.prompt)
        self.save(self.directory / 'response.json', response())
        self.raw['usage']['cost'] /= 2
        self.save(self.batch / 'terminal.json', self.raw)
        with self.assertRaises(ValueError):
            C.verify_saved_candidate(self.out, self.entry, self.prompt)

    def test_copied_receipt_cannot_double_charge_another_id(self):
        self.finish()
        other = self.out / 'results/2'
        for name in ('batch-origin.json', 'batch-receipt.json', 'started.json'):
            self.save(other / name, json.loads((self.directory / name).read_text()))
        with self.assertRaises(ValueError):
            C.charge_state(other)


if __name__ == '__main__':
    unittest.main()
