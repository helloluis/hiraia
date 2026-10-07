#!/usr/bin/env python3
"""Seal the reviewed, uncommitted local result; never commit or publish it."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def pin(path):
    raw = path.read_bytes()
    return {'path': str(path.relative_to(ROOT)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


if __name__ == '__main__':
    out = HERE/'completion-001.json'
    assert not out.exists()
    assert git('rev-parse', 'HEAD').decode().strip() == 'a2ce8367182c09055c2d5936418ad2c7212d70b0'
    branch = git('branch', '--show-current').decode().strip()
    assert branch == 'codex/cebuano-curriculum-alignment-20261007'
    subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)
    verification = json.loads((HERE/'final-verification-001.json').read_bytes())
    for entry in verification['outputs']:
        assert pin(ROOT/entry['path']) == entry, entry['path']
    validation = json.loads((HERE/'validation-evidence-001.json').read_bytes())
    for row in validation['executions']:
        for key in ('execution', 'output'):
            assert pin(ROOT/row[key]['path']) == row[key]
    artifact = validation['release_asset']
    assert pin(ROOT/artifact['path'])['sha256'] == artifact['sha256']
    packaging = ROOT/'build/cebuano-curriculum-alignment/executions/package-results-001'
    assert json.loads((packaging/'execution.json').read_bytes())['actual_exit_code'] == 0
    target = HERE/'evidence/executions/package-results-001'
    target.mkdir(exist_ok=False)
    for name in ('execution.json', 'output.txt'):
        (target/name).write_bytes((packaging/name).read_bytes())
    paths = set(git('diff', '--name-only', '-z').decode().strip('\0').split('\0'))
    paths.update(git('ls-files', '--others', '--exclude-standard', '-z').decode().strip('\0').split('\0'))
    paths.discard('')
    manifest = [pin(ROOT/file) for file in sorted(paths)]
    receipt = dict(schema='hiraia.cebuano-curriculum-alignment-completion/v1',
        recorded_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
        status='local_alignment_complete', branch=branch, base_commit=git('rev-parse', 'HEAD').decode().strip(),
        worktree=str(ROOT), historical_approved_edits_carried=3986,
        curriculum_records_reviewed=137, curriculum_records_edited=26, cebuano_leaves_edited=47,
        active_cards=49155, retirement='dcard-09952', mandatory_holds_preserved=verification['mandatory_holds_unchanged'],
        assessment_source_links_reviewed=79, assessment_items_with_links_reviewed=77,
        foundation_items_reviewed=2, unsupported_exposure_link_held='ha-g4-0010',
        english_filipino_and_answer_keys_unchanged=True, curriculum_membership_and_english_review_lock_unchanged=True,
        new_grounding_vectors=2, unchanged_vectors_verified=159064,
        required_local_checks_passed=len(validation['required_successes']),
        tests={'curriculum':92,'assessment_runtime':84,'public_browser':3,'historical_guards':47,
               'pipeline_integration':3,'english_review_guards':4,'assessment_compiler':6,'application_guards':8},
        evidence=[pin(HERE/name) for name in ('import-001.json','carry-approved-001.json',
            'reviewed-edits-001.json','review-application-001.json','source-reconciliation-001.json',
            'assessment-link-decisions-001.json','assessment-source-validation-001.json','vector-refresh-001.json',
            'final-verification-001.json','validation-evidence-001.json')],
        packaging_actual_exit=pin(target/'execution.json'), release_asset=artifact,
        release_required='Publish and read-back verify the new immutable vector asset before distributing a build from this branch.',
        native_certified=False, classroom_validated=False, assessment_production_enabled=False,
        provider_calls=0, committed=False, uploaded=False, deployed=False,
        final_changed_files=manifest)
    out.write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps({'completion':pin(out), 'changed_files':len(manifest), 'status':receipt['status']},indent=2))
