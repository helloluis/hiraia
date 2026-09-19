"""Audit-2: continuously diagnose Fresh-1 proposals using the exact Audit-1 contract.

No generator rationale, prior diagnosis, or answer key is sent to the API.
Independent requests are grouped in local manifests; source data stays unchanged.
"""
import argparse
import collections
import concurrent.futures
import json
import os
from pathlib import Path
import re
import shlex
import signal
import sys
import time
import urllib.error
import urllib.request

import gemini_flex_auditor as F
import gemini_translation_queue as Q
import fresh_result_selection as selector

T = Q.T

VALID = ('pass', 'flagged', 'needs_review', 'source_issue')
TERMINAL = {*VALID, 'error'}
PROMPT = F.audit.e.BASE + '\n' + F.audit.e.DIAG
MIGRATION_NAME = 'migration-fresh-batch-v1.json'
MIGRATION_ROOT = Path(Q.__file__).resolve().parent
MIGRATION_FILES = frozenset(str(MIGRATION_ROOT / name) for name in (
    'fresh_result_selection.py', 'gemini_reaudit_queue.py', 'fresh_batch_contract.py'))
MIGRATION_CONTRACT = str(MIGRATION_ROOT / 'fresh_batch_contract.py')
MIGRATION_V2_NAME = 'migration-fresh-batch-v2.json'
MIGRATION_V2_FILES = frozenset(str(MIGRATION_ROOT / name) for name in (
    'fresh_result_selection.py', 'gemini_reaudit_queue.py', 'fresh_batch_contract_v2.py'))
MIGRATION_V2_CONTRACT = str(MIGRATION_ROOT / 'fresh_batch_contract_v2.py')


# Proven queue/storage helpers are reused without mutating their module globals.
durable_write = Q.durable_write
exclusive_lock = Q.exclusive_lock
load_snapshot = Q.load_snapshot
can_admit = Q.can_admit
file_sha = Q.file_sha
load_entries = Q.load_entries
sync_blocks = Q.sync_blocks
batch_work = Q.batch_work
audit_state = Q.audit_state


def clean_item(job, sample_id):
    content = job['content']
    clean = {'sample_id': sample_id, 'job': {'key': job['key'], 'content': {
        'english': {field: content['english'][field] for field in ('q', 'options', 'explanation')},
        'target': {field: content['target'][field] for field in ('q', 'options', 'explanation')},
        'grades': content['grades'], 'language': content['language'],
        'answer': content['answer'],
        'source_fact': {'en': content.get('source_fact', {}).get('en')}}}}
    clean = T.parse(T.canonical(clean))
    content = clean['job']['content']
    english, target = content['english'], content['target']
    target_schema = F.audit.e.schema(content, 'rewrite')['properties']['proposed']
    F.audit.e.validate(english, target_schema)
    F.audit.e.validate(target, target_schema)
    if (type(sample_id) is not int or sample_id <= 0 or not isinstance(job['key'], str) or not job['key']
            or content['language'] not in ('tl', 'bis') or not 2 <= len(target['options']) <= 10
            or type(content['answer']) is not int or not 0 <= content['answer'] < len(target['options'])
            or any(not value.strip() for quiz in (english, target) for value in T.fields(quiz).values())):
        raise ValueError('Invalid fresh-proposal audit input')
    if not isinstance(content['grades'], list) or any(type(grade) is not int or not 1 <= grade <= 12 for grade in content['grades']):
        raise ValueError('Invalid grade mapping')
    context = content['source_fact']['en']
    if context is not None and not isinstance(context, str):
        raise ValueError('English source context must be string or null')
    return clean


def source_identity(job):
    """Compare frozen source metadata without reading the obsolete translation."""
    content = job['content']
    return {'english': {field: content['english'][field] for field in ('q', 'options', 'explanation')},
        'grades': content['grades'], 'language': content['language'], 'answer': content['answer'],
        'source_fact': {'en': content.get('source_fact', {}).get('en')}}


