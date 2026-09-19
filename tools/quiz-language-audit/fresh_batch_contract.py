"""Authentic cloud-batch provenance and billing for Fresh-1 translations.

Raw provider responses are never decorated with invented Flex metadata or costs.
The terminal batch bill is authoritative; per-item receipts explicitly allocate
that bill for existing result-ledger consumers. This module performs no I/O
mutations or network requests.
"""
import collections
import functools
import hashlib
import math
from pathlib import Path

import gemini_translator as T

MODEL = T.MODEL
CANONICAL_MODEL = 'google/gemini-3.8-flash-20260902'
MODELS = (MODEL, CANONICAL_MODEL)
INPUT_PER_MILLION = .375
COMPLETION_PER_MILLION = 1.875
ALLOCATION_METHOD = 'equal_share_of_batch_actual_cost'


def batch_payload(entry, prompt):
    """Keep the exact English-only Fresh contract, using genuine batch routing."""
    value = T.payload(entry, prompt)
    del value['service_tier']
    del value['provider']
    return value


def _number(value, name):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError('Invalid nonnegative finite ' + name)
    return value


def _integer(value, name):
    if type(value) is not int or value < 0:
        raise ValueError('Invalid nonnegative integer ' + name)
    return value


def _usage(value, *, billing=False):
    if not isinstance(value, dict):
        raise ValueError('Missing batch usage' if billing else 'Missing response usage')
    usage = {key: _integer(value.get(key), key)
             for key in ('prompt_tokens', 'completion_tokens')}
    details = value.get('completion_tokens_details') or {}
    reasoning = details.get('reasoning_tokens', value.get('reasoning_tokens', 0))
    usage['reasoning_tokens'] = _integer(reasoning, 'reasoning_tokens')
    if usage['reasoning_tokens'] > usage['completion_tokens']:
        raise ValueError('Reasoning tokens exceed completion tokens')
    if billing:
        cost = _number(value.get('cost'), 'batch cost')
        if value.get('is_byok') is not False:
            raise ValueError('Batch billing must explicitly be non-BYOK')
        cap = (INPUT_PER_MILLION * usage['prompt_tokens'] +
               COMPLETION_PER_MILLION * usage['completion_tokens']) / 1e6
        # Reasoning is already included in completion_tokens.
        if cost > cap + 1e-6:
            raise ValueError('Batch actual cost exceeds authorized prices')
    return usage


def _requests(requests):
    if not isinstance(requests, list) or not 1 <= len(requests) <= 500:
        raise ValueError('Cloud batch must contain 1 to 500 requests')
    identifiers, schema = [], None
    for request in requests:
        identifier, body = request.get('custom_id'), request.get('body')
        if not isinstance(identifier, str) or not identifier or identifier in identifiers:
            raise ValueError('Batch custom IDs must be nonempty and unique')
        if not isinstance(body, dict) or body.get('model') != MODEL:
            raise ValueError('Unexpected request model')
        if 'service_tier' in body or 'provider' in body:
            raise ValueError('Cloud batch must not claim Flex request routing')
        current = T.digest(body.get('response_format'))
        if schema is not None and current != schema:
            raise ValueError('Google batch response_format must be identical')
        schema = current
        identifiers.append(identifier)
    return identifiers


