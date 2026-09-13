"""Resume untouched Gemini diagnoses through verified, discounted Flex requests.

Never changes quiz sources or retries a request with any durable attempt marker.
The frozen baseline includes the original run and its controlled diagnostics.
"""
import argparse
import collections
import concurrent.futures
import csv
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import shlex
import signal
import sys
import time
import urllib.error
import urllib.request

import gemini_auditor as audit

MODEL = audit.MODEL
URL = audit.URL
INPUT_PER_MILLION = .375
OUTPUT_PER_MILLION = 1.875
TIMEOUT_SECONDS = 900
BILLING_TOLERANCE_USD = .000001
STATUSES = ('pass', 'flagged', 'needs_review', 'source_issue')
ATTEMPT_FILES = ('started.json', 'request.json', 'response.json', 'final.json', 'error.json')


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def resolved(value):
    path = Path(value)
    return path if path.is_absolute() else audit.REPO / path


def payload(content):
    value = audit.payload(content)
    value['service_tier'] = 'flex'
    value['provider'].update(only=['google-ai-studio/flex'], max_price={
        'prompt': INPUT_PER_MILLION, 'completion': OUTPUT_PER_MILLION})
    return value


def reservation(content):
    # UTF-8 bytes plus framing allowance conservatively bound prompt tokens.
    prompt_bound = len(audit.e.a.canonical(payload(content)).encode()) + 4096
    return (prompt_bound * INPUT_PER_MILLION + 8000 * OUTPUT_PER_MILLION) / 1e6


def valid_number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def validate_billing(raw):
    if not isinstance(raw, dict):
        raise ValueError('Invalid response object; stop to reconcile billing')
    if raw.get('service_tier') != 'flex':
        raise ValueError('Returned service_tier is not flex; stop discounted-route spending')
    usage = raw.get('usage') or {}
    if not isinstance(usage, dict):
        raise ValueError('Invalid billing usage object; stop to protect budget')
    if not valid_number(usage.get('cost')):
        raise ValueError('Missing or invalid billing usage.cost; stop to protect budget')
    for field in ('prompt_tokens', 'completion_tokens'):
        if type(usage.get(field)) is not int or usage[field] < 0:
            raise ValueError('Invalid billing token count: ' + field)
    if usage.get('is_byok') is not False:
        raise ValueError('Unexpected BYOK billing; stop to reconcile charges')
    ceiling = (usage['prompt_tokens'] * INPUT_PER_MILLION
               + usage['completion_tokens'] * OUTPUT_PER_MILLION) / 1e6
    if usage['cost'] > ceiling + BILLING_TOLERANCE_USD:
        raise ValueError('Reported charge exceeds uncached Flex token price; stop to reconcile billing')
    return usage['cost']


def charge_state(directory):
    """Received charge, unknown reservation, and received usage; never count reasoning twice."""
    started = read(directory / 'started.json') if (directory / 'started.json').exists() else {}
    held = started.get('reserved_usd', 0)
    if not valid_number(held):
        raise ValueError('Invalid durable request reservation')
    rawfile = directory / 'response.json'
    if not rawfile.exists():
        return 0.0, held, collections.Counter()
    raw = read(rawfile)
    usage = (raw.get('usage') or {}) if isinstance(raw, dict) else {}
    if not isinstance(usage, dict):
        usage = {}
    tokens = collections.Counter()
    for field in ('prompt_tokens', 'completion_tokens'):
        value = usage.get(field)
        if type(value) is int and value >= 0:
            tokens[field] = value
    details = usage.get('completion_tokens_details') or {}
    if not isinstance(details, dict):
        details = {}
    reasoning = details.get('reasoning_tokens')
    if type(reasoning) is int and reasoning >= 0:
        tokens['reasoning_tokens'] = reasoning
    received = usage.get('cost')
    if valid_number(received):
        return received, 0.0, tokens
    return 0.0, held, tokens


