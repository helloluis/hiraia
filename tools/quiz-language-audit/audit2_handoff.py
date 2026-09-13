#!/usr/bin/env python3
"""Continuously export Audit-2 flags for external review; no provider calls."""
import argparse
import collections
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import signal
import sys
import time

import gemini_reaudit_queue as R
import pipeline_status as P

RUNS = Path(__file__).resolve().parent / 'runs'
AUDIT = RUNS / '2026-09-13/gemini-reaudit-queue-v1'
FRESH = RUNS / '2026-09-13/gemini-fresh-queue-v1'
OUT = RUNS / '2026-09-13/audit-2-frontier-handoff'
GUIDE = """This is a live, generated reference for a final review outside the current session.
Read it without editing it; save your review decisions and proposed corrections in a separate file.
Reload this reference before each new group of cards. Track work by `key` plus `revision_sha256`,
not by row position. A downloaded or pasted copy is a snapshot and will not update itself.

Review the full Fresh-1 translation against its English original and English context.
Audit-2 findings are advisory: confirm, correct, or reject them independently. Check every option,
the question, and the explanation; retain option order and deliberately incorrect distractors.
Use youth-friendly Filipino/Cebuano and familiar English terms when local alternatives are obscure.
The stored answer index is zero-based and is a reference to verify, not proof that the English is sound.
If the English or answer is questionable, return a source-review hold instead of silently changing it.
Records with `eligible_for_language_repair: false` require source review before language corrections.

Return one decision per key/revision: `corrected`, `already_ok`, or `source_review`, with a short reason
and the complete proposed q/options/explanation when corrected. Preserve the language, IDs, English,
option order, and answer index. No source edits or publication are authorized by this handoff.
Before any later application, recheck current holds, revision hashes and the source row hashes.
"""