def payload(item, prompt=None):
    if prompt is not None and prompt != PROMPT:
        raise ValueError('Audit-2 requires the exact frozen Audit-1 prompt')
    return F.payload(item['job']['content'])


def reservation(value):
    return ((len(T.canonical(value).encode()) + 4096) * .375 + 8000 * 1.875) / 1e6


def validate(raw, item):
    # Audit-1's validator is unchanged; reject duplicate JSON fields before it
    # parses the same content so ambiguous transport data cannot become a pass.
    T.parse(raw['choices'][0]['message']['content'])
    return F.audit.validate(raw, item['job']['content'])


def request(item, out, value, ceiling, credential):
    directory = T.directory(Path(out), item)
    if T.attempted(Path(out), item):
        raise RuntimeError('Refusing to retry attempted Audit-2 sample ' + str(item['sample_id']))
    durable_write(directory / 'request.json', value, immutable=True)
    durable_write(directory / 'started.json', {'time': time.time(), 'reserved_usd': ceiling,
        'request_sha256': T.digest(value)}, immutable=True)
    fatal, kind = False, 'transport'
    try:
        req = urllib.request.Request(F.URL, data=T.canonical(value).encode(), headers={
            'Authorization': 'Bearer ' + credential, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=F.TIMEOUT_SECONDS) as response:
            raw_text = response.read().decode('utf-8')
        (directory / 'response.txt').write_text(raw_text)
        kind = 'response_validation'
        raw = T.parse(raw_text)
        durable_write(directory / 'response.json', raw, immutable=True)
        try:
            F.validate_billing(raw)
        except Exception:
            fatal, kind = True, 'billing'
            raise
        final = validate(raw, item)
        durable_write(directory / 'final.json', final, immutable=True)
        return final['status'], False
    except Exception as error:
        code = error.code if isinstance(error, urllib.error.HTTPError) else None
        fatal = fatal or code in (401, 402, 403, 404, 429)
        detail = error.read(16000).decode(errors='replace').replace(credential, '[REDACTED]') if code else None
        durable_write(directory / 'error.json', {'error': str(error).replace(credential, '[REDACTED]'),
            'kind': kind, 'http_status': code, 'provider_detail': detail, 'fatal': fatal,
            'time': time.time(), 'automatic_retry': False}, immutable=True)
        return 'error', fatal

def validate_dependency_migration(original, current, record, original_config_sha256):
    """Allow exactly the attested batch adapter dependency update, nothing else.

    The original config remains immutable. This local authorization record binds
    its exact bytes to the three reviewed dependency changes; it is not a generic
    configuration override and cannot change prompts, budgets, polling or routes.
    """
    required = {'schema_version', 'kind', 'original_config_sha256', 'dependencies'}
    if (not isinstance(record, dict) or not required <= set(record)
            or set(record) - required - {'authorization'}
            or type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['kind'] != 'fresh_batch_v1'
            or record['original_config_sha256'] != original_config_sha256
            or not re.fullmatch('[0-9a-f]{64}', str(original_config_sha256))):
        raise ValueError('Invalid or unbound Fresh batch migration attestation')
    if ({key: value for key, value in original.items() if key != 'dependencies_sha256'}
            != {key: value for key, value in current.items() if key != 'dependencies_sha256'}):
        raise ValueError('Migration cannot change nondependency Audit-2 configuration')
    before, after = original.get('dependencies_sha256'), current.get('dependencies_sha256')
    declared = record['dependencies']
    if not all(isinstance(value, dict) for value in (before, after, declared)):
        raise ValueError('Invalid migration dependency mappings')
    changed = {path for path in set(before) | set(after) if before.get(path) != after.get(path)}
    if (changed != MIGRATION_FILES or set(declared) != MIGRATION_FILES
            or MIGRATION_CONTRACT in before or set(after) != set(before) | {MIGRATION_CONTRACT}):
        raise ValueError('Migration permits only selector, runner, and the new batch contract')
    for path in MIGRATION_FILES:
        change = declared[path]
        if (not isinstance(change, dict) or set(change) != {'old_sha256', 'new_sha256'}
                or change['old_sha256'] != before.get(path)
                or change['new_sha256'] != after.get(path)
                or not re.fullmatch('[0-9a-f]{64}', str(after.get(path)))
                or (path != MIGRATION_CONTRACT and not re.fullmatch('[0-9a-f]{64}', str(before.get(path))))):
            raise ValueError('Migration dependency hash mismatch: ' + path)
    return True


def migration_v1_config(original, record, original_config_sha256):
    """Reconstruct and validate the first attested state without editing it."""
    if not isinstance(record, dict) or not isinstance(record.get('dependencies'), dict):
        raise ValueError('Missing or invalid first migration attestation')
    updates = {}
    for path, change in record['dependencies'].items():
        if not isinstance(change, dict) or 'new_sha256' not in change:
            raise ValueError('Invalid first migration dependency declaration')
        updates[path] = change['new_sha256']
    intermediate = {**original, 'dependencies_sha256': {
        **original.get('dependencies_sha256', {}), **updates}}
    validate_dependency_migration(original, intermediate, record, original_config_sha256)
    return intermediate


def validate_dependency_migration_v2(original, current, first_record, record,
                                     original_config_sha256, first_record_sha256):
    """Validate the complete immutable v1→v2 chain and its narrow second delta."""
    intermediate = migration_v1_config(original, first_record, original_config_sha256)
    required = {'schema_version', 'kind', 'original_config_sha256',
                'previous_migration_sha256', 'dependencies'}
    if (not isinstance(record, dict) or not required <= set(record)
            or set(record) - required - {'authorization'}
            or type(record['schema_version']) is not int or record['schema_version'] != 2
            or record['kind'] != 'fresh_batch_v2'
            or record['original_config_sha256'] != original_config_sha256
            or record['previous_migration_sha256'] != first_record_sha256
            or not re.fullmatch('[0-9a-f]{64}', str(first_record_sha256))):
        raise ValueError('Invalid or unbound second batch migration attestation')
    if ({key: value for key, value in intermediate.items() if key != 'dependencies_sha256'}
            != {key: value for key, value in current.items() if key != 'dependencies_sha256'}):
        raise ValueError('Second migration cannot change nondependency Audit-2 configuration')
    before, after = intermediate.get('dependencies_sha256'), current.get('dependencies_sha256')
    declared = record['dependencies']
    if not all(isinstance(value, dict) for value in (before, after, declared)):
        raise ValueError('Invalid second migration dependency mappings')
    changed = {path for path in set(before) | set(after) if before.get(path) != after.get(path)}
    if (changed != MIGRATION_V2_FILES or set(declared) != MIGRATION_V2_FILES
            or MIGRATION_V2_CONTRACT in before
            or set(after) != set(before) | {MIGRATION_V2_CONTRACT}):
        raise ValueError('Second migration permits only selector, runner, and the new v2 contract')
    for path in MIGRATION_V2_FILES:
        change = declared[path]
        if (not isinstance(change, dict) or set(change) != {'old_sha256', 'new_sha256'}
                or change['old_sha256'] != before.get(path)
                or change['new_sha256'] != after.get(path)
                or not re.fullmatch('[0-9a-f]{64}', str(after.get(path)))
                or (path != MIGRATION_V2_CONTRACT and not re.fullmatch('[0-9a-f]{64}', str(before.get(path))))):
            raise ValueError('Second migration dependency hash mismatch: ' + path)
    return True


def make_dependency_migration_v2(original, current, first_record,
                                 original_config_sha256, first_record_sha256):
    """Build a checked record; the caller owns its exclusive, durable write."""
    intermediate = migration_v1_config(original, first_record, original_config_sha256)
    record = {'schema_version': 2, 'kind': 'fresh_batch_v2',
        'original_config_sha256': original_config_sha256,
        'previous_migration_sha256': first_record_sha256,
        'dependencies': {path: {'old_sha256': intermediate['dependencies_sha256'].get(path),
                                'new_sha256': current.get('dependencies_sha256', {}).get(path)}
                         for path in sorted(MIGRATION_V2_FILES)}}
    validate_dependency_migration_v2(original, current, first_record, record,
                                    original_config_sha256, first_record_sha256)
    return record


def freeze_config(args, prompt, snapshot):
    if prompt != PROMPT:
        raise ValueError('Prompt file does not exactly match the frozen Audit-1 prompt')
    if not F.valid_number(args.budget) or not 0 < args.budget <= 30:
        raise ValueError('Audit-2 budget must be positive and no greater than $30')
    if args.concurrency not in (1, 2) or not 1 <= args.batch_size <= 50 or args.poll_seconds < 1:
        raise ValueError('Invalid concurrency, batch size, or poll interval')
    if bool(args.other_budget_log) != bool(args.combined_budget is not None):
        raise ValueError('Other budget logs and combined budget must be supplied together')
    if args.combined_budget is not None and (not F.valid_number(args.combined_budget) or args.combined_budget <= 0):
        raise ValueError('Combined budget must be positive')
    if len({path.resolve() for path in args.other_budget_log}) != len(args.other_budget_log):
        raise ValueError('Other budget logs must be unique')
    dependencies = [Path(__file__), Path(Q.__file__), Path(selector.__file__), Path(Q.selector.__file__),
        Path(T.__file__), Path(T.rewrite.__file__), Path(T.rewrite.qwen.__file__), Path(F.__file__),
        Path(F.audit.__file__), Path(F.audit.e.__file__), Path(F.audit.e.a.__file__),
        Path(MIGRATION_CONTRACT), Path(MIGRATION_V2_CONTRACT)]
    config = {'jobs': str(args.jobs.resolve()), 'jobs_sha256': file_sha(args.jobs),
        'snapshot_count': len(snapshot), 'prompt_sha256': T.digest(prompt),
        'fresh_out': str(args.fresh_out.resolve()), 'fresh_process': str(args.fresh_process.resolve()),
        'fresh_config_sha256': file_sha(args.fresh_out / 'config.json'),
        'fresh_prompt_file_sha256': file_sha(args.fresh_out / 'prompt.txt'),
        'dependencies_sha256': {str(path.resolve()): file_sha(path) for path in dependencies},
        'model': F.MODEL, 'service_tier': 'flex', 'provider': 'google-ai-studio/flex',
        'input_per_million_usd': .375, 'completion_per_million_usd': 1.875,
        'budget_usd': args.budget, 'concurrency': args.concurrency, 'batch_size': args.batch_size,
        'poll_seconds': args.poll_seconds, 'other_budget_logs': [str(path.resolve()) for path in args.other_budget_log],
        'combined_budget_usd': args.combined_budget, 'combined_guard_is_cooperative': False,
        'timeout_seconds': F.TIMEOUT_SECONDS, 'max_tokens': 8000, 'automatic_retries': 0,
        'diagnosis_only': True, 'audit_1_contract_unchanged': True, 'answer_key_sent': False,
        'generator_notes_sent': False, 'prior_diagnoses_sent': False}
    target = args.out / 'config.json'
    if target.exists():
        original = T.read(target)
        if original != config:
            attestation = args.out / MIGRATION_NAME
            if not attestation.exists():
                raise ValueError('Frozen Audit-2 configuration changed without a migration attestation')
            first_record, original_sha = T.read(attestation), file_sha(target)
            intermediate = migration_v1_config(original, first_record, original_sha)
            if intermediate != config:
                second = args.out / MIGRATION_V2_NAME
                if not second.exists():
                    raise ValueError('Frozen Audit-2 configuration changed without a v2 migration attestation')
                validate_dependency_migration_v2(original, config, first_record, T.read(second),
                                                original_sha, file_sha(attestation))
    else:
        durable_write(target, config, immutable=True)
    return config

def ingest(out, snapshot, candidates, prompt=None):
    out = Path(out)
    known = {item['job']['key']: item for item in load_entries(out)}
    added = 0
    for candidate in candidates:
        key, job = candidate['key'], candidate['job']
        original = snapshot.get(key)
        if original is None or job.get('key') != key or candidate['sample_id'] != original['sample_id']:
            raise ValueError('Fresh proposal identity differs from immutable source snapshot')
        clean = clean_item(job, candidate['sample_id'])
        if {k: v for k, v in clean['job']['content'].items() if k != 'target'} != source_identity(original['job']):
            raise ValueError('Fresh proposal changed original English, key, context, or metadata')
        if key in known:
            continue
        item = {**clean, 'selection': candidate['selection'],
            'source_refs': original['job'].get('refs', []),
            'source_job_sha256': T.digest(original['job']),
            'fresh_content_sha256': T.digest(clean['job']['content']),
            'selection_sha256': T.digest(candidate['selection']),
            'request_sha256': T.digest(payload(clean, prompt))}
        durable_write(out / 'queue' / (str(item['sample_id']) + '.json'), item, immutable=True)
        known[key] = item
        added += 1
    return added

def validate_entries(entries, snapshot, prompt=None):
    for item in entries:
        original = snapshot.get(item['job']['key'])
        if original is None or original['sample_id'] != item['sample_id']:
            raise ValueError('Persisted Audit-2 identity differs from the snapshot')
        clean = clean_item(item['job'], item['sample_id'])
        if (clean['job'] != item['job']
                or {k: v for k, v in clean['job']['content'].items() if k != 'target'} != source_identity(original['job'])
                or item['source_job_sha256'] != T.digest(original['job'])
                or item['fresh_content_sha256'] != T.digest(clean['job']['content'])
                or item['selection_sha256'] != T.digest(item['selection'])
                or item['source_refs'] != original['job'].get('refs', [])
                or item['request_sha256'] != T.digest(payload(item, prompt))):
            raise ValueError('Persisted Audit-2 proposal or provenance changed')

def validate_results(out, entries, prompt):
    """Resume only verified prior artifacts, while never retrying partial intents."""
    for item in entries:
        directory = T.directory(Path(out), item)
        if not T.attempted(Path(out), item):
            continue
        request_path = directory / 'request.json'
        if not request_path.exists() or T.read(request_path) != payload(item, prompt):
            raise ValueError('Prior request does not match the frozen queue payload')
        raw_path = directory / 'response.json'
        if raw_path.exists():
            raw = T.read(raw_path)
            T.flex.validate_billing(raw)
        final_path = directory / 'final.json'
        if final_path.exists():
            final = T.read(final_path)
            if final['status'] in VALID:
                if not raw_path.exists() or validate(raw, item) != final:
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
                    or record['request_sha256'] != T.digest(payload(item, prompt))):
                raise ValueError('Batch contains duplicate, missing, or changed requests')
            assigned.add(item['sample_id'])
    pending = [item for item in entries if item['sample_id'] not in assigned
               and item['job']['key'] not in blocked_keys]
    while len(pending) >= batch_size or (allow_partial and pending):
        selected, pending = pending[:batch_size], pending[batch_size:]
        number = len(batches) + 1
        batch = {'batch_id': number, 'created': time.time(), 'cloud_batch': False,
            'items': [{'sample_id': item['sample_id'], 'key': item['job']['key'],
                       'request_sha256': T.digest(payload(item, prompt))} for item in selected]}
        durable_write(out / 'batches' / f'{number:06d}.json', batch, immutable=True)
        batches.append(batch)
    return batches


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
    failures = [record['status'] == 'error' for record in records]
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


