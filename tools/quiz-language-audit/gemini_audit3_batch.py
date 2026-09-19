#!/usr/bin/env python3
"""Frozen Audit-3 diagnoses through genuine OpenRouter cloud batches.

Only this new run directory is written. Prior runners and quiz sources are never
changed. A durable submission intent is never retried; accepted IDs can be resumed
or collected using GET only. Every received charge comes from the terminal batch
bill, and individual receipts explicitly allocate that bill once.
"""
import argparse
import collections
from contextlib import contextmanager
import csv
import fcntl
import functools
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import signal
import sys
import time
import types
import urllib.parse
import uuid

import gemini_auditor as A
import gemini_batch_auditor as B
import fresh_batch_contract as C

ROOT = Path(__file__).resolve().parent
VALID = ('pass', 'flagged', 'needs_review', 'source_issue')
TERMINAL = {'completed', 'failed', 'cancelled', 'expired'}
REMOTE = TERMINAL | {'validating', 'queued', 'in_progress', 'finalizing', 'cancelling'}
INPUT_RATE, OUTPUT_RATE = .375, 1.875
POLL_SECONDS, VISIBILITY_SECONDS = 60, 900
BATCH_SIZE, WINDOW, CANARY_SIZE = 500, 4, 2
BUDGET, COMBINED_BUDGET = 30., 250.
PROMPT = A.e.BASE + '\n' + A.e.DIAG
read, canonical, digest = lambda p: C.T.parse(Path(p).read_text()), A.e.a.canonical, A.e.a.digest


class BudgetCapacity(ValueError):
    pass


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def write(path, value, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write('\n'); handle.flush(); os.fsync(handle.fileno())
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
        temporary.unlink(missing_ok=True)


def ensure(path, value):
    if path.exists():
        if read(path) != value:
            raise ValueError('Conflicting immutable artifact: ' + str(path))
    else:
        write(path, value, immutable=True)


@contextmanager
def exclusive_lock(out):
    out.mkdir(parents=True, exist_ok=True)
    with (out / 'run.lock').open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def emit(out, event, **values):
    value = {'time': time.time(), 'event': event, **values}
    line = json.dumps(value, ensure_ascii=False, allow_nan=False)
    with (out / 'process.log').open('a') as handle:
        handle.write(line + '\n'); handle.flush()
    print(line, flush=True)


def dependency_hashes():
    # Freeze all locally imported helper code, including dynamically loaded
    # original prompt/schema modules. No dependency is modified by this runner.
    todo, seen, paths = [A, B, C], set(), {Path(__file__).resolve()}
    while todo:
        module = todo.pop()
        if id(module) in seen:
            continue
        seen.add(id(module))
        path = Path(module.__file__).resolve() if getattr(module, '__file__', None) else None
        if path is None or not path.is_relative_to(ROOT):
            continue
        paths.add(path)
        todo.extend(value for value in vars(module).values() if isinstance(value, types.ModuleType))
    return {str(path): sha(path) for path in sorted(paths)}


def clean_content(job):
    c = job['content']
    data = {name: c[name] for name in ('english', 'target', 'grades', 'language', 'answer')}
    data['source_fact'] = {'en': c.get('source_fact', {}).get('en')}
    if c['language'] not in ('tl', 'bis'):
        raise ValueError('Audit-3 accepts only Filipino and Cebuano')
    n = len(c['english']['options'])
    if not 2 <= n <= 10 or len(c['target']['options']) != n:
        raise ValueError('English and candidate option counts must match')
    for name in ('english', 'target'):
        quiz = c[name]
        if set(quiz) != {'q', 'options', 'explanation'} or not isinstance(quiz['options'], list):
            raise ValueError('Invalid candidate quiz shape')
        if any(not isinstance(s, str) or not s.strip() for s in [quiz['q'], *quiz['options'], quiz['explanation']]):
            raise ValueError('Quiz text must be nonempty strings')
    if type(c['answer']) is not int or not 0 <= c['answer'] < n:
        raise ValueError('Invalid private answer index')
    if not isinstance(c['grades'], list) or any(type(g) is not int or not 1 <= g <= 12 for g in c['grades']):
        raise ValueError('Invalid grades')
    if data['source_fact']['en'] is not None and not isinstance(data['source_fact']['en'], str):
        raise ValueError('English source context must be text or null')
    return C.T.parse(canonical(data))


def load_jobs(path):
    jobs = {}
    for line in Path(path).read_text().splitlines():
        job = C.T.parse(line)
        key = job['key']
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}', key) or key in jobs:
            raise ValueError('Invalid or duplicate snapshot job key')
        clean_content(job)
        jobs[key] = job
    if len(jobs) < CANARY_SIZE:
        raise ValueError('At least two jobs required for the canary')
    return jobs


def payload(job):
    value = A.payload(clean_content(job))
    del value['provider']
    if 'service_tier' in value:
        raise ValueError('Unexpected Flex routing in original audit payload')
    return value