def validate_batch(status, requests):
    """Validate terminal coverage and real aggregate billing, not quiz semantics.

    Per-request transport failures remain in ``results`` for quarantine. The
    caller applies T.validate to each successful response independently.
    """
    identifiers = _requests(requests)
    if not isinstance(status, dict) or status.get('status') != 'completed':
        raise ValueError('Batch is not completed with reconcilable billing')
    if status.get('model') not in MODELS or status.get('endpoint') != '/v1/chat/completions':
        raise ValueError('Unexpected batch model or endpoint')
    if not isinstance(status.get('id'), str) or not status['id'] or status.get('error'):
        raise ValueError('Invalid terminal batch identity or batch-level error')
    counts = status.get('request_counts')
    if not isinstance(counts, dict):
        raise ValueError('Missing terminal request counts')
    for key in ('total', 'completed', 'failed'):
        _integer(counts.get(key), 'request_counts.' + key)
    if counts['total'] != len(identifiers) or counts['completed'] + counts['failed'] != len(identifiers):
        raise ValueError('Terminal batch counts do not cover all requests')
    aggregate = _usage(status.get('usage'), billing=True)
    results = status.get('results')
    if not isinstance(results, list) or len(results) != len(identifiers):
        raise ValueError('Missing or extra batch results')
    mapped, native = {}, {}
    successes = 0
    for result in results:
        if not isinstance(result, dict):
            raise ValueError('Malformed batch result')
        identifier = result.get('custom_id')
        if identifier not in identifiers or identifier in mapped:
            raise ValueError('Unknown or duplicate result custom ID')
        mapped[identifier] = result
        response = result.get('response')
        if response is not None and not isinstance(response, dict):
            raise ValueError('Malformed result response')
        body = (response or {}).get('body')
        success = (response or {}).get('status_code') == 200 and not result.get('error')
        if success:
            successes += 1
            if not isinstance(body, dict) or body.get('model') not in MODELS:
                raise ValueError('Unexpected batch result model')
            if body.get('provider') not in ('Google', 'Google AI Studio'):
                raise ValueError('Unexpected batch result provider')
            if body.get('service_tier') not in (None, 'batch', 'default'):
                raise ValueError('Unexpected service tier in genuine batch result')
        if isinstance(body, dict) and body.get('usage') is not None:
            native[identifier] = _usage(body['usage'])
            if 'is_byok' in body['usage'] and body['usage']['is_byok'] is not False:
                raise ValueError('Unexpected BYOK result usage')
            if 'cost' in body['usage']:
                # Native item cost, when returned, is real metadata but does not
                # replace the authoritative terminal bill or receipt allocation.
                native_cost = _number(body['usage']['cost'], 'native result cost')
                native_cap = (INPUT_PER_MILLION * native[identifier]['prompt_tokens'] +
                    COMPLETION_PER_MILLION * native[identifier]['completion_tokens']) / 1e6
                if native_cost > native_cap + 1e-6:
                    raise ValueError('Native result cost exceeds authorized prices')
    if set(mapped) != set(identifiers) or successes != counts['completed']:
        raise ValueError('Result outcomes disagree with terminal coverage counts')
    missing = [identifier for identifier in identifiers if identifier not in native]
    allocated_usage = {identifier: {} for identifier in missing}
    for token in ('prompt_tokens', 'completion_tokens'):
        remainder = aggregate[token] - sum(value[token] for value in native.values())
        if remainder < 0:
            raise ValueError('Native token usage exceeds terminal aggregate')
        if missing:
            quotient, residual = divmod(remainder, len(missing))
            for index, identifier in enumerate(missing):
                allocated_usage[identifier][token] = quotient + (index < residual)
    # Missing per-item reasoning is not invented. Zero denotes unreported in
    # the explicitly estimated allocation; raw aggregate metadata is retained.
    for value in allocated_usage.values():
        value['reasoning_tokens'] = 0
    total = status['usage']['cost']
    share, assigned = total / len(identifiers), 0.0
    allocations = {}
    for index, identifier in enumerate(identifiers):
        amount = total - assigned if index == len(identifiers) - 1 else share
        assigned += amount
        allocations[identifier] = {'received_cost_usd': amount,
            'received_usage': native.get(identifier, allocated_usage.get(identifier)),
            'usage_basis': 'native_response' if identifier in native else 'allocated_batch_usage'}
    return {'batch_id': status['id'], 'usage': status['usage'],
        'received_cost_usd': total, 'request_counts': counts,
        'results': mapped, 'allocations': allocations}


def _signature(path):
    path = Path(path).resolve(strict=True)
    stat = path.stat()
    return str(path), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns


@functools.lru_cache(maxsize=2048)
def _file(signature):
    data = Path(signature[0]).read_bytes()
    return T.parse(data.decode()), hashlib.sha256(data).hexdigest()


def _read(path):
    return _file(_signature(path))


def _batch_dir(fresh_out, value):
    root = (Path(fresh_out) / 'bulk/batches').resolve()
    directory = Path(value).resolve(strict=True)
    if not directory.is_relative_to(root) or directory.parent != root:
        raise ValueError('Batch provenance escapes Fresh-1 batch directory')
    return directory


@functools.lru_cache(maxsize=128)
def _cached_envelope(request_signature, accepted_signature):
    envelope, request_sha = _file(request_signature)
    accepted, accepted_sha = _file(accepted_signature)
    if envelope.get('endpoint') != '/v1/chat/completions' or envelope.get('model') != MODEL:
        raise ValueError('Unexpected submitted batch envelope')
    identifiers = _requests(envelope.get('requests'))
    if (not isinstance(accepted.get('id'), str) or not accepted['id']
            or accepted.get('model') not in MODELS
            or accepted.get('endpoint') != '/v1/chat/completions'
            or accepted.get('request_counts', {}).get('total') != len(identifiers)):
        raise ValueError('Acceptance does not match submitted batch')
    return envelope, accepted, request_sha, accepted_sha


def _envelope(batch_dir):
    return _cached_envelope(_signature(batch_dir / 'request.json'),
                            _signature(batch_dir / 'accepted.json'))


def make_origin(entry, batch_dir):
    """Build the immutable origin after an unambiguous accepted submission."""
    batch_dir = Path(batch_dir).resolve(strict=True)
    envelope, accepted, request_sha, accepted_sha = _envelope(batch_dir)
    identifier = str(entry['sample_id'])
    rows = [row for row in envelope['requests'] if row['custom_id'] == identifier]
    if len(rows) != 1:
        raise ValueError('Entry is absent from submitted batch')
    return {'version': 1, 'kind': 'cloud_batch', 'batch_id': accepted['id'],
        'custom_id': identifier, 'batch_dir': str(batch_dir),
        'request_file_sha256': request_sha, 'accepted_file_sha256': accepted_sha,
        'request_body_sha256': T.digest(rows[0]['body']), 'entry_sha256': T.digest(entry)}


def _bound_origin(origin):
    if origin.get('version') != 1 or origin.get('kind') != 'cloud_batch':
        raise ValueError('Unsupported cloud batch provenance')
    batch_dir = Path(origin['batch_dir']).resolve(strict=True)
    envelope, accepted, request_sha, accepted_sha = _envelope(batch_dir)
    if (origin['batch_id'] != accepted['id'] or origin['request_file_sha256'] != request_sha
            or origin['accepted_file_sha256'] != accepted_sha):
        raise ValueError('Accepted batch provenance changed')
    rows = [row for row in envelope['requests'] if row['custom_id'] == origin['custom_id']]
    if len(rows) != 1 or T.digest(rows[0]['body']) != origin['request_body_sha256']:
        raise ValueError('Submitted request provenance changed')
    return batch_dir, envelope


@functools.lru_cache(maxsize=128)
def _checked_terminal(request_signature, terminal_signature):
    envelope, _ = _file(request_signature)
    terminal, terminal_sha = _file(terminal_signature)
    return validate_batch(terminal, envelope['requests']), terminal_sha


