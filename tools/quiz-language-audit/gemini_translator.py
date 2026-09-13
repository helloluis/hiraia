"""Bounded English-only Gemini Flex translation trials; never applies source edits.

Each card is an independent request. Durable attempt records are never retried,
including interrupted requests. A --limit canary can precede the remaining trial.
"""
import argparse
import collections
import concurrent.futures
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import sys
import time
import urllib.error
import urllib.request

import gemini_rewriter as rewrite

flex = rewrite.flex

MODEL = flex.MODEL
URL = flex.URL
TIMEOUT_SECONDS = 900
ATTEMPT_FILES = ('request.json', 'started.json', 'response.txt', 'response.json', 'final.json', 'error.json')
STATUSES = ('proposal', 'held', 'rejected', 'error', 'interrupted', 'pending')
# Reuse the proven storage, strict JSON, and billing helpers without changing
# another runner's globals or its diagnosis-guided editing contract.
write, canonical, digest = rewrite.write, rewrite.canonical, rewrite.digest
unique_object, parse, read = rewrite.unique_object, rewrite.parse, rewrite.read
credential = rewrite.credential


def schema(item):
    count = len(item['job']['content']['english']['options'])
    quiz = {'type': 'object', 'additionalProperties': False,
        'required': ['q', 'options', 'explanation'], 'properties': {
            'q': {'type': 'string'}, 'explanation': {'type': 'string'},
            'options': {'type': 'array', 'minItems': count, 'maxItems': count,
                'items': {'type': 'string'}}}}
    return {'type': 'object', 'additionalProperties': False,
        'required': ['status', 'proposed', 'note'], 'properties': {
            'status': {'type': 'string', 'enum': ['translated', 'hold']},
            'proposed': {'anyOf': [quiz, {'type': 'null'}]},
            'note': {'type': 'string'}}}


def payload(item, prompt):
    # Explicit allowlist: never serialize target, audit, answer, topic, references,
    # previous proposals, or target-language source context into the request.
    content = item['job']['content']
    response_schema = schema(item)
    data = {'english': {key: content['english'][key]
                       for key in ('q', 'options', 'explanation')},
        'grades': content['grades'],
        'language': flex.audit.e.a.LANGUAGES[content['language']],
        'source_context_english': content.get('source_fact', {}).get('en')}
    return {'model': MODEL, 'temperature': 0, 'max_tokens': 8000,
        'reasoning': {'effort': 'low', 'exclude': True}, 'service_tier': 'flex',
        'provider': {'only': ['google-ai-studio/flex'], 'require_parameters': True,
            'allow_fallbacks': False, 'max_price': {'prompt': .375, 'completion': 1.875}},
        'response_format': {'type': 'json_schema', 'json_schema': {
            'name': 'translation', 'strict': True, 'schema': response_schema}},
        'messages': [{'role': 'system', 'content': prompt}, {'role': 'user',
            'content': canonical({'quiz': data, 'response_schema': response_schema})}]}


def reservation(value):
    return ((len(canonical(value).encode()) + 4096) * .375 + 8000 * 1.875) / 1e6


def fields(quiz):
    return {'q': quiz['q'], 'explanation': quiz['explanation'],
            **{f'options[{index}]': value for index, value in enumerate(quiz['options'])}}


def validate(raw, item):
    choice = raw['choices'][0]
    if choice.get('finish_reason') != 'stop':
        raise ValueError('Incomplete response: ' + str(choice.get('finish_reason')))
    result = parse(choice['message']['content'])
    flex.audit.e.validate(result, schema(item))
    if not result['note'].strip():
        raise ValueError('Empty translation note')
    if result['status'] == 'hold':
        if result['proposed'] is not None:
            raise ValueError('Hold must have null proposal')
        return {'status': 'held', 'result': result, 'changes': []}
    if result['proposed'] is None:
        raise ValueError('Translated must have full proposal')
    original = item['job']['content']['english']
    before, after = fields(original), fields(result['proposed'])
    for field, value in after.items():
        if not value.strip() or not any(character.isalnum() for character in value):
            raise ValueError('Empty or punctuation-only translation field: ' + field)
    proposed = result['proposed']['options']
    normalized = lambda text: ' '.join(text.casefold().split())
    for index, value in enumerate(proposed):
        # Exact verbatim moves can be rejected mechanically; translated option
        # alignment and semantic preservation still require independent review.
        if value != original['options'][index] and value in original['options']:
            raise ValueError('English option moved from its original position')
        for earlier in range(index):
            if (normalized(value) == normalized(proposed[earlier]) and
                    normalized(original['options'][index]) != normalized(original['options'][earlier])):
                raise ValueError('Distinct English options collapsed into duplicate translations')
    return {'status': 'proposal', 'result': result,
            'changes': [{'field': field, 'before': before[field], 'after': value}
                        for field, value in after.items() if value != before[field]]}


