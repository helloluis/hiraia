#!/usr/bin/env python3
"""Apply only reviewed bis leaves, with full-document inverse verification."""
import argparse
import copy
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parents[1]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def locate(doc, pointer):
    parts = pointer.split('/')[1:]
    assert pointer.startswith('/') and parts[-1] == 'bis', 'Only bis leaves may change'
    parent = doc
    for raw in parts[:-1]:
        part = raw.replace('~1', '/').replace('~0', '~')
        parent = parent[int(part)] if isinstance(parent, list) else parent[part]
    assert isinstance(parent, dict) and isinstance(parent.get('en'), str)
    assert isinstance(parent.get('bis'), str)
    return parent


def prepare(plan, raw_files):
    for file, pin in plan['source_pins'].items():
        assert sha(raw_files[file]) == pin['sha256'], f'Stale source: {file}'
    before = {file: json.loads(raw) for file, raw in raw_files.items()}
    after = copy.deepcopy(before)
    seen = set()
    for change in plan['changes']:
        key = change['file'], change['pointer']
        assert key not in seen, f'Duplicate edit: {key}'
        seen.add(key)
        parent = locate(after[change['file']], change['pointer'])
        assert parent['en'] == change['english'], f'English context changed: {key}'
        assert parent['bis'] == change['before'], f'Cebuano context changed: {key}'
        assert isinstance(change['after'], str) and change['after'].strip()
        assert change['after'] != change['before']
        parent['bis'] = change['after']
    inverse = copy.deepcopy(after)
    for change in plan['changes']:
        locate(inverse[change['file']], change['pointer'])['bis'] = change['before']
    assert inverse == before, 'Unreviewed field changed'
    # If a fact/explanation or overlay/supplement has the same English/Bisaya
    # pair, all copies in the reviewed scope must receive the same decision.
    decisions = {}
    for change in plan['changes']:
        key = change['fact_id'], change['english'], change['before']
        assert decisions.setdefault(key, change['after']) == change['after'], 'Divergent copies'
    return before, after


def apply(root, plan, receipt):
    assert not receipt.exists(), 'Application receipt already exists'
    files = {file: (root/file).read_bytes() for file in plan['source_pins']}
    before, after = prepare(plan, files)
    inventory = json.loads((HERE/'review-inventory-001.json').read_bytes())
    changed = {(x['file'], x['pointer'][:-4]): x for x in plan['changes']}
    for record in inventory['records']:
        replacements = {(x['english'], x['before']): x['after'] for x in plan['changes']
                        if x['fact_id'] == record['fact_id']}
        for field in record['fields']:
            pair = field['en'], field['bis']
            if pair in replacements:
                edit = changed.get((field['file'], field['pointer']))
                assert edit is not None and edit['after'] == replacements[pair], 'Unsynchronized duplicate'
    writes = {file: (json.dumps(after[file], ensure_ascii=False, indent=2)+'\n').encode()
              for file in files if before[file] != after[file]}
    for file, raw in files.items():
        assert (root/file).read_bytes() == raw, f'Source changed during preflight: {file}'
    for file, raw in writes.items():
        (root/file).write_bytes(raw)
    report = {'schema': 'hiraia.cebuano-curriculum-application/v1',
              'plan_sha256': sha((HERE/'reviewed-edits-001.json').read_bytes()),
              'changed_records': len({x['fact_id'] for x in plan['changes']}),
              'bis_leaves': len(plan['changes']), 'english_filipino_other_fields_unchanged': True,
              'answer_indices_and_order_unchanged': True, 'duplicate_fields_synchronized': True,
              'files': {file: {'before_sha256': sha(files[file]), 'after_sha256': sha(raw)} for file, raw in writes.items()}}
    receipt.write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', required=True)
    args = parser.parse_args()
    result = apply(ROOT, json.loads((HERE/'reviewed-edits-001.json').read_bytes()), HERE/'review-application-001.json')
    print(json.dumps(result, indent=2))
