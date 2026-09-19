"""Select verified Fresh-1 proposals for Audit-2 without leaking prior judgments.

Reads live immutable artifacts only; never invokes a provider or writes upstream.
Source-block overlays are consulted on every scan, even for previously seen jobs.
"""
import collections
import hashlib
from pathlib import Path

import gemini_translation_queue as Q

T = Q.T
_snapshot_cache = {}
_verified = {}


def signature(path):
    stat = Path(path).stat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)


def snapshot_data(path):
    path = Path(path).resolve()
    stamp = signature(path)
    cached = _snapshot_cache.get(str(path))
    if cached is None or cached[0] != stamp:
        cached = (stamp, Q.load_snapshot(path), Q.file_sha(path))
        _snapshot_cache[str(path)] = cached
    return cached[1], cached[2]


def source_config(jobs_path, fresh_out):
    snapshot, jobs_hash = snapshot_data(jobs_path)
    fresh_out = Path(fresh_out)
    config = T.read(fresh_out / 'config.json')
    prompt = (fresh_out / 'prompt.txt').read_text()
    if config['jobs_sha256'] != jobs_hash or config['prompt_sha256'] != T.digest(prompt):
        raise ValueError('Fresh-1 source snapshot or prompt differs from its frozen configuration')
    if config['model'] != T.MODEL or config['service_tier'] != 'flex':
        raise ValueError('Unexpected Fresh-1 source model or service tier')
    return snapshot, prompt


