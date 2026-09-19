#!/usr/bin/env python3
"""Prepare, apply and verify a hash-bound Fresh/frontier translation integration.

No provider calls. Existing audit/generation evidence is never rewritten. All source
changes are first staged with exact-byte backups and a per-language provenance ledger.
"""
import argparse
import collections
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import time

import audit as A
import audit2_handoff as H
import fresh_result_selection as S
import gemini_reaudit_queue as R


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def atomic_bytes(path, value, mode=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.' + path.name + '.' + str(os.getpid()) + '.tmp')
    try:
        with temp.open('xb') as f:
            f.write(value)
            f.flush()
            os.fsync(f.fileno())
        if mode is not None:
            temp.chmod(mode)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def write(path, value):
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())


def rows_of(doc):
    rows = doc if isinstance(doc, list) else doc['questions']
    return list(rows.values()) if isinstance(rows, dict) else rows


def load_document(path):
    raw = path.read_bytes()
    if path.suffix == '.jsonl':
        doc = [json.loads(line) for line in raw.splitlines() if line.strip()]
    else:
        doc = json.loads(raw)
    return raw, doc, rows_of(doc)


def render_document(path, raw, doc, changed_rows):
    if path.suffix == '.jsonl':
        lines = raw.decode().splitlines(keepends=True)
        row = 0
        for i, line in enumerate(lines):
            if not line.strip():
                continue
            if row in changed_rows:
                ending = '\r\n' if line.endswith('\r\n') else '\n' if line.endswith('\n') else ''
                lines[i] = json.dumps(doc[row], ensure_ascii=False) + ending
            row += 1
        return ''.join(lines).encode()
    text = raw.decode()
    indent = 2 if text.startswith('{\n  ') or text.startswith('[\n  ') else None
    compact = indent is None and ': ' not in text[:30]
    rendered = json.dumps(doc, ensure_ascii=False, indent=indent,
                          separators=(',', ':') if compact else None)
    return (rendered + ('\n' if text.endswith('\n') else '')).encode()


def replace_target(row, language, proposed):
    if language not in ('tl', 'bis') or A.text_errors(proposed):
        raise ValueError('Invalid language or proposed translation')
    options = row.get('options', row.get('o'))
    if len(options) != len(proposed['options']):
        raise ValueError('Option count changed')
    row['q'][language] = proposed['q']
    for option, translated in zip(options, proposed['options']):
        option[language] = translated
    row.get('explanation', row.get('e'))[language] = proposed['explanation']


def assert_translation_only(before, after, languages):
    def protected(row):
        result = copy.deepcopy(row)
        for lang in languages:
            result['q'].pop(lang, None)
            result.get('explanation', result.get('e')).pop(lang, None)
            for option in result.get('options', result.get('o')):
                option.pop(lang, None)
        return result
    if protected(before) != protected(after):
        raise ValueError('Integration changed English, options/order, key, ID, or metadata')


def validated_decisions(review, reference, audit_out, fresh_out):
    manifest = read(reference / 'manifest.json')
    for name, digest in manifest['files_sha256'].items():
        if sha(reference / name) != digest:
            raise ValueError('Reference file hash mismatch: ' + name)
    current, _ = H.collect(audit_out, fresh_out)
    if A.digest(current) != manifest['snapshot_sha256']:
        raise ValueError('Reference is stale against current validated upstream results')
    refs = {r['key']: r for r in current}
    decisions = {}
    for line in (review / 'decisions.jsonl').read_text().splitlines():
        d = json.loads(line)
        if d['key'] in decisions or d['key'] not in refs:
            raise ValueError('Duplicate or unknown frontier decision')
        r = refs[d['key']]
        for field in ('key', 'revision_sha256', 'sample_id', 'language', 'provenance', 'source_refs'):
            if d[field] != r[field]:
                raise ValueError('Stale frontier ' + field + ': ' + d['key'])
        if not r['eligible_for_language_repair']:
            raise ValueError('Frontier decision is source held: ' + d['key'])
        if d['decision'] == 'corrected':
            if A.text_errors(d['proposed']) or len(d['proposed']['options']) != len(r['english']['options']):
                raise ValueError('Invalid frontier proposal: ' + d['key'])
        elif d['decision'] not in ('already_ok', 'needs_review', 'source_review') or d['proposed'] is not None:
            raise ValueError('Invalid frontier decision')
        decisions[d['key']] = d
    if set(decisions) != set(refs):
        raise ValueError('Frontier decisions do not cover the final flagged reference')
    return decisions