def latest_other_budget(path):
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
            elif isinstance(value.get('report', value.get('summary')), dict):
                summary = value.get('report', value.get('summary'))
                accounted, reserved = summary['budget_accounted_usd'], 0
                stamp = value.get('process', {}).get('ended', summary.get('time'))
            else:
                continue
            if not all(T.flex.valid_number(number) and number >= 0 for number in (accounted, reserved, stamp)):
                continue
            return {'accounted_usd': accounted, 'inflight_reserved_usd': reserved, 'time': stamp}
        except (ValueError, KeyError, TypeError):
            continue
    raise ValueError('No complete audit budget record is available; spending remains stopped')


def refresh(args, snapshot, prompt):
    config_path = args.out / 'config.json'
    if config_path.exists():
        frozen = T.read(config_path)
        if (file_sha(args.fresh_out / 'config.json') != frozen['fresh_config_sha256']
                or file_sha(args.fresh_out / 'prompt.txt') != frozen['fresh_prompt_file_sha256']):
            raise ValueError('Fresh-1 configuration or prompt changed after Audit-2 was frozen')
    entries = load_entries(args.out)
    candidates, scan = selector.ingest_candidates(args.jobs, args.fresh_out,
        {item['job']['key'] for item in entries})
    blocked = sync_blocks(args.out, scan.get('blocked_keys', {}))
    added = ingest(args.out, snapshot, [item for item in candidates if item['key'] not in blocked], prompt)
    entries = load_entries(args.out)
    validate_entries(entries, snapshot, prompt)
    producer = audit_state(args.fresh_process)
    batches = seal_batches(args.out, entries, prompt, args.batch_size,
                           allow_partial=not producer['running'], blocked_keys=blocked)
    durable_write(args.out / 'discovery.json', {'time': time.time(), 'added': added,
        'selected_total': len(entries), 'upstream': producer, 'scan': scan})
    return entries, batches, blocked, producer

