#!/usr/bin/env python3
"""Enumerate the two curriculum handoffs without treating old approvals as new."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).parent
PILOT_NEW = {
    'g4-pilot-shape-actions', 'g4-pilot-measure-motion', 'g4-pilot-graph-compare',
    'g4-pilot-motion-course', 'g5-pilot-life-cycle-comparison', 'g5-pilot-friction-test',
    'g6-pilot-machine-tradeoffs', 'g7-pilot-net-force-motion', 'g6-pilot-water-wave-test',
    'g8-pilot-periodic-history', 'g8-pilot-elements-1-10', 'g8-pilot-elements-11-20',
    'g8-pilot-shell-position', 'g9-pilot-dating-evidence', 'g9-pilot-space-evidence',
    'g10-pilot-climate-evidence', 'g9-pilot-conservation-categories',
}
PILOT_EXISTING = {
    'rigid-objects-g4', 'soft-objects-g4', 'stretching-a-rubber-band-g4',
    'bending-objects-g4', 'mammal-life-cycle-g5', 'chicken-and-human-cycles-g4',
    'what-a-wave-is-g6', 'quiet-volcanoes-g8', 'lava-flow-distance-and-shape-g8',
    'g3-core-compare-moving-balls',
}


def inventory():
    records = {}
    pins = {}
    def read(relative):
        raw = (ROOT/relative).read_bytes()
        pins[relative] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
        return json.loads(raw)

    def add(fid, file, pointer, value, scope):
        entry = records.setdefault(fid, {'fact_id': fid, 'scopes': [], 'locations': [], 'fields': []})
        if scope not in entry['scopes']:
            entry['scopes'].append(scope)
        entry['locations'].append({'file': file, 'pointer': pointer})
        def walk(obj, path):
            if isinstance(obj, dict):
                if 'en' in obj and 'bis' in obj:
                    entry['fields'].append({'file': file, 'pointer': path,
                                            'en': obj['en'], 'bis': obj['bis']})
                else:
                    for key, val in obj.items():
                        walk(val, path + '/' + key)
            elif isinstance(obj, list):
                for i, val in enumerate(obj):
                    walk(val, path + '/' + str(i))
        walk(value, pointer)
        if isinstance(value, dict) and 'a' in value:
            entry.setdefault('answer_indices', []).append({'file': file, 'pointer': pointer+'/a', 'value': value['a']})
        if isinstance(value, dict) and 'source' in value:
            entry.setdefault('science_sources', []).append(value['source'])

    for file in ['rag/pipeline/pilot-content-corrections.json', 'rag/pipeline/full-year-content-corrections.json']:
        for i, record in enumerate(read(file)['corrections']):
            add(record['factId'], file, f'/corrections/{i}', record, 'science-correction')
            if 'question' in record:
                records[record['factId']].setdefault('answer_indices', []).append(
                    {'file': file, 'pointer': f'/corrections/{i}/question/a', 'value': record['question']['a']})
    delta = read('docs/full-year-content-changes.json')
    new = PILOT_NEW | {c['factId'] for g in delta['grades'] for c in g['newCards']}
    existing = PILOT_EXISTING | {fid for g in delta['grades'] for fid in g['changedQuestionsOnExistingFacts']}
    assert len(new) == 59
    seen_new, seen_existing = set(), set()
    for grade in range(3,11):
        file = f'packages/mobile/src/data/grade{grade}LessonSupplement.json'
        doc = read(file)
        for i, card in enumerate(doc['cards']):
            fid = card['factId']
            if fid in new or fid in records or fid == 'g3-core-compare-moving-balls':
                add(fid, file, f'/cards/{i}', card, 'supplement-card')
                if fid in new:
                    seen_new.add(fid)
        for fid, question in doc['questions'].items():
            if fid in new | existing or fid in records:
                add(fid, file, '/questions/'+fid, question, 'supplement-question')
                if fid in existing:
                    seen_existing.add(fid)
    assert seen_new == new, sorted(new-seen_new)
    assert seen_existing == existing, sorted(existing-seen_existing)
    for i, record in enumerate(records.values(), 1):
        record['ordinal'] = i
    return {'schema': 'hiraia.curriculum-cebuano-review-inventory/v1', 'source_pins': pins,
            'new_cards': len(new), 'changed_existing_questions': len(existing),
            'records': list(records.values())}


def show(doc, first, last):
    for record in doc['records'][first-1:last]:
        print(f"\n[{record['ordinal']}] {record['fact_id']} ({', '.join(record['scopes'])})")
        print('Correct-option indices:', [r['value'] for r in record.get('answer_indices', [])])
        seen = {}
        for field in record['fields']:
            pair = (field['en'], field['bis'])
            if pair in seen:
                print(field['pointer'], '= same EN/BIS as', seen[pair])
                continue
            seen[pair] = field['pointer']
            print(field['pointer'] + '\nEN: ' + field['en'] + '\nBIS: ' + field['bis'])


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--write', action='store_true')
    p.add_argument('--first', type=int, default=1)
    p.add_argument('--last', type=int, default=10)
    args = p.parse_args()
    path = HERE/'review-inventory-001.json'
    if args.write:
        assert not path.exists()
        doc = inventory()
        path.write_text(json.dumps(doc, ensure_ascii=False, indent=2)+'\n')
        print(json.dumps({k: v for k,v in doc.items() if k not in ('records', 'source_pins')}))
        print('records', len(doc['records']), 'fields', sum(len(r['fields']) for r in doc['records']))
    else:
        show(json.loads(path.read_bytes()), args.first, args.last)
