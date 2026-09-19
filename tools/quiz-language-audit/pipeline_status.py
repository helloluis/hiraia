#!/usr/bin/env python3
"""Read pipeline artifacts; write only this collector's monitoring snapshots.

No API calls, runner report writers, retries, or process mutations. Counts are a
live filesystem observation, not an atomic database snapshot. Rates describe the
model's findings on the Audit-1-selected population, not linguistic ground truth.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import shlex
import subprocess
import time

REPO = Path(__file__).resolve().parents[2]
RUNS = REPO / 'tools/quiz-language-audit/runs'
AUDIT_STATUSES = ('pass', 'flagged', 'needs_review', 'source_issue')
WARNINGS = []


def read(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as exc:
        WARNINGS.append(f'{path}: unreadable {type(exc).__name__}')
        return default


def resolve(value):
    path = Path(value)
    return path if path.is_absolute() else REPO / path


def number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def ratio(numerator, denominator):
    return numerator / denominator if denominator else None


def wilson(successes, total):
    if not total:
        return None
    p, z = successes / total, 1.959963984540054
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    margin = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [max(0, center - margin), min(1, center + margin)]


def process_state(root):
    process = read(root / 'process.json', {})
    if not process:
        return {'state': 'not_started', 'running': False, 'pid': None, 'started': None}
    pid = process.get('pid')
    state = {'pid': pid, 'started': process.get('started'), 'reported_status': process.get('status'),
             'mode': process.get('mode'), 'bulk_dir': process.get('bulk_dir')}
    if type(pid) is not int or pid <= 0:
        return {**state, 'state': 'unverified', 'running': None}
    try:
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'command='],
                                text=True, capture_output=True, timeout=5)
        if result.returncode == 1 and not result.stdout.strip():
            return {**state, 'state': 'stopped', 'running': False}
        if result.returncode:
            return {**state, 'state': 'unverified', 'running': None}
        actual = shlex.split(result.stdout.strip())
        expected = process.get('exact_command')
        if expected:
            expected = shlex.split(expected)
            # macOS launches framework Python through its app executable, and
            # persistent terminals may add -u outside the recorded runner argv.
            # Require every script argument to match; allow only these harmless
            # interpreter flags, never arbitrary prefixes or substring matches.
            expected_exe = Path(expected[0]).resolve()
            actual_exe = Path(actual[0]).resolve() if actual else None
            framework = next((p for p in expected_exe.parents
                              if p.parent.name == 'Versions' and p.parent.parent.name == 'Python.framework'), None)
            allowed_exe = {expected_exe}
            if framework:
                allowed_exe.add(framework / 'Resources/Python.app/Contents/MacOS/Python')
            script_args = expected[1:]
            extra = actual[1:len(actual) - len(script_args)] if len(actual) >= len(expected) else None
            matches = (actual_exe in allowed_exe and extra is not None
                       and all(flag in ('-u', '-B') for flag in extra)
                       and actual[-len(script_args):] == script_args)
            state['normalized_interpreter_flags'] = extra if matches else None
        else:
            argv = process.get('argv')
            matches = bool(argv and len(actual) >= len(argv) and actual[-len(argv):] == argv)
        return {**state, 'state': 'running' if matches else 'pid_command_mismatch',
                'running': matches, 'command_matches': matches}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {**state, 'state': 'unverified', 'running': None}


def recent_pace(root, process, now, pending, cloud_batch=False):
    start = max(now - 900, process['started'] if number(process.get('started')) else now - 900)
    events = []
    future = 0
    try:
        with (root / 'process.log').open() as handle:
            for line in handle:
                try:
                    event = json.loads(line)
                except ValueError:
                    continue
                stamp = event.get('time')
                completed = event.get('event') == 'completed' or 'new_completed_requests' in event
                if not completed or not number(stamp):
                    continue
                if stamp > now:
                    future += 1
                elif stamp >= start:
                    events.append(event)
    except FileNotFoundError:
        pass
    events.sort(key=lambda event: event['time'])
    span = events[-1]['time'] - events[0]['time'] if events else 0
    elapsed = max(0, now - start)
    supported = len(events) >= 30 and elapsed >= 300 and span >= 300
    pace = len(events) / elapsed if supported else None
    last_age = now - events[-1]['time'] if events else None
    failures = sum(bool(e.get('error')) or e.get('status') in ('error', 'rejected') for e in events)
    # The full window includes idle time; a stale log cannot supply a live ETA.
    eta_ok = supported and process.get('running') is True and last_age is not None and last_age <= 300
    result = {'window_seconds': elapsed, 'closed_request_events': len(events),
            'request_failure_events': failures, 'request_failure_rate': ratio(failures, len(events)),
            'last_completion_age_seconds': last_age, 'requests_per_minute': pace * 60 if pace else None,
            'backlog_eta_seconds': pending / pace if eta_ok and pace else None,
            'future_events_ignored': future,
            'eta_scope': 'Current untouched backlog at recent request throughput; excludes future arrivals and retries.'}
    if cloud_batch:
        result.update(requests_per_minute=None, backlog_eta_seconds=None,
            mode='cloud_batch',
            eta_scope='Cloud completion/import bursts do not measure provider throughput. No cloud backlog ETA is inferred.')
    return result


def entries(root):
    result = {}
    for path in (root / 'queue').glob('*.json'):
        item = read(path)
        if not isinstance(item, dict) or 'sample_id' not in item or 'job' not in item:
            WARNINGS.append(f'{path}: invalid queue artifact')
            continue
        result[str(item['sample_id'])] = item
    return result


def batch_charge(directory):
    """Use the batch receipt ledger without manufacturing per-response usage."""
    origin = read(directory / 'batch-origin.json', {})
    started = read(directory / 'started.json', {})
    version_two = ((isinstance(origin, dict) and origin.get('version') == 2)
                   or (directory / 'batch-failure-receipt.json').exists()
                   or (isinstance(started, dict)
                       and Path(started.get('batch_dir', '')).parent.name == 'batches'
                       and Path(started.get('batch_dir', '')).parent.parent.name == 'bulk-v2'))
    if version_two:
        from fresh_batch_contract_v2 import charge_state
    else:
        from fresh_batch_contract import charge_state
    received, reserved, _usage = charge_state(directory)
    if not number(received) or not number(reserved):
        raise ValueError('Invalid cloud-batch accounting')
    return float(received), float(reserved)


def cloud_batches(root, now):
    """Read cloud state once per stage, separately from legacy local manifests."""
    names = ('bulk', 'bulk-v2')
    process = read(root / 'process.json', {})
    process = process if isinstance(process, dict) else {}
    configured = process.get('bulk_dir')
    selected = None
    if isinstance(configured, str):
        candidate = Path(configured)
        candidate = candidate if candidate.is_absolute() else root / candidate
        selected = next((name for name in names if candidate.resolve() == (root / name).resolve()), None)
        if selected is None:
            WARNINGS.append(f'{root}: process names an unexpected cloud configuration directory')
    if selected is None:
        selected = ('bulk-v2' if process.get('mode') == 'cloud_batch_v2' else
                    'bulk' if process.get('mode') == 'cloud_batch' else
                    'bulk-v2' if (root / 'bulk-v2/config.json').exists() else 'bulk')
    settings, summaries, enabled = {}, {}, False
    states = {}
    for name in names:
        base = root / name
        summary, config = read(base / 'summary.json', {}), read(base / 'config.json', {})
        if not isinstance(summary, dict) or not isinstance(config, dict):
            WARNINGS.append(f'{base}: invalid cloud-batch summary or configuration')
            summary, config = {}, {}
        enabled = enabled or bool(summary) or (base / 'config.json').exists()
        settings[name] = {**config, **summary}
        summaries[name] = summary
        for directory in sorted((base / 'batches').glob('[0-9]*')):
            if not directory.is_dir():
                continue
            if not directory.name.isdigit():
                WARNINGS.append(f'{directory}: invalid cloud-batch directory name')
                continue
            manifest = read(directory / 'manifest.json', {})
            accepted = read(directory / 'accepted.json', {})
            remote = read(directory / 'terminal.json', read(directory / 'status.json', accepted))
            if not all(isinstance(value, dict) for value in (manifest, accepted, remote)):
                WARNINGS.append(f'{directory}: invalid cloud-batch state')
                continue
            accepted_id = accepted.get('id')
            accepted_id = accepted_id if isinstance(accepted_id, str) and accepted_id else None
            if accepted_id and remote.get('id') != accepted_id:
                WARNINGS.append(f'{directory}: cloud status differs from accepted batch ID')
                remote = accepted
            states[str(directory.resolve())] = {
                'namespace': name, 'batch_label': name + '/' + directory.name,
                'number': int(directory.name), 'size': len(manifest.get('sample_ids', [])),
                'id': accepted_id, 'status': remote.get('status', 'prepared'),
                'collected': (directory / 'collected.json').exists(),
                'submission_intent': (directory / 'submission-intent.json').exists(),
                'request_counts': remote.get('request_counts')}
    enabled = enabled or bool(states)
    summary = settings[selected]
    terminal_failures = ('failed', 'expired', 'cancelled')
    provider_ids = [value['id'] for value in states.values() if value['id'] is not None]
    if len(provider_ids) != len(set(provider_ids)):
        WARNINGS.append(f'{root}: duplicate provider batch IDs across cloud manifests')
    namespaces = {}
    for name in names:
        group = [value for value in states.values() if value['namespace'] == name]
        namespaces[name] = {
            'submitted_batches': len({value['id'] for value in group if value['id'] is not None}),
            'closed_batches': sum(value['collected'] for value in group),
            'terminal_failed_batches': sum(value['status'] in terminal_failures for value in group),
            'outstanding_batches': sum(value['id'] is not None and not value['collected']
                                       and value['status'] not in terminal_failures for value in group)}
    stamp = summaries[selected].get('time')
    return {'enabled': enabled, 'by_directory': states,
            'active_namespace': selected, 'by_namespace': namespaces,
            'batches': list(states.values()),
            'submitted_batches': len(set(provider_ids)),
            'closed_batches': sum(value['collected'] for value in states.values()),
            'outstanding_batches': sum(value['id'] is not None and not value['collected']
                                       and value['status'] not in terminal_failures for value in states.values()),
            'provider_pending_batches': sum(value['id'] is not None and value['status'] not in
                                             (*terminal_failures, 'completed') for value in states.values()),
            'terminal_failed_batches': sum(value['status'] in terminal_failures for value in states.values()),
            'uncollected_terminal_failed_batches': sum(value['status'] in terminal_failures and not value['collected']
                                                       for value in states.values()),
            'ambiguous_submissions': sum(value['submission_intent'] and value['id'] is None for value in states.values()),
            'batch_size': summary.get('batch_size'),
            'maximum_outstanding_batches': summary.get('maximum_outstanding_batches'),
            'poll_seconds': summary.get('poll_seconds'),
            'summary_time': stamp,
            'summary_age_seconds': max(0., now - stamp) if number(stamp) else None}


def cloud_pending_status(root, started, cloud):
    path = started.get('batch_dir')
    if not isinstance(path, str):
        return 'cloud_submission_unknown', None
    path = Path(path).resolve()
    allowed = {(root / name / 'batches').resolve() for name in ('bulk', 'bulk-v2')}
    if path.parent not in allowed:
        WARNINGS.append(f'{root}: cloud attempt points outside its batch directory')
        return 'cloud_submission_unknown', None
    state = cloud['by_directory'].get(str(path))
    if not state or state['id'] is None:
        return 'cloud_submission_unknown', None
    remote = state['status']
    if remote in ('queued', 'validating', 'pending', 'scheduled'):
        return 'cloud_queued', remote
    if remote in ('in_progress', 'finalizing', 'cancelling', 'running', 'processing'):
        return 'cloud_inflight', remote
    if remote == 'completed':
        return 'cloud_awaiting_import', remote
    if remote in ('failed', 'expired', 'cancelled'):
        return 'cloud_' + remote, remote
    return 'cloud_pending', remote


def attempt(root, identifier, process, now, cloud=None):
    directory = root / 'results' / str(identifier)
    final = read(directory / 'final.json')
    error = read(directory / 'error.json')
    started = read(directory / 'started.json', {})
    raw = read(directory / 'response.json', {})
    usage = raw.get('usage') or {} if isinstance(raw, dict) else {}
    cost = usage.get('cost') if isinstance(usage, dict) else None
    received = float(cost) if number(cost) else 0.0
    held = 0.0 if number(cost) else started.get('reserved_usd', 0.0)
    held = float(held) if number(held) else 0.0
    cloud_batch = (directory / 'batch-origin.json').exists() or started.get('kind') == 'cloud_batch'
    accounting_error = False
    if cloud_batch:
        try:
            received, held = batch_charge(directory)
        except (ImportError, OSError, ValueError, KeyError, TypeError) as exc:
            WARNINGS.append(f'{directory}: cloud-batch accounting unavailable ({type(exc).__name__})')
            received = 0.0
            ceiling = started.get('reserved_usd', 0.0)
            held = float(ceiling) if number(ceiling) else 0.0
            accounting_error = True
    marker = cloud_batch or bool(started) or any((directory / name).exists() for name in
                               ('request.json', 'response.json', 'final.json', 'error.json'))
    stamp = started.get('time')
    # A full scan takes seconds: this request may have started after its global
    # observation cutoff. Age it at the actual artifact read, while recent_pace
    # deliberately retains the fixed cutoff for its measured event window.
    observed = time.time()
    age = observed - stamp if number(stamp) and stamp <= observed else None
    current = (process.get('running') is True and age is not None and age <= 900
               and (not number(process.get('started')) or stamp >= process['started']))
    remote_status = None
    cloud_status = None
    if cloud_batch:
        cloud_status, remote_status = cloud_pending_status(root, started, cloud or cloud_batches(root, now))
    if isinstance(final, dict):
        status = final.get('status', 'invalid_artifact')
    elif cloud_status in ('cloud_failed', 'cloud_expired', 'cloud_cancelled'):
        # A terminal provider failure is not a successful batch awaiting import.
        status = cloud_status
    elif isinstance(error, dict):
        # HTTP errors/timeouts differ from a received response rejected locally.
        status = 'response_error' if raw else 'transport_error'
    elif cloud_batch:
        status = cloud_status
    elif marker:
        status = 'inflight' if current else 'interrupted_unknown'
    else:
        status = 'pending'
    if (directory / 'final.json').exists() and not isinstance(final, dict):
        status = 'invalid_artifact'
    return {'status': status, 'final': final, 'attempted': marker,
            'received_cost_usd': received, 'uncertain_or_active_reserved_usd': held,
            'inflight_age_seconds': age if current and status == 'inflight' else None,
            'http_status': error.get('http_status') if isinstance(error, dict) else None,
            'cloud_batch': cloud_batch, 'cloud_status': remote_status,
            'cloud_age_seconds': age if cloud_batch and status.startswith('cloud_') else None,
            'accounting_error': accounting_error}


def reconcile_attempts(root, observed, process, now, eligible=None, cloud=None):
    """Refresh new/unfinished attempts, then recheck active ones after discovery.

    The second small pass prevents counting both a worker's old request (which
    completed during discovery) and its replacement. This remains a live scan,
    not a transaction across the runner's files.
    """
    unfinished = {'pending', 'inflight', 'interrupted_unknown', 'invalid_artifact',
                  'cloud_queued', 'cloud_inflight', 'cloud_awaiting_import',
                  'cloud_pending', 'cloud_submission_unknown'}
    for directory in (root / 'results').iterdir() if (root / 'results').exists() else []:
        identifier = directory.name
        if not directory.is_dir() or (eligible is not None and identifier not in eligible):
            continue
        if identifier not in observed or observed[identifier]['status'] in unfinished:
            observed[identifier] = attempt(root, identifier, process, now, cloud)
    for identifier, prior in list(observed.items()):
        if prior['status'] in unfinished - {'pending', 'invalid_artifact'}:
            observed[identifier] = attempt(root, identifier, process, now, cloud)


def metrics(records):
    raw = collections.Counter(r['raw_status'] for r in records if r['raw_status'] in AUDIT_STATUSES)
    eligible = [r for r in records if not r['blocked'] and r['raw_status'] in AUDIT_STATUSES]
    counts = collections.Counter(r['raw_status'] for r in eligible)
    quality = [r for r in eligible if r['raw_status'] != 'source_issue']
    issues = sum(r.get('field_issue', False) for r in quality)
    matched = [r for r in records if r.get('audit1_matched_flagged') and r['raw_status'] in AUDIT_STATUSES]
    converted = sum(r['raw_status'] == 'pass' and not r['blocked'] for r in matched)
    n = len(quality)
    return {'raw_status_counts': dict(raw), 'unblocked_status_counts': dict(counts),
            'raw_valid': sum(raw.values()), 'quality_denominator': n,
            'source_blocked_raw_valid': sum(r['blocked'] and r['raw_status'] in AUDIT_STATUSES for r in records),
            'flagged_rate': ratio(counts['flagged'], n),
            'uncertain_rate': ratio(counts['needs_review'], n),
            'nonpass_language_rate': ratio(counts['flagged'] + counts['needs_review'], n),
            'confirmed_field_issue_jobs': issues, 'confirmed_field_issue_rate': ratio(issues, n),
            'confirmed_field_issue_wilson95': wilson(issues, n),
            'decisive_flagged_rate': ratio(counts['flagged'], counts['pass'] + counts['flagged']),
            'pass_rate_all_valid': ratio(counts['pass'], sum(counts.values())),
            'answer_mismatch_jobs': sum(r.get('answer_matches') is False for r in quality),
            'matched_audit1_flagged_valid': len(matched), 'matched_unblocked_pass': converted,
            'matched_pass_conversion_rate': ratio(converted, len(matched))}


def quality_summary(records):
    result = metrics(records)
    result['by_language'] = {language: metrics([r for r in records if r['language'] == language])
                             for language in ('bis', 'tl')}
    return result


def audit1_matches(fresh, cache):
    selection = fresh.get('selection', {})
    name = selection.get('audit_path')
    if not name:
        return False
    expected = selection.get('audit_sha256')
    cache_key = (name, expected)
    if cache_key not in cache:
        try:
            data = resolve(name).read_bytes()
            value = json.loads(data)
            cache[cache_key] = (value.get('status') == 'flagged'
                                and value.get('answer_matches') is True
                                and (not expected or hashlib.sha256(data).hexdigest() == expected))
        except (OSError, ValueError, TypeError):
            cache[cache_key] = False
    return cache[cache_key]


def batches_and_cohorts(root, records, audit2=False):
    by_id = {r['sample_id']: r for r in records}
    batches = [b for path in (root / 'batches').glob('*.json')
               if isinstance((b := read(path)), dict) and 'batch_id' in b and isinstance(b.get('items'), list)]
    batches.sort(key=lambda b: b['batch_id'])
    done = 0
    for batch in batches:
        group = [by_id.get(str(item.get('sample_id'))) for item in batch['items']]
        done += bool(group) and all(r and r['terminal'] for r in group)
    result = {'done': done, 'total': len(batches)}
    if not audit2:
        return result, []
    cohorts = []
    seen = set()
    for offset in range(0, len(batches), 10):
        chunk = batches[offset:offset + 10]
        identifiers = [str(item.get('sample_id')) for b in chunk for item in b['items']]
        duplicate = bool(seen.intersection(identifiers)) or len(set(identifiers)) != len(identifiers)
        seen.update(identifiers)
        group = [by_id[identifier] for identifier in identifiers if identifier in by_id]
        valid = sum(r['raw_status'] in AUDIT_STATUSES for r in group)
        terminal = sum(r['terminal'] for r in group)
        cohorts.append({'cohort': offset // 10 + 1, 'first_batch': chunk[0]['batch_id'],
                        'last_batch': chunk[-1]['batch_id'], 'assigned': len(identifiers),
                        'valid': valid, 'terminal': terminal,
                        'closed': len(chunk) == 10 and terminal == len(identifiers) and not duplicate,
                        'partial_assignment': len(chunk) < 10, 'duplicate_membership': duplicate,
                        'source_held': sum(r['blocked'] for r in group), **quality_summary(group)})
    return result, cohorts


def queue_stage(root, name, now, fresh_entries=None, fresh_blocks=None):
    process = process_state(root)
    available = root.exists()
    queue = entries(root)
    blocks = {**(fresh_blocks or {}), **read(root / 'source-blocks.json', {})}
    records, cache = [], {}
    received = reserved = 0.0
    cloud = cloud_batches(root, now) if name == 'Fresh-1' else None
    observed = {identifier: attempt(root, identifier, process, now, cloud) for identifier in queue}
    reconcile_attempts(root, observed, process, now, queue, cloud)
    for identifier, item in queue.items():
        job = item.get('job', {})
        key = job.get('key')
        result = observed[identifier]
        received += result['received_cost_usd']; reserved += result['uncertain_or_active_reserved_usd']
        raw_status = result['status']
        blocked = key in blocks
        final = result['final'] or {}
        diagnosis = final.get('diagnosis', {})
        checks = diagnosis.get('checks', {})
        status = ('source_held' if raw_status == 'pending' else 'requires_source_review') if blocked else raw_status
        fresh = (fresh_entries or {}).get(identifier, {})
        matched = (raw_status in AUDIT_STATUSES and fresh.get('job', {}).get('key') == key
                   and audit1_matches(fresh, cache))
        records.append({'sample_id': identifier, 'key': key, 'language': job.get('content', {}).get('language'),
                        'raw_status': raw_status, 'status': status, 'blocked': blocked,
                        'field_issue': any(isinstance(c, dict) and c.get('status') == 'issue' for c in checks.values()),
                        'answer_matches': final.get('answer_matches'), 'audit1_matched_flagged': bool(matched),
                        'terminal': raw_status in AUDIT_STATUSES + ('proposal', 'held', 'rejected', 'error',
                                                                 'transport_error', 'response_error',
                                                                 'cloud_failed', 'cloud_expired', 'cloud_cancelled')
                                    or (blocked and raw_status == 'pending')})
    raw_counts = collections.Counter(r['raw_status'] for r in records)
    effective = collections.Counter(r['status'] for r in records)
    audit2 = name == 'Audit-2'
    batch_counts, cohorts = batches_and_cohorts(root, records, audit2)
    valid = sum(raw_counts[s] for s in AUDIT_STATUSES) if audit2 else raw_counts['proposal']
    failures = sum(raw_counts[s] for s in ('transport_error', 'response_error', 'error', 'rejected',
                                          'cloud_failed', 'cloud_expired', 'cloud_cancelled'))
    closed_attempts = valid + failures + (raw_counts['held'] if not audit2 else 0)
    pending = sum(r['raw_status'] == 'pending' and not r['blocked'] for r in records)
    cloud_mode = bool(cloud and (cloud['enabled'] or any(value['cloud_batch'] for value in observed.values())))
    stage = {'name': name, 'path': str(root), 'available': available, 'process': process,
             'completed': valid, 'selected': len(queue), 'eligible_selected': sum(not r['blocked'] for r in records),
             'raw_counts': dict(raw_counts), 'effective_counts': dict(effective),
             'pending': pending, 'inflight': raw_counts['inflight'],
             'cloud_queued': raw_counts['cloud_queued'], 'cloud_inflight': raw_counts['cloud_inflight'],
             'cloud_awaiting_import': raw_counts['cloud_awaiting_import'],
             'cloud_pending_unknown': raw_counts['cloud_pending'],
             'cloud_submission_unknown': raw_counts['cloud_submission_unknown'],
             'cloud_terminal_failures': sum(raw_counts[s] for s in ('cloud_failed', 'cloud_expired', 'cloud_cancelled')),
             'interrupted_unknown': raw_counts['interrupted_unknown'],
             'source_held_selected': sum(r['blocked'] for r in records),
             'source_blocked_completed': sum(r['blocked'] and r['raw_status'] in AUDIT_STATUSES + ('proposal',) for r in records),
             'request_failures': failures, 'request_failure_rate': ratio(failures, closed_attempts),
             'transport_errors': raw_counts['transport_error'],
             'response_errors': raw_counts['response_error'] + raw_counts['rejected'],
             'invalid_artifacts': raw_counts['invalid_artifact'], 'batches': batch_counts,
             'cloud_batches': {k: v for k, v in cloud.items() if k != 'by_directory'} if cloud_mode else None,
             'accounting_errors': sum(value['accounting_error'] for value in observed.values()),
             'received_cost_usd': received, 'uncertain_or_active_reserved_usd': reserved,
             'recent': recent_pace(root, process, now, pending, cloud_batch=cloud_mode),
             'quality': quality_summary(records) if audit2 else None, 'cohorts': cohorts}
    return stage, queue, blocks


def audit_stage(root, now):
    process = process_state(root)
    baseline = read(root / 'baseline.json', {})
    frozen = baseline.get('report', baseline.get('source_report', baseline))
    if root.exists() and not frozen.get('total'):
        WARNINGS.append(f'{root}: frozen audit baseline missing; original counts/cost unavailable')
    counts = collections.Counter({k: frozen.get('counts', {}).get(k, 0) for k in AUDIT_STATUSES})
    total = frozen.get('total')
    received = frozen.get('received_cost_usd', 0.0)
    reserved = frozen.get('uncertain_charge_reserved_usd', 0.0)
    historical = frozen.get('counts', {}).get('errors_or_unresolved', 0)
    flex = collections.Counter()
    observed = {}
    for directory in (root / 'results').iterdir() if (root / 'results').exists() else []:
        if not directory.is_dir():
            continue
        observed[directory.name] = attempt(root, directory.name, process, now)
    reconcile_attempts(root, observed, process, now)
    for result in observed.values():
        flex[result['status']] += 1
        received += result['received_cost_usd']; reserved += result['uncertain_or_active_reserved_usd']
        if result['status'] in AUDIT_STATUSES:
            counts[result['status']] += 1
    completed = sum(counts.values())
    failures = flex['transport_error'] + flex['response_error'] + flex['error']
    pending = max(0, total - completed - historical - failures - flex['inflight'] - flex['interrupted_unknown']) if total else None
    return {'name': 'Audit-1', 'path': str(root), 'available': root.exists(), 'process': process,
            'completed': completed, 'selected': total, 'eligible_selected': total,
            'raw_counts': dict(counts), 'flex_counts': dict(flex),
            'pending': pending, 'inflight': flex['inflight'], 'interrupted_unknown': flex['interrupted_unknown'],
            'source_held_selected': counts['source_issue'], 'request_failures': failures,
            'historical_unresolved': historical,
            'request_failure_rate': ratio(failures, sum(flex[s] for s in AUDIT_STATUSES) + failures),
            'transport_errors': flex['transport_error'], 'response_errors': flex['response_error'],
            'invalid_artifacts': flex['invalid_artifact'], 'batches': None,
            'received_cost_usd': received, 'uncertain_or_active_reserved_usd': reserved,
            'recent': recent_pace(root, process, now, pending or 0),
            'baseline_note': 'Frozen baseline counts/cost include historical diagnostics exactly once.'}


def trend(cohorts):
    closed = [c for c in cohorts if c['closed']]
    comparable = [c for c in closed if all(c['by_language'][lang]['quality_denominator'] >= 50 for lang in ('bis', 'tl'))]
    if len(comparable) < 2:
        return {'description': 'Not enough closed cohorts with at least 50 valid language judgments per language.', 'delta': None}
    old, new = comparable[-2:]
    rates = [sum(c['by_language'][lang]['confirmed_field_issue_rate'] for lang in ('bis', 'tl')) / 2 for c in (old, new)]
    delta = rates[1] - rates[0]
    return {'cohorts': [old['cohort'], new['cohort']], 'equal_language_issue_rates': rates, 'delta': delta,
            'description': 'Observed equal-language issue rate ' + ('decreased' if delta < 0 else 'increased' if delta > 0 else 'was unchanged')
            + '; descriptive same-model findings, not evidence of improving linguistic quality or learning.'}


def pct(value):
    return f'{value:.1%}' if value is not None else '—'


def duration(seconds):
    if seconds is None:
        return '—'
    return f'{seconds / 3600:.1f}h' if seconds >= 3600 else f'{seconds / 60:.0f}m'


def markdown(report):
    lines = [f"Pipeline observation: {report['created_utc']}", '',
             '| Stage | Completed / selected | Batches done / total | Pending · active | Model content findings | Source holds | Request failures | Cost received + reserved | Recent pace · backlog ETA |',
             '|---|---:|---:|---:|---|---:|---|---:|---|']
    for stage in report['stages']:
        if not stage['available'] or (stage['process']['state'] == 'not_started' and not stage['selected']):
            lines.append(f"| {stage['name']} (not started) | — | — | — | — | — | — | — | — |")
            continue
        counts = (stage['quality']['unblocked_status_counts']
                  if stage['name'] == 'Audit-2' else stage['raw_counts'])
        flag_rate = ratio(counts.get('flagged', 0), sum(counts.get(s, 0) for s in AUDIT_STATUSES))
        rate_label = 'raw valid'
        if stage['name'] == 'Audit-2':
            flag_rate = stage['quality']['flagged_rate']
            rate_label = f"{stage['quality']['quality_denominator']} unblocked language judgments"
        content = (f"{counts.get('proposal', 0):,} proposals; quality pending" if stage['name'] == 'Fresh-1' else
                   f"{counts.get('pass', 0):,} pass · {counts.get('flagged', 0):,} flagged ({pct(flag_rate)} of {rate_label}) · {counts.get('needs_review', 0):,} uncertain · {counts.get('source_issue', 0):,} source")
        batch = stage['batches']
        batch_text = f"{batch['done']:,}/{batch['total']:,}" if batch else '—'
        pending = f"{stage['pending']:,}" if stage['pending'] is not None else '—'
        pending_text = f"{pending} · {stage['inflight']}"
        cloud = stage.get('cloud_batches')
        if cloud is not None:
            batch_text += f" local; {cloud['closed_batches']:,}/{cloud['submitted_batches']:,} cloud"
            if cloud.get('active_namespace') == 'bulk-v2':
                current = cloud['by_namespace']['bulk-v2']
                batch_text += f"; bulk-v2 {current['outstanding_batches']}/{cloud.get('maximum_outstanding_batches') or '—'} outstanding"
            if cloud.get('terminal_failed_batches'):
                batch_text += f" ({cloud['terminal_failed_batches']} failed terminal)"
            pending_text += (f" local; {stage['cloud_queued']} queued · {stage['cloud_inflight']} active cloud"
                             f" · {stage['cloud_awaiting_import']} awaiting import")
            if stage['cloud_pending_unknown']:
                pending_text += f" · {stage['cloud_pending_unknown']} remote state unknown"
        failures = f"{stage['transport_errors']} API/transport · {stage['response_errors']} invalid response"
        failures += f" ({pct(stage['request_failure_rate'])} of closed current-run attempts)"
        if stage.get('historical_unresolved'):
            failures += f"; {stage['historical_unresolved']} historical unresolved"
        if stage['interrupted_unknown']:
            failures += f"; {stage['interrupted_unknown']} unresolved attempt"
        if stage['invalid_artifacts']:
            failures += f"; {stage['invalid_artifacts']} unreadable artifact"
        if stage.get('cloud_submission_unknown'):
            failures += f"; {stage['cloud_submission_unknown']} cloud submission unconfirmed"
        if stage.get('cloud_terminal_failures'):
            failures += f"; {stage['cloud_terminal_failures']} cloud terminal failures"
        if stage.get('accounting_errors'):
            failures += f"; {stage['accounting_errors']} accounting unresolved"
        recent = stage['recent']; pace = recent['requests_per_minute']
        pace_text = ('cloud ETA unavailable' if recent.get('mode') == 'cloud_batch' else
                     f'{pace:.1f}/min' if pace is not None else 'insufficient window')
        selected = f"{stage['selected']:,}" if stage['selected'] is not None else '—'
        lines.append(f"| {stage['name']} ({stage['process']['state']}) | {stage['completed']:,}/{selected} | {batch_text} | {pending_text} | {content} | {stage['source_held_selected']} | {failures} | ${stage['received_cost_usd']:.3f} + ${stage['uncertain_or_active_reserved_usd']:.3f} | {pace_text} · {duration(recent['backlog_eta_seconds'])} |")
    a2 = report['stages'][2]
    q = a2.get('quality') or {}
    if q.get('raw_valid'):
        lines += ['', f"Audit-2: confirmed field issues {q['confirmed_field_issue_jobs']}/{q['quality_denominator']} ({pct(q['confirmed_field_issue_rate'])}); includes issues within uncertain verdicts. Previously flagged → unblocked pass: {q['matched_unblocked_pass']}/{q['matched_audit1_flagged_valid']} ({pct(q['matched_pass_conversion_rate'])}).",
                  '', '| Fixed cohort (batch IDs) | Valid / assigned | Cebuano field issues (n) | Filipino field issues (n) | Uncertain | Source-held | Matched pass conversion |',
                  '|---|---:|---|---|---:|---:|---:|']
        cohorts = a2.get('cohorts', [])
        shown = [c for c in cohorts if c['closed']][-3:]
        current = next((c for c in cohorts if not c['closed']), None)
        if current:
            shown.append(current)
        for c in shown:
            languages = [c['by_language'][lang] for lang in ('bis', 'tl')]
            cells = [f"{l['confirmed_field_issue_jobs']}/{l['quality_denominator']} ({pct(l['confirmed_field_issue_rate'])})" for l in languages]
            label = f"{c['cohort']} ({c['first_batch']}–{c['last_batch']}; {'closed' if c['closed'] else 'partial'})"
            lines.append(f"| {label} | {c['valid']}/{c['assigned']} | {cells[0]} | {cells[1]} | {c['unblocked_status_counts'].get('needs_review', 0)} | {c['source_held']} | {c['matched_unblocked_pass']}/{c['matched_audit1_flagged_valid']} ({pct(c['matched_pass_conversion_rate'])}) |")
    combined = report['combined_accounting']
    lines += ['', f"Combined received ${combined['received_cost_usd']:.3f} + reserved ${combined['uncertain_or_active_reserved_usd']:.3f} = ${combined['accounted_usd']:.3f} / $250 ceiling.",
              '', report['trend']['description'], '',
              'This is an approximate live scan; active and newly appearing requests are reconciled at the end of each stage. Selected totals downstream grow while upstream runs. Completed means raw valid results, including later source-held results; source holds are shown separately. ETA covers the current untouched backlog only and requires ≥30 completion events spanning ≥5 minutes within 15 minutes.',
              '', 'Fresh-1 cloud batches are counted separately from the older local manifests. Accepted cloud work remains queued or active independently of the local coordinator and the 900-second synchronous timeout. Cloud import bursts do not support an ETA. Cloud costs use allocations of actual aggregate batch receipts; raw provider usage is not rewritten.',
              '', 'Quality rates exclude known source holds and source-issue verdicts; transport failures supply no quality verdict. Matched pass conversion retains source issues and late holds in its denominator. The same model generates and reviews this Audit-1-flagged subset: these rates are not independent proof of linguistic quality, corpus-wide error rates, or model learning. Wilson intervals in JSON describe sampling variation only.']
    if report['warnings']:
        lines += ['', f"Collector warnings: {len(report['warnings'])}; see latest.json. Counts may be incomplete."]
    return '\n'.join(lines) + '\n'


def collect(audit1, fresh1, audit2):
    WARNINGS.clear()
    now = time.time()
    first = audit_stage(audit1, now)
    fresh, fresh_queue, blocks = queue_stage(fresh1, 'Fresh-1', now)
    second, _, _ = queue_stage(audit2, 'Audit-2', now, fresh_queue, blocks)
    received = sum(s['received_cost_usd'] for s in (first, fresh, second))
    reserved = sum(s['uncertain_or_active_reserved_usd'] for s in (first, fresh, second))
    return {'created_utc': dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(),
            'time': now, 'observation_finished': time.time(), 'stages': [first, fresh, second],
            'trend': trend(second['cohorts']), 'warnings': list(WARNINGS),
            'combined_accounting': {'received_cost_usd': received,
                                   'uncertain_or_active_reserved_usd': reserved,
                                   'accounted_usd': received + reserved, 'budget_ceiling_usd': 250,
                                   'remaining_accounted_usd': 250 - received - reserved,
                                   'note': 'Observation only; active runners enforce their spending reservations.'},
            'method': 'Read-only filesystem scan; no requests, retries, runner reports, or source edits. Cohorts are ten consecutive sealed batches, never completion-order samples.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True, help='Dedicated monitoring output directory')
    parser.add_argument('--audit1', type=Path, default=RUNS / '2026-09-12/gemini-auditor-flex-v1')
    parser.add_argument('--fresh1', type=Path, default=RUNS / '2026-09-13/gemini-fresh-queue-v1')
    parser.add_argument('--audit2', type=Path, default=RUNS / '2026-09-13/gemini-reaudit-queue-v1')
    args = parser.parse_args()
    roots = [p.resolve() for p in (args.audit1, args.fresh1, args.audit2)]
    out = args.out.resolve()
    if any(out == root or out in root.parents or root in out.parents for root in roots):
        parser.error('--out must be separate from all pipeline directories, descendants, and ancestors')
    report = collect(*roots)
    text = markdown(report)
    out.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    data = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
    (out / f'{stamp}.json').write_text(data)
    for name, value in [('latest.json', data), ('latest.md', text)]:
        temporary = out / ('.' + name + '.tmp')
        temporary.write_text(value)
        temporary.replace(out / name)
    print(text, end='')


if __name__ == '__main__':
    main()