def reservation(body):
    # UTF-8 bytes plus framing conservatively bound input tokens; reasoning is
    # already inside the 8000 maximum completion tokens.
    return ((len(canonical(body).encode()) + 4096) * INPUT_RATE + 8000 * OUTPUT_RATE) / 1e6


def source_identity(job):
    return {k: v for k, v in clean_content(job).items() if k != 'target'}


def validate_integration(jobs_path, manifest_path, jobs):
    manifest = read(manifest_path)
    if manifest.get('jobs_sha256') != sha(jobs_path):
        raise ValueError('Integration snapshot hash changed')
    source_path = Path(manifest['source_jobs']).resolve()
    if sha(source_path) != manifest['source_jobs_sha256']:
        raise ValueError('Original source snapshot changed')
    rows = [C.T.parse(line) for line in source_path.read_text().splitlines()]
    source = {j['key']: j for j in rows}
    if len(source) != len(rows):
        raise ValueError('Original snapshot contains duplicate keys')
    files = manifest.get('source_files')
    if not isinstance(files, dict) or not files:
        raise ValueError('Integration must bind the installed source files')
    current_rows = {}
    for filename, info in files.items():
        path = Path(filename)
        if not path.is_absolute() or sha(path) != info['after_sha256']:
            raise ValueError('Integrated source file changed: ' + filename)
        current_rows[filename] = A.e.a.read_rows(path)
    links = manifest.get('jobs')
    if not isinstance(links, dict) or set(links) != set(jobs):
        raise ValueError('Integration manifest does not exactly cover candidate jobs')
    for key, job in jobs.items():
        old = source.get(key)
        link = links[key]
        if (old is None or link.get('source_job_sha256') != digest(old)
                or link.get('candidate_target_sha256') != digest(job['content']['target'])
                or source_identity(old) != source_identity(job)):
            raise ValueError('Integration source or candidate provenance changed: ' + key)
        refs = job.get('refs')
        if not isinstance(refs, list) or not refs:
            raise ValueError('Candidate lacks integrated source references: ' + key)
        oldrefs = {(r['path'], r['row'], r.get('id')) for r in old['refs']}
        if {(r['path'], r['row'], r.get('id')) for r in refs} != oldrefs or len(refs) != len(old['refs']):
            raise ValueError('Candidate source reference identities changed: ' + key)
        for ref in refs:
            rows = current_rows.get(ref['path'])
            index = ref['row']
            if rows is None or type(index) is not int or not 0 <= index < len(rows):
                raise ValueError('Source reference is outside the frozen integrated files')
            row = rows[index]
            if (digest(row) != ref['row_hash'] or A.e.a.localized(row, job['content']['language']) != job['content']['target']
                    or A.e.a.localized(row, 'en') != job['content']['english']
                    or row.get('answer', row.get('a')) != job['content']['answer']):
                raise ValueError('Integrated source row no longer matches candidate: ' + key)
    for entry in manifest.get('candidate_source_files', []):
        if sha(Path(entry['path'])) != entry['sha256']:
            raise ValueError('Integrated candidate source file changed: ' + entry['path'])
    return manifest


def prepare(out, jobs_path, integration_manifest, baseline_accounted_usd):
    if not number(baseline_accounted_usd) or baseline_accounted_usd + BUDGET > COMBINED_BUDGET:
        raise ValueError('Baseline cannot reserve the authorized new-pass budget')
    if (out / 'config.json').exists() or (out / 'batches').exists() or (out / 'results').exists():
        raise ValueError('Audit-3 run already prepared; never replace its freeze')
    jobs_path, integration_manifest = jobs_path.resolve(), integration_manifest.resolve()
    jobs = load_jobs(jobs_path)
    validate_integration(jobs_path, integration_manifest, jobs)
    plan = [{'key': key, 'job_sha256': digest(job), 'target_sha256': digest(job['content']['target']),
             'request_sha256': digest(payload(job)), 'schema_sha256': digest(payload(job)['response_format'])}
            for key, job in jobs.items()]
    if max(collections.Counter(row['schema_sha256'] for row in plan).values()) < CANARY_SIZE:
        raise ValueError('Two canary jobs must share the identical response schema')
    ensure(out / 'plan.json', plan)
    config = {'version': 1, 'stage': 'Audit-3', 'mode': 'cloud_batch',
        'jobs': str(jobs_path), 'jobs_sha256': sha(jobs_path), 'selected': len(jobs),
        'integration_manifest': str(integration_manifest), 'integration_manifest_sha256': sha(integration_manifest),
        'plan_sha256': sha(out / 'plan.json'), 'prompt_sha256': digest(PROMPT),
        'dependencies_sha256': dependency_hashes(), 'model': A.MODEL, 'canonical_model': C.CANONICAL_MODEL,
        'api': B.API, 'endpoint': '/v1/chat/completions', 'temperature': 0, 'reasoning_effort': 'low',
        'max_tokens': 8000, 'input_per_million_usd': INPUT_RATE, 'completion_per_million_usd': OUTPUT_RATE,
        'budget_usd': BUDGET, 'combined_budget_usd': COMBINED_BUDGET,
        'baseline_accounted_usd': baseline_accounted_usd, 'batch_size': BATCH_SIZE,
        'maximum_outstanding_batches': WINDOW, 'canary_size': CANARY_SIZE, 'poll_seconds': POLL_SECONDS,
        'automatic_retries': 0, 'diagnosis_only': True, 'private_answer_sent': False,
        'prior_diagnoses_sent': False, 'generator_notes_sent': False}
    write(out / 'config.json', config, immutable=True)
    return config


