"""Versioned native-batch nullable-schema compatibility for Fresh-1.

Only the wire response_format changes: the original quiz-object-or-null union
becomes the same constrained object with type ['object', 'null']. Google documents
this nullable representation at https://ai.google.dev/gemini-api/docs/structured-output.
The original messages and T.validate remain unchanged. Batch v1 artifacts and
validators are never modified. This module performs no writes or network calls.
"""
import collections
import copy
from pathlib import Path

import fresh_batch_contract as V1

T = V1.T
MODEL, CANONICAL_MODEL, MODELS = V1.MODEL, V1.CANONICAL_MODEL, V1.MODELS
INPUT_PER_MILLION = V1.INPUT_PER_MILLION
COMPLETION_PER_MILLION = V1.COMPLETION_PER_MILLION
ALLOCATION_METHOD = V1.ALLOCATION_METHOD
validate_batch = V1.validate_batch
SCHEMA_ENCODING = 'nullable_object_type_array_v2'


def batch_payload(entry, prompt):
    value = V1.batch_payload(entry, prompt)
    properties = value['response_format']['json_schema']['schema']['properties']
    original = properties['proposed']
    if (set(original) != {'anyOf'} or len(original['anyOf']) != 2
            or original['anyOf'][1] != {'type': 'null'}
            or original['anyOf'][0].get('type') != 'object'):
        raise ValueError('Frozen nullable proposal schema changed')
    proposed = copy.deepcopy(original['anyOf'][0])
    proposed['type'] = ['object', 'null']
    properties['proposed'] = proposed
    return value


def _batch_dir(fresh_out, value, version=2):
    namespace = 'bulk-v2' if version == 2 else 'bulk' if version == 1 else None
    if namespace is None:
        raise ValueError('Unsupported batch origin version')
    root = (Path(fresh_out) / namespace / 'batches').resolve()
    directory = Path(value).resolve(strict=True)
    if not directory.is_relative_to(root) or directory.parent != root:
        raise ValueError('Batch provenance escapes its versioned Fresh directory')
    return directory


def make_origin(entry, batch_dir):
    # V1's origin builder binds the genuine submitted body, not its Flex hash.
    value = V1.make_origin(entry, batch_dir)
    value.update(version=2, schema_encoding=SCHEMA_ENCODING)
    return value


def _bound_origin(origin):
    if (origin.get('version') != 2 or origin.get('kind') != 'cloud_batch'
            or origin.get('schema_encoding') != SCHEMA_ENCODING):
        raise ValueError('Unsupported v2 cloud batch provenance')
    directory = Path(origin['batch_dir']).resolve(strict=True)
    envelope, accepted, request_sha, accepted_sha = V1._envelope(directory)
    if (origin['batch_id'] != accepted['id'] or origin['request_file_sha256'] != request_sha
            or origin['accepted_file_sha256'] != accepted_sha):
        raise ValueError('Accepted v2 batch provenance changed')
    rows = [row for row in envelope['requests'] if row['custom_id'] == origin['custom_id']]
    if len(rows) != 1 or T.digest(rows[0]['body']) != origin['request_body_sha256']:
        raise ValueError('Submitted v2 request provenance changed')
    return directory, envelope


def make_receipt(origin):
    directory, _ = _bound_origin(origin)
    terminal_path = directory / 'terminal.json'
    checked, terminal_sha = V1._checked_terminal(
        V1._signature(directory / 'request.json'), V1._signature(terminal_path))
    if checked['batch_id'] != origin['batch_id']:
        raise ValueError('Terminal identity does not match v2 acceptance')
    identifier = origin['custom_id']
    allocation = checked['allocations'][identifier]
    body = (checked['results'][identifier].get('response') or {}).get('body')
    return {'version': 2, 'kind': 'cloud_batch', 'batch_id': origin['batch_id'],
        'custom_id': identifier, 'terminal_path': str(terminal_path),
        'terminal_file_sha256': terminal_sha,
        'batch_received_cost_usd': checked['received_cost_usd'],
        'allocated_received_cost_usd': allocation['received_cost_usd'],
        'cost_allocation_method': ALLOCATION_METHOD,
        'response_body_sha256': T.digest(body) if isinstance(body, dict) else None,
        'request_count': checked['request_counts']['total'],
        'received_usage': allocation['received_usage'], 'usage_basis': allocation['usage_basis']}


def immutable_dependency_paths(fresh_out, entry, prompt):
    result_dir = T.directory(Path(fresh_out), entry)
    origin, _ = V1._read(result_dir / 'batch-origin.json')
    if origin.get('version') != 2:
        raise ValueError('V2 candidate requires a v2 origin')
    directory = _batch_dir(fresh_out, origin['batch_dir'])
    return [result_dir / name for name in ('batch-origin.json', 'batch-receipt.json',
        'request.json', 'response.json')] + [directory / name
        for name in ('request.json', 'accepted.json', 'terminal.json')]


def verify_saved_candidate(fresh_out, entry, prompt):
    fresh_out = Path(fresh_out)
    result_dir = T.directory(fresh_out, entry)
    origin, _ = V1._read(result_dir / 'batch-origin.json')
    directory = _batch_dir(fresh_out, origin['batch_dir'])
    if origin != make_origin(entry, directory):
        raise ValueError('Original Fresh entry or immutable v2 origin changed')
    request, _ = V1._read(result_dir / 'request.json')
    if request != batch_payload(entry, prompt) or T.digest(request) != origin['request_body_sha256']:
        raise ValueError('Fresh prompt or English-only v2 request changed')
    receipt, _ = V1._read(result_dir / 'batch-receipt.json')
    if receipt != make_receipt(origin):
        raise ValueError('V2 receipt or terminal billing changed')
    raw, _ = V1._read(result_dir / 'response.json')
    checked, _ = V1._checked_terminal(V1._signature(directory / 'request.json'),
                                      V1._signature(directory / 'terminal.json'))
    record = checked['results'][origin['custom_id']]
    response = record.get('response') or {}
    if (record.get('error') or response.get('status_code') != 200
            or raw != response.get('body') or T.digest(raw) != receipt['response_body_sha256']):
        raise ValueError('Saved response is not the successful v2 batch output')
    return raw


