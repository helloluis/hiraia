"""Submit one frozen OpenRouter diagnosis batch; poll and validate its results.

Never retries a submission or changes source quizzes. An ambiguous submission
must be reconciled with OpenRouter before any further spending is attempted.
"""
import argparse
import collections
import csv
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

import gemini_auditor as audit


API = 'https://openrouter.ai/api/beta/batches'
# Verified against OpenRouter's public model catalog; batches return canonical_slug.
RESOLVED_MODEL = 'google/gemini-3.8-flash-20260902'
DEFAULT_OUT = audit.REPO / 'tools/quiz-language-audit/runs/2026-09-12/gemini-auditor-batch-v1'
TERMINAL = {'completed', 'failed', 'expired', 'cancelled'}


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def key():
    value = os.environ.get('OPENROUTER_API_KEY')
    if not value:
        for line in (audit.REPO / '.env.local').read_text().splitlines():
            if line.strip().startswith('OPENROUTER_API_KEY='):
                value = line.split('=', 1)[1].strip().strip('\"\'')
                break
    if not value:
        raise RuntimeError('Missing OpenRouter API key')
    return value


def network(url, data=None, timeout=120):
    credential = key()
    request = urllib.request.Request(url, data=data, headers={
        'Authorization': 'Bearer ' + credential,
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as ex:
        detail = ex.read(16000).decode('utf-8', errors='replace')
        raise RuntimeError('HTTP ' + str(ex.code) + ': ' + detail.replace(credential, '[REDACTED]')) from None
    except Exception as ex:
        raise RuntimeError(str(ex).replace(credential, '[REDACTED]')) from None


def preflight(out):
    manifest = read(out / 'manifest.json')
    source = audit.REPO / manifest['source_run']
    if read(source / 'process.json')['status'] not in ('stopped', 'finished'):
        raise RuntimeError('Source audit must be stopped')
    source_lock = (source / 'run.lock').open('r')
    try:
        fcntl.flock(source_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return _preflight_locked(out, manifest, source, source_lock)
    except BaseException:
        source_lock.close()
        raise


def _preflight_locked(out, manifest, source, source_lock):
    snapshot = audit.REPO / manifest['source_jobs']
    if hashlib.sha256(snapshot.read_bytes()).hexdigest() != manifest['source_jobs_sha256']:
        raise RuntimeError('Source snapshot changed')
    blob = (out / 'request.json').read_bytes()
    if hashlib.sha256(blob).hexdigest() != manifest['request_sha256']:
        raise RuntimeError('Frozen batch request changed')
    payload = json.loads(blob)
    if list(payload) != ['endpoint', 'model', 'requests']:
        raise RuntimeError('OpenRouter requires endpoint/model before requests')
    if payload['endpoint'] != '/v1/chat/completions' or payload['model'] != audit.MODEL:
        raise RuntimeError('Unexpected batch route/model')
    selected = [json.loads(line) for line in (out / 'jobs.jsonl').read_text().splitlines()]
    original = {j['key']: j for j in (json.loads(line) for line in snapshot.read_text().splitlines())}
    expected = {k for k in original if not any((source / 'results' / k / name).exists()
                for name in ('started.json', 'response.json', 'final.json', 'error.json'))}
    jobs = {j['key']: j for j in selected}
    required = expected
    if manifest.get('parent_out'):
        parent = audit.REPO / manifest['parent_out']
        plan = read(parent / 'parts.json')
        entry = next((part for part in plan['parts'] if (parent / part['path']).resolve() == out.resolve()), None)
        if not entry or entry['request_sha256'] != manifest['request_sha256']:
            raise RuntimeError('Part missing from the authorized partition manifest')
        required = set(entry['keys'])
        partition_ids = [job_id for part in plan['parts'] for job_id in part['keys']]
        parent_blob = (parent / 'request.json').read_bytes()
        if hashlib.sha256(parent_blob).hexdigest() != read(parent / 'manifest.json')['request_sha256']:
            raise RuntimeError('Frozen parent request changed')
        parent_ids = {item['custom_id'] for item in json.loads(parent_blob)['requests']}
        if len(partition_ids) != len(set(partition_ids)) or set(partition_ids) != parent_ids:
            raise RuntimeError('Partitions overlap or fail to cover the frozen parent batch')
        if not required <= expected:
            raise RuntimeError('Partition contains previously attempted source jobs')
    if len(jobs) != len(selected) or set(jobs) != required or len(jobs) != manifest['selected_jobs']:
        raise RuntimeError('Selection no longer exactly matches untouched source jobs')
    if len(payload['requests']) != len(jobs):
        raise RuntimeError('Request/job count mismatch')
    seen = set()
    for item in payload['requests']:
        job_id = item['custom_id']
        if job_id in seen or job_id not in jobs:
            raise RuntimeError('Duplicate or unknown request ID')
        seen.add(job_id)
        if jobs[job_id] != original[job_id] or item['body'] != audit.payload(jobs[job_id]['content']):
            raise RuntimeError('Frozen content or diagnosis settings changed')
        if audit.e.a.digest(item['body']['response_format']) != manifest['response_format_sha256']:
            raise RuntimeError('Google batch requires one identical response schema')
    if read(source / 'report.json') != manifest['source_report']:
        # Report timestamps may refresh; accounting and results must not change.
        current = read(source / 'report.json')
        if any(current[k] != manifest['source_report'][k] for k in
               ('completed', 'counts', 'pending', 'received_cost_usd', 'uncertain_charge_reserved_usd')):
            raise RuntimeError('Source accounting changed; reconcile before submission')
    return manifest, jobs, blob, source_lock


def metadata(raw):
    return {k: v for k, v in raw.items() if k != 'results'}


def submit(out):
    manifest, jobs, blob, source_lock = preflight(out)
    if len(jobs) > 5000:
        source_lock.close()
        raise RuntimeError('OpenRouter allows at most 5000 requests per batch; use the verified partitions')
    authorization = read(out / 'authorization.json')
    if not authorization.get('one_batch_authorized') or authorization.get('request_sha256') != manifest['request_sha256']:
        raise RuntimeError('Full frozen batch authorization missing')
    if (out / 'submission-intent.json').exists() or (out / 'submission.json').exists():
        raise RuntimeError('Submission already attempted; reconcile/poll, never resubmit blindly')
    # Read-only account check before committing the one authorized request.
    _, credits = network('https://openrouter.ai/api/v1/credits')
    data = credits['data']
    balance = data['total_credits'] - data['total_usage']
    if balance < manifest['expected_batch_cost_usd']:
        raise RuntimeError('Available account credits below estimated batch cost')
    write(out / 'credits-before.json', {'time': time.time(), 'balance_usd': balance})
    # Exclusive durable intent is recorded before the network mutation.
    with (out / 'submission-intent.json').open('x') as f:
        json.dump({'time': time.time(), 'request_sha256': manifest['request_sha256'],
                   'requests': len(jobs), 'model': audit.MODEL,
                   'status': 'attempting_once', 'retries': 0}, f)
        f.flush()
        os.fsync(f.fileno())
    try:
        status, raw = network(API, data=blob, timeout=300)
        write(out / 'submission-response.json', raw)
        if status != 202 or not isinstance(raw.get('id'), str):
            raise RuntimeError('Unexpected submission response; reconcile before any further POST')
        if raw.get('model') not in (audit.MODEL, RESOLVED_MODEL) or raw.get('request_counts', {}).get('total') != len(jobs):
            raise RuntimeError('Accepted batch identity/count mismatch; inspect stored response')
        write(out / 'submission.json', metadata(raw))
        write(out / 'status.json', {'checked_at': time.time(), **metadata(raw)})
        print(json.dumps(metadata(raw)), flush=True)
    except Exception as ex:
        write(out / 'submission-error.json', {'time': time.time(), 'error': str(ex),
              'automatic_retry': False, 'instruction': 'Reconcile GET batch list; do not POST again.'})
        raise
    finally:
        source_lock.close()


def validate_results(raw, jobs):
    if raw.get('status') != 'completed' or not isinstance(raw.get('results'), list):
        raise RuntimeError('Batch has no completed result array')
    usage = raw.get('usage') or {}
    if (type(usage.get('cost')) not in (int, float) or not math.isfinite(usage['cost'])
            or usage['cost'] < 0 or usage.get('is_byok') is not False):
        raise RuntimeError('Missing/unsupported batch billing; inspect before importing')
    if raw.get('model') not in (audit.MODEL, RESOLVED_MODEL):
        raise RuntimeError('Returned model mismatch')
    ids = [item.get('custom_id') for item in raw['results']]
    if len(ids) != len(set(ids)) or set(ids) != set(jobs):
        raise RuntimeError('Missing, duplicate or unknown result IDs; no import performed')
    counts = raw.get('request_counts', {})
    if counts.get('total') != len(jobs):
        raise RuntimeError('Returned total does not match manifest')
    if any(type(counts.get(k)) is not int or counts[k] < 0 for k in ('total', 'completed', 'failed')):
        raise RuntimeError('Invalid batch request counts')
    if counts['completed'] + counts['failed'] != counts['total']:
        raise RuntimeError('Terminal batch counts do not reconcile')


def import_results(out, raw):
    jobs = {j['key']: j for j in (json.loads(line) for line in (out / 'jobs.jsonl').read_text().splitlines())}
    validate_results(raw, jobs)
    counts = collections.Counter()
    for item in raw['results']:
        job_id = item['custom_id']
        destination = out / 'results' / job_id
        destination.mkdir(parents=True, exist_ok=True)
        saved = destination / 'batch-result.json'
        if saved.exists() and read(saved) != item:
            raise RuntimeError('Provider result changed on repeated import')
        write(saved, item)
        response = item.get('response')
        try:
            if item.get('error') is not None or not response:
                raise ValueError('Provider batch request failed')
            if response.get('status_code') != 200:
                raise ValueError('Provider response HTTP ' + str(response.get('status_code')))
            body = response['body']
            write(destination / 'response.json', body)
            result = audit.validate(body, jobs[job_id]['content'])
            write(destination / 'final.json', result)
            counts[result['status']] += 1
        except (ValueError, KeyError, TypeError, IndexError) as ex:
            write(destination / 'error.json', {'error': str(ex), 'batch_id': raw['id'],
                   'provider_error': item.get('error'), 'automatic_retry': False})
            counts['errors'] += 1
    write(out / 'import.json', {'time': time.time(), 'batch_id': raw['id'], 'counts': dict(counts)})
    return counts


def report(out):
    manifest = read(out / 'manifest.json')
    baseline = manifest['source_report']
    batch_counts = collections.Counter()
    locations = [out]
    if (out / 'parts.json').exists():
        locations = [out / part['path'] for part in read(out / 'parts.json')['parts']]
        statuses = [read(location / 'status.json') if (location / 'status.json').exists()
                    else {'status': 'not_submitted'} for location in locations]
        states = [s['status'] for s in statuses]
        state = 'completed' if all(s == 'completed' for s in states) else (
            'finished_with_failures' if all(s in TERMINAL for s in states) else (
            'not_submitted' if all(s == 'not_submitted' for s in states) else (
            'submission_incomplete' if 'not_submitted' in states else 'in_progress')))
        known = [s['usage'] for s in statuses if (s.get('usage') or {}).get('is_byok') is False
                 and isinstance(s['usage'].get('cost'), (int, float))]
        usage = {k: sum(u.get(k, 0) for u in known) for k in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'cost')}
        if known:
            usage['is_byok'] = False
        request_counts = {'total': manifest['selected_jobs'], **{
            k: sum(s.get('request_counts', {}).get(k, 0) for s in statuses) for k in ('completed', 'failed')}}
        status = {'status': state, 'request_counts': request_counts, 'usage': usage,
            'parts': [{'path': str(location.relative_to(out)), **metadata(s)} for location, s in zip(locations, statuses)],
            'parts_without_reported_cost': len(statuses) - len(known)}
        write(out / 'status.json', {'checked_at': time.time(), **status})
    else:
        status = read(out / 'status.json') if (out / 'status.json').exists() else {'status': 'not_submitted'}
    for location in locations:
        for final in (location / 'results').glob('*/final.json'):
            batch_counts[read(final)['status']] += 1
    errors = sum(1 for location in locations for _ in (location / 'results').glob('*/error.json'))
    usage = status.get('usage') or {}
    charged = usage.get('cost') if usage.get('is_byok') is False else None
    combined = {k: baseline['counts'].get(k, 0) + batch_counts[k]
                for k in ('pass', 'flagged', 'needs_review', 'source_issue')}
    summary = {'time': time.time(), 'status': status.get('status'), 'batch_id': status.get('id'),
        'total': baseline['total'], 'completed': sum(combined.values()), 'counts': combined,
        'batch_request_counts': status.get('request_counts'), 'batch_validated_counts': dict(batch_counts),
        'historical_unresolved': baseline['counts']['errors_or_unresolved'], 'batch_errors': errors,
        'pending_batch_validation': manifest['selected_jobs'] - sum(batch_counts.values()) - errors,
        'prior_received_cost_usd': baseline['received_cost_usd'], 'batch_received_cost_usd': charged,
        'received_cost_usd': baseline['received_cost_usd'] + (charged or 0),
        'batch_charge_unreported': bool(status.get('parts_without_reported_cost')) or (
            charged is None and status.get('status') != 'not_submitted'),
        'parts': status.get('parts'),
        'prior_uncertain_charge_reserved_usd': baseline['uncertain_charge_reserved_usd'],
        'batch_expected_cost_usd': manifest['expected_batch_cost_usd'],
        'batch_usage': usage,
        'note': 'Full remaining audit authorized after extra funding; provider requires at most 5000 requests per batch. No local hard spending stop within accepted batches. Reasoning is included in completion tokens.'}
    write(out / 'report.json', summary)
    # Consolidated exports include all preserved synchronous results and new batch diagnoses.
    # The stopped original run and its reports remain untouched.
    with (out / 'review.csv.tmp').open('w') as csvfile, (out / 'diagnoses.jsonl.tmp').open('w') as jsonfile:
        writer = csv.writer(csvfile)
        writer.writerow(['key', 'language', 'status', 'answer_matches', 'diagnosis', 'source_refs', 'run'])
        jobs = [json.loads(line) for line in (audit.REPO / manifest['source_jobs']).read_text().splitlines()]
        for job in jobs:
            finals = [(location, location / 'results' / job['key'] / 'final.json')
                      for location in [audit.REPO / manifest['source_run'], *locations]]
            finals = [(location, path) for location, path in finals if path.exists()]
            if len(finals) > 1:
                raise RuntimeError('Duplicate source/batch diagnosis found')
            if finals:
                location, path = finals[0]
                result = read(path)
                writer.writerow([job['key'], job['content']['language'], result['status'],
                    result['answer_matches'], json.dumps(result['diagnosis'], ensure_ascii=False),
                    json.dumps(job['refs']), location.name])
                jsonfile.write(json.dumps({'key': job['key'], 'language': job['content']['language'],
                    **result, 'run': location.name}, ensure_ascii=False) + '\n')
    (out / 'review.csv.tmp').replace(out / 'review.csv')
    (out / 'diagnoses.jsonl.tmp').replace(out / 'diagnoses.jsonl')
    return summary


def poll(out, export=True):
    if (out / 'parts.json').exists():
        for part in read(out / 'parts.json')['parts']:
            location = out / part['path']
            if (location / 'submission.json').exists():
                poll(location, export=False)
        result = report(out)
        print(json.dumps(result), flush=True)
        return
    submission = read(out / 'submission.json')
    batch_id = submission['id']
    if (out / 'import.json').exists() and read(out / 'status.json')['status'] == 'completed':
        if export:
            print(json.dumps(report(out)), flush=True)
        return
    _, raw = network(API + '/' + urllib.parse.quote(batch_id, safe=''), timeout=300)
    if raw.get('id') != batch_id:
        raise RuntimeError('Batch identity mismatch')
    write(out / 'status.json', {'checked_at': time.time(), **metadata(raw)})
    if raw.get('status') == 'completed':
        write(out / 'completed-response.json', raw)
        import_results(out, raw)
    if export:
        result = report(out)
        print(json.dumps(result), flush=True)


def submit_parts(out):
    plan = read(out / 'parts.json')
    for part in plan['parts']:
        location = out / part['path']
        if (location / 'submission.json').exists():
            continue
        submit(location)
    print(json.dumps(report(out)), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('preflight', 'submit', 'submit-parts', 'poll', 'report'))
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    lock = (args.out / 'batch-run.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if args.command == 'preflight':
        manifest, jobs, blob, source_lock = preflight(args.out)
        source_lock.close()
        print(json.dumps({'validated_jobs': len(jobs), 'request_bytes': len(blob),
                          'request_sha256': manifest['request_sha256']}))
    elif args.command == 'submit':
        submit(args.out)
    elif args.command == 'submit-parts':
        submit_parts(args.out)
    elif args.command == 'poll':
        poll(args.out)
    else:
        print(json.dumps(report(args.out)))


if __name__ == '__main__':
    main()
