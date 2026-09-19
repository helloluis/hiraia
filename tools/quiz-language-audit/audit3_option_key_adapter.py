"""Lossless option-check labels for the separate Audit-3 v4 wire candidate.

This local adapter is not evidence of provider compatibility.
Only checks property names options[i] <-> option_i change. All other schema
constraints, quiz text, option order, generation settings and system prose stay
as supplied. adapt_payload also changes labels in the embedded response_schema
inside the user message, so the model receives one consistent naming convention.
The frozen system prompt contains no options[i] literals and needs no change.

validate_wire_response keeps the original raw object and message content intact,
maps a separate copy, then calls the original gemini_auditor.validate. The result
uses original option labels. The v4 runner saves untouched raw responses
and records this encoding separately; it must not present the decoded copy as a
provider response. This module does no I/O beyond importing the local validator.

Equivalence covers parsed JSON values under the label bijection. Duplicate JSON
members and nonfinite JSON constants are rejected as protocol errors rather than
being silently collapsed by json.loads. No billing/model validation is performed
here: the original batch provenance and billing checks would still be required.
"""
from copy import deepcopy
import json
import gemini_auditor as original_auditor


ENCODING = 'checks_option_underscore_v1'


def option_names(count):
    if type(count) is not int or not 2 <= count <= 10:
        raise ValueError('Option count must be an integer from 2 through 10')
    return {f'options[{i}]': f'option_{i}' for i in range(count)}


def _mapping(count, inverse):
    names = option_names(count)
    return {v: k for k, v in names.items()} if inverse else names


def _expected(names):
    return {'q', 'explanation', *names}


def _map_schema(schema, count, inverse):
    names = _mapping(count, inverse)
    result = deepcopy(schema)
    try:
        checks = result['properties']['checks']
        properties, required = checks['properties'], checks['required']
    except (KeyError, TypeError):
        raise ValueError('Expected the original audit checks object schema') from None
    if (not isinstance(properties, dict) or set(properties) != _expected(names)
            or not isinstance(required, list) or len(required) != len(properties)
            or not all(isinstance(k, str) for k in required)
            or set(required) != set(properties)):
        raise ValueError('Unexpected, missing or ambiguous audit field names')
    checks['properties'] = {names.get(k, k): v for k, v in properties.items()}
    checks['required'] = [names.get(k, k) for k in required]
    return result


def to_wire_schema(schema, count):
    """Copy the schema, changing only option property names and required labels."""
    return _map_schema(schema, count, inverse=False)


def from_wire_schema(schema, count):
    """Inverse of to_wire_schema; useful for offline equivalence verification."""
    return _map_schema(schema, count, inverse=True)


def _map_diagnosis(parsed, count, inverse):
    names = _mapping(count, inverse)
    if not isinstance(parsed, dict) or not isinstance(parsed.get('checks'), dict):
        raise ValueError('Audit checks must be an object')
    if set(parsed['checks']) != _expected(names):
        raise ValueError('Unexpected, missing or ambiguous audit field names')
    result = deepcopy(parsed)
    result['checks'] = {names.get(k, k): v for k, v in result['checks'].items()}
    return result


def to_wire_diagnosis(parsed, count):
    """Encode an existing parsed diagnosis, for offline fixtures and round trips."""
    return _map_diagnosis(parsed, count, inverse=False)


def from_wire_diagnosis(parsed, count):
    """Decode fields without repairing, dropping, or changing diagnosis values."""
    return _map_diagnosis(parsed, count, inverse=True)


def parse_json(text):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Duplicate JSON member')
            result[key] = value
        return result

    def nonfinite(_):
        raise ValueError('Nonfinite JSON constant')

    return json.loads(text, object_pairs_hook=unique, parse_constant=nonfinite)


def adapt_payload(payload, count):
    """Adapt an existing audit payload; leave routing and generation values alone.

    The explicit-type wire schema and the original embedded prompt schema can
    differ, as they do in frozen Audit-3 v3. Each is renamed independently; no
    constraints are copied between them. This is not a generic message adapter.
    """
    result = deepcopy(payload)
    try:
        envelope = result['response_format']['json_schema']
        messages = result['messages']
        if (len(messages) != 2 or messages[0]['role'] != 'system'
                or messages[1]['role'] != 'user'):
            raise ValueError('Expected the original two-message audit payload')
        data = parse_json(messages[1]['content'])
        if not isinstance(data, dict) or set(data) != {'quiz', 'response_schema'}:
            raise ValueError('Expected the original quiz and response_schema data')
        if len(data['quiz']['target']['options']) != count:
            raise ValueError('Payload option count mismatch')
        envelope['schema'] = to_wire_schema(envelope['schema'], count)
        data['response_schema'] = to_wire_schema(data['response_schema'], count)
        messages[1]['content'] = json.dumps(data, ensure_ascii=False,
                                           sort_keys=True, separators=(',', ':'),
                                           allow_nan=False)
    except (KeyError, TypeError, IndexError):
        raise ValueError('Malformed original audit payload') from None
    return result


def validate_wire_response(raw, content):
    """Preserve raw, inverse-map a copy, and use the original audit validator."""
    count = len(content['target']['options'])
    try:
        parsed = parse_json(raw['choices'][0]['message']['content'])
    except (KeyError, TypeError, IndexError):
        raise ValueError('Malformed received audit response') from None
    diagnosis = from_wire_diagnosis(parsed, count)
    decoded = deepcopy(raw)
    decoded['choices'][0]['message']['content'] = json.dumps(
        diagnosis, ensure_ascii=False, allow_nan=False)
    return original_auditor.validate(decoded, content)