def frozen(out):
    config = read(out / 'config.json')
    fixed = {'version': 1, 'stage': 'Audit-3', 'mode': 'cloud_batch', 'model': A.MODEL,
        'canonical_model': C.CANONICAL_MODEL, 'api': B.API, 'endpoint': '/v1/chat/completions',
        'temperature': 0, 'reasoning_effort': 'low', 'max_tokens': 8000,
        'input_per_million_usd': INPUT_RATE, 'completion_per_million_usd': OUTPUT_RATE,
        'budget_usd': BUDGET, 'combined_budget_usd': COMBINED_BUDGET, 'batch_size': BATCH_SIZE,
        'maximum_outstanding_batches': WINDOW, 'canary_size': CANARY_SIZE, 'poll_seconds': POLL_SECONDS,
        'automatic_retries': 0, 'diagnosis_only': True, 'private_answer_sent': False,
        'prior_diagnoses_sent': False, 'generator_notes_sent': False}
    if any(type(config.get(k)) is not type(v) or config[k] != v for k, v in fixed.items()):
        raise ValueError('Frozen Audit-3 routing, limits or contract changed')
    if not number(config.get('baseline_accounted_usd')) or config['baseline_accounted_usd'] + BUDGET > COMBINED_BUDGET:
        raise ValueError('Invalid frozen combined-budget baseline')
    if (config['dependencies_sha256'] != dependency_hashes() or config['prompt_sha256'] != digest(PROMPT)
            or config['plan_sha256'] != sha(out / 'plan.json')):
        raise ValueError('Frozen code, prompt or plan changed')
    for field, pathfield in (('jobs_sha256', 'jobs'), ('integration_manifest_sha256', 'integration_manifest')):
        if config[field] != sha(Path(config[pathfield])):
            raise ValueError('Frozen ' + pathfield + ' changed')
    jobs = load_jobs(Path(config['jobs']))
    validate_integration(Path(config['jobs']), Path(config['integration_manifest']), jobs)
    plan = read(out / 'plan.json')
    expected = [{'key': k, 'job_sha256': digest(j), 'target_sha256': digest(j['content']['target']),
                 'request_sha256': digest(payload(j)), 'schema_sha256': digest(payload(j)['response_format'])}
                for k, j in jobs.items()]
    if plan != expected or config['selected'] != len(jobs):
        raise ValueError('Frozen candidate plan changed')
    return config, jobs, plan


def batch_dirs(out):
    return sorted((out / 'batches').glob('[0-9]*'))


def active_batches(out):
    return [d for d in batch_dirs(out) if (d / 'submission-intent.json').exists()
            and not (d / 'collected.json').exists()]


def checked_batch(out, directory, jobs):
    if directory.resolve().parent != (out / 'batches').resolve():
        raise ValueError('Batch provenance escapes this run')
    manifest, envelope = read(directory / 'manifest.json'), read(directory / 'request.json')
    if (manifest['config_sha256'] != sha(out / 'config.json')
            or manifest['request_sha256'] != sha(directory / 'request.json')
            or list(envelope) != ['endpoint', 'model', 'requests']
            or envelope['endpoint'] != '/v1/chat/completions' or envelope['model'] != A.MODEL):
        raise ValueError('Frozen batch provenance changed')
    identifiers = C._requests(envelope['requests'])
    if identifiers != manifest['keys']:
        raise ValueError('Batch manifest/request IDs differ')
    for row in envelope['requests']:
        key = row['custom_id']
        if key not in jobs or row['body'] != payload(jobs[key]):
            raise ValueError('Batch request differs from frozen candidate: ' + key)
    amounts = {r['custom_id']: reservation(r['body']) for r in envelope['requests']}
    if manifest['reservations'] != amounts or manifest['reserved_usd'] != sum(amounts.values()):
        raise ValueError('Durable batch reservation changed')
    intentpath = directory / 'submission-intent.json'
    if intentpath.exists():
        intent = read(intentpath)
        if intent['request_sha256'] != manifest['request_sha256'] or not number(intent.get('time')):
            raise ValueError('Submission intent differs from frozen request')
    return manifest, envelope


