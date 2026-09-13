"""Continuously consume eligible diagnoses into English-only Gemini Flex proposals.

Requests are independent cards grouped in immutable local manifests, not cloud
batch submissions. Source data and the separate audit runner are never changed.
"""
import argparse
import collections
import concurrent.futures
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import time
import uuid

import gemini_translator as T
import translation_queue_selection as selector

TERMINAL = {'proposal', 'held', 'rejected', 'error'}


def durable_write(path, value, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    try:
        if immutable:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


@contextmanager
def exclusive_lock(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    with (out / 'run.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def load_snapshot(path):
    snapshot = {}
    with Path(path).open() as handle:
        for index, line in enumerate(handle, 1):
            job = T.parse(line)
            key = job['key']
            if not isinstance(key, str) or not key or key in snapshot:
                raise ValueError('Snapshot has invalid or duplicate job keys')
            snapshot[key] = {'sample_id': index, 'job': job}
    if not snapshot:
        raise ValueError('Empty job snapshot')
    return snapshot


def clean_item(job, sample_id):
    content = job['content']
    clean = {'sample_id': sample_id, 'job': {'key': job['key'], 'content': {
        'english': {field: content['english'][field] for field in ('q', 'options', 'explanation')},
        'grades': content['grades'], 'language': content['language'],
        'source_fact': {'en': content.get('source_fact', {}).get('en')}}}}
    # A deep copy prevents later selector or caller mutations from changing a request.
    clean = T.parse(T.canonical(clean))
    english = clean['job']['content']['english']
    T.flex.audit.e.validate(english, T.schema(clean)['properties']['proposed']['anyOf'][0])
    if (type(sample_id) is not int or sample_id <= 0
            or clean['job']['content']['language'] not in ('tl', 'bis')
            or not isinstance(job['key'], str) or not job['key']
            or not 2 <= len(english['options']) <= 10
            or any(not value.strip() for value in T.fields(english).values())):
        raise ValueError('Invalid clean translation job')
    grades = clean['job']['content']['grades']
    # Legacy snapshot rows can have no grade mapping. Preserve [] as unknown
    # metadata rather than inventing a grade or stopping all eligible translations.
    if not isinstance(grades, list) or any(type(grade) is not int or not 1 <= grade <= 12 for grade in grades):
        raise ValueError('Grades must be school grade numbers or an empty unknown mapping')
    context = clean['job']['content']['source_fact']['en']
    if context is not None and not isinstance(context, str):
        raise ValueError('English source context must be string or null')
    return clean


def can_admit(accounted, inflight_reservations, next_reservation, budget):
    values = (accounted, inflight_reservations, next_reservation, budget)
    return (all(T.flex.valid_number(value) and value >= 0 for value in values)
            and budget > 0 and sum(values[:3]) <= budget)


def file_sha(path):
    checksum = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            checksum.update(chunk)
    return checksum.hexdigest()


def freeze_config(args, prompt, snapshot):
    if not prompt.strip():
        raise ValueError('Empty translation prompt')
    if not T.flex.valid_number(args.budget) or not 0 < args.budget <= 30:
        raise ValueError('Queue budget must be positive and no greater than $30')
    if args.concurrency not in (1, 2) or not 1 <= args.batch_size <= 50:
        raise ValueError('Maximum concurrency is 2 and maximum local batch size is 50')
    if args.poll_seconds < 1:
        raise ValueError('Polling interval must be positive')
    combined = getattr(args, 'combined_budget', None)
    budget_log = getattr(args, 'audit_budget_log', None)
    if bool(combined is not None) != bool(budget_log is not None):
        raise ValueError('Combined budget and audit budget log must be supplied together')
    if combined is not None and (not T.flex.valid_number(combined) or combined <= 0):
        raise ValueError('Combined budget must be positive')
    source_holds = getattr(args, 'source_holds', None)
    dependencies = [Path(__file__), Path(T.__file__), Path(T.rewrite.__file__),
        Path(T.rewrite.qwen.__file__), Path(T.flex.__file__), Path(T.flex.audit.__file__),
        Path(T.flex.audit.e.__file__), Path(T.flex.audit.e.a.__file__), Path(selector.__file__)]
    config = {'jobs': str(args.jobs.resolve()), 'jobs_sha256': file_sha(args.jobs),
        'snapshot_count': len(snapshot), 'prompt_sha256': T.digest(prompt),
        'audit_dirs': [str(path.resolve()) for path in args.audit_out],
        'source_holds': str(source_holds.resolve()) if source_holds else None,
        'source_holds_sha256': file_sha(source_holds) if source_holds else None,
        'dependencies_sha256': {str(path.resolve()): file_sha(path) for path in dependencies},
        'model': T.MODEL, 'service_tier': 'flex', 'provider': 'google-ai-studio/flex',
        'input_per_million_usd': .375, 'completion_per_million_usd': 1.875,
        'budget_usd': args.budget, 'concurrency': args.concurrency,
        'batch_size': args.batch_size, 'poll_seconds': args.poll_seconds,
        'audit_process': str(args.audit_process.resolve()) if args.audit_process else None,
        'audit_budget_log': str(budget_log.resolve()) if budget_log else None,
        'combined_budget_usd': combined, 'combined_guard_is_cooperative': False,
        'timeout_seconds': T.TIMEOUT_SECONDS, 'max_tokens': 8000, 'automatic_retries': 0,
        'english_only': True, 'proposals_only': True}
    target = args.out / 'config.json'
    if target.exists():
        if T.read(target) != config:
            raise ValueError('Frozen queue inputs, prompt, dependencies, or configuration changed')
    else:
        durable_write(target, config, immutable=True)
    return config


def load_entries(out):
    entries = [T.read(path) for path in (Path(out) / 'queue').glob('*.json')]
    entries.sort(key=lambda item: item['sample_id'])
    ids = [item['sample_id'] for item in entries]
    keys = [item['job']['key'] for item in entries]
    if len(ids) != len(set(ids)) or len(keys) != len(set(keys)):
        raise ValueError('Duplicate persisted queue identities')
    return entries


def ingest(out, snapshot, candidates, prompt):
    out = Path(out)
    known = {item['job']['key']: item for item in load_entries(out)}
    added = 0
    for candidate in candidates:
        key, job = candidate['key'], candidate['job']
        if key not in snapshot or job.get('key') != key or job != snapshot[key]['job']:
            raise ValueError('Selector job does not match immutable source snapshot')
        if key in known:
            continue
        item = clean_item(job, snapshot[key]['sample_id'])
        item.update(selection=candidate['selection'], source_refs=job.get('refs', []),
            source_job_sha256=T.digest(job), request_sha256=T.digest(T.payload(item, prompt)))
        durable_write(out / 'queue' / (str(item['sample_id']) + '.json'), item, immutable=True)
        known[key] = item
        added += 1
    return added


def sync_blocks(out, blocked_keys):
    target = Path(out) / 'source-blocks.json'
    existing = T.read(target) if target.exists() else {}
    merged = {**existing, **blocked_keys}
    if merged != existing or not target.exists():
        durable_write(target, merged)
    return merged


def validate_entries(entries, snapshot, prompt):
    for item in entries:
        original = snapshot.get(item['job']['key'])
        if (original is None or original['sample_id'] != item['sample_id']
                or clean_item(original['job'], item['sample_id'])['job'] != item['job']
                or item['source_job_sha256'] != T.digest(original['job'])
                or item['source_refs'] != original['job'].get('refs', [])
                or item['request_sha256'] != T.digest(T.payload(item, prompt))):
            raise ValueError('Persisted queue entry no longer matches frozen inputs')


def validate_results(out, entries, prompt):
    """Resume only verified prior artifacts, while never retrying partial intents."""
    for item in entries:
        directory = T.directory(Path(out), item)
        if not T.attempted(Path(out), item):
            continue
        request_path = directory / 'request.json'
        if not request_path.exists() or T.read(request_path) != T.payload(item, prompt):
            raise ValueError('Prior request does not match the frozen queue payload')
        raw_path = directory / 'response.json'
        if raw_path.exists():
            raw = T.read(raw_path)
            T.flex.validate_billing(raw)
        final_path = directory / 'final.json'
        if final_path.exists():
            final = T.read(final_path)
            if final['status'] in ('proposal', 'held'):
                if not raw_path.exists() or T.validate(raw, item) != final:
                    raise ValueError('Prior final proposal differs from its validated raw response')


def seal_batches(out, entries, prompt, batch_size, allow_partial=False, blocked_keys=None):
    out = Path(out)
    blocked_keys = blocked_keys or {}
    by_id = {item['sample_id']: item for item in entries}
    batches = [T.read(path) for path in sorted((out / 'batches').glob('*.json'))]
    assigned = set()
    for expected, batch in enumerate(batches, 1):
        if batch['batch_id'] != expected or not 1 <= len(batch['items']) <= batch_size:
            raise ValueError('Invalid persisted batch manifest')
        for record in batch['items']:
            item = by_id.get(record['sample_id'])
            if (item is None or item['sample_id'] in assigned or record['key'] != item['job']['key']
                    or record['request_sha256'] != T.digest(T.payload(item, prompt))):
                raise ValueError('Batch contains duplicate, missing, or changed requests')
            assigned.add(item['sample_id'])
    pending = [item for item in entries if item['sample_id'] not in assigned
               and item['job']['key'] not in blocked_keys]
    while len(pending) >= batch_size or (allow_partial and pending):
        selected, pending = pending[:batch_size], pending[batch_size:]
        number = len(batches) + 1
        batch = {'batch_id': number, 'created': time.time(), 'cloud_batch': False,
            'items': [{'sample_id': item['sample_id'], 'key': item['job']['key'],
                       'request_sha256': T.digest(T.payload(item, prompt))} for item in selected]}
        durable_write(out / 'batches' / f'{number:06d}.json', batch, immutable=True)
        batches.append(batch)
    return batches


def batch_work(out, entries, batches, blocked_keys=None):
    blocked_keys = blocked_keys or {}
    by_id = {item['sample_id']: item for item in entries}
    return [by_id[record['sample_id']] for batch in batches for record in batch['items']
            if by_id[record['sample_id']]['job']['key'] not in blocked_keys
            and not T.attempted(Path(out), by_id[record['sample_id']])]


def outcome_records(out, entries):
    records = []
    for item in entries:
        record_path = Path(out) / 'outcomes' / (str(item['sample_id']) + '.json')
        directory = T.directory(Path(out), item)
        if record_path.exists():
            record = T.read(record_path)
        elif (directory / 'error.json').exists():
            path = directory / 'error.json'
            error = T.read(path)
            record = {'status': 'error', 'fatal': bool(error.get('fatal')),
                      'time': error.get('time', path.stat().st_mtime)}
        elif (directory / 'final.json').exists():
            path = directory / 'final.json'
            record = {'status': T.read(path)['status'], 'fatal': False,
                      'time': path.stat().st_mtime}
        else:
            continue
        if record['status'] not in TERMINAL:
            raise ValueError('Unexpected terminal outcome status')
        records.append({**record, 'sample_id': item['sample_id']})
    return sorted(records, key=lambda record: (record['time'], record['sample_id']))


def failure_state(out, entries):
    records = outcome_records(out, entries)
    failures = [record['status'] in ('error', 'rejected') for record in records]
    consecutive = 0
    for failed in reversed(failures):
        if not failed:
            break
        consecutive += 1
    return {'consecutive': consecutive, 'recent': failures[-100:],
            'fatal': any(record.get('fatal', False) for record in records),
            'errors': sum(failures)}


def stopped_for_failures(state):
    return state['fatal'] or state['consecutive'] >= 3 or sum(state['recent']) >= 10


def audit_state(path):
    if path is None:
        return {'running': False, 'reason': 'static diagnosis inputs'}
    try:
        process = T.read(Path(path))
        if process.get('status') != 'running':
            return {'running': False, 'reason': process.get('status', 'unknown')}
        pid = process['pid']
        if type(pid) is not int or pid <= 0:
            raise ValueError('Invalid audit PID')
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return {'running': False, 'reason': 'audit PID is no longer alive'}
        except PermissionError:
            # A permission-limited signal probe cannot establish identity; the
            # read-only command check below must still verify the recorded PID.
            pass
        actual = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'command='],
                                capture_output=True, text=True, check=False)
        expected_argv = process.get('argv')
        if not isinstance(expected_argv, list) or not expected_argv:
            raise ValueError('Running audit lacks its recorded argv')
        # macOS ps prints argv as plain text, so compare its stable command suffix
        # after the interpreter rather than interpreting whitespace as shell code.
        expected_suffix = ' '.join(str(value) for value in expected_argv)
        if actual.returncode != 0 or not actual.stdout.strip().endswith(expected_suffix):
            return {'running': False, 'reason': 'audit PID does not match the recorded command'}
        return {'running': True, 'reason': 'audit PID and recorded command match'}
    except (OSError, ValueError, KeyError) as error:
        raise ValueError('Cannot establish upstream audit state: ' + str(error)) from error


def latest_audit_budget(path):
    if path is None:
        return None
    with Path(path).open('rb') as handle:
        handle.seek(0, 2)
        size = handle.tell()
        handle.seek(max(0, size - 262144))
        text = handle.read().decode('utf-8', errors='replace')
    for line in reversed(text.splitlines()):
        try:
            value = T.parse(line)
            if 'accounted_usd' in value:
                accounted, reserved = value['accounted_usd'], value['inflight_reserved_usd']
                stamp = value['time']
            elif isinstance(value.get('report'), dict):
                accounted, reserved = value['report']['budget_accounted_usd'], 0
                stamp = value.get('process', {}).get('ended', value['report'].get('time'))
            else:
                continue
            if not all(T.flex.valid_number(number) and number >= 0 for number in (accounted, reserved, stamp)):
                continue
            return {'accounted_usd': accounted, 'inflight_reserved_usd': reserved, 'time': stamp}
        except (ValueError, KeyError, TypeError):
            continue
    raise ValueError('No complete audit budget record is available; spending remains stopped')


def refresh(args, snapshot, prompt):
    entries = load_entries(args.out)
    candidates, scan = selector.ingest_candidates(args.jobs, args.audit_out,
        {item['job']['key'] for item in entries}, source_holds_path=args.source_holds)
    blocked = sync_blocks(args.out, scan.get('blocked_keys', {}))
    added = ingest(args.out, snapshot,
                   [item for item in candidates if item['key'] not in blocked], prompt)
    entries = load_entries(args.out)
    validate_entries(entries, snapshot, prompt)
    producer = audit_state(args.audit_process)
    batches = seal_batches(args.out, entries, prompt, args.batch_size,
                           allow_partial=not producer['running'], blocked_keys=blocked)
    durable_write(args.out / 'discovery.json', {'time': time.time(), 'added': added,
        'selected_total': len(entries), 'upstream': producer, 'scan': scan})
    return entries, batches, blocked, producer


def report(out, entries, blocked_keys=None, budget=None, scan=None):
    out = Path(out)
    if blocked_keys is None:
        blocked_path = out / 'source-blocks.json'
        blocked_keys = T.read(blocked_path) if blocked_path.exists() else {}
    counts = collections.Counter({name: 0 for name in
        ('proposal', 'held', 'rejected', 'error', 'interrupted', 'pending', 'source_held', 'requires_source_review')})
    usage = collections.Counter()
    received = reserved = 0.0
    records = []
    for item in entries:
        directory = T.directory(out, item)
        cost, unknown, tokens = T.flex.charge_state(directory)
        received += cost
        reserved += unknown
        usage.update(tokens)
        if (directory / 'final.json').exists():
            outcome = T.read(directory / 'final.json')
        elif (directory / 'error.json').exists():
            outcome = {'status': 'error', 'error': T.read(directory / 'error.json')}
        else:
            outcome = {'status': 'interrupted' if T.attempted(out, item) else 'pending'}
        if item['job']['key'] in blocked_keys:
            if outcome['status'] == 'proposal':
                outcome = {**outcome, 'status': 'requires_source_review', 'raw_status': 'proposal'}
            elif outcome['status'] == 'pending':
                outcome = {**outcome, 'status': 'source_held'}
            outcome = {**outcome, 'source_hold_reason': blocked_keys[item['job']['key']]}
        counts[outcome['status']] += 1
        records.append({'sample_id': item['sample_id'], 'key': item['job']['key'],
            'language': item['job']['content']['language'],
            'english': item['job']['content']['english'], 'selection': item['selection'],
            'source_refs': item['source_refs'], **outcome})
    summary = {'time': time.time(), 'selected': len(entries), 'counts': dict(counts),
        'received_cost_usd': received, 'uncertain_and_active_reserved_usd': reserved,
        'budget_accounted_usd': received + reserved, 'budget_usd': budget,
        'received_usage': dict(usage), 'failure_state': failure_state(out, entries),
        'known_source_blocked_keys': len(blocked_keys), 'scan': scan,
        'note': 'Independent Flex requests. Proposals only. Reasoning is included in completion tokens. No automatic retries.'}
    temporary = out / 'proposals.jsonl.tmp'
    with temporary.open('w') as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
    temporary.replace(out / 'proposals.jsonl')
    durable_write(out / 'summary.json', summary)
    return summary


def run(args, snapshot, prompt, entries, batches, blocked, producer):
    summary = report(args.out, entries, blocked, args.budget)
    if stopped_for_failures(summary['failure_state']):
        raise ValueError('Persisted failure threshold requires investigation before further spending')
    if (args.out / 'STOP').exists():
        raise ValueError('STOP sentinel is present; spending remains stopped')
    credential = T.credential()
    process = {'pid': os.getpid(), 'started': time.time(), 'status': 'running',
        'command': 'gemini_translation_queue.py run', 'argv': sys.argv,
        'exact_command': shlex.join([sys.executable, *sys.argv]), 'limit': args.limit}
    durable_write(args.out / 'process.json', process)
    reason = []
    def stop(signum, _frame):
        if not reason:
            reason.append(signal.Signals(signum).name)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    accounted = summary['budget_accounted_usd']
    active, done, submitted = {}, 0, 0
    state = summary['failure_state']
    work = collections.deque(batch_work(args.out, entries, batches, blocked))
    next_refresh = time.monotonic() + args.poll_seconds
    next_report = 50
    print(json.dumps({'event': 'started', **process}), flush=True)
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.concurrency) as pool:
            while True:
                if (args.out / 'STOP').exists() and not reason:
                    reason.append('STOP sentinel')
                if not reason and time.monotonic() >= next_refresh:
                    entries, batches, blocked, producer = refresh(args, snapshot, prompt)
                    active_ids = {item['sample_id'] for item, _ in active.values()}
                    work = collections.deque(item for item in batch_work(args.out, entries, batches, blocked)
                                             if item['sample_id'] not in active_ids)
                    next_refresh = time.monotonic() + args.poll_seconds
                    report(args.out, entries, blocked, args.budget)
                    print(json.dumps({'time': time.time(), 'event': 'discovery',
                        'selected': len(entries), 'source_blocks': len(blocked), 'upstream': producer}), flush=True)
                while not reason and work and len(active) < args.concurrency:
                    if args.limit is not None and submitted >= args.limit:
                        reason.append('limit reached')
                        break
                    item = work.popleft()
                    if item['job']['key'] in blocked or T.attempted(args.out, item):
                        continue
                    payload = T.payload(item, prompt)
                    if T.digest(payload) != item['request_sha256']:
                        raise ValueError('Request changed after selection')
                    ceiling = T.reservation(payload)
                    inflight = sum(value[1] for value in active.values())
                    if not can_admit(accounted, inflight, ceiling, args.budget):
                        work.appendleft(item)
                        if not active:
                            reason.append('queue budget cannot reserve the next request')
                        break
                    other = latest_audit_budget(args.audit_budget_log)
                    if (other is not None and producer['running']
                            and time.time() - other['time'] > 1000):
                        raise ValueError('Active audit budget snapshot is over 1000 seconds old; investigate before further spending')
                    if other is not None and not can_admit(
                            accounted + other['accounted_usd'] + other['inflight_reserved_usd'],
                            inflight, ceiling, args.combined_budget):
                        work.appendleft(item)
                        if not active:
                            reason.append('combined budget snapshot cannot reserve the next request')
                        break
                    active[pool.submit(T.request, item, args.out, payload, ceiling, credential)] = (item, ceiling)
                    submitted += 1
                if not active:
                    if reason:
                        break
                    if args.limit is not None and submitted >= args.limit:
                        reason.append('limit reached')
                        break
                    if not work and not producer['running']:
                        # One final discovery after the producer stops captures its last responses.
                        entries, batches, blocked, producer = refresh(args, snapshot, prompt)
                        work = collections.deque(batch_work(args.out, entries, batches, blocked))
                        if not work:
                            break
                        continue
                    time.sleep(min(1, max(.05, next_refresh - time.monotonic())))
                    continue
                finished, _ = concurrent.futures.wait(active, timeout=1,
                    return_when=concurrent.futures.FIRST_COMPLETED)
                for future in finished:
                    item, ceiling = active.pop(future)
                    status, fatal = future.result()
                    cost, unknown, _ = T.flex.charge_state(T.directory(args.out, item))
                    accounted += cost + unknown
                    record = {'time': time.time(), 'sample_id': item['sample_id'],
                        'key': item['job']['key'], 'status': status, 'fatal': fatal,
                        'received_cost_usd': cost, 'uncertain_reserved_usd': unknown}
                    durable_write(args.out / 'outcomes' / (str(item['sample_id']) + '.json'), record, immutable=True)
                    failed = status in ('error', 'rejected')
                    state['consecutive'] = state['consecutive'] + 1 if failed else 0
                    state['recent'] = (state['recent'] + [failed])[-100:]
                    state['fatal'] = state['fatal'] or fatal
                    state['errors'] += failed
                    done += 1
                    if stopped_for_failures(state) and not reason:
                        reason.append('billing/provider failure or sustained errors')
                    if accounted > args.budget and not reason:
                        reason.append('received usage exceeded queue budget; reconcile billing')
                    print(json.dumps({'event': 'completed', **record,
                        'completed_this_launch': done, 'accounted_usd': accounted,
                        'inflight_reserved_usd': sum(value[1] for value in active.values()),
                        'stop': reason[0] if reason else None}), flush=True)
                if finished and (done >= next_report or reason):
                    report(args.out, entries, blocked, args.budget)
                    next_report = (done // 50 + 1) * 50
    except BaseException as error:
        if not reason:
            reason.append(type(error).__name__ + ': ' + str(error).replace(credential, '[REDACTED]'))
        raise
    finally:
        summary = report(args.out, entries, blocked, args.budget)
        process.update(status='stopped' if reason and reason[0] != 'limit reached' else 'finished',
            ended=time.time(), reason=reason[0] if reason else 'eligible queue drained and audit stopped',
            submitted_this_launch=submitted, completed_this_launch=done)
        durable_write(args.out / 'process.json', process)
        print(json.dumps({'process': process, 'summary': summary}), flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'run', 'report'))
    parser.add_argument('--jobs', type=Path, required=True)
    parser.add_argument('--audit-out', type=Path, action='append', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--prompt-file', type=Path, required=True)
    parser.add_argument('--source-holds', type=Path)
    parser.add_argument('--audit-process', type=Path)
    parser.add_argument('--audit-budget-log', type=Path)
    parser.add_argument('--combined-budget', type=float)
    parser.add_argument('--budget', type=float, default=30)
    parser.add_argument('--concurrency', type=int, choices=(1, 2), default=2)
    parser.add_argument('--batch-size', type=int, default=50)
    parser.add_argument('--poll-seconds', type=int, default=60)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error('--limit must be positive')
    with exclusive_lock(args.out):
        snapshot, prompt = load_snapshot(args.jobs), args.prompt_file.read_text()
        freeze_config(args, prompt, snapshot)
        entries = load_entries(args.out)
        validate_entries(entries, snapshot, prompt)
        if args.command == 'report':
            print(json.dumps(report(args.out, entries, budget=args.budget)), flush=True)
            return
        entries, batches, blocked, producer = refresh(args, snapshot, prompt)
        if args.command == 'prepare':
            print(json.dumps(report(args.out, entries, blocked, args.budget)), flush=True)
            return
        validate_results(args.out, entries, prompt)
        run(args, snapshot, prompt, entries, batches, blocked, producer)


if __name__ == '__main__':
    main()