def prepare(args):
    out = args.out.resolve()
    if (out / 'manifest.json').exists():
        raise ValueError('Integration already prepared; use apply or verify, never overwrite its plan')
    if out.exists() and any(p.name != '.integration.lock' for p in out.iterdir()):
        raise ValueError('Use an empty integration output directory')
    snapshot_manifest = read(args.jobs.parent / 'manifest.json')
    facts_path = args.source_repo.resolve() / 'rag/bank/science-facts.jsonl'
    if sha(facts_path) != snapshot_manifest['facts_sha256']:
        raise ValueError('English source context bank changed since the original audit')
    documents = {}
    for record in snapshot_manifest['inputs']:
        path = Path(record['path'])
        if not path.is_relative_to(args.source_repo.resolve()) or sha(path) != record['sha256']:
            raise ValueError('Source file changed or belongs to another checkout: ' + str(path))
        raw, doc, rows = load_document(path)
        documents[str(path)] = {'raw': raw, 'doc': doc, 'rows': rows, 'original': copy.deepcopy(rows),
                                'changed': collections.defaultdict(set), 'mode': stat.S_IMODE(path.stat().st_mode)}
    source_files = {}
    for path in [args.jobs, args.jobs.parent / 'manifest.json', args.fresh_out / 'config.json',
                 args.fresh_out / 'prompt.txt', args.review / 'decisions.jsonl',
                 args.reference / 'manifest.json', args.reference / 'audit-2-flagged.jsonl',
                 args.fresh_out / 'source-blocks.json', args.audit_out / 'source-blocks.json',
                 args.fresh_out / 'process.json', args.audit_out / 'process.json', facts_path, Path(__file__)]:
        source_files[str(path.resolve())] = sha(path)
    print('Verifying current frontier decisions and every Fresh proposal...', flush=True)
    decisions = validated_decisions(args.review, args.reference, args.audit_out, args.fresh_out)
    snapshot, prompt = S.source_config(args.jobs, args.fresh_out)
    candidates, scan = S.ingest_candidates(args.jobs, args.fresh_out, set())
    if scan['invalid_proposals'] or scan['unknown_result_directories']:
        raise ValueError('Fresh provenance has invalid or unknown artifacts')
    holds = {k: ['existing source hold'] for k in H.source_blocks(args.fresh_out, args.audit_out)}
    source_english = set()
    audit_status = {}
    for path in (args.audit_out / 'results').glob('*/final.json'):
        final = read(path)
        entry = read(args.audit_out / 'queue' / (path.parent.name + '.json'))
        key = entry['job']['key']
        audit_status[key] = final['status']
        if final['status'] in ('source_issue', 'needs_review'):
            # Revalidate the diagnoses that justify exclusions; no new model judgment.
            raw = read(path.parent / 'response.json')
            R.F.validate_billing(raw)
            if R.validate(raw, R.clean_item(entry['job'], entry['sample_id'])) != final:
                raise ValueError('Invalid Audit-2 hold evidence: ' + str(path))
            holds.setdefault(key, []).append('Audit-2 ' + final['status'])
            source_files[str(path.resolve())] = sha(path)
            if final['status'] == 'source_issue':
                source_english.add(A.digest(entry['job']['content']['english']))
    for key in list(holds):
        if key in snapshot and 'existing source hold' in holds[key]:
            source_english.add(A.digest(snapshot[key]['job']['content']['english']))
    for key, d in decisions.items():
        if d['decision'] in ('needs_review', 'source_review'):
            holds.setdefault(key, []).append('Frontier ' + d['decision'])
            if d['decision'] == 'source_review':
                source_english.add(A.digest(snapshot[key]['job']['content']['english']))
    for candidate in candidates:
        if A.digest(candidate['job']['content']['english']) in source_english:
            holds.setdefault(candidate['key'], []).append('English source hold propagated across languages/versions')
    ledger, jobs, exclusions = [], [], []
    counts = collections.Counter()
    occupied = set()
    for candidate in candidates:
        key, sid = candidate['key'], candidate['sample_id']
        original = snapshot[key]['job']
        if key in holds:
            exclusions.append({'key': key, 'sample_id': sid, 'language': original['content']['language'],
                               'reasons': holds[key], 'source_refs': original['refs']})
            continue
        for label, path in candidate['selection'].items():
            if label.endswith('_path'):
                digest = candidate['selection'][label[:-5] + '_file_sha256']
                if path in source_files and source_files[path] != digest:
                    raise ValueError('Conflicting Fresh dependency hashes')
                source_files[path] = digest
        d = decisions.get(key)
        proposed = d['proposed'] if d and d['decision'] == 'corrected' else candidate['job']['content']['target']
        kind = 'frontier_corrected' if d and d['decision'] == 'corrected' else 'frontier_already_ok' if d else 'fresh'
        job = copy.deepcopy(candidate['job'])
        job['content']['target'] = proposed
        R.clean_item(job, sid)
        language = job['content']['language']
        for ref in original['refs']:
            source = documents[ref['path']]
            row = source['original'][ref['row']]
            if A.digest(row) != ref['row_hash'] or A.localized(row, language) != original['content']['target']:
                raise ValueError('Source row/old translation changed: ' + str(ref))
            if A.localized(row, 'en') != original['content']['english'] or row.get('answer', row.get('a')) != original['content']['answer']:
                raise ValueError('English or private answer differs from source snapshot')
            slot = (ref['path'], ref['row'], language)
            if slot in occupied:
                raise ValueError('Two candidates target the same source language field')
            occupied.add(slot)
            replace_target(source['rows'][ref['row']], language, proposed)
            source['changed'][ref['row']].add(language)
        job['sample_id'] = sid
        jobs.append(job)
        ledger.append({'key': key, 'sample_id': sid, 'language': language, 'kind': kind,
                       'source_job_sha256': A.digest(original), 'candidate_target_sha256': A.digest(proposed),
                       'fresh_proposed_sha256': candidate['selection']['fresh_proposed_sha256'],
                       'frontier_decision_sha256': A.digest(d) if d else None,
                       'prior_audit2_status': audit_status.get(key, 'no_valid_verdict'),
                       'source_refs_before': original['refs'], 'fresh_provenance': candidate['selection']})
        counts[kind] += 1
        counts[language] += 1
    for job in jobs:
        for ref in job['refs']:
            ref['row_hash'] = A.digest(documents[ref['path']]['rows'][ref['row']])
    file_records = {}
    for path, source in documents.items():
        for row, languages in source['changed'].items():
            assert_translation_only(source['original'][row], source['rows'][row], languages)
        if not source['changed']:
            continue
        relative = Path(path).relative_to(args.source_repo.resolve())
        staged = out / 'staged' / relative
        backup = out / 'backups' / relative
        raw_after = render_document(Path(path), source['raw'], source['doc'], source['changed'])
        atomic_bytes(backup, source['raw'])
        atomic_bytes(staged, raw_after)
        file_records[path] = {'before_sha256': hashlib.sha256(source['raw']).hexdigest(),
                              'after_sha256': hashlib.sha256(raw_after).hexdigest(),
                              'backup_path': str(backup), 'staged_path': str(staged), 'mode': source['mode'],
                              'changed_rows': len(source['changed']),
                              'language_updates': sum(map(len, source['changed'].values()))}
    jobs_path = out / 'jobs.jsonl'
    atomic_bytes(jobs_path, ''.join(A.canonical(j) + '\n' for j in jobs).encode())
    atomic_bytes(out / 'integration-ledger.jsonl', ''.join(A.canonical(j) + '\n' for j in ledger).encode())
    write(out / 'holds.json', exclusions)
    manifest = {'version': 1, 'created': time.time(), 'source_repo': str(args.source_repo.resolve()),
                'source_jobs': str(args.jobs.resolve()), 'source_jobs_sha256': sha(args.jobs),
                'jobs_path': str(jobs_path), 'jobs_sha256': sha(jobs_path),
                'jobs': {r['key']: {k: r[k] for k in ('source_job_sha256', 'candidate_target_sha256', 'kind', 'sample_id')} for r in ledger},
                'source_files': file_records, 'evidence_files_sha256': source_files,
                'ledger_sha256': sha(out / 'integration-ledger.jsonl'), 'holds_sha256': sha(out / 'holds.json'),
                'counts': {**dict(counts), 'fresh_proposals': len(candidates), 'integrated': len(jobs),
                           'held': len(exclusions), 'source_files': len(file_records),
                           'row_language_updates': len(occupied)},
                'authorization': 'User requested integration of Fresh translations with current external rewrites, followed by Gemini batch Audit-3 of all integrated translations.',
                'limits': {'audit3_budget_usd': 30, 'combined_budget_usd': 250},
                'scope': 'Translated q/options/explanation only. English, answer index, row membership/order, IDs and other metadata unchanged. Existing evidence is immutable.'}
    write(out / 'manifest.json', manifest)
    print(json.dumps(manifest['counts']), flush=True)