def rates(counts):
    valid = sum(counts.get(status, 0) for status in VALID)
    decisive = counts.get('pass', 0) + counts.get('flagged', 0)
    language_evaluable = decisive + counts.get('needs_review', 0)
    terminal_attempts = valid + counts.get('requires_source_review', 0) + counts.get('error', 0)
    return {'completed_valid_audits': valid,
        'eligible_valid_denominator': valid,
        'pass_rate': counts.get('pass', 0) / valid if valid else None,
        'flag_rate': counts.get('flagged', 0) / valid if valid else None,
        'flagged_rate': counts.get('flagged', 0) / valid if valid else None,
        'nonpass_rate': (valid - counts.get('pass', 0)) / valid if valid else None,
        'source_held_completed_audits': counts.get('requires_source_review', 0),
        'decisive_language_audits': decisive,
        'decisive_language_issue_rate': counts.get('flagged', 0) / decisive if decisive else None,
        'confirmed_translation_errors': counts.get('flagged', 0),
        'confirmed_translation_error_rate': counts.get('flagged', 0) / decisive if decisive else None,
        'language_evaluable_denominator': language_evaluable,
        'confirmed_field_issue_jobs': counts.get('confirmed_field_issue_jobs', 0),
        'confirmed_field_issue_rate': counts.get('confirmed_field_issue_jobs', 0) / language_evaluable if language_evaluable else None,
        'answer_mismatch': counts.get('answer_mismatch', 0),
        'needs_review': counts.get('needs_review', 0), 'source_issues': counts.get('source_issue', 0),
        'technical_errors': counts.get('error', 0), 'terminal_attempts': terminal_attempts,
        'technical_error_rate': counts.get('error', 0) / terminal_attempts if terminal_attempts else None,
        'transport_errors': counts.get('transport_error', 0),
        'transport_error_rate': counts.get('transport_error', 0) / terminal_attempts if terminal_attempts else None,
        'note': 'Pass/flag/nonpass rates include all eligible valid diagnoses. Decisive language-issue rate uses flagged/(pass+flagged); uncertainty and source issues are shown separately. Late source-held results are excluded from quality rates. Technical errors use all raw valid finals plus errors, excluding pending work.'}