def reconcile_failed_zero_cost(status, requests):
    """Validate an all-failed, explicitly unbilled terminal without importing it.

    This narrow failure path does not relax validate_batch. A missing aggregate
    bill, partial coverage, any response, any token use, or nonzero cost fails
    closed and keeps the request reservation for separate reconciliation.
    """
    identifiers = V1._requests(requests)
    if (not isinstance(status, dict) or status.get('status') not in ('completed', 'failed')
            or status.get('model') not in MODELS
            or status.get('endpoint') != '/v1/chat/completions'
            or not isinstance(status.get('id'), str) or not status['id']):
        raise ValueError('Not a recognized terminal batch failure')
    counts = status.get('request_counts')
    if not isinstance(counts, dict):
        raise ValueError('Missing failed batch counts')
    for key in ('total', 'completed', 'failed'):
        V1._integer(counts.get(key), key)
    if counts != {'total': len(identifiers), 'completed': 0, 'failed': len(identifiers)}:
        raise ValueError('Batch is not an exact all-failed result')
    tokens = V1._usage(status.get('usage'), billing=True)
    if any(tokens.values()) or status['usage']['cost'] != 0:
        raise ValueError('Failure receipt is not explicitly zero usage and zero cost')
    if 'total_tokens' in status['usage']:
        if V1._integer(status['usage']['total_tokens'], 'total_tokens') != 0:
            raise ValueError('Nonzero failed batch total token usage')
    results = status.get('results')
    if not isinstance(results, list) or len(results) != len(identifiers):
        raise ValueError('Failed batch lacks exact result coverage')
    mapped = {}
    for record in results:
        if not isinstance(record, dict):
            raise ValueError('Invalid failed request record')
        identifier = record.get('custom_id')
        if identifier not in identifiers or identifier in mapped:
            raise ValueError('Unknown or duplicate failed request ID')
        if (record.get('response') is not None or not isinstance(record.get('error'), dict)
                or not record['error']):
            raise ValueError('Failure reconciliation requires explicit error and no response')
        mapped[identifier] = record
    if set(mapped) != set(identifiers):
        raise ValueError('Failed result IDs do not match submitted requests')
    return {'batch_id': status['id'], 'received_cost_usd': 0,
        'usage': status['usage'], 'results': mapped, 'request_counts': counts}


def make_failure_receipt(origin):
    """Build a separate receipt for verified zero-cost failed v1/v2 requests."""
    if origin.get('version') == 1:
        directory, envelope = V1._bound_origin(origin)
    else:
        directory, envelope = _bound_origin(origin)
    terminal_path = directory / 'terminal.json'
    terminal, terminal_sha = V1._read(terminal_path)
    checked = reconcile_failed_zero_cost(terminal, envelope['requests'])
    if checked['batch_id'] != origin['batch_id']:
        raise ValueError('Failed terminal identity differs from accepted batch')
    if origin['custom_id'] not in checked['results']:
        raise ValueError('Request is absent from failed terminal')
    return {'version': 2, 'kind': 'cloud_batch_failure_reconciliation',
        'batch_id': origin['batch_id'], 'custom_id': origin['custom_id'],
        'origin_sha256': T.digest(origin), 'terminal_path': str(terminal_path),
        'terminal_file_sha256': terminal_sha,
        'request_file_sha256': origin['request_file_sha256'],
        'accepted_file_sha256': origin['accepted_file_sha256'],
        'batch_received_cost_usd': 0, 'allocated_received_cost_usd': 0,
        'request_count': checked['request_counts']['total'],
        'received_usage': {'prompt_tokens': 0, 'completion_tokens': 0, 'reasoning_tokens': 0},
        'usage_basis': 'verified_zero_usage_all_failed'}


def charge_state(directory):
    directory = Path(directory)
    failure_path = directory / 'batch-failure-receipt.json'
    origin_path = directory / 'batch-origin.json'
    started_path = directory / 'started.json'
    started = V1._read(started_path)[0] if started_path.exists() else {}
    origin = V1._read(origin_path)[0] if origin_path.exists() else {}
    if not failure_path.exists() and origin.get('version') != 2:
        return V1.charge_state(directory)
    reserved = V1._number(started.get('reserved_usd'), 'request reservation')
    batch_dir = _batch_dir(directory.parent.parent, origin['batch_dir'], origin.get('version'))
    if (origin.get('custom_id') != directory.name
            or started.get('request_sha256') != origin.get('request_body_sha256')
            or Path(started.get('batch_dir', '')).resolve() != batch_dir):
        raise ValueError('Versioned batch accounting origin does not belong to request')
    if failure_path.exists():
        receipt, _ = V1._read(failure_path)
        if (directory / 'batch-receipt.json').exists() or receipt != make_failure_receipt(origin):
            raise ValueError('Conflicting or unverified failed-batch billing receipt')
        return 0.0, 0.0, collections.Counter(receipt['received_usage'])
    receipt_path = directory / 'batch-receipt.json'
    if not receipt_path.exists():
        return 0.0, reserved, collections.Counter()
    receipt, _ = V1._read(receipt_path)
    if receipt != make_receipt(origin):
        raise ValueError('Versioned batch accounting receipt is unverified')
    return receipt['allocated_received_cost_usd'], 0.0, collections.Counter(receipt['received_usage'])