def make_receipt(origin):
    """Allocate the real terminal bill without modifying any provider response."""
    batch_dir, _ = _bound_origin(origin)
    terminal_path = batch_dir / 'terminal.json'
    checked, terminal_sha = _checked_terminal(
        _signature(batch_dir / 'request.json'), _signature(terminal_path))
    if checked['batch_id'] != origin['batch_id']:
        raise ValueError('Terminal identity does not match acceptance')
    identifier = origin['custom_id']
    allocation = checked['allocations'][identifier]
    body = (checked['results'][identifier].get('response') or {}).get('body')
    return {'version': 1, 'kind': 'cloud_batch', 'batch_id': origin['batch_id'],
        'custom_id': identifier, 'terminal_path': str(terminal_path),
        'terminal_file_sha256': terminal_sha,
        'batch_received_cost_usd': checked['received_cost_usd'],
        'allocated_received_cost_usd': allocation['received_cost_usd'],
        'cost_allocation_method': ALLOCATION_METHOD,
        'response_body_sha256': T.digest(body) if isinstance(body, dict) else None,
        'request_count': checked['request_counts']['total'],
        'received_usage': allocation['received_usage'], 'usage_basis': allocation['usage_basis']}


def immutable_dependency_paths(fresh_out, entry, prompt):
    """Paths whose fingerprints must participate in downstream cache identity."""
    result_dir = T.directory(Path(fresh_out), entry)
    origin, _ = _read(result_dir / 'batch-origin.json')
    batch_dir = _batch_dir(fresh_out, origin['batch_dir'])
    return [result_dir / name for name in ('batch-origin.json', 'batch-receipt.json',
        'request.json', 'response.json')] + [batch_dir / name
        for name in ('request.json', 'accepted.json', 'terminal.json')]


def verify_saved_candidate(fresh_out, entry, prompt):
    """Return the untouched response only after binding every batch dependency."""
    fresh_out = Path(fresh_out)
    result_dir = T.directory(fresh_out, entry)
    origin, _ = _read(result_dir / 'batch-origin.json')
    batch_dir = _batch_dir(fresh_out, origin['batch_dir'])
    if origin != make_origin(entry, batch_dir):
        raise ValueError('Original Fresh entry or immutable origin changed')
    request, _ = _read(result_dir / 'request.json')
    if request != batch_payload(entry, prompt) or T.digest(request) != origin['request_body_sha256']:
        raise ValueError('Fresh prompt or English-only submitted request changed')
    receipt, _ = _read(result_dir / 'batch-receipt.json')
    if receipt != make_receipt(origin):
        raise ValueError('Cloud batch receipt or terminal billing changed')
    raw, _ = _read(result_dir / 'response.json')
    checked, _ = _checked_terminal(_signature(batch_dir / 'request.json'),
                                   _signature(batch_dir / 'terminal.json'))
    record = checked['results'][origin['custom_id']]
    response = record.get('response') or {}
    if (record.get('error') or response.get('status_code') != 200
            or raw != response.get('body') or T.digest(raw) != receipt['response_body_sha256']):
        raise ValueError('Saved response is not the successful batch output')
    return raw


def charge_state(directory):
    """Return received, unresolved reservation, token Counter for one result.

    Batch item charges are labeled allocations of the real aggregate bill, not
    native per-response prices. Sum these OR the batch bills, never both.
    Accepted cloud jobs may remain pending for the provider's batch window.
    """
    directory = Path(directory)
    origin_path, started_path = directory / 'batch-origin.json', directory / 'started.json'
    started = _read(started_path)[0] if started_path.exists() else {}
    if not origin_path.exists() and started.get('kind') != 'cloud_batch':
        return T.flex.charge_state(directory)
    reserved = _number(started.get('reserved_usd'), 'request reservation')
    receipt_path = directory / 'batch-receipt.json'
    if not receipt_path.exists():
        return 0.0, reserved, collections.Counter()
    origin, _ = _read(origin_path)
    batch_dir = _batch_dir(directory.parent.parent, origin['batch_dir'])
    if (origin.get('custom_id') != directory.name
            or started.get('request_sha256') != origin.get('request_body_sha256')
            or Path(started.get('batch_dir', '')).resolve() != batch_dir):
        raise ValueError('Batch accounting origin does not belong to this request')
    receipt, _ = _read(receipt_path)
    if receipt != make_receipt(origin):
        raise ValueError('Batch accounting receipt changed or is unverified')
    return receipt['allocated_received_cost_usd'], 0.0, collections.Counter(receipt['received_usage'])