def verify_plan(out, applied=False):
    manifest = read(out / 'manifest.json')
    for path, digest in manifest['evidence_files_sha256'].items():
        if sha(path) != digest:
            raise ValueError('Integration evidence changed: ' + path)
    for name, field in [('jobs.jsonl', 'jobs_sha256'), ('integration-ledger.jsonl', 'ledger_sha256'), ('holds.json', 'holds_sha256')]:
        if sha(out / name) != manifest[field]:
            raise ValueError('Integration plan changed: ' + name)
    for path, record in manifest['source_files'].items():
        if sha(record['backup_path']) != record['before_sha256'] or sha(record['staged_path']) != record['after_sha256']:
            raise ValueError('Backup or staged source changed: ' + path)
        if sha(path) not in ({record['after_sha256']} if applied else {record['before_sha256'], record['after_sha256']}):
            raise ValueError('Live source changed outside this integration: ' + path)
    return manifest


def verify_applied(out):
    manifest = verify_plan(out, applied=True)
    cache = {}
    for line in (out / 'jobs.jsonl').read_text().splitlines():
        job = json.loads(line)
        if A.digest(job['content']['target']) != manifest['jobs'][job['key']]['candidate_target_sha256']:
            raise ValueError('Integrated target hash mismatch')
        for ref in job['refs']:
            if ref['path'] not in cache:
                cache[ref['path']] = A.read_rows(Path(ref['path']))
            row = cache[ref['path']][ref['row']]
            if A.digest(row) != ref['row_hash'] or A.localized(row, job['content']['language']) != job['content']['target']:
                raise ValueError('Applied source differs from Audit-3 snapshot')
    return manifest