def validate_remote(raw, envelope, batch_id=None):
    if (not isinstance(raw, dict) or not isinstance(raw.get('id'), str) or not raw['id']
            or raw.get('model') not in C.MODELS or raw.get('endpoint') != '/v1/chat/completions'
            or raw.get('status') not in REMOTE
            or type(raw.get('request_counts', {}).get('total')) is not int
            or raw['request_counts']['total'] != len(envelope['requests'])
            or (batch_id is not None and raw['id'] != batch_id)):
        raise ValueError('Provider batch identity, route or count mismatch')


@functools.lru_cache(maxsize=256)
def checked_bill(request_signature, accepted_signature, terminal_signature):
    """Cache only the small validated bill; file identity changes invalidate it."""
    envelope = read(Path(request_signature[0])); accepted = read(Path(accepted_signature[0]))
    terminal = read(Path(terminal_signature[0]))
    validate_remote(accepted, envelope)
    validate_remote(terminal, envelope, accepted['id'])
    checked = C.validate_batch(terminal, envelope['requests'])
    return {'received_cost_usd': checked['received_cost_usd'], 'usage': checked['usage'],
        'terminal_sha256': sha(Path(terminal_signature[0])), 'batch_id': accepted['id']}


def accounting(out):
    config = read(out / 'config.json')
    received = unknown = active = 0.
    tokens = collections.Counter()
    for d in batch_dirs(out):
        if not (d / 'submission-intent.json').exists():
            continue
        reserve = read(d / 'manifest.json')['reserved_usd']
        if (d / 'billing.json').exists():
            bill = read(d / 'billing.json')
            expected = checked_bill(*(C._signature(d / name) for name in ('request.json', 'accepted.json', 'terminal.json')))
            if bill != expected:
                raise ValueError('Terminal billing provenance changed')
            received += bill['received_cost_usd']
            for token in ('prompt_tokens', 'completion_tokens'):
                tokens[token] += bill['usage'][token]
            reason = (bill['usage'].get('completion_tokens_details') or {}).get('reasoning_tokens', bill['usage'].get('reasoning_tokens'))
            if reason is not None:
                tokens['reasoning_tokens_reported'] += reason
        elif (d / 'accepted.json').exists() and not (d / 'terminal.json').exists():
            active += reserve
        else:
            unknown += reserve
    total = received + unknown + active
    return {'received_cost_usd': received, 'received_usage': dict(tokens), 'uncertain_charge_reserved_usd': unknown,
        'active_reserved_usd': active, 'budget_accounted_usd': total,
        'baseline_accounted_usd': config['baseline_accounted_usd'],
        'combined_accounted_usd': config['baseline_accounted_usd'] + total}


def block(out, reason):
    if not (out / 'BLOCKED.json').exists():
        write(out / 'BLOCKED.json', {'time': time.time(), 'reason': str(reason),
              'automatic_resume': False, 'instruction': 'Collect accepted batches using GET; reconcile before any further submission.'}, immutable=True)


def check_ledger(out, jobs):
    seen = set()
    for d in batch_dirs(out):
        manifest, envelope = checked_batch(out, d, jobs)
        if not (d / 'submission-intent.json').exists():
            raise ValueError('Incomplete local batch preparation requires reconciliation')
        if seen.intersection(manifest['keys']):
            raise ValueError('Batch plans overlap')
        seen.update(manifest['keys'])
        if (d / 'submission-intent.json').exists() and not (d / 'accepted.json').exists():
            raise ValueError('Ambiguous submission intent; no resubmission or new spending')
        if (d / 'accepted.json').exists():
            if not (d / 'submission-intent.json').exists():
                raise ValueError('Accepted batch lacks its durable intent')
            validate_remote(read(d / 'accepted.json'), envelope)
    return seen


def canary_ready(out):
    passed = out / 'canary-passed.json'
    if not passed.exists():
        return False
    proof = read(passed)
    directory = out / 'batches' / proof['batch']
    if (proof.get('batch') != '000001' or proof.get('config_sha256') != sha(out / 'config.json')
            or proof['terminal_sha256'] != sha(directory / 'terminal.json')
            or not (directory / 'collected.json').exists()):
        raise ValueError('Canary proof differs from collected batch')
    collected = read(directory / 'collected.json')
    if (collected['errors'] != 0 or collected['jobs'] != CANARY_SIZE
            or sum(collected['counts'].values()) != CANARY_SIZE
            or proof['keys'] != read(directory / 'manifest.json')['keys']):
        raise ValueError('Canary outcomes do not pass the structural gate')
    marker = out / 'CANARY-REVIEWED.json'
    if not marker.exists():
        return False
    release = read(marker)
    if (release.get('approved') is not True or release.get('terminal_sha256') != proof['terminal_sha256']
            or release.get('config_sha256') != sha(out / 'config.json')):
        raise ValueError('Canary review marker is not bound to this run and terminal')
    return True