def report(out, entries, blocked_keys=None, budget=None, scan=None):
    out = Path(out)
    if blocked_keys is None:
        blocked_path = out / 'source-blocks.json'
        blocked_keys = T.read(blocked_path) if blocked_path.exists() else {}
    names = (*VALID, 'error', 'interrupted', 'pending', 'source_held', 'requires_source_review',
             'transport_error', 'response_validation_error', 'billing_error',
             'confirmed_field_issue_jobs', 'answer_mismatch')
    counts = collections.Counter({name: 0 for name in names})
    raw_counts = collections.Counter({name: 0 for name in (*VALID, 'error', 'interrupted', 'pending')})
    languages, by_batch = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    raw_languages, raw_batches = collections.defaultdict(collections.Counter), collections.defaultdict(collections.Counter)
    batch_ids = {}
    for path in (out / 'batches').glob('*.json'):
        batch = T.read(path)
        for record in batch['items']:
            batch_ids[record['sample_id']] = batch['batch_id']
    usage = collections.Counter()
    received = reserved = 0.0
    records = []
    for item in entries:
        directory = T.directory(out, item)
        cost, unknown, tokens = F.charge_state(directory)
        received += cost
        reserved += unknown
        usage.update(tokens)
        if (directory / 'final.json').exists():
            outcome = T.read(directory / 'final.json')
            if outcome['status'] not in VALID:
                raise ValueError('Unexpected Audit-2 final status')
        elif (directory / 'error.json').exists():
            outcome = {'status': 'error', 'error': T.read(directory / 'error.json')}
        else:
            outcome = {'status': 'interrupted' if T.attempted(out, item) else 'pending'}
        language = item['job']['content']['language']
        batch_id = str(batch_ids.get(item['sample_id'], 'unbatched'))
        for counter in (raw_counts, raw_languages[language], raw_batches[batch_id]):
            counter[outcome['status']] += 1
        if item['job']['key'] in blocked_keys:
            if outcome['status'] in VALID:
                outcome = {**outcome, 'status': 'requires_source_review', 'raw_status': outcome['status']}
            elif outcome['status'] == 'pending':
                outcome = {**outcome, 'status': 'source_held'}
            outcome = {**outcome, 'source_hold_reason': blocked_keys[item['job']['key']]}
        counters = [counts, languages[language], by_batch[batch_id]]
        for counter in counters:
            counter[outcome['status']] += 1
            if outcome['status'] == 'error':
                kind = outcome['error'].get('kind', 'transport')
                counter[{'transport': 'transport_error', 'billing': 'billing_error',
                         'response_validation': 'response_validation_error'}.get(kind, 'response_validation_error')] += 1
            elif outcome['status'] in VALID:
                counter['answer_mismatch'] += outcome.get('answer_matches') is False
                if outcome['status'] != 'source_issue' and any(
                        check.get('status') == 'issue' for check in outcome.get('diagnosis', {}).get('checks', {}).values()):
                    counter['confirmed_field_issue_jobs'] += 1
        records.append({'sample_id': item['sample_id'], 'key': item['job']['key'],
            'batch_id': batch_ids.get(item['sample_id']), 'language': item['job']['content']['language'],
            'english': item['job']['content']['english'], 'target': item['job']['content']['target'],
            'selection': item['selection'], 'source_refs': item['source_refs'], **outcome})
    summary = {'time': time.time(), 'selected': len(entries), 'counts': dict(counts),
        'raw_counts': dict(raw_counts), 'rates': rates(counts),
        'by_language': {key: {'counts': dict(value), 'raw_counts': dict(raw_languages[key]), 'rates': rates(value)} for key, value in languages.items()},
        'by_batch': {key: {'counts': dict(value), 'raw_counts': dict(raw_batches[key]), 'rates': rates(value)} for key, value in by_batch.items()},
        'received_cost_usd': received, 'uncertain_and_active_reserved_usd': reserved,
        'budget_accounted_usd': received + reserved, 'budget_usd': budget,
        'received_usage': dict(usage), 'failure_state': failure_state(out, entries),
        'known_source_blocked_keys': len(blocked_keys), 'scan': scan,
        'note': 'Audit-2 diagnosis only. Reasoning is included in completion tokens. No automatic retries or source edits.'}
    temporary = out / 'diagnoses.jsonl.tmp'
    with temporary.open('w') as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + '\n')
    temporary.replace(out / 'diagnoses.jsonl')
    durable_write(out / 'summary.json', summary)
    return summary