def validate_sample(items):
    if not isinstance(items, list) or not 1 <= len(items) <= 50:
        raise ValueError('Trial requires 1 to 50 sample entries')
    keys, ids = set(), set()
    for item in items:
        number = item['sample_id']
        key, content = item['job']['key'], item['job']['content']
        if type(number) is not int or number <= 0 or number in ids:
            raise ValueError('Sample IDs must be unique positive integers')
        if not isinstance(key, str) or not key or key in keys:
            raise ValueError('Job keys must be unique nonempty strings')
        if content['language'] not in ('tl', 'bis'):
            raise ValueError('Only Filipino/Cebuano trial jobs are eligible')
        english = content['english']
        if not isinstance(english, dict) or set(english) != {'q', 'options', 'explanation'}:
            raise ValueError('English quiz must contain only q/options/explanation')
        if not isinstance(english['options'], list) or not 2 <= len(english['options']) <= 10:
            raise ValueError('English quiz must have 2 to 10 ordered options')
        if any(not isinstance(value, str) or not value.strip() for value in fields(english).values()):
            raise ValueError('English quiz fields must be nonempty strings')
        if (not isinstance(content['grades'], list) or not content['grades'] or
                any(type(grade) is not int or not 1 <= grade <= 12 for grade in content['grades'])):
            raise ValueError('Grades must be a nonempty list of school grade numbers')
        context = content.get('source_fact', {}).get('en')
        if context is not None and not isinstance(context, str):
            raise ValueError('English source context must be string or null')
        keys.add(key)
        ids.add(number)


def directory(out, item):
    return out / 'results' / str(item['sample_id'])


def attempted(out, item):
    return any((directory(out, item) / name).exists() for name in ATTEMPT_FILES)


def prepare(args, items, prompt):
    validate_sample(items)
    if not prompt.strip():
        raise ValueError('Empty translation prompt')
    if not flex.valid_number(args.budget) or not 0 < args.budget <= 2:
        raise ValueError('This trial requires a positive budget no greater than $2')
    payloads = {str(item['sample_id']): payload(item, prompt) for item in items}
    ceilings = {key: reservation(value) for key, value in payloads.items()}
    if sum(ceilings.values()) > args.budget:
        raise ValueError('All conservative request reservations exceed trial budget')
    dependencies = (Path(__file__), Path(rewrite.__file__), Path(rewrite.qwen.__file__),
                    Path(flex.__file__), Path(flex.audit.__file__),
                    Path(flex.audit.e.__file__), Path(flex.audit.e.a.__file__))
    config = {'model': MODEL, 'service_tier': 'flex', 'sample_sha256': digest(items),
        'prompt_sha256': digest(prompt), 'payload_sha256': {key: digest(value) for key, value in payloads.items()},
        'dependencies_sha256': {str(path.relative_to(flex.audit.REPO)):
            hashlib.sha256(path.read_bytes()).hexdigest() for path in dependencies},
        'budget_usd': args.budget, 'concurrency': args.concurrency, 'timeout_seconds': TIMEOUT_SECONDS,
        'total': len(items), 'max_tokens': 8000, 'automatic_retries': 0,
        'input_per_million_usd': .375, 'completion_per_million_usd': 1.875,
        'total_conservative_reservations_usd': sum(ceilings.values()), 'fresh_english_only_proposals': True, 'all_fields_translated': True,
        'answer_key_sent': False, 'old_target_sent': False, 'audit_sent': False}
    target = args.out / 'config.json'
    if target.exists() and read(target) != config:
        raise ValueError('Frozen sample, prompt, payload, runner, or configuration changed')
    for item in items:
        result = directory(args.out, item)
        request_path = result / 'request.json'
        if attempted(args.out, item):
            if not request_path.exists() or read(request_path) != payloads[str(item['sample_id'])]:
                raise ValueError('Prior attempt does not match frozen request')
        final_path = result / 'final.json'
        if final_path.exists() and read(final_path)['status'] in ('proposal', 'held'):
            raw = read(result / 'response.json')
            flex.validate_billing(raw)
            if validate(raw, item) != read(final_path):
                raise ValueError('Prior final result differs from validated response')
    write(target, config)
    write(args.out / 'reservations.json', ceilings)
    for number, value in payloads.items():
        write(args.out / 'prepared_requests' / (number + '.json'), value)
    return payloads, ceilings