def failure_state(out):
    """Persistent technical outcomes in sealed batch/item order, not arrival order."""
    recent = collections.deque(maxlen=100)
    consecutive = closed = 0
    first_trigger = None
    for directory in batch_dirs(out):
        if not (directory / 'collected.json').exists():
            continue
        for key in read(directory / 'manifest.json')['keys']:
            result = out / 'results' / key
            failed = (result / 'error.json').exists()
            final = read(result / 'final.json') if (result / 'final.json').exists() else None
            if (failed and final is not None) or (not failed and (final is None or final.get('status') not in VALID)):
                raise ValueError('Closed batch has conflicting or missing technical outcome')
            recent.append(failed)
            consecutive = consecutive + 1 if failed else 0
            closed += 1
            if first_trigger is None and (consecutive >= 3 or sum(recent) >= 10):
                first_trigger = closed
    return {'closed_requests': closed, 'latest_n': len(recent), 'latest_errors': sum(recent),
        'consecutive_errors': consecutive,
        'threshold_reached': first_trigger is not None, 'first_trigger_at_closed_request': first_trigger}


def guard_admission(out):
    state = failure_state(out)
    if state['threshold_reached']:
        reason = 'Persistent technical failure guard: ' + canonical(state)
        block(out, reason)
        raise ValueError(reason)
    return state


def next_keys(out, jobs, plan):
    guard_admission(out)
    used = check_ledger(out, jobs)
    pending = [row for row in plan if row['key'] not in used]
    if not pending:
        return []
    canary = not batch_dirs(out)
    if not canary and not canary_ready(out):
        return []
    groups = collections.defaultdict(list)
    for row in pending:
        groups[row['schema_sha256']].append(row['key'])
    if canary:
        keys = next(values[:CANARY_SIZE] for values in groups.values() if len(values) >= CANARY_SIZE)
    else:
        keys = next(iter(groups.values()))[:BATCH_SIZE]
    cost = accounting(out)
    chosen, held = [], 0.
    for key in keys:
        amount = reservation(payload(jobs[key]))
        if (cost['budget_accounted_usd'] + held + amount > BUDGET
                or cost['combined_accounted_usd'] + held + amount > COMBINED_BUDGET):
            break
        chosen.append(key); held += amount
    if not chosen or (canary and len(chosen) != CANARY_SIZE):
        raise BudgetCapacity('Cannot reserve next batch under the $30/$250 ceilings')
    return chosen


def submit(out, jobs, keys, network=B.network):
    if (out / 'STOP').exists() or (out / 'BLOCKED.json').exists():
        raise ValueError('Submissions are stopped')
    guard_admission(out)
    used = check_ledger(out, jobs)
    if used.intersection(keys) or len(set(keys)) != len(keys) or not keys:
        raise ValueError('Never repeat an assigned or attempted job')
    if len(active_batches(out)) >= WINDOW:
        raise ValueError('Outstanding cloud batch window is full')
    if batch_dirs(out) and not canary_ready(out):
        raise ValueError('Canary gate is closed')
    if not batch_dirs(out) and len(keys) != CANARY_SIZE:
        raise ValueError('First batch must contain exactly two canary jobs')
    requests = [{'custom_id': key, 'body': payload(jobs[key])} for key in keys]
    C._requests(requests)
    envelope = {'endpoint': '/v1/chat/completions', 'model': A.MODEL, 'requests': requests}
    amounts = {row['custom_id']: reservation(row['body']) for row in requests}
    amount = sum(amounts.values()); cost = accounting(out)
    if cost['budget_accounted_usd'] + amount > BUDGET or cost['combined_accounted_usd'] + amount > COMBINED_BUDGET:
        raise BudgetCapacity('Batch exceeds reserved budget ceiling')
    d = out / 'batches' / f'{len(batch_dirs(out)) + 1:06d}'
    write(d / 'request.json', envelope, immutable=True)
    write(d / 'manifest.json', {'keys': keys, 'request_sha256': sha(d / 'request.json'),
        'config_sha256': sha(out / 'config.json'), 'reservations': amounts,
        'reserved_usd': amount}, immutable=True)
    write(d / 'submission-intent.json', {'time': time.time(), 'request_sha256': sha(d / 'request.json'),
        'automatic_retry': False}, immutable=True)
    emit(out, 'cloud_submit_intent', batch=d.name, jobs=len(keys), reserved_usd=amount)
    try:
        code, raw = network(B.API, data=(d / 'request.json').read_bytes(), timeout=300)
        write(d / 'submission-response.json', raw, immutable=True)
        if code != 202:
            raise ValueError('Submission did not return HTTP202; outcome is ambiguous')
        validate_remote(raw, envelope)
        write(d / 'accepted.json', raw, immutable=True)
        accepted_at = time.time()
        write(d / 'poll.json', {'accepted_at': accepted_at, 'next_poll_at': accepted_at + POLL_SECONDS})
        write(d / 'status.json', raw)
        emit(out, 'cloud_accepted', batch=d.name, id=raw['id'], jobs=len(keys))
    except Exception as error:
        write(d / 'submission-error.json', {'time': time.time(), 'error': str(error),
            'automatic_retry': False}, immutable=True)
        block(out, error)
        raise
    return d


