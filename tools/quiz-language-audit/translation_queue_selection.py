"""Read finalized diagnoses to select fresh translations; never send diagnoses.

The caller gets private provenance and a source-hold map. A source issue in
either language holds both translations of the same English quiz. Cached reads
are keyed by file identity/stat; report exports and partial files are not inputs.
"""
import collections
import hashlib
import json
from pathlib import Path
import re

import gemini_auditor as audit

_snapshot_cache = {}
_json_cache = {}


def english_hash(english):
    return audit.e.a.digest(english)


def _signature(path):
    stat = path.stat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)


def _read(path):
    sig = _signature(path)
    cached = _json_cache.get(str(path))
    if cached and cached[0] == sig:
        return cached[1], cached[2]
    data = path.read_bytes()
    value = json.loads(data)
    digest = hashlib.sha256(data).hexdigest()
    _json_cache[str(path)] = (sig, value, digest)
    return value, digest


def load_snapshot(path):
    path = Path(path).resolve()
    sig = _signature(path)
    cached = _snapshot_cache.get(str(path))
    if cached and cached[0] == sig:
        return cached[1]
    jobs = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        job = json.loads(line)
        key = job['key']
        if not isinstance(key, str) or not re.fullmatch('[0-9a-f]{64}', key):
            raise ValueError('Snapshot key must be a SHA-256 hex identifier')
        if key in jobs:
            raise ValueError('Duplicate snapshot key: ' + key)
        if job['content']['language'] not in ('tl', 'bis'):
            raise ValueError('Unexpected snapshot language')
        jobs[key] = job
    if not jobs:
        raise ValueError('Empty snapshot')
    _snapshot_cache[str(path)] = (sig, jobs)
    return jobs


def validate_final(final, job):
    """Reuse diagnosis consistency/evidence validation against frozen content."""
    if not isinstance(final, dict):
        raise ValueError('Final diagnosis is not an object')
    raw = {'choices': [{'finish_reason': 'stop', 'message': {
        'content': json.dumps(final['diagnosis'], ensure_ascii=False)}}]}
    normalized = audit.validate(raw, job['content'])
    if normalized != final:
        raise ValueError('Stored status/answer metadata does not match diagnosis')
    return final


def eligible(final, job):
    if source_errors(job):
        return False
    diagnosis = final['diagnosis']
    checks = diagnosis['checks'].values()
    return (final['status'] == 'flagged' and final['answer_matches'] is True
        and diagnosis['verdict'] == 'fix'
        and diagnosis['whole_quiz']['status'] == 'ok'
        and diagnosis['correct_index'] == job['content']['answer']
        and any(check['status'] == 'issue' for check in checks)
        and all(check['status'] in ('ok', 'issue') for check in checks))


def source_errors(job):
    # Snapshot preflight describes the OLD target. Missing/duplicate target text
    # can be repaired by fresh translation; only English defects block this gate.
    content = job['content']
    errors = audit.e.a.text_errors(content['english'])
    answer = content['answer']
    if type(answer) is not int or not 0 <= answer < len(content['english']['options']):
        errors.append('invalid English answer index')
    return errors


def ingest_candidates(jobs_path, audit_dirs, seen_keys, source_holds_path=None):
    jobs = load_snapshot(jobs_path)
    roots = [Path(p).resolve() for p in audit_dirs]
    if len(set(roots)) != len(roots) or not roots:
        raise ValueError('Audit directories must be nonempty and unique')
    held_english = {}
    if source_holds_path is not None:
        hold_document, _ = _read(Path(source_holds_path))
        for digest, record in hold_document['english_content_hashes'].items():
            if not re.fullmatch('[0-9a-f]{64}', digest):
                raise ValueError('Invalid English source hold hash')
            reason = record['reason']
            if not isinstance(reason, str) or not reason.strip():
                raise ValueError('Empty English source hold reason')
            held_english[digest] = reason
    finals = collections.defaultdict(list)
    errors = set()
    parse_errors = {}
    unexpected = 0
    for root in roots:
        results = root / 'results'
        if not results.is_dir():
            raise ValueError('Missing audit results directory: ' + str(results))
        for directory in results.iterdir():
            key = directory.name
            if key not in jobs:
                unexpected += 1
                continue
            if (directory / 'error.json').exists():
                errors.add(key)
            final_path = directory / 'final.json'
            if not final_path.exists():
                continue
            try:
                final, digest = _read(final_path)
                validate_final(final, jobs[key])
                finals[key].append((final_path, final, digest))
                if final['status'] == 'source_issue':
                    held_english[english_hash(jobs[key]['content']['english'])] = (
                        'Audit identified an English/source issue: ' + str(final_path))
            except (ValueError, KeyError, TypeError, IndexError) as ex:
                parse_errors[key] = type(ex).__name__ + ': ' + str(ex)
    blocked = {key: 'Invalid or contradictory finalized diagnosis: ' + reason
               for key, reason in parse_errors.items()}
    for key, job in jobs.items():
        digest = english_hash(job['content']['english'])
        if digest in held_english:
            blocked[key] = held_english[digest]
        defects = source_errors(job)
        if defects:
            blocked[key] = 'English source structure requires review: ' + json.dumps(defects)
    counts = collections.Counter()
    candidates = []
    eligible_keys = []
    for key, entries in finals.items():
        final = entries[0][1]
        if any(value != final for _, value, _ in entries[1:]):
            blocked[key] = 'Conflicting finalized diagnoses across audit runs'
            counts['conflicting_finals'] += 1
            continue
        if key in errors:
            blocked[key] = 'Active audit error coexists with final; reconcile before translating'
        counts[final['status']] += 1
        if key in blocked or not eligible(final, jobs[key]):
            continue
        eligible_keys.append(key)
        if key in seen_keys:
            continue
        path, _, digest = entries[0]
        candidates.append({'key': key, 'job': jobs[key], 'selection': {
            'audit_path': str(path), 'audit_sha256': digest,
            'issue_fields': [field for field, check in final['diagnosis']['checks'].items()
                             if check['status'] == 'issue'],
            'reason': 'Confirmed language issues, stable answer, no source/uncertainty hold'}})
    # Frozen snapshot ordering makes initial batches deterministic.
    order = {key: index for index, key in enumerate(jobs)}
    candidates.sort(key=lambda candidate: order[candidate['key']])
    summary = {'snapshot_jobs': len(jobs), 'finalized_unique': len(finals),
        'status_counts': dict(counts), 'active_error_jobs': len(errors),
        'invalid_final_jobs': len(parse_errors), 'invalid_final_details': parse_errors,
        'unexpected_result_directories': unexpected, 'eligible_total': len(eligible_keys),
        'eligible_already_seen': sum(key in seen_keys for key in eligible_keys),
        'new_candidates': len(candidates), 'blocked_keys': blocked,
        'held_english_quizzes': len(held_english),
        'note': 'Private selection provenance only; diagnoses and original translations must not enter generation payloads.'}
    return candidates, summary
