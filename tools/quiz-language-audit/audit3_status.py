#!/usr/bin/env python3
"""Free read-only Audit-3 inspection; writes only a separate monitoring directory.

No model calls, provider polls, retries, process controls, source checks/writes or
runner report writers. Cloud completion timing does not support an ETA.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import time
import uuid

import gemini_audit3_batch as G

STATES = ('local_unsubmitted', 'local_prepared', 'cloud_queued', 'cloud_inflight',
          'awaiting_import', 'terminal_failed', 'unknown_submission', 'inconsistent_missing')
PRIOR_STATES = ('prior_failed_requests', 'prior_unresolved_requests', 'prior_completed_requests')
VALID = G.VALID


def read(path, warnings, default=None):
    try:
        return G.read(path)
    except FileNotFoundError:
        return default
    except (ValueError, OSError) as error:
        warnings.append(f'{path.name}: {type(error).__name__}: {error}')
        return default


def age(now, stamp):
    return now - stamp if G.number(stamp) and stamp <= now else None


def ratio(n, d):
    return n / d if d else None


def file_sha(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def hash_matches(path, expected, warnings, label):
    try:
        actual = file_sha(path)
        if actual != expected:
            warnings.append(label + ': frozen SHA256 mismatch')
            return False
        return True
    except (OSError, TypeError) as error:
        warnings.append(label + ': cannot verify hash: ' + str(error))
        return False


def normalized_argv(argv):
    if not argv:
        raise ValueError('Empty command')
    executable = Path(shutil.which(argv[0]) or argv[0]).resolve()
    allowed = {executable}
    for parent in executable.parents:
        if parent.parent.name == 'Versions' and parent.parent.parent.name == 'Python.framework':
            allowed.add(parent / 'Resources/Python.app/Contents/MacOS/Python')
    args = list(argv[1:]); flags = []
    while args and args[0] in ('-B', '-u'):
        flags.append(args.pop(0))
    # Script identity can be relative in sys.orig_argv and absolute in ps.
    if args and args[0].endswith('.py'):
        script = Path(args[0])
        args[0] = str((script if script.is_absolute() else G.A.REPO / script).resolve())
    return allowed, args, flags


def process_state(process, ps=subprocess.run):
    pid = process.get('pid')
    base = {'pid': pid, 'recorded_status': process.get('status'), 'reason': process.get('reason'),
            'started': process.get('started'), 'running': None, 'command_matches': None}
    if type(pid) is not int or pid <= 0:
        return {**base, 'state': 'not_started' if not process else 'invalid_pid'}
    try:
        result = ps(['ps', '-p', str(pid), '-o', 'stat=,command='],
                    capture_output=True, text=True, timeout=5, check=False)
        if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
            return {**base, 'running': False, 'state': 'stopped'}
        if result.returncode != 0:
            return {**base, 'state': 'unverified', 'detail': 'ps could not inspect this PID'}
        status, command = result.stdout.strip().split(None, 1)
        expected = shlex.split(process['exact_command'])
        allowed, arguments, flags = normalized_argv(expected)
        actual_allowed, actual_arguments, actual_flags = normalized_argv(shlex.split(command))
        matches = bool(allowed.intersection(actual_allowed)) and arguments == actual_arguments and flags == actual_flags
        return {**base, 'state': 'zombie' if status.startswith('Z') else 'running' if matches else 'pid_command_mismatch',
            'running': matches and not status.startswith('Z'), 'command_matches': matches,
            'interpreter_flags': {'recorded': flags, 'observed': actual_flags}}
    except (KeyError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        return {**base, 'state': 'unverified', 'detail': str(error)}


def metadata(config, warnings):
    """Stream the submitted snapshot; do not reload all integrated source rows."""
    jobs, hasher = {}, hashlib.sha256()
    path = Path(config['jobs'])
    with path.open('rb') as handle:
        for line in handle:
            hasher.update(line)
            job = G.C.T.parse(line.decode())
            key, lang = job['key'], job['content']['language']
            if key in jobs or lang not in ('tl', 'bis'):
                raise ValueError('Invalid or duplicate snapshot key/language')
            jobs[key] = lang
    if hasher.hexdigest() != config['jobs_sha256']:
        warnings.append('Submitted jobs: frozen SHA256 mismatch')
    return jobs, hasher.hexdigest() == config['jobs_sha256']


def runner_module(config):
    if type(config.get('version')) is not int:
        raise ValueError('Missing Audit-3 runner version')
    if config['version'] == 1:
        return G
    if config['version'] == 2 and config.get('schema_encoding') == 'explicit_enum_string_type_v2':
        import gemini_audit3_batch_v2
        return gemini_audit3_batch_v2
    if config['version'] == 3 and config.get('schema_encoding') == 'explicit_enum_string_type_strict_v3':
        import gemini_audit3_batch_v3
        return gemini_audit3_batch_v3
    if config['version'] == 4 and config.get('schema_encoding') == 'explicit_enum_string_type_strict_option_underscore_v4':
        import gemini_audit3_batch_v4
        return gemini_audit3_batch_v4
    if config['version'] == 5 and config.get('schema_encoding') == 'explicit_enum_string_type_strict_option_underscore_v4':
        import gemini_audit3_batch_v5
        return gemini_audit3_batch_v5
    if config['version'] == 6 and config.get('schema_encoding') == 'explicit_enum_string_type_strict_option_underscore_v4':
        import gemini_audit3_batch_v6
        return gemini_audit3_batch_v6
    raise ValueError('Unsupported Audit-3 runner/schema version')


def predecessor_states(run, config, jobs, warnings, visited=None):
    visited = set() if visited is None else visited
    identity = str(run.resolve())
    if identity in visited:
        raise ValueError('Cycle in predecessor history')
    visited.add(identity)
    excluded = config.get('excluded_keys', [])
    if not excluded:
        return {}, None
    path = run / 'predecessor.json'
    if not hash_matches(path, config['predecessor_sha256'], warnings, 'Predecessor record'):
        raise ValueError('Predecessor record cannot be verified')
    previous = read(path, warnings, {})
    if previous.get('out') != config['predecessor_out'] or previous.get('attempted_keys') != excluded:
        raise ValueError('Predecessor identities differ from the frozen exclusions')
    root = Path(previous['out']).resolve()
    previous_config = read(root / 'config.json', warnings, {})
    if previous_config.get('version') != config['version'] - 1:
        raise ValueError('Predecessor version does not match the frozen history')
    earlier, _ = predecessor_states(root, previous_config, jobs, warnings, visited)
    remote = {}
    for directory in sorted((root / 'batches').glob('[0-9]*')):
        manifest = read(directory / 'manifest.json', warnings, {})
        status = read(directory / 'terminal.json', warnings) or read(directory / 'status.json', warnings, {})
        keys = manifest.get('keys', [])
        counts = status.get('request_counts') or {}
        all_failed = (status.get('status') in G.TERMINAL and counts.get('total') == len(keys)
                      and counts.get('failed') == len(keys) and counts.get('completed') == 0)
        for key in keys:
            if key in earlier:
                warnings.append('Duplicate attempt across predecessor history: ' + key)
            remote[key] = 'prior_failed_requests' if all_failed else 'prior_unresolved_requests'
    result = {}
    if len(set(excluded)) != len(excluded) or not set(excluded) <= set(jobs):
        raise ValueError('Invalid excluded predecessor keys')
    for key in excluded:
        d = root / 'results' / key
        final = read(d / 'final.json', warnings)
        error = read(d / 'error.json', warnings)
        if final is not None and final.get('status') in VALID:
            result[key] = 'prior_completed_requests'
        elif error is not None:
            result[key] = 'prior_failed_requests'
        elif key in remote:
            result[key] = remote[key]
        elif key in earlier:
            result[key] = earlier[key]
        else:
            result[key] = 'prior_unresolved_requests'
            warnings.append('Excluded predecessor key lacks a visible durable attempt: ' + key)
    return result, str(root)


def inspect(run, ps=subprocess.run):
    started = time.time(); warnings = []
    config = read(run / 'config.json', warnings, {})
    if not config:
        raise ValueError('Audit-3 config.json missing or unreadable')
    runner = runner_module(config)
    jobs, jobs_match = metadata(config, warnings)
    previous, predecessor_out = predecessor_states(run, config, jobs, warnings)
    if len(jobs) != config['selected']:
        warnings.append('Submitted job count differs from frozen selection')
    integrity = {'jobs': jobs_match, 'plan': hash_matches(run / 'plan.json', config['plan_sha256'], warnings, 'Plan'),
        'integration_manifest': hash_matches(Path(config['integration_manifest']),
            config['integration_manifest_sha256'], warnings, 'Integration manifest')}
    integrity['dependencies'] = all([hash_matches(Path(path), digest, warnings, 'Dependency ' + Path(path).name)
                                   for path, digest in config['dependencies_sha256'].items()])
    process = read(run / 'process.json', warnings, {})
    health = process_state(process, ps)
    if health['state'] in ('unverified', 'pid_command_mismatch', 'zombie', 'invalid_pid'):
        warnings.append('Process: ' + health['state'])
    launch_argv = read(run / 'run-argv.json', warnings)
    health['launch_command_matches'] = None
    if launch_argv is not None and process.get('exact_command'):
        try:
            allowed, args, flags = normalized_argv(launch_argv)
            actual_allowed, actual_args, actual_flags = normalized_argv(shlex.split(process['exact_command']))
            health['launch_command_matches'] = bool(allowed.intersection(actual_allowed)) and args == actual_args and flags == actual_flags
            if not health['launch_command_matches']:
                warnings.append('Recorded process command differs from saved run-argv.json')
        except (ValueError, TypeError, OSError) as error:
            warnings.append('Cannot verify saved launch argv: ' + str(error))
    old_report = read(run / 'report.json', warnings, {})
    config_sha = file_sha(run / 'config.json')
    assigned, batches = {}, []
    provider = collections.Counter(); accepted_count = collected_count = 0
    now = time.time()
    for directory in sorted((run / 'batches').glob('[0-9]*')):
        manifest = read(directory / 'manifest.json', warnings, {})
        if manifest.get('config_sha256') != config_sha:
            warnings.append(directory.name + ': manifest frozen config SHA256 mismatch')
        hash_matches(directory / 'request.json', manifest.get('request_sha256'), warnings, directory.name + ' request')
        keys = manifest.get('keys', [])
        if not keys:
            warnings.append(directory.name + ': missing or empty manifest')
        accepted = read(directory / 'accepted.json', warnings, {})
        status = read(directory / 'terminal.json', warnings) or read(directory / 'status.json', warnings, {}) or accepted
        collected = read(directory / 'collected.json', warnings)
        schedule = read(directory / 'poll.json', warnings, {})
        intent = read(directory / 'submission-intent.json', warnings)
        terminal_exists = (directory / 'terminal.json').exists()
        if collected is not None:
            state = 'collected'; collected_count += 1
        elif intent is None:
            state = 'local_prepared'
        elif not accepted:
            state = 'unknown_submission'
        elif status.get('status') in ('failed', 'cancelled', 'expired') or status.get('error'):
            state = 'terminal_failed'
        elif terminal_exists or status.get('status') == 'completed':
            state = 'awaiting_import'
        elif status.get('status') in ('validating', 'queued'):
            state = 'cloud_queued'
        elif status.get('status') in ('in_progress', 'finalizing', 'cancelling'):
            state = 'cloud_inflight'
        else:
            state = 'unknown_submission'
            warnings.append(directory.name + ': unrecognized remote batch status')
        if accepted:
            accepted_count += 1
            if status.get('id') != accepted.get('id'):
                warnings.append(directory.name + ': accepted/status batch ID mismatch')
        request_counts = status.get('request_counts') or {}
        for field in ('total', 'completed', 'failed'):
            value = request_counts.get(field)
            if type(value) is int and value >= 0:
                provider[field] += value
            elif accepted:
                warnings.append(directory.name + ': missing/invalid provider request count ' + field)
        if accepted and request_counts.get('total') != len(keys):
            warnings.append(directory.name + ': provider total differs from local manifest')
        poll_age = age(now, schedule.get('last_attempt_at'))
        next_due = schedule.get('next_poll_at')
        overdue = now - next_due if G.number(next_due) and now > next_due else 0
        if state in ('cloud_queued', 'cloud_inflight') and health['running'] is True and overdue > 600:
            warnings.append(directory.name + ': provider poll is over ten minutes overdue')
        batch = {'batch': directory.name, 'id': accepted.get('id'), 'state': state,
            'remote_status': status.get('status'), 'jobs': len(keys), 'request_counts': request_counts,
            'poll_age_seconds': poll_age, 'poll_due_in_seconds': next_due - now if G.number(next_due) else None,
            'accepted_age_seconds': age(now, schedule.get('accepted_at')),
            'terminal_saved': terminal_exists, 'billing_saved': (directory / 'billing.json').exists()}
        batches.append(batch)
        for key in keys:
            if key in previous:
                warnings.append(directory.name + ': attempted predecessor key appears in current batch: ' + key)
            if key in assigned or key not in jobs:
                warnings.append(directory.name + ': overlapping or unknown assigned key ' + str(key))
            assigned[key] = batch
    counts = collections.Counter({s: 0 for s in (*VALID, 'errors', *STATES, *PRIOR_STATES)})
    langs = {lang: collections.Counter({s: 0 for s in (*VALID, 'errors', *STATES, *PRIOR_STATES)}) for lang in ('tl', 'bis')}
    confirmed = collections.Counter(); samples = []
    batch_transport_errors = collections.Counter()
    result_root = run / 'results'
    for key, language in jobs.items():
        if key in previous:
            counts[previous[key]] += 1; langs[language][previous[key]] += 1
            continue
        directory = result_root / key
        final = read(directory / 'final.json', warnings)
        error = read(directory / 'error.json', warnings)
        if final is not None and error is not None:
            warnings.append(key + ': conflicting final and error artifacts')
        if final is not None and final.get('status') in VALID:
            state = final['status']
            if state != 'source_issue' and any(check.get('status') == 'issue'
                    for check in (final.get('diagnosis', {}).get('checks') or {}).values()):
                confirmed[language] += 1
        elif error is not None:
            state = 'errors'
            if error.get('kind') == 'transport' and key in assigned:
                batch_transport_errors[assigned[key]['batch']] += 1
            if len(samples) < 5:
                samples.append({'key': key, 'kind': error.get('kind'), 'http_status': error.get('http_status'),
                                'fatal': error.get('fatal'), 'error': error.get('error')})
        else:
            state = assigned.get(key, {}).get('state', 'local_unsubmitted')
            if state == 'collected' or final is not None:
                state = 'inconsistent_missing'
                warnings.append(key + ': collected or invalid final without a usable outcome')
        counts[state] += 1; langs[language][state] += 1
    completed = sum(counts[s] for s in VALID)
    unimported_provider_failures = 0
    for batch in batches:
        failed = batch['request_counts'].get('failed')
        value = max(0, failed - batch_transport_errors[batch['batch']]) if batch['state'] == 'terminal_failed' and type(failed) is int else 0
        batch['unimported_provider_failures'] = value
        unimported_provider_failures += value
    observed_errors = counts['errors'] + unimported_provider_failures
    derived = {}
    for language, values in langs.items():
        n = sum(values[s] for s in VALID)
        denominator = n - values['source_issue']
        derived[language] = {'counts': dict(values), 'valid_diagnoses': n,
            'all_valid_flag_rate': ratio(values['flagged'], n),
            'decisive_flag_rate': ratio(values['flagged'], values['pass'] + values['flagged']),
            'confirmed_field_issue_count': confirmed[language],
            'confirmed_field_issue_rate_excluding_source': ratio(confirmed[language], denominator),
            'confirmed_field_issue_denominator': denominator}
    try:
        cost = {'verified': True, **runner.accounting(run)}
    except Exception as error:
        cost = {'verified': False, 'received_cost_usd': None, 'uncertain_charge_reserved_usd': None,
                'active_reserved_usd': None, 'combined_accounted_usd': None}
        warnings.append('Billing validation failed: ' + str(error))
    try:
        guard = runner.failure_state(run)
    except Exception as error:
        guard = {'verified': False}; warnings.append('Failure guard validation failed: ' + str(error))
    if guard.get('threshold_reached'):
        warnings.append('Persistent technical failure guard has triggered')
    blocked = read(run / 'BLOCKED.json', warnings)
    if blocked:
        warnings.append('Run is BLOCKED: ' + str(blocked.get('reason')))
    if counts['unknown_submission']:
        warnings.append('Unknown submission outcomes remain; do not resubmit')
    if cost.get('verified') and (cost['budget_accounted_usd'] > 30 or cost['combined_accounted_usd'] > 250):
        warnings.append('Observed received/reserved exposure exceeds the frozen budget')
    drift = {s: {'observed': counts[s], 'reported': old_report.get('counts', {}).get(s)}
             for s in (*VALID, 'errors') if counts[s] != old_report.get('counts', {}).get(s)}
    return {'time': time.time(), 'scan_started': started, 'scan_seconds': time.time() - started,
        'run': str(run), 'stage': 'Audit-3', 'runner_version': config['version'],
        'selected': len(jobs), 'eligible_selected': config.get('eligible_selected', len(jobs)),
        'completed': completed, 'predecessor': {'out': predecessor_out, 'excluded_count': len(previous),
            'unaudited_or_unresolved_requests': counts['prior_failed_requests'] + counts['prior_unresolved_requests'],
            'counts': {state: counts[state] for state in PRIOR_STATES}},
        'counts': dict(counts), 'by_language': derived, 'process': health, 'integrity': integrity,
        'batches': batches, 'batches_accepted': accepted_count, 'batches_collected': collected_count,
        'provider_request_counts': dict(provider),
        'outstanding_provider_batches': sum(b['state'] in ('cloud_queued', 'cloud_inflight') for b in batches),
        'awaiting_import_batches': sum(b['state'] == 'awaiting_import' for b in batches),
        'terminal_failed_batches': sum(b['state'] == 'terminal_failed' for b in batches),
        'unknown_submission_batches': sum(b['state'] == 'unknown_submission' for b in batches),
        'cost': cost, 'technical_failure_guard': guard,
        'all_valid_flag_rate': ratio(counts['flagged'], completed),
        'decisive_flag_rate': ratio(counts['flagged'], counts['pass'] + counts['flagged']),
        'request_failure_rate': ratio(observed_errors, completed + observed_errors),
        'quarantined_request_errors': counts['errors'],
        'historical_failed_requests': counts['prior_failed_requests'],
        'unimported_provider_failures': unimported_provider_failures,
        'observed_request_failures': observed_errors,
        'request_failure_rate_denominator': completed + observed_errors,
        'report_age_seconds': age(time.time(), old_report.get('time')), 'report_count_difference': drift,
        'error_samples': samples, 'stop_present': (run / 'STOP').exists(), 'blocked': blocked is not None,
        'warnings': list(dict.fromkeys(warnings)), 'eta': None,
        'note': 'Read-only live scan; artifacts may advance during collection. No cloud ETA. Same-model findings are not native-speaker certification. Confirmed field issues include needs_review with an issue and exclude source_issue; reasoning stays inside completion tokens. Integrated source rows are not rescanned by this monitor.'}


def money(value):
    return '$' + format(value, '.4f') if G.number(value) else 'unverified'


def markdown(value):
    c = value['counts']; cost = value['cost']; flags = c['flagged']; n = value['completed']
    pct = lambda numerator, denominator: f'{100 * numerator / denominator:.2f}% ({numerator}/{denominator})' if denominator else '— (0 diagnoses)'
    lines = ['| Stage | Completed / selected | Provider batches collected / accepted | Queued / in flight | Awaiting import / failed terminal / unknown | Local unsubmitted |',
        '|---|---:|---:|---:|---:|---:|',
        f"| Audit-3 | {n:,} / {value['selected']:,} | {value['batches_collected']} / {value['batches_accepted']} | {c['cloud_queued']:,} / {c['cloud_inflight']:,} | {c['awaiting_import']:,} / {c['terminal_failed']:,} / {c['unknown_submission']:,} | {c['local_unsubmitted']:,} |", '',
        '| Language | Pass | Flagged | Needs review | Source issue | Local errors / terminal failed jobs | Decisive flag rate |',
        '|---|---:|---:|---:|---:|---:|---:|']
    for lang, item in value['by_language'].items():
        a = item['counts']
        lines.append(f"| {lang} | {a['pass']:,} | {a['flagged']:,} | {a['needs_review']:,} | {a['source_issue']:,} | {a['errors']:,} / {a['terminal_failed']:,} | {pct(a['flagged'], a['pass'] + a['flagged'])} |")
    lines += ['', f"All-valid flag rate: {pct(flags, n)}. Decisive flag rate excludes needs_review and source_issue.",
        f"Received: {money(cost.get('received_cost_usd'))}; uncertain reserved: {money(cost.get('uncertain_charge_reserved_usd'))}; active reserved: {money(cost.get('active_reserved_usd'))}; combined exposure: {money(cost.get('combined_accounted_usd'))} / $250.",
        f"Prior attempts: {c['prior_failed_requests']:,} failed, {c['prior_unresolved_requests']:,} with unknown outcome, {c['prior_completed_requests']:,} completed; excluded from current submissions within the same full selection. Unknown billing remains reserved above.",
        f"Current technical failures: {value['observed_request_failures']:,} ({value['quarantined_request_errors']:,} quarantined locally; {value['unimported_provider_failures']:,} provider failures awaiting import/billing reconciliation).",
        f"Process: {value['process']['state']}. Cloud ETA: unavailable.", '', value['note']]
    if value['warnings']:
        lines += ['', 'Warnings:'] + ['- ' + warning.replace('\n', ' ') for warning in value['warnings']]
    return '\n'.join(lines) + '\n'


def write_snapshots(run, out, value):
    run, out = run.resolve(), out.resolve()
    # Reject both descendants and ancestors: no monitoring files anywhere inside
    # a pipeline tree, including an accidental parent-directory destination.
    if out.is_relative_to(run) or run.is_relative_to(out):
        raise ValueError('Monitoring output must be disjoint from the Audit-3 run')
    config = G.read(run / 'config.json')
    integration = G.read(Path(config['integration_manifest']))
    protected_paths = [Path(config[field]).resolve() for field in ('jobs', 'integration_manifest')]
    protected_paths += [Path(path).resolve() for path in integration.get('source_files', {})]
    for protected in protected_paths:
        if out == protected or protected.is_relative_to(out):
            raise ValueError('Monitoring output cannot contain frozen inputs')
    if any((parent / 'config.json').exists() for parent in [out, *out.parents] if parent != G.A.REPO):
        raise ValueError('Monitoring output cannot be inside another pipeline/configuration directory')
    out.mkdir(parents=True, exist_ok=True)
    for name, text in (('latest.json', json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n'),
                       ('latest.md', markdown(value))):
        target = out / name; temporary = out / (name + '.' + uuid.uuid4().hex + '.tmp')
        with temporary.open('x') as handle:
            handle.write(text); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args(); run = args.run.resolve()
    value = inspect(run)
    write_snapshots(run, args.out, value)
    print(json.dumps({'completed': value['completed'], 'selected': value['selected'],
                      'warnings': value['warnings'], 'latest': str(args.out.resolve() / 'latest.md')}))


if __name__ == '__main__':
    main()