def collect_terminal(out, directory, jobs):
    manifest, envelope = checked_batch(out, directory, jobs)
    accepted, terminal = read(directory / 'accepted.json'), read(directory / 'terminal.json')
    validate_remote(accepted, envelope)
    validate_remote(terminal, envelope, accepted['id'])
    checked = C.validate_batch(terminal, envelope['requests'])
    if checked['received_cost_usd'] > manifest['reserved_usd'] + 1e-6:
        raise ValueError('Actual terminal charge exceeds its prior reservation')
    terminal_sha = sha(directory / 'terminal.json')
    bill = {'received_cost_usd': checked['received_cost_usd'], 'usage': checked['usage'],
        'terminal_sha256': terminal_sha, 'batch_id': accepted['id']}
    ensure(directory / 'billing.json', bill)
    errors, counts, fatal = 0, collections.Counter(), False
    for row in envelope['requests']:
        key = row['custom_id']; d = out / 'results' / key
        record = checked['results'][key]
        response = record.get('response') or {}
        raw, code = response.get('body'), response.get('status_code')
        allocation = checked['allocations'][key]
        origin = {'kind': 'audit3_cloud_batch', 'batch_id': accepted['id'], 'batch': directory.name,
            'key': key, 'config_sha256': sha(out / 'config.json'), 'job_sha256': digest(jobs[key]),
            'target_sha256': digest(jobs[key]['content']['target']),
            'request_file_sha256': sha(directory / 'request.json'), 'request_body_sha256': digest(row['body']),
            'accepted_file_sha256': sha(directory / 'accepted.json'), 'terminal_sha256': terminal_sha}
        receipt = {'kind': 'allocation_of_actual_batch_charge', 'batch_id': accepted['id'],
            'key': key, 'terminal_sha256': terminal_sha, 'origin_sha256': digest(origin),
            'response_body_sha256': digest(raw) if isinstance(raw, dict) else None,
            'batch_received_cost_usd': checked['received_cost_usd'],
            'allocated_received_cost_usd': allocation['received_cost_usd'],
            'allocation_method': C.ALLOCATION_METHOD, 'received_usage': allocation['received_usage'],
            'usage_basis': allocation['usage_basis']}
        ensure(d / 'batch-origin.json', origin); ensure(d / 'batch-receipt.json', receipt)
        ensure(d / 'request.json', row['body']); ensure(d / 'batch-result.json', record)
        if isinstance(raw, dict):
            ensure(d / 'response.json', raw)
        try:
            if record.get('error') or code != 200 or not isinstance(raw, dict):
                raise ValueError('Provider batch request failed')
            C.T.parse(raw['choices'][0]['message']['content'])
            result = A.validate(raw, clean_content(jobs[key]))
        except (ValueError, KeyError, TypeError, IndexError) as error:
            if (d / 'final.json').exists():
                raise ValueError('Invalid diagnosis conflicts with an earlier final artifact') from error
            provider_error = record.get('error') or {}
            fatal_item = code in (401, 402, 403, 404, 429) or (isinstance(provider_error, dict)
                and str(provider_error.get('code')) in ('401', '402', '403', '404', '429'))
            fatal = fatal or fatal_item; errors += 1
            ensure(d / 'error.json', {'kind': 'transport' if code != 200 or record.get('error') else 'invalid_diagnosis',
                'error': str(error), 'http_status': code, 'provider_detail': record.get('error'),
                'fatal': fatal_item, 'automatic_retry': False, 'batch_id': accepted['id']})
        else:
            if (d / 'error.json').exists():
                raise ValueError('Successful diagnosis conflicts with an earlier error artifact')
            ensure(d / 'final.json', result)
            counts[result['status']] += 1
    ensure(directory / 'collected.json', {'jobs': len(manifest['keys']), 'counts': dict(counts),
        'errors': errors, 'terminal_sha256': terminal_sha})
    emit(out, 'cloud_collected', batch=directory.name, jobs=len(manifest['keys']), counts=dict(counts), errors=errors)
    if directory.name == '000001':
        if errors:
            raise ValueError('Two-card structural canary failed; larger batches remain blocked')
        ensure(out / 'canary-passed.json', {'batch': directory.name, 'keys': manifest['keys'],
            'terminal_sha256': terminal_sha, 'config_sha256': sha(out / 'config.json')})
    guard_admission(out)
    if fatal or errors >= 10 or (len(manifest['keys']) >= 10 and errors / len(manifest['keys']) >= .1):
        raise ValueError('Batch request failure threshold reached; investigate before more spending')
    return checked