def read(path):
    return R.T.read(Path(path))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic(path, content):
    path = Path(path)
    temporary = path.with_name('.' + path.name + '.' + str(os.getpid()) + '.tmp')
    try:
        with temporary.open('w', encoding='utf-8') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path, value):
    atomic(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def source_blocks(*roots):
    blocked = {}
    for root in roots:
        path = root / 'source-blocks.json'
        if path.exists():
            values = read(path)
            if not isinstance(values, dict):
                raise ValueError('Source holds must be a mapping: ' + str(path))
            for key, reason in values.items():
                blocked.setdefault(key, []).append(str(reason))
    return {key: sorted(set(reasons)) for key, reasons in blocked.items()}


def collect(audit, fresh):
    config = read(audit / 'config.json')
    if Path(config['fresh_out']).resolve() != fresh.resolve():
        raise ValueError('Fresh-1 directory differs from the frozen Audit-2 configuration')
    batches = {}
    for path in (audit / 'batches').glob('*.json'):
        batch = read(path)
        for item in batch['items']:
            sample_id = item['sample_id']
            if sample_id in batches:
                raise ValueError('Duplicate Audit-2 batch membership')
            batches[sample_id] = batch['batch_id']
    counts = collections.Counter()
    records, seen = [], set()
    for path in sorted((audit / 'results').glob('*/final.json'), key=lambda p: int(p.parent.name)):
        final = read(path)
        counts[final['status']] += 1
        if final['status'] != 'flagged':
            continue
        directory = path.parent
        if (directory / 'error.json').exists():
            raise ValueError('Final/error conflict for Audit-2 sample ' + directory.name)
        queue_path = audit / 'queue' / (directory.name + '.json')
        entry = read(queue_path)
        clean = R.clean_item(entry['job'], entry['sample_id'])
        key, content = clean['job']['key'], clean['job']['content']
        if (entry['sample_id'] != int(directory.name) or key in seen
                or entry['fresh_content_sha256'] != R.T.digest(content)
                or entry['selection_sha256'] != R.T.digest(entry['selection'])):
            raise ValueError('Invalid or duplicate Audit-2 identity/content')
        request = read(directory / 'request.json')
        if request != R.payload(clean) or R.T.digest(request) != entry['request_sha256']:
            raise ValueError('Audit-2 request differs from its queued card')
        raw = read(directory / 'response.json')
        R.F.validate_billing(raw)
        if raw.get('model') != R.F.MODEL or R.validate(raw, clean) != final:
            raise ValueError('Audit-2 final differs from its validated response')
        fresh_final = fresh / 'results' / directory.name / 'final.json'
        proposal = read(fresh_final)
        if (sha(fresh_final) != entry['selection']['fresh_final_file_sha256']
                or proposal['status'] != 'proposal'
                or proposal['result']['proposed'] != content['target']):
            raise ValueError('Fresh-1 proposal changed after Audit-2 reviewed it')
        seen.add(key)
        records.append({'schema_version': 1, 'key': key, 'sample_id': entry['sample_id'],
            'audit2_batch_id': batches.get(entry['sample_id']),
            'language': content['language'], 'grades': content['grades'],
            'english': content['english'], 'fresh_translation': content['target'],
            'english_context': content['source_fact']['en'],
            'original_answer_index_zero_based': content['answer'],
            'audit2': final,
            'source_refs': entry['source_refs'],
            'provenance': {'snapshot_sha256': config['jobs_sha256'],
                'source_job_sha256': entry['source_job_sha256'],
                'fresh_content_sha256': entry['fresh_content_sha256'],
                'fresh_proposed_sha256': entry['selection']['fresh_proposed_sha256'],
                'audit2_request_sha256': entry['request_sha256'],
                'audit2_queue_file_sha256': sha(queue_path),
                'audit2_final_file_sha256': sha(path),
                'fresh_final_file_sha256': sha(fresh_final),
                'audit2_final_path': str(path.resolve()),
                'fresh_final_path': str(fresh_final.resolve())}})
    # Read live holds after the scan; never retain a cached eligibility decision.
    blocked = source_blocks(fresh, audit)
    for record in records:
        holds = blocked.get(record['key'], [])
        record.update(eligible_for_language_repair=not holds, source_hold_reasons=holds)
        record['revision_sha256'] = R.T.digest(record)
    return records, dict(counts)


def export(audit, fresh, out):
    records, counts = collect(audit, fresh)
    stamp = dt.datetime.now(dt.timezone.utc).isoformat()
    revision = R.T.digest(records)
    held = [record['key'] for record in records if not record['eligible_for_language_repair']]
    jsonl = ''.join(json.dumps(record, ensure_ascii=False) + '\n' for record in records)
    header = ['# Audit-2 flagged cards — external final review', '',
        f'Updated: {stamp} · Snapshot: `{revision}`', '',
        f'{len(records)} flagged cards; {len(records) - len(held)} eligible for language review; '
        f'{len(held)} held for source review. Refreshed every 60 seconds while the pipelines run.', '', GUIDE]
    for record in records:
        header.extend(['', f"## {record['sample_id']} · {record['language']} · Audit-2 batch {record['audit2_batch_id']}",
            '', 'Source review required.' if not record['eligible_for_language_repair'] else 'Ready for external review.',
            '', '```json', json.dumps(record, ensure_ascii=False, indent=2), '```'])
    markdown = '\n'.join(header) + '\n'
    out.mkdir(parents=True, exist_ok=True)
    # Each file is independently atomic. Manifest is published last and records
    # both content hashes so consumers using both formats can verify consistency.
    atomic(out / 'audit-2-flagged.jsonl', jsonl)
    atomic(out / 'audit-2-flagged.md', markdown)
    summary = {'time': time.time(), 'exported_at': stamp, 'snapshot_sha256': revision,
        'flagged': len(records), 'eligible': len(records) - len(held), 'source_held': len(held),
        'held_keys': held, 'by_language': dict(collections.Counter(r['language'] for r in records)),
        'audit2_observed_statuses': counts,
        'record_revisions': {r['key']: r['revision_sha256'] for r in records},
        'files_sha256': {'audit-2-flagged.jsonl': hashlib.sha256(jsonl.encode()).hexdigest(),
                         'audit-2-flagged.md': hashlib.sha256(markdown.encode()).hexdigest()},
        'scope': 'Reference only; status flagged exclusively; no provider calls or source edits.'}
    write_json(out / 'manifest.json', summary)
    return summary


def watch(args):
    process = {'pid': os.getpid(), 'started': time.time(), 'status': 'running',
        'argv': sys.argv, 'exact_command': shlex.join([sys.executable, *sys.argv]),
        'poll_seconds': args.poll_seconds, 'api_calls': False}
    reason = []
    def stop(signum, _):
        reason.append(signal.Signals(signum).name)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    write_json(args.out / 'process.json', process)
    try:
        while not reason:
            if (args.out / 'STOP').exists():
                reason.append('STOP sentinel')
                break
            summary = export(args.audit_out, args.fresh_out, args.out)
            producers = {str(root): P.process_state(root) for root in (
                args.audit_out, args.fresh_out, RUNS / '2026-09-12/gemini-auditor-flex-v1')}
            print(json.dumps({'time': time.time(), 'event': 'export',
                **{k: summary[k] for k in ('flagged', 'eligible', 'source_held', 'snapshot_sha256')},
                'producers': producers}), flush=True)
            if all(p['state'] == 'stopped' for p in producers.values()):
                # All producers are gone; do one final snapshot for late writes.
                export(args.audit_out, args.fresh_out, args.out)
                reason.append('all producers stopped; final reference exported')
                break
            deadline = time.monotonic() + args.poll_seconds
            while not reason and time.monotonic() < deadline:
                time.sleep(min(1, max(0, deadline - time.monotonic())))
    except Exception as error:
        process['status'] = 'failed'
        process['error'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        if process['status'] == 'running':
            process['status'] = 'finished'
        process.update(ended=time.time(), reason=reason)
        write_json(args.out / 'process.json', process)


@contextlib.contextmanager
def lock(out):
    out.mkdir(parents=True, exist_ok=True)
    with (out / '.export.lock').open('a+') as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('The handoff exporter is already running') from None
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('export', 'watch'))
    parser.add_argument('--audit-out', type=Path, default=AUDIT)
    parser.add_argument('--fresh-out', type=Path, default=FRESH)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--poll-seconds', type=int, default=60)
    args = parser.parse_args()
    roots = (args.audit_out.resolve(), args.fresh_out.resolve(),
             (RUNS / '2026-09-12/gemini-auditor-flex-v1').resolve())
    out = args.out.resolve()
    if args.poll_seconds < 1 or any(out == r or out in r.parents or r in out.parents for r in roots):
        parser.error('Use a positive interval and a separate handoff directory')
    with lock(args.out):
        if args.command == 'export':
            result = export(args.audit_out, args.fresh_out, args.out)
            print(json.dumps({k: result[k] for k in ('flagged', 'eligible', 'source_held', 'snapshot_sha256')}))
        else:
            watch(args)


if __name__ == '__main__':
    main()