def request(item, out, value, ceiling, credential):
    result = directory(out, item)
    if attempted(out, item):
        raise RuntimeError('Refusing to retry attempted sample ' + str(item['sample_id']))
    write(result / 'request.json', value)
    intent = result / 'started.tmp'
    with intent.open('x') as handle:
        json.dump({'time': time.time(), 'reserved_usd': ceiling,
                   'request_sha256': digest(value)}, handle)
        handle.flush()
        os.fsync(handle.fileno())
    # Publish complete intent atomically, without overwriting an existing attempt.
    os.link(intent, result / 'started.json')
    intent.unlink()
    fatal = False
    try:
        req = urllib.request.Request(URL, data=canonical(value).encode(), headers={
            'Authorization': 'Bearer ' + credential, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            raw_text = response.read().decode('utf-8')
        (result / 'response.txt').write_text(raw_text)
        raw = parse(raw_text)
        write(result / 'response.json', raw)
        try:
            flex.validate_billing(raw)
        except Exception:
            fatal = True
            raise
        try:
            final = validate(raw, item)
        except Exception as ex:
            final = {'status': 'rejected', 'reason': str(ex), 'changes': [], 'result': None}
        write(result / 'final.json', final)
        return final['status'], False
    except Exception as ex:
        code = ex.code if isinstance(ex, urllib.error.HTTPError) else None
        fatal = fatal or code in (401, 402, 403, 404, 429)
        detail = ex.read(16000).decode(errors='replace').replace(credential, '[REDACTED]') if code else None
        write(result / 'error.json', {'error': str(ex).replace(credential, '[REDACTED]'),
            'http_status': code, 'provider_detail': detail, 'fatal': fatal,
            'time': time.time(), 'automatic_retry': False})
        return 'error', fatal


def report(out, items):
    counts = collections.Counter({status: 0 for status in STATUSES})
    tokens = collections.Counter()
    received = reserved = 0.0
    records, lines = [], ['# Gemini Flex fresh translation trial', '',
        'Proposals only. Structural validation does not establish translation quality.', '']
    for item in items:
        result, content = directory(out, item), item['job']['content']
        cost, unknown, usage = flex.charge_state(result)
        received += cost
        reserved += unknown
        tokens.update(usage)
        final_path = result / 'final.json'
        if final_path.exists():
            outcome = read(final_path)
            if outcome['status'] not in ('proposal', 'held', 'rejected'):
                raise ValueError('Unexpected final status')
        elif (result / 'error.json').exists():
            outcome = {'status': 'error', 'error': read(result / 'error.json')}
        else:
            outcome = {'status': 'interrupted' if attempted(out, item) else 'pending'}
        counts[outcome['status']] += 1
        record = {'sample_id': item['sample_id'], 'key': item['job']['key'],
            'language': content['language'], 'english': content['english'],
            'source_context_english': content.get('source_fact', {}).get('en'), **outcome}
        records.append(record)
        lines += [f'## {item["sample_id"]}. {content["language"]}: {content["english"]["q"]}', '',
            'Status: **' + outcome['status'] + '**', '', 'English:', '```json',
            json.dumps(content['english'], ensure_ascii=False, indent=2), '```', '',
            'After / outcome:', '```json', json.dumps(outcome, ensure_ascii=False, indent=2), '```', '']
    summary = {'time': time.time(), 'total': len(items), 'counts': dict(counts),
        'received_cost_usd': received, 'uncertain_charge_reserved_usd': reserved,
        'budget_accounted_usd': received + reserved, 'received_usage': dict(tokens),
        'note': 'Reasoning tokens are included in completion tokens. No automatic retries or source edits.'}
    for name, text in [('proposals.jsonl', ''.join(json.dumps(value, ensure_ascii=False) + '\n' for value in records)),
                       ('review.md', '\n'.join(lines))]:
        temporary = out / (name + '.tmp')
        temporary.write_text(text)
        temporary.replace(out / name)
    write(out / 'summary.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'run', 'report'))
    parser.add_argument('--sample', type=Path, required=True)
    parser.add_argument('--prompt-file', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--limit', type=int)
    parser.add_argument('--budget', type=float, default=2)
    parser.add_argument('--concurrency', type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error('--limit must be positive')
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        items, prompt = read(args.sample), args.prompt_file.read_text()
        payloads, ceilings = prepare(args, items, prompt)
        summary = report(args.out, items)
        if args.command != 'run':
            print(json.dumps(summary), flush=True)
            return
        previous_errors = summary['counts']['error'] + summary['counts']['rejected']
        for path in (args.out / 'results').glob('*/error.json'):
            if read(path).get('fatal'):
                raise ValueError('A prior fatal error requires investigation; spending remains stopped')
        if previous_errors >= 3:
            raise ValueError('Trial has reached its three-error limit')
        key = credential()
        pending = [item for item in items if not attempted(args.out, item)]
        if args.limit:
            pending = pending[:args.limit]
        reason = []
        def stop(signum, _frame):
            if not reason:
                reason.append(signal.Signals(signum).name)
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, stop)
        process = {'pid': os.getpid(), 'started': time.time(), 'status': 'running',
            'command': 'gemini_translator.py run', 'argv': sys.argv,
            'exact_command': shlex.join([sys.executable, *sys.argv]), 'planned_requests': len(pending)}
        write(args.out / 'process.json', process)
        errors, done, position = previous_errors, 0, 0
        active = {}
        print(json.dumps({'event': 'started', **process}), flush=True)
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                while active or position < len(pending):
                    while not reason and len(active) < args.concurrency and position < len(pending):
                        item = pending[position]
                        number = str(item['sample_id'])
                        active[pool.submit(request, item, args.out, payloads[number], ceilings[number], key)] = item
                        position += 1
                    if not active:
                        break
                    finished, _ = concurrent.futures.wait(active, timeout=1,
                        return_when=concurrent.futures.FIRST_COMPLETED)
                    for future in finished:
                        item = active.pop(future)
                        status, fatal = future.result()
                        done += 1
                        errors += status in ('error', 'rejected')
                        if fatal and not reason:
                            reason.append('fatal billing/provider error')
                        elif errors >= 3 and not reason:
                            reason.append('three trial errors')
                        print(json.dumps({'time': time.time(), 'completed_this_launch': done,
                            'sample_id': item['sample_id'], 'status': status, 'errors': errors}), flush=True)
                    if finished:
                        summary = report(args.out, items)
                        if summary['budget_accounted_usd'] > args.budget and not reason:
                            reason.append('budget exceeded; reconcile provider charge')
        except BaseException as ex:
            if not reason:
                reason.append(type(ex).__name__ + ': ' + str(ex).replace(key, '[REDACTED]'))
            raise
        finally:
            summary = report(args.out, items)
            process.update(status='stopped' if reason else 'finished', ended=time.time(),
                reason=reason[0] if reason else ('limit reached' if summary['counts']['pending'] else 'trial complete'),
                completed_this_launch=done)
            write(args.out / 'process.json', process)
            print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    main()