def poll_batch(out, directory, jobs, network=B.network, now=None):
    """One due GET; independent durable schedule, including on process resume."""
    now = time.time() if now is None else now
    _, envelope = checked_batch(out, directory, jobs)
    accepted = read(directory / 'accepted.json')
    validate_remote(accepted, envelope)
    if (directory / 'terminal.json').exists():
        collect_terminal(out, directory, jobs)
        return True
    schedule_path = directory / 'poll.json'
    if not schedule_path.exists():
        # Crash after acceptance: conservatively wait a full minute from recovery.
        write(schedule_path, {'accepted_at': now, 'next_poll_at': now + POLL_SECONDS})
        return False
    schedule = read(schedule_path)
    if not number(schedule.get('next_poll_at')) or not number(schedule.get('accepted_at')):
        raise ValueError('Invalid persisted poll schedule')
    if now < max(schedule['next_poll_at'], schedule['accepted_at'] + POLL_SECONDS):
        return False
    # Persist next due BEFORE GET; a crash cannot accidentally poll more often.
    write(schedule_path, {**schedule, 'last_attempt_at': now, 'next_poll_at': now + POLL_SECONDS})
    try:
        code, raw = network(B.API + '/' + urllib.parse.quote(accepted['id'], safe=''), timeout=300)
        if code != 200:
            raise ValueError('Unexpected status HTTP ' + str(code))
        validate_remote(raw, envelope, accepted['id'])
        write(directory / 'status.json', raw)
        emit(out, 'cloud_poll', batch=directory.name, id=accepted['id'], status=raw['status'],
             request_counts=raw.get('request_counts'))
        if raw['status'] in TERMINAL:
            ensure(directory / 'terminal.json', raw)
            collect_terminal(out, directory, jobs)
            return True
    except Exception as error:
        write(directory / 'poll-errors' / (str(time.time_ns()) + '.json'),
              {'time': now, 'error': str(error), 'batch_id': accepted['id'], 'method': 'GET'}, immutable=True)
        if str(error).startswith('HTTP 404:') and now - schedule['accepted_at'] <= VISIBILITY_SECONDS:
            emit(out, 'cloud_visibility_pending', batch=directory.name, id=accepted['id'])
            return False
        raise
    return False


def report(out, jobs):
    counts = collections.Counter({s: 0 for s in (*VALID, 'errors', 'cloud_pending', 'unsubmitted')})
    languages = {lang: collections.Counter({s: 0 for s in (*VALID, 'errors')}) for lang in ('tl', 'bis')}
    attempted = set()
    batches = []
    for d in batch_dirs(out):
        manifest = read(d / 'manifest.json')
        if (d / 'submission-intent.json').exists():
            attempted.update(manifest['keys'])
        status = read(d / 'status.json') if (d / 'status.json').exists() else {}
        batches.append({'batch': d.name, 'jobs': len(manifest['keys']), 'id': status.get('id'),
                       'status': status.get('status', 'unsubmitted'), 'collected': (d / 'collected.json').exists()})
    with (out / 'review.csv.tmp').open('w') as csvfile, (out / 'diagnoses.jsonl.tmp').open('w') as jsonfile:
        writer = csv.writer(csvfile)
        writer.writerow(['key', 'language', 'status', 'answer_matches', 'diagnosis', 'source_refs'])
        for key, job in jobs.items():
            d = out / 'results' / key
            final = read(d / 'final.json') if (d / 'final.json').exists() else None
            if final is not None:
                status = final['status']; lang = job['content']['language']
                counts[status] += 1; languages[lang][status] += 1
                value = {'key': key, 'language': lang, **final}
                jsonfile.write(json.dumps(value, ensure_ascii=False) + '\n')
                writer.writerow([key, lang, status, final['answer_matches'],
                                 json.dumps(final['diagnosis'], ensure_ascii=False), json.dumps(job.get('refs', []))])
            elif (d / 'error.json').exists():
                counts['errors'] += 1; languages[job['content']['language']]['errors'] += 1
            else:
                counts['cloud_pending' if key in attempted else 'unsubmitted'] += 1
    (out / 'review.csv.tmp').replace(out / 'review.csv')
    (out / 'diagnoses.jsonl.tmp').replace(out / 'diagnoses.jsonl')
    completed = sum(counts[s] for s in VALID)
    cost = accounting(out)
    value = {'time': time.time(), 'stage': 'Audit-3', 'mode': 'cloud_batch', 'selected': len(jobs),
        'completed': completed, 'counts': dict(counts), 'by_language': {k: dict(v) for k, v in languages.items()},
        'batches': batches, 'batches_submitted': sum(b['id'] is not None for b in batches),
        'batches_collected': sum(b['collected'] for b in batches), 'outstanding_batches': len(active_batches(out)),
        'content_flag_rate': counts['flagged'] / completed if completed else None,
        'content_flag_rate_denominator': 'all valid diagnoses: pass + flagged + needs_review + source_issue',
        'all_valid_content_flag_rate': counts['flagged'] / completed if completed else None,
        'decisive_content_flag_rate': counts['flagged'] / (counts['pass'] + counts['flagged']) if counts['pass'] + counts['flagged'] else None,
        'decisive_content_flag_rate_denominator': 'pass + flagged',
        'technical_failure_guard': failure_state(out),
        'request_failure_rate': counts['errors'] / (completed + counts['errors']) if completed + counts['errors'] else None,
        **cost, 'budget_usd': BUDGET, 'combined_budget_usd': COMBINED_BUDGET,
        'note': 'Same-model diagnosis, not native-speaker certification. Source/uncertainty findings are separate from request failures. Reasoning is included in completion tokens; per-card costs are allocations of real aggregate charges.'}
    write(out / 'report.json', value)
    emit(out, 'accounting', accounted_usd=cost['received_cost_usd'] + cost['uncertain_charge_reserved_usd'],
         inflight_reserved_usd=cost['active_reserved_usd'], completed=completed, counts=dict(counts))
    return value