def request(job, out, credential, ceiling):
    directory = out / 'results' / job['key']
    directory.mkdir(parents=True, exist_ok=True)
    if any((directory / name).exists() for name in ATTEMPT_FILES):
        raise RuntimeError('Attempt marker exists; refusing duplicate request ' + job['key'])
    value = payload(job['content'])
    write(directory / 'request.json', value)
    # Exclusive, durable intent precedes any network request.
    with (directory / 'started.json').open('x') as handle:
        json.dump({'time': time.time(), 'reserved_usd': ceiling}, handle)
        handle.flush()
        os.fsync(handle.fileno())
    fatal = False
    try:
        req = urllib.request.Request(URL, data=audit.e.a.canonical(value).encode(), headers={
            'Authorization': 'Bearer ' + credential, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
            raw = json.load(response)
        write(directory / 'response.json', raw)
        try:
            validate_billing(raw)
        except Exception:
            fatal = True
            raise
        final = audit.validate(raw, job['content'])
        write(directory / 'final.json', final)
        received, unknown, _ = charge_state(directory)
        return False, False, received + unknown
    except Exception as ex:
        code = ex.code if isinstance(ex, urllib.error.HTTPError) else None
        fatal = fatal or code in (401, 402, 403, 404, 429)
        detail = None
        if isinstance(ex, urllib.error.HTTPError):
            detail = ex.read(16000).decode('utf-8', errors='replace').replace(credential, '[REDACTED]')
        write(directory / 'error.json', {'error': str(ex).replace(credential, '[REDACTED]'),
              'http_status': code, 'provider_detail': detail, 'fatal': fatal,
              'time': time.time(), 'automatic_retry': False})
        received, unknown, _ = charge_state(directory)
        return True, fatal, received + unknown


def baseline_data(out):
    baseline = read(out / 'baseline.json')
    original = baseline.get('report', baseline.get('source_report', baseline))
    source = resolved(baseline['source_run'])
    snapshot = resolved(baseline.get('jobs', baseline.get('source_jobs',
        'tools/quiz-language-audit/runs/2026-09-12/jobs.jsonl')))
    for field in ('received_cost_usd', 'uncertain_charge_reserved_usd'):
        if not valid_number(original.get(field)):
            raise ValueError('Invalid frozen baseline accounting: ' + field)
    if original.get('total') != 66000:
        raise ValueError('Baseline must cover the full 66000-job snapshot')
    return baseline, original, source, snapshot


def report(out, jobs):
    _, original, source, snapshot = baseline_data(out)
    flex_counts = collections.Counter()
    tokens = collections.Counter(original.get('received_usage', {}))
    received = unknown = 0.0
    errors = inflight = 0
    for job in jobs:
        directory = out / 'results' / job['key']
        spent, held, usage = charge_state(directory)
        received += spent
        unknown += held
        tokens.update(usage)
        if (directory / 'final.json').exists():
            final = read(directory / 'final.json')
            if final['status'] not in STATUSES:
                raise ValueError('Unexpected diagnosis status')
            flex_counts[final['status']] += 1
        elif (directory / 'error.json').exists():
            errors += 1
        elif any((directory / name).exists() for name in ATTEMPT_FILES):
            inflight += 1
    counts = {status: original['counts'].get(status, 0) + flex_counts[status] for status in STATUSES}
    historical = original['counts'].get('errors_or_unresolved', 0)
    counts['errors_or_unresolved'] = historical + errors + inflight
    completed = sum(counts[status] for status in STATUSES)
    result = {'time': time.time(), 'total': original['total'], 'completed': completed, 'counts': counts,
        'pending': original['total'] - completed - historical - errors,
        'pending_includes_inflight': True, 'inflight_or_interrupted': inflight,
        'historical_unresolved': historical, 'flex_errors': errors,
        'errors': historical + errors, 'flex_completed': sum(flex_counts.values()),
        'flex_total': len(jobs), 'flex_counts': dict(flex_counts), 'received_usage': dict(tokens),
        'prior_received_cost_usd': original['received_cost_usd'], 'flex_received_cost_usd': received,
        'received_cost_usd': original['received_cost_usd'] + received,
        'prior_uncertain_charge_reserved_usd': original['uncertain_charge_reserved_usd'],
        'flex_uncertain_charge_reserved_usd': unknown,
        'uncertain_charge_reserved_usd': original['uncertain_charge_reserved_usd'] + unknown,
        'budget_accounted_usd': original['received_cost_usd'] + original['uncertain_charge_reserved_usd'] + received + unknown,
        'note': 'Original diagnostics are included once in baseline. Reasoning tokens are included in completion tokens. No automatic retries.'}
    # Exports consolidate the preserved original diagnoses and this continuation.
    with (out / 'review.csv.tmp').open('w', newline='') as csvfile, (out / 'diagnoses.jsonl.tmp').open('w') as jsonfile:
        writer = csv.writer(csvfile)
        writer.writerow(['key', 'language', 'status', 'answer_matches', 'diagnosis', 'source_refs', 'run'])
        exported = 0
        for line in snapshot.read_text().splitlines():
            job = json.loads(line)
            finals = [(location, location / 'results' / job['key'] / 'final.json') for location in (source, out)]
            finals = [(location, path) for location, path in finals if path.exists()]
            if len(finals) > 1:
                raise ValueError('Duplicate original/Flex diagnosis: ' + job['key'])
            if not finals:
                continue
            location, path = finals[0]
            final = read(path)
            writer.writerow([job['key'], job['content']['language'], final['status'], final['answer_matches'],
                json.dumps(final['diagnosis'], ensure_ascii=False), json.dumps(job['refs']), str(location)])
            jsonfile.write(json.dumps({'key': job['key'], 'language': job['content']['language'],
                **final, 'run': str(location)}, ensure_ascii=False) + '\n')
            exported += 1
    (out / 'review.csv.tmp').replace(out / 'review.csv')
    (out / 'diagnoses.jsonl.tmp').replace(out / 'diagnoses.jsonl')
    result['exported_diagnoses'] = exported
    write(out / 'report.json', result)
    return result


def preflight(out, jobs):
    baseline, original, source, snapshot = baseline_data(out)
    if source.resolve() == out.resolve():
        raise ValueError('Continuation must use a separate output directory')
    if read(source / 'process.json')['status'] not in ('stopped', 'finished'):
        raise ValueError('Original audit is not stopped')
    source_lock = (source / 'run.lock').open('r')
    fcntl.flock(source_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        current = read(source / 'report.json')
        frozen_source = baseline.get('source_original_report', original)
        for field in ('total', 'completed', 'counts', 'received_cost_usd', 'uncertain_charge_reserved_usd'):
            if current[field] != frozen_source[field]:
                raise ValueError('Original audit accounting changed: ' + field)
        blob = snapshot.read_bytes()
        expected_hash = baseline.get('source_jobs_sha256', baseline.get('jobs_sha256'))
        if expected_hash and hashlib.sha256(blob).hexdigest() != expected_hash:
            raise ValueError('Original snapshot changed')
        source_jobs = {j['key']: j for j in map(json.loads, blob.decode().splitlines())}
        selected = {j['key']: j for j in jobs}
        untouched = {key for key in source_jobs if not any(
            (source / 'results' / key / name).exists() for name in ATTEMPT_FILES)}
        if len(selected) != len(jobs) or set(selected) != untouched:
            raise ValueError('Continuation must exactly cover untouched original jobs without duplicates')
        for key, job in selected.items():
            if job != source_jobs[key]:
                raise ValueError('Continuation job content differs from immutable snapshot')
            directory = out / 'results' / key
            if (directory / 'request.json').exists() and read(directory / 'request.json') != payload(job['content']):
                raise ValueError('Existing request differs from frozen Flex diagnosis payload')
            if (directory / 'final.json').exists():
                raw = read(directory / 'response.json')
                validate_billing(raw)
                if read(directory / 'final.json') != audit.validate(raw, job['content']):
                    raise ValueError('Existing diagnosis fails original validation')
        return source_lock
    except BaseException:
        source_lock.close()
        raise


def api_key():
    value = os.environ.get('OPENROUTER_API_KEY')
    if not value:
        for line in (audit.REPO / '.env.local').read_text().splitlines():
            if line.strip().startswith('OPENROUTER_API_KEY='):
                value = line.split('=', 1)[1].strip().strip('\"\'')
                break
    if not value:
        raise ValueError('Missing OpenRouter key')
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['run', 'report'])
    parser.add_argument('--jobs', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--budget', type=float, default=250)
    parser.add_argument('--concurrency', type=int, default=4)
    args = parser.parse_args()
    if not valid_number(args.budget) or args.budget <= 0 or not 1 <= args.concurrency <= 4:
        parser.error('Budget must be positive and concurrency must be between 1 and 4')
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / 'run.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        jobs = [json.loads(line) for line in args.jobs.read_text().splitlines()]
        if not jobs:
            raise ValueError('Empty continuation job selection')
        with preflight(args.out, jobs):
            if args.command == 'report':
                print(json.dumps(report(args.out, jobs)), flush=True)
                return
            config = {'model': MODEL, 'endpoint': URL, 'service_tier': 'flex',
                'provider': payload(jobs[0]['content'])['provider'],
                'jobs_sha256': hashlib.sha256(args.jobs.read_bytes()).hexdigest(),
                'baseline_sha256': hashlib.sha256((args.out / 'baseline.json').read_bytes()).hexdigest(),
                'prompt_sha256': audit.e.a.digest([audit.e.BASE, audit.e.DIAG, audit.e.schema(jobs[0]['content'], 'diagnose')]),
                'original_runner_sha256': hashlib.sha256(Path(audit.__file__).read_bytes()).hexdigest(),
                'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                'budget_usd': args.budget, 'concurrency': args.concurrency, 'total': len(jobs),
                'mode': 'diagnosis_only', 'reasoning_effort': 'low', 'max_tokens': 8000,
                'timeout_seconds': TIMEOUT_SECONDS, 'retries': 0,
                'input_usd_per_million': INPUT_PER_MILLION, 'output_usd_per_million': OUTPUT_PER_MILLION}
            configfile = args.out / 'config.json'
            if configfile.exists() and read(configfile) != config:
                raise ValueError('Configuration changed: refusing resume')
            write(configfile, config)
            credential = api_key()
            summary = report(args.out, jobs)
            spent, reserved = summary['budget_accounted_usd'], 0.0
            stop = {'reason': None}
            signal.signal(signal.SIGTERM, lambda *_: stop.update(reason='SIGTERM'))
            signal.signal(signal.SIGINT, lambda *_: stop.update(reason='SIGINT'))
            process = {'pid': os.getpid(), 'started': time.time(), 'status': 'running',
                'command': 'gemini_flex_auditor.py run', 'argv': sys.argv,
                'exact_command': shlex.join([sys.executable, *sys.argv])}
            write(args.out / 'process.json', process)
            pending = iter(j for j in jobs if not any((args.out / 'results' / j['key'] / name).exists()
                for name in ATTEMPT_FILES))
            recent = collections.deque(maxlen=100)
            consecutive = done = 0
            exhausted = False
            try:
                with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
                    active = {}
                    while active or (not exhausted and not stop['reason']):
                        while len(active) < args.concurrency and not exhausted and not stop['reason']:
                            job = next(pending, None)
                            if job is None:
                                exhausted = True
                                break
                            ceiling = reservation(job['content'])
                            if spent + reserved + ceiling > args.budget:
                                stop['reason'] = 'budget ceiling'
                                break
                            reserved += ceiling
                            active[pool.submit(request, job, args.out, credential, ceiling)] = (ceiling, job['key'])
                        if not active:
                            break
                        finished, _ = concurrent.futures.wait(active, return_when=concurrent.futures.FIRST_COMPLETED)
                        for future in finished:
                            ceiling, job_key = active.pop(future)
                            reserved -= ceiling
                            error, fatal, charge = future.result()
                            spent += charge
                            done += 1
                            recent.append(error)
                            consecutive = consecutive + 1 if error else 0
                            if fatal or consecutive >= 3 or (len(recent) == 100 and sum(recent) >= 10):
                                stop['reason'] = 'billing/API failure or sustained errors'
                            print(json.dumps({'time': time.time(), 'key': job_key,
                                'new_completed_requests': done, 'error': error, 'fatal': fatal,
                                'accounted_usd': round(spent, 9), 'inflight_reserved_usd': reserved,
                                'stop': stop['reason']}), flush=True)
                            if done % 1000 == 0:
                                report(args.out, jobs)
            except BaseException as ex:
                stop['reason'] = 'runner exception: ' + str(ex).replace(credential, '[REDACTED]')
                raise
            finally:
                process.update(status='stopped' if stop['reason'] else 'finished',
                    reason=stop['reason'], ended=time.time())
                write(args.out / 'process.json', process)
                summary = report(args.out, jobs)
                print(json.dumps({'process': process, 'report': summary}), flush=True)


if __name__ == '__main__':
    main()