def summary_for_log(summary):
    # Detailed batch statistics remain in summary.json; keep terminal/log records
    # small enough for reliable tail readers as hundreds of batches accumulate.
    return {key: value for key, value in summary.items() if key not in ('by_batch', 'scan')}


def run(args, snapshot, prompt, entries, batches, blocked, producer):
    summary = report(args.out, entries, blocked, args.budget)
    if stopped_for_failures(summary['failure_state']):
        raise ValueError('Persisted failure threshold requires investigation before further spending')
    if (args.out / 'STOP').exists():
        raise ValueError('STOP sentinel is present; spending remains stopped')
    credential = T.credential()
    process = {'pid': os.getpid(), 'started': time.time(), 'status': 'running',
        'command': 'gemini_reaudit_queue.py run', 'argv': sys.argv,
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
                    if (args.out / 'STOP').exists():
                        reason.append('STOP sentinel')
                        break
                    if args.limit is not None and submitted >= args.limit:
                        reason.append('limit reached')
                        break
                    item = work.popleft()
                    if item['job']['key'] in blocked or T.attempted(args.out, item):
                        continue
                    value = payload(item, prompt)
                    if T.digest(value) != item['request_sha256']:
                        raise ValueError('Request changed after selection')
                    ceiling = reservation(value)
                    inflight = sum(value[1] for value in active.values())
                    if not can_admit(accounted, inflight, ceiling, args.budget):
                        work.appendleft(item)
                        if not active:
                            reason.append('queue budget cannot reserve the next request')
                        break
                    other_records = [latest_other_budget(path) for path in args.other_budget_log]
                    for path, other in zip(args.other_budget_log, other_records):
                        other_process = Path(path).parent / 'process.json'
                        if (time.time() - other['time'] > 1000
                                and audit_state(other_process)['running']):
                            raise ValueError('Active pipeline budget snapshot is over 1000 seconds old; investigate before further spending')
                    other_accounted = sum(record['accounted_usd'] + record['inflight_reserved_usd'] for record in other_records)
                    if other_records and not can_admit(accounted + other_accounted, inflight, ceiling, args.combined_budget):
                        work.appendleft(item)
                        if not active:
                            reason.append('combined pipeline budget snapshot cannot reserve the next request')
                        break
                    active[pool.submit(request, item, args.out, value, ceiling, credential)] = (item, ceiling)
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
                    failed = status == 'error'
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
            ended=time.time(), reason=reason[0] if reason else 'Fresh-1 producer stopped and Audit-2 queue drained',
            submitted_this_launch=submitted, completed_this_launch=done)
        durable_write(args.out / 'process.json', process)
        print(json.dumps({'process': process, 'summary': summary_for_log(summary)}), flush=True)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'run', 'report'))
    parser.add_argument('--jobs', type=Path, required=True)
    parser.add_argument('--fresh-out', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--prompt-file', type=Path)
    parser.add_argument('--fresh-process', type=Path)
    parser.add_argument('--other-budget-log', type=Path, action='append', default=[])
    parser.add_argument('--combined-budget', type=float)
    parser.add_argument('--budget', type=float, default=30)
    parser.add_argument('--concurrency', type=int, choices=(1, 2), default=2)
    parser.add_argument('--batch-size', type=int, default=50)
    parser.add_argument('--poll-seconds', type=int, default=60)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error('--limit must be positive')
    args.fresh_process = args.fresh_process or args.fresh_out / 'process.json'
    with exclusive_lock(args.out):
        snapshot = load_snapshot(args.jobs)
        prompt = args.prompt_file.read_text() if args.prompt_file else PROMPT
        freeze_config(args, prompt, snapshot)
        entries = load_entries(args.out)
        validate_entries(entries, snapshot, prompt)
        if args.command == 'report':
            print(json.dumps(summary_for_log(report(args.out, entries, budget=args.budget))), flush=True)
            return
        entries, batches, blocked, producer = refresh(args, snapshot, prompt)
        if args.command == 'prepare':
            print(json.dumps(summary_for_log(report(args.out, entries, blocked, args.budget))), flush=True)
            return
        validate_results(args.out, entries, prompt)
        run(args, snapshot, prompt, entries, batches, blocked, producer)


if __name__ == '__main__':
    main()