def step(out, jobs, plan, *, collect_only=False, network=B.network, should_stop=lambda: False):
    # A problem on one ID must not starve collection of other outstanding IDs.
    errors = []
    for directory in active_batches(out):
        if not (directory / 'accepted.json').exists():
            errors.append('Ambiguous submission intent in ' + directory.name)
            continue
        try:
            poll_batch(out, directory, jobs, network=network)
        except Exception as error:
            errors.append(str(error))
    if errors:
        block(out, '; '.join(errors))
        raise ValueError('; '.join(errors))
    if collect_only or should_stop() or (out / 'STOP').exists() or (out / 'BLOCKED.json').exists():
        return
    while len(active_batches(out)) < WINDOW:
        if should_stop() or (out / 'STOP').exists():
            return
        try:
            keys = next_keys(out, jobs, plan)
        except BudgetCapacity:
            if active_batches(out):
                return
            raise
        if not keys:
            return
        submit(out, jobs, keys, network=network)
        if not (out / 'canary-passed.json').exists():
            return


def run(out, *, collect_only=False, once=False, network=B.network):
    config, jobs, plan = frozen(out)
    if not collect_only:
        if (out / 'BLOCKED.json').exists():
            raise ValueError('Run is blocked; collect accepted IDs without submitting')
        check_ledger(out, jobs)
    original_argv = getattr(sys, 'orig_argv', None) or [sys.executable, *sys.argv]
    process = {'pid': os.getpid(), 'started': time.time(), 'status': 'running',
        'mode': 'cloud_batch_collect' if collect_only else 'cloud_batch', 'argv': sys.argv,
        'original_argv': list(original_argv), 'exact_command': shlex.join(original_argv)}
    write(out / 'process.json', process)
    stopping = []
    handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    for sig in handlers:
        signal.signal(sig, lambda signum, frame: stopping.append(signal.Signals(signum).name))
    try:
        while True:
            step(out, jobs, plan, collect_only=collect_only or bool(stopping), network=network, should_stop=lambda: bool(stopping))
            summary = report(out, jobs)
            no_active = not active_batches(out)
            if once or (no_active and (collect_only or stopping or (out / 'STOP').exists()
                    or summary['counts']['unsubmitted'] == 0)):
                process['status'] = 'finished' if summary['counts']['unsubmitted'] == 0 and no_active else 'stopped'
                process['reason'] = stopping[0] if stopping else 'collect-only' if collect_only else 'once' if once else 'STOP' if (out / 'STOP').exists() else None
                break
            deadline = time.monotonic() + POLL_SECONDS
            while time.monotonic() < deadline:
                time.sleep(min(1., max(0., deadline - time.monotonic())))
    except BaseException as error:
        block(out, str(error))
        process.update(status='stopped', reason=type(error).__name__ + ': ' + str(error))
        raise
    finally:
        for sig, handler in handlers.items():
            signal.signal(sig, handler)
        process.update(ended=time.time(), remote_batches_pending=len(active_batches(out)))
        write(out / 'process.json', process)
        report(out, jobs)
    return process


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'run', 'collect', 'report'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--jobs', type=Path)
    parser.add_argument('--integration-manifest', type=Path)
    parser.add_argument('--baseline-accounted-usd', type=float)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args(); out = args.out.resolve()
    with exclusive_lock(out):
        if args.command == 'prepare':
            if args.jobs is None or args.integration_manifest is None or args.baseline_accounted_usd is None:
                parser.error('prepare requires --jobs, --integration-manifest, and --baseline-accounted-usd')
            print(json.dumps(prepare(out, args.jobs, args.integration_manifest, args.baseline_accounted_usd)))
        elif args.command == 'report':
            _, jobs, _ = frozen(out); report(out, jobs)
        else:
            run(out, collect_only=args.command == 'collect', once=args.once)


if __name__ == '__main__':
    main()
