#!/usr/bin/env python3
"""Import already-paid Qwen streams that were filed as errors but can be parsed.

Does not POST. Attempt markers stay. Error result files are moved to
results-pre-salvage/ before a verdict is written.
"""
import json
import shutil
from collections import Counter
from pathlib import Path

import audit_images as audit

OUT = Path('/Users/luis/Code/hiraia/tools/image-audit/runs/2026-09-21')


def last_response(stem):
    attempt = OUT / 'attempts' / stem
    for rel in ('retry2/response.txt', 'retry/response.txt', 'response.txt'):
        path = attempt / rel
        if path.exists() and path.stat().st_size:
            return path
    return None


def main():
    snap, jobs = audit.load(OUT)
    archive = OUT / 'results-pre-salvage'
    archive.mkdir(exist_ok=True)
    counts = Counter()
    leftover = []
    for path in sorted((OUT / 'results').glob('*.json')):
        record = audit.read_json(path)
        if not record.get('error') or record.get('verdict'):
            continue
        job = jobs[path.stem]
        counts['error'] += 1
        counts['error_' + job['kind']] += 1
        counts['type_' + str((record.get('error') or {}).get('type'))] += 1
        response = last_response(path.stem)
        if not response:
            leftover.append({'id': path.stem, 'kind': job['kind'], 'why': 'no_response'})
            counts['no_response'] += 1
            continue
        try:
            verdict = audit.normalize_verdict(job, audit.decode_response(response.read_text()))
            status = audit.validate(job, verdict)
        except Exception as error:
            leftover.append({'id': path.stem, 'kind': job['kind'],
                             'why': type(error).__name__, 'detail': str(error)[:160]})
            counts['still_' + type(error).__name__] += 1
            continue
        shutil.move(str(path), str(archive / path.name))
        audit.write_json(path, {
            'rubric_sha256': snap['rubric_sha256'],
            'reviewer': 'qwen3.8-omni-flash',
            'raw_response': response.read_text(),
            'verdict': verdict,
            'salvaged': True,
            'salvaged_from': record.get('error'),
        })
        counts['salvaged'] += 1
        counts['salvaged_' + job['kind']] += 1
        counts['salvaged_status_' + status] += 1
    leftover_path = OUT / 'salvage-leftover.jsonl'
    leftover_path.write_text(''.join(json.dumps(row) + '\n' for row in leftover))
    summary = dict(counts)
    summary['leftover'] = len(leftover)
    (OUT / 'salvage-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