def apply(out):
    manifest = verify_plan(out)
    for path, record in manifest['source_files'].items():
        if sha(path) == record['after_sha256']:
            continue
        if sha(path) != record['before_sha256']:
            raise ValueError('Source changed immediately before replacement: ' + path)
        atomic_bytes(path, Path(record['staged_path']).read_bytes(), record['mode'])
    verify_applied(out)
    result = {'time': time.time(), 'manifest_sha256': sha(out / 'manifest.json'),
              'status': 'applied_and_verified', 'counts': manifest['counts']}
    target = out / 'applied.json'
    if not target.exists():
        write(target, result)
    elif read(target)['manifest_sha256'] != result['manifest_sha256']:
        raise ValueError('Conflicting integration application receipt')
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('prepare', 'apply', 'verify'))
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--jobs', type=Path)
    parser.add_argument('--fresh-out', type=Path)
    parser.add_argument('--audit-out', type=Path)
    parser.add_argument('--review', type=Path)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--source-repo', type=Path)
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    with (args.out / '.integration.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == 'prepare':
            if any(getattr(args, name) is None for name in ('jobs', 'fresh_out', 'audit_out', 'review', 'reference', 'source_repo')):
                parser.error('prepare requires all source paths')
            prepare(args)
        elif args.command == 'apply':
            apply(args.out)
        else:
            print(json.dumps({'verified': True, 'counts': verify_applied(args.out)['counts']}))


if __name__ == '__main__':
    main()