def verify_candidate(fresh_out, snapshot, prompt, sample_id):
    fresh_out = Path(fresh_out)
    directory = fresh_out / 'results' / str(sample_id)
    paths = {
        'fresh_queue': fresh_out / 'queue' / (str(sample_id) + '.json'),
        'fresh_request': directory / 'request.json',
        'fresh_response': directory / 'response.json',
        'fresh_final': directory / 'final.json'}
    entry = T.read(paths['fresh_queue'])
    batch_origin = directory / 'batch-origin.json'
    batch_contract = None
    if batch_origin.exists():
        origin = T.read(batch_origin)
        if (not isinstance(origin, dict) or origin.get('kind') != 'cloud_batch'
                or type(origin.get('version')) is not int):
            raise ValueError('Missing or invalid cloud batch origin version')
        if origin['version'] == 1:
            import fresh_batch_contract as batch_contract
        elif origin['version'] == 2:
            import fresh_batch_contract_v2 as batch_contract
        else:
            raise ValueError('Unsupported cloud batch origin version')
        paths['fresh_batch_origin'] = batch_origin
        known_paths = {path.resolve() for path in paths.values()}
        dependencies = batch_contract.immutable_dependency_paths(fresh_out, entry, prompt)
        for path in sorted({Path(path).resolve() for path in dependencies} - known_paths):
            paths[f'fresh_batch_dependency_{len(paths)}'] = path
    fingerprints = tuple((str(path), signature(path)) for path in paths.values())
    cache_key = (str(fresh_out.resolve()), sample_id, T.digest(prompt))
    cached = _verified.get(cache_key)
    if cached and cached[0] == fingerprints:
        candidate = cached[1]
        source = snapshot.get(candidate['key'])
        if source and candidate['selection']['source_job_sha256'] == T.digest(source['job']):
            return T.parse(T.canonical(candidate))
    key = entry['job']['key']
    source = snapshot.get(key)
    if source is None or source['sample_id'] != sample_id or entry['sample_id'] != sample_id:
        raise ValueError('Fresh-1 proposal has the wrong source identity')
    Q.validate_entries([entry], snapshot, prompt)
    request = T.read(paths['fresh_request'])
    if batch_contract is not None:
        # Genuine batch requests retain their actual transport fields. The
        # contract binds the accepted batch/input/receipt and frozen queue entry;
        # no Flex service-tier or billing fields are synthesized.
        raw = batch_contract.verify_saved_candidate(fresh_out, entry, prompt)
        if raw != T.read(paths['fresh_response']):
            raise ValueError('Batch verifier returned a different stored response')
    else:
        if request != T.payload(entry, prompt) or T.digest(request) != entry['request_sha256']:
            raise ValueError('Fresh-1 request differs from its frozen English-only payload')
        raw = T.read(paths['fresh_response'])
        T.flex.validate_billing(raw)
    if batch_contract is None and raw.get('model') != T.MODEL:
        raise ValueError('Fresh-1 response model differs from the expected model')
    final = T.read(paths['fresh_final'])
    if final['status'] != 'proposal' or T.validate(raw, entry) != final:
        raise ValueError('Fresh-1 proposal differs from its validated raw response')
    proposed = final['result']['proposed']
    original = source['job']
    content = original['content']
    # The old target and non-English source context are not retained in this job.
    job = {'key': key, 'content': {
        'english': content['english'], 'target': proposed,
        'grades': content['grades'], 'language': content['language'],
        'answer': content['answer'],
        'source_fact': {'en': content.get('source_fact', {}).get('en')}},
        'refs': original.get('refs', []), 'preflight': []}
    selection = {'source_job_sha256': T.digest(original),
        'fresh_request_sha256': T.digest(request),
        'fresh_proposed_sha256': T.digest(proposed),
        'reason': 'Verified Fresh-1 proposal; previous diagnoses and generator notes are excluded from Audit-2 requests.'}
    if batch_contract is not None:
        selection['fresh_transport'] = 'cloud_batch'
        selection['fresh_batch_version'] = origin['version']
    for label, path in paths.items():
        selection[label + '_path'] = str(path.resolve())
        selection[label + '_file_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    # Explicit aliases for downstream provenance checks.
    selection['fresh_final_sha256'] = selection['fresh_final_file_sha256']
    selection['fresh_queue_sha256'] = selection['fresh_queue_file_sha256']
    selection['fresh_response_sha256'] = selection['fresh_response_file_sha256']
    candidate = {'key': key, 'job': job, 'sample_id': sample_id, 'selection': selection}
    _verified[cache_key] = (fingerprints, candidate)
    return T.parse(T.canonical(candidate))


def ingest_candidates(jobs_path, fresh_out, seen_keys):
    fresh_out = Path(fresh_out).resolve()
    snapshot, prompt = source_config(jobs_path, fresh_out)
    blocked_path = fresh_out / 'source-blocks.json'
    blocked = T.read(blocked_path) if blocked_path.exists() else {}
    if not isinstance(blocked, dict):
        raise ValueError('Fresh-1 source blocks must be a mapping')
    counts = collections.Counter()
    invalid = {}
    candidates = []
    eligible = set()
    unknown_directories = 0
    results = fresh_out / 'results'
    for directory in results.iterdir() if results.exists() else []:
        try:
            number = int(directory.name)
        except ValueError:
            unknown_directories += 1
            continue
        entry_path = fresh_out / 'queue' / (str(number) + '.json')
        if not entry_path.exists():
            unknown_directories += 1
            continue
        entry = T.read(entry_path)
        key = entry['job']['key']
        path = directory / 'final.json'
        if not path.exists():
            counts['error' if (directory / 'error.json').exists() else 'inflight_or_interrupted'] += 1
            continue
        try:
            final = T.read(path)
            status = final['status']
            if status not in ('proposal', 'held', 'rejected'):
                raise ValueError('Unexpected Fresh-1 final status')
            counts[status] += 1
            if key in blocked:
                counts['source_blocked_completed'] += 1
                continue
            if status != 'proposal':
                continue
            if (directory / 'error.json').exists():
                raise ValueError('Fresh-1 error coexists with a proposal')
            candidate = verify_candidate(fresh_out, snapshot, prompt, number)
            eligible.add(key)
            if key not in seen_keys:
                candidates.append(candidate)
        except (ValueError, KeyError, TypeError, IndexError, OSError) as error:
            invalid[key] = type(error).__name__ + ': ' + str(error)
            blocked[key] = 'Fresh-1 provenance requires review: ' + invalid[key]
    candidates.sort(key=lambda item: item['sample_id'])
    summary = {'upstream_pipeline': 'Fresh-1', 'status_counts': dict(counts),
        'eligible_total': len(eligible), 'eligible_already_seen': len(eligible & set(seen_keys)),
        'new_candidates': len(candidates), 'blocked_keys': blocked,
        'invalid_proposals': invalid, 'unknown_result_directories': unknown_directories,
        'note': 'All generation provenance stays local; Audit-2 receives the English and new translation without prior verdicts or generator notes.'}
    return candidates, summary
