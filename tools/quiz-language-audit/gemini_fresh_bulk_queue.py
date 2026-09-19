#!/usr/bin/env python3
"""Continue Fresh-1 with real OpenRouter cloud batches, never replaying attempts.

The original config, prompt, queue, local manifests and received results stay
immutable. Bulk records live under bulk/. This coordinator holds Fresh-1's
existing exclusive lock while it submits, polls, collects and reports.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import sys
import time

import gemini_translation_queue as Q
import gemini_batch_auditor as B
import fresh_batch_contract as C
import pipeline_status as P

T = Q.T
DEFAULT_OUT = Path(__file__).resolve().parent / 'runs/2026-09-13/gemini-fresh-queue-v1'
AUDIT2 = DEFAULT_OUT.parent / 'gemini-reaudit-queue-v1'
TERMINAL = {'completed', 'failed', 'cancelled', 'expired'}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write(path, value, immutable=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    Q.durable_write(path, value, immutable=immutable)


def ensure(path, value):
    """Replay a local import safely, never replace a different received artifact."""
    if path.exists():
        if T.read(path) != value:
            raise ValueError('Conflicting immutable artifact: ' + str(path))
        return
    write(path, value, immutable=True)


def emit(event, **values):
    print(json.dumps({'time': time.time(), 'event': event, **values}), flush=True)


def batch_dirs(out):
    return sorted((out / 'bulk/batches').glob('[0-9]*'))


def active_batches(out):
    return [p for p in batch_dirs(out) if (p / 'submission-intent.json').exists()
            and not (p / 'collected.json').exists()]


def canary_release_ready(out):
    """Keep the coordinator alive until the first outputs reach Audit-2."""
    passed_path = out / 'bulk/canary-passed.json'
    if not passed_path.exists():
        return True
    release_path = out / 'bulk/CANARY-REVIEWED.json'
    if not release_path.exists():
        return False
    passed, release = T.read(passed_path), T.read(release_path)
    if (release.get('approved') is not True
            or release.get('terminal_sha256') != passed['terminal_sha256']
            or not release.get('audit2_selected_sample_ids')):
        raise ValueError('Invalid canary handover approval; do not submit larger batches')
    return True


def baseline_state(out):
    config = T.read(out / 'bulk/config.json')
    baseline = config['baseline']
    return baseline['received_cost_usd'], baseline['uncertain_and_active_reserved_usd']


def accounting(out):
    received, unknown = baseline_state(out)
    active = 0.0
    for directory in batch_dirs(out):
        if not (directory / 'submission-intent.json').exists():
            continue
        manifest = T.read(directory / 'manifest.json')
        if (directory / 'billing.json').exists():
            billing = T.read(directory / 'billing.json')
            received += billing['received_cost_usd']
        elif (directory / 'collected.json').exists():
            unknown += manifest['reserved_usd']
        else:
            active += manifest['reserved_usd']
    return {'received_cost_usd': received, 'unknown_reserved_usd': unknown,
            'active_reserved_usd': active,
            'budget_accounted_usd': received + unknown + active}


def report(out, entries):
    blocked = T.read(out / 'source-blocks.json')
    counts = collections.Counter({k: 0 for k in ('proposal', 'held', 'rejected', 'error',
        'interrupted', 'pending', 'source_held', 'requires_source_review', 'cloud_pending')})
    attempted = set()
    for directory in batch_dirs(out):
        if (directory / 'submission-intent.json').exists():
            attempted.update(T.read(directory / 'manifest.json')['sample_ids'])
    rows = []
    for item in entries:
        directory = T.directory(out, item)
        if (directory / 'final.json').exists():
            final = T.read(directory / 'final.json')
        elif (directory / 'error.json').exists():
            final = {'status': 'error', 'error': T.read(directory / 'error.json')}
        elif item['sample_id'] in attempted:
            final = {'status': 'cloud_pending'}
        else:
            final = {'status': 'interrupted' if T.attempted(out, item) else 'pending'}
        if item['job']['key'] in blocked:
            if final['status'] == 'proposal':
                final = {**final, 'status': 'requires_source_review', 'raw_status': 'proposal'}
            elif final['status'] == 'pending':
                final = {**final, 'status': 'source_held'}
        counts[final['status']] += 1
        rows.append({'sample_id': item['sample_id'], 'key': item['job']['key'],
            'language': item['job']['content']['language'], 'english': item['job']['content']['english'],
            'selection': item['selection'], 'source_refs': item['source_refs'], **final})
    cost = accounting(out)
    batches = []
    for directory in batch_dirs(out):
        manifest = T.read(directory / 'manifest.json')
        state = T.read(directory / 'status.json') if (directory / 'status.json').exists() else {}
        batches.append({'number': int(directory.name), 'size': len(manifest['sample_ids']),
            'id': state.get('id'), 'status': state.get('status', 'prepared'),
            'collected': (directory / 'collected.json').exists(),
            'request_counts': state.get('request_counts')})
    bulk = {'time': time.time(), 'mode': 'cloud_batch', 'batch_size': 500,
        'maximum_outstanding_batches': 1, 'poll_seconds': 60,
        'batches': batches, 'submitted_batches': sum(b['id'] is not None for b in batches),
        'closed_batches': sum(b['collected'] for b in batches),
        'cloud_pending': counts['cloud_pending'], 'local_pending': counts['pending'], **cost}
    summary = {'time': time.time(), 'selected': len(entries), 'counts': dict(counts),
        'received_cost_usd': cost['received_cost_usd'],
        'uncertain_and_active_reserved_usd': cost['unknown_reserved_usd'] + cost['active_reserved_usd'],
        'budget_accounted_usd': cost['budget_accounted_usd'], 'budget_usd': 30,
        'bulk': bulk, 'known_source_blocked_keys': len(blocked),
        'note': 'Fresh-1 legacy Flex plus genuine cloud batches. Actual batch-level charges counted once; no automatic retries. Proposals are not language approval.'}
    temp = out / 'proposals.jsonl.bulk.tmp'
    with temp.open('w') as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    os.replace(temp, out / 'proposals.jsonl')
    write(out / 'summary.json', summary)
    write(out / 'bulk/summary.json', bulk)
    emit('bulk_accounting', accounted_usd=cost['received_cost_usd'] + cost['unknown_reserved_usd'],
         inflight_reserved_usd=cost['active_reserved_usd'], counts=dict(counts))
    return summary


def prepare(out):
    if P.process_state(out).get('running') is not False:
        raise ValueError('Fresh-1 must be verified stopped before bulk migration')
    bulk = out / 'bulk'
    bulk.mkdir(exist_ok=True)
    if (bulk / 'config.json').exists():
        raise ValueError('Bulk migration already prepared; never overwrite its frozen plan')
    legacy = T.read(out / 'config.json')
    snapshot = Q.load_snapshot(Path(legacy['jobs']))
    prompt = (out / 'prompt.txt').read_text()
    entries = Q.load_entries(out)
    Q.validate_entries(entries, snapshot, prompt)
    blocked = T.read(out / 'source-blocks.json')
    pending = [item for item in entries if item['job']['key'] not in blocked and not T.attempted(out, item)]
    baseline = Q.report(out, entries, blocked, 30)
    if baseline['counts']['interrupted']:
        raise ValueError('Reconcile interrupted legacy requests before migration')
    config = {'time': time.time(), 'mode': 'cloud_batch', 'original_config_sha256': sha(out / 'config.json'),
        'prompt_sha256': T.digest(prompt), 'jobs_sha256': sha(Path(legacy['jobs'])),
        'model': T.MODEL, 'canonical_model': B.RESOLVED_MODEL,
        'batch_size': 500, 'maximum_outstanding_batches': 1, 'poll_seconds': 60,
        'budget_usd': 30, 'combined_budget_usd': 250, 'canary_size': 2,
        'canary_handover_gate': 'bulk/CANARY-REVIEWED.json matching terminal hash and verified Audit-2 selection',
        'input_per_million_usd': .375, 'completion_per_million_usd': 1.875,
        'baseline': baseline, 'pending_count': len(pending), 'retries': 0,
        'dependencies_sha256': {str(Path(p).resolve()): sha(p)
            for p in (__file__, C.__file__, Q.__file__, T.__file__)}}
    write(bulk / 'legacy-process.json', T.read(out / 'process.json'), immutable=True)
    write(bulk / 'config.json', config, immutable=True)
    write(bulk / 'plan.json', [{'sample_id': item['sample_id'], 'key': item['job']['key'],
        'queue_sha256': sha(out / 'queue' / (str(item['sample_id']) + '.json')),
        'request_sha256': T.digest(C.batch_payload(item, prompt))} for item in pending], immutable=True)
    write(bulk / 'authorization.json', {'time': time.time(),
        'user_request': 'Bulk submit the rest of Fresh-1, conservatively 500 at a time; poll more frequently, collect and feed Audit-2 immediately.',
        'scope': 'One cloud batch of up to500 untouched Fresh-1 language jobs outstanding, same prompt/content validator/model, controlled2-job batch-format canary reused once, automatic collection and downstream feeding.',
        'existing_budgets_retained': True, 'apply_source_edits': False, 'automatic_retries': False}, immutable=True)
    report(out, entries)
    return config


def frozen_entries(out):
    config = T.read(out / 'bulk/config.json')
    old = T.read(out / 'config.json')
    prompt = (out / 'prompt.txt').read_text()
    if sha(out / 'config.json') != config['original_config_sha256'] or T.digest(prompt) != config['prompt_sha256']:
        raise ValueError('Frozen source configuration/prompt changed')
    if sha(Path(old['jobs'])) != config['jobs_sha256']:
        raise ValueError('Frozen jobs changed')
    if any(sha(Path(p)) != digest for p, digest in config['dependencies_sha256'].items()):
        raise ValueError('Frozen bulk runner dependencies changed')
    entries = Q.load_entries(out)
    by_id = {i['sample_id']: i for i in entries}
    for item in T.read(out / 'bulk/plan.json'):
        number = item['sample_id']
        if (by_id[number]['job']['key'] != item['key']
            or sha(out / 'queue' / (str(number) + '.json')) != item['queue_sha256']
            or T.digest(C.batch_payload(by_id[number], prompt)) != item['request_sha256']):
            raise ValueError('Frozen bulk plan changed')
    return config, entries, by_id, prompt


def next_items(out, by_id, prompt):
    blocked = T.read(out / 'source-blocks.json')
    unused = [by_id[p['sample_id']] for p in T.read(out / 'bulk/plan.json')
              if by_id[p['sample_id']]['job']['key'] not in blocked
              and not T.attempted(out, by_id[p['sample_id']])]
    if not unused:
        return []
    schema = T.digest(C.batch_payload(unused[0], prompt)['response_format'])
    limit = 500 if (out / 'bulk/canary-passed.json').exists() else 2
    same_schema = [i for i in unused if T.digest(C.batch_payload(i, prompt)['response_format']) == schema]
    cost = accounting(out)
    other = Q.latest_audit_budget(Path(T.read(out / 'config.json')['audit_budget_log']))
    a2 = Q.latest_audit_budget(AUDIT2 / 'process.log')
    combined = cost['budget_accounted_usd'] + other['accounted_usd'] + other['inflight_reserved_usd'] + a2['accounted_usd'] + a2['inflight_reserved_usd']
    result, reserve = [], 0.0
    for item in same_schema[:limit]:
        amount = T.reservation(C.batch_payload(item, prompt))
        if cost['budget_accounted_usd'] + reserve + amount > 30 or combined + reserve + amount > 250:
            break
        reserve += amount
        result.append(item)
    if not result:
        raise ValueError('Existing budget cannot reserve the next cloud request')
    return result


def submit(out, items, prompt):
    number = len(batch_dirs(out)) + 1
    directory = out / 'bulk/batches' / f'{number:06d}'
    requests = [{'custom_id': str(i['sample_id']), 'body': C.batch_payload(i, prompt)} for i in items]
    value = {'endpoint': '/v1/chat/completions', 'model': T.MODEL, 'requests': requests}
    amounts = {str(i['sample_id']): T.reservation(r['body']) for i, r in zip(items, requests)}
    manifest = {'number': number, 'sample_ids': [i['sample_id'] for i in items],
        'reserved_usd': sum(amounts.values()), 'reservations': amounts,
        'schema_sha256': T.digest(requests[0]['body']['response_format']), 'created': time.time()}
    write(directory / 'manifest.json', manifest, immutable=True)
    write(directory / 'request.json', value, immutable=True)
    write(directory / 'submission-intent.json', {'time': time.time(),
        'request_sha256': sha(directory / 'request.json'), 'automatic_retry': False}, immutable=True)
    for item, request in zip(items, requests):
        result = T.directory(out, item)
        if T.attempted(out, item):
            raise ValueError('A bulk item was already attempted')
        write(result / 'request.json', request['body'], immutable=True)
        write(result / 'started.json', {'time': time.time(), 'kind': 'cloud_batch',
            'batch_dir': str(directory.resolve()), 'reserved_usd': amounts[str(item['sample_id'])],
            'request_sha256': T.digest(request['body'])}, immutable=True)
    emit('cloud_submit_intent', batch=number, jobs=len(items), reserved_usd=manifest['reserved_usd'])
    try:
        code, accepted = B.network(B.API, (directory / 'request.json').read_bytes())
        write(directory / 'accepted.json', accepted, immutable=True)
        write(directory / 'status.json', accepted)
        if code != 202 or not isinstance(accepted.get('id'), str):
            raise ValueError('Batch acceptance is ambiguous; reconcile without resubmission')
        for item in items:
            origin = C.make_origin(item, directory)
            write(T.directory(out, item) / 'batch-origin.json', origin, immutable=True)
        emit('cloud_accepted', batch=number, id=accepted['id'], jobs=len(items))
    except Exception as error:
        write(directory / 'submission-error.json', {'time': time.time(), 'error': str(error), 'automatic_retry': False}, immutable=True)
        raise
    return directory


def collect(out, directory, by_id):
    terminal = T.read(directory / 'terminal.json')
    requests = T.read(directory / 'request.json')['requests']
    checked = C.validate_batch(terminal, requests)
    ensure(directory / 'billing.json', {'received_cost_usd': checked['received_cost_usd'],
        'usage': checked['usage'], 'terminal_sha256': sha(directory / 'terminal.json')})
    failed = 0
    proposals = 0
    fatal = False
    for index, request in enumerate(requests):
        number = int(request['custom_id']); item = by_id[number]
        result = T.directory(out, item)
        record = checked['results'][request['custom_id']]
        receipt = C.make_receipt(T.read(result / 'batch-origin.json'))
        ensure(result / 'batch-receipt.json', receipt)
        raw = (record.get('response') or {}).get('body')
        code = (record.get('response') or {}).get('status_code')
        provider_error = record.get('error') or {}
        fatal_item = code in (401, 402, 403, 404, 429) or (isinstance(provider_error, dict)
            and provider_error.get('code') in (401, 402, 403, 404, 429, '401', '402', '403', '404', '429'))
        fatal = fatal or fatal_item
        if record.get('error') or code != 200 or not isinstance(raw, dict):
            failed += 1
            final = {'status': 'error'}
            ensure(result / 'error.json', {'time': terminal['finalized_at'], 'kind': 'cloud_batch_request',
                'provider_detail': record.get('error'), 'http_status': code,
                'fatal': fatal_item, 'automatic_retry': False})
        else:
            ensure(result / 'response.json', raw)
            try:
                final = T.validate(raw, item)
            except Exception as error:
                final = {'status': 'rejected', 'reason': str(error), 'changes': [], 'result': None}
            failed += final['status'] == 'rejected'
            proposals += final['status'] == 'proposal'
            ensure(result / 'final.json', final)
        ensure(out / 'outcomes' / f'{number}.json', {'time': terminal['finalized_at'], 'sample_id': number,
            'key': item['job']['key'], 'status': final['status'], 'fatal': fatal_item,
            'billing_scope': 'allocation_of_received_cloud_batch_charge',
            'received_cost_usd': receipt['allocated_received_cost_usd'],
            'uncertain_reserved_usd': 0})
    ensure(directory / 'collected.json', {'time': terminal['finalized_at'], 'jobs': len(requests), 'failures': failed})
    emit('cloud_collected', batch=int(directory.name), jobs=len(requests), failures=failed)
    if not (out / 'bulk/canary-passed.json').exists():
        if failed or not proposals:
            raise ValueError('Cloud-format canary failed; do not submit larger batches')
        write(out / 'bulk/canary-passed.json', {'time': time.time(), 'batch': int(directory.name),
            'terminal_sha256': sha(directory / 'terminal.json'), 'reused_once': True}, immutable=True)
    if fatal or failed >= 10 or Q.stopped_for_failures(Q.failure_state(out, Q.load_entries(out))):
        raise ValueError('Cloud batch failure threshold reached; investigate before more spending')


def collect_existing(out):
    """GET already accepted jobs and import them; this command cannot submit."""
    _, entries, by_id, _ = frozen_entries(out)
    if P.process_state(out).get('running') is not False:
        raise ValueError('Coordinator must be verified stopped before separate collection')
    for directory in active_batches(out):
        if not (directory / 'accepted.json').exists():
            raise ValueError('Unknown submission outcome; reconcile before further action')
        accepted = T.read(directory / 'accepted.json')
        _, status = B.network(B.API + '/' + accepted['id'])
        if status.get('id') != accepted['id']:
            raise ValueError('Provider batch ID changed')
        write(directory / 'status.json', status)
        if status.get('status') in TERMINAL:
            ensure(directory / 'terminal.json', status)
            collect(out, directory, by_id)
    return report(out, entries)


def run(out, max_batches=None):
    config, entries, by_id, prompt = frozen_entries(out)
    if (out / 'bulk/BLOCKED.json').exists():
        raise ValueError('A previous bulk failure requires explicit reconciliation before more spending')
    if (out / 'bulk/STOP').exists():
        raise ValueError('Bulk STOP sentinel is present')
    if active_batches(out):
        raise ValueError('Existing unfinished batch requires read-only collection/reconciliation, never blind relaunch')
    process = {'pid': os.getpid(), 'started': time.time(), 'status': 'running',
        'mode': 'cloud_batch', 'argv': sys.argv,
        'exact_command': shlex.join([sys.executable, *sys.argv])}
    write(out / 'process.json', process)
    reason = []
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda signum, frame: reason.append(signal.Signals(signum).name))
    emit('bulk_started', **process)
    submitted = 0
    try:
        while not reason and not (out / 'bulk/STOP').exists():
            if not canary_release_ready(out):
                emit('canary_awaiting_handover_verification')
                report(out, entries)
                for _ in range(60):
                    time.sleep(1)
                    if reason or (out / 'bulk/STOP').exists():
                        break
                continue
            items = next_items(out, by_id, prompt)
            if not items:
                break
            directory = submit(out, items, prompt)
            submitted += 1
            report(out, entries)
            while True:
                accepted = T.read(directory / 'accepted.json')
                _, status = B.network(B.API + '/' + accepted['id'])
                if status.get('id') != accepted['id']:
                    raise ValueError('Provider batch ID changed')
                write(directory / 'status.json', status)
                emit('cloud_poll', batch=int(directory.name), id=status['id'], status=status.get('status'),
                     request_counts=status.get('request_counts'))
                if status.get('status') in TERMINAL:
                    write(directory / 'terminal.json', status, immutable=True)
                    collect(out, directory, by_id)
                    report(out, entries)
                    break
                report(out, entries)
                # STOP stops admission immediately; accepted work still needs collection.
                for _ in range(60):
                    time.sleep(1)
                    if reason:
                        break
                if reason:
                    break
            if max_batches is not None and submitted >= max_batches:
                reason.append('requested batch limit')
        process.update(status='stopped' if reason or (out / 'bulk/STOP').exists() else 'finished',
                       reason=reason[0] if reason else ('STOP sentinel' if (out / 'bulk/STOP').exists() else None))
    except BaseException as error:
        process.update(status='stopped', reason=type(error).__name__ + ': ' + str(error))
        ensure(out / 'bulk/BLOCKED.json', {'time': time.time(), 'reason': process['reason'],
            'automatic_resume': False})
        raise
    finally:
        process['ended'] = time.time()
        process['remote_batches_pending'] = len(active_batches(out))
        write(out / 'process.json', process)
        summary = report(out, entries)
        emit('bulk_stopped', process=process, summary=summary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'run', 'report', 'collect'])
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT)
    parser.add_argument('--max-batches', type=int)
    args = parser.parse_args()
    out = args.out.resolve()
    if out != DEFAULT_OUT.resolve():
        raise ValueError('Only the authorized Fresh-1 output is supported')
    with Q.exclusive_lock(out):
        if args.command == 'prepare':
            print(json.dumps(prepare(out)))
        elif args.command == 'collect':
            collect_existing(out)
        elif args.command == 'report':
            if P.process_state(out).get('running') is not False:
                raise ValueError('Cannot report while coordinator is active')
            report(out, Q.load_entries(out))
        else:
            run(out, args.max_batches)


if __name__ == '__main__':
    main()
