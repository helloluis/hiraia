#!/usr/bin/env python3
"""Preserve local validation evidence and prepare a named, unpublished asset."""
import datetime
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BUILD = ROOT/'build/cebuano-curriculum-alignment'


def pin(path):
    raw = path.read_bytes()
    return dict(path=str(path.relative_to(ROOT)), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())


def main():
    proof = json.loads((HERE/'final-verification-001.json').read_bytes())
    for entry in proof['outputs']:
        assert pin(ROOT/entry['path']) == entry, f"Verified output changed: {entry['path']}"
    required = ['assessments-002', 'assessment-source-validation-001', 'cards-db-001',
        'full-year-audit-001', 'normal-source-final-001', 'vectors-001', 'final-verification-001',
        'check-pipeline-guards-001', 'check-pipeline-integration-001', 'check-english-review-guards-001',
        'check-facts-db-001', 'check-assessment-compiled-001', 'check-similarity-compiled-001',
        'check-tala-catalog-001', 'check-curriculum-tests-002', 'check-assessment-tests-002',
        'check-web-competencies-001', 'check-web-terms-tests-001', 'check-mobile-types-002',
        'check-desktop-types-002', 'check-web-types-001', 'assessment-compiler-tests-001']
    required += [f'check-grade{grade}-compiled-001' for grade in range(3, 11)]
    receipts = []
    for folder in sorted((BUILD/'executions').iterdir()):
        execution = folder/'execution.json'
        if not execution.exists():
            continue  # This packaging command has not exited yet.
        row = json.loads(execution.read_bytes())
        output = folder/'output.txt'
        assert pin(output)['sha256'] == row['output_sha256']
        if folder.name in required:
            assert row['actual_exit_code'] == 0, folder.name
        target = HERE/'evidence/executions'/folder.name
        target.mkdir(parents=True, exist_ok=False)
        for source in (execution, output):
            shutil.copyfile(source, target/source.name)
            assert source.read_bytes() == (target/source.name).read_bytes()
        receipts.append(dict(name=folder.name, actual_exit_code=row['actual_exit_code'],
                             execution=pin(target/'execution.json'), output=pin(target/'output.txt')))
    assert set(required) <= {row['name'] for row in receipts}
    for name in ('source-drift-001.json', 'source-reconciliation-trial/mismatches.json'):
        source = BUILD/name
        target = HERE/'evidence'/('source-first-trial-mismatches.json' if '/' in name else name)
        assert not target.exists()
        shutil.copyfile(source, target)
    asset = proof['retrieval_asset']
    output = BUILD/'release'/asset['filename']
    output.parent.mkdir(exist_ok=True)
    assert not output.exists()
    shutil.copyfile(ROOT/asset['path'], output)
    assert pin(output)['sha256'] == asset['sha256']
    result = dict(recorded_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        required_successes=required, executions=receipts, release_asset={**pin(output),
        'filename': asset['filename'], 'md5': asset['md5'], 'published': False},
        earlier_application_tests=dict(cases=8, actual_exit_code=0, actual_tool_chunk='d18039',
            evidence_kind='Actual tool result in this alignment session; predates the execution-log wrapper.'),
        initial_source_failures=[
            dict(actual_exit_code=1, actual_tool_chunk='048b55', reason='Normal generation exposed ffct-00580 source-context drift.'),
            dict(actual_exit_code=1, actual_tool_chunk='40ca0b', reason='First isolated trial reactivated one stale concise-editorial entry on dcard-08517.'),
        ],
        provider_calls=0, committed=False, deployed=False)
    path = HERE/'validation-evidence-001.json'
    assert not path.exists()
    path.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({'receipt': pin(path), 'required_successes':len(required), 'copied_executions':len(receipts),
                      'release_asset':result['release_asset']}, indent=2))


if __name__ == '__main__':
    main()
