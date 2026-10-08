#!/usr/bin/env python3
"""Build a bounded current-copy review packet. No card is approved or changed.

Automatic competency tags nominate placements only. A reviewer must examine
each current title/body, science claim, translation and exact lesson relevance.
"""
import argparse
import hashlib
import json
import sys
from collections import defaultdict, deque
from pathlib import Path

from audit import inventory

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'rag/pipeline'))
from lesson_examples import copy_digest


def prepare(grades, limit, reserved):
    ledger, summary = inventory()
    pending = {r['id'] for r in ledger if r['disposition'] == 'needs-current-review'}
    pins = dict(summary['evidencePins'])

    def read(path):
        data = (ROOT / path).read_bytes()
        pins[path] = hashlib.sha256(data).hexdigest()
        return json.loads(data)

    cards = {c['id']: c for c in read('rag/pipeline/cardsPool.app.json')['cards']}
    used_sources = {r['factId'] for r in ledger if r['disposition'].startswith('curriculum-')}
    pending = {id for id in pending if cards[id]['factId'] not in used_sources}
    tags = read('packages/mobile/src/generated/curriculumTags.generated.json')
    by_code, lessons, exclusions, enrichment, counts = defaultdict(list), {}, {}, {}, {}
    for grade in grades:
        author = read(f'rag/pipeline/grade{grade}-lessons.authoring.json')
        crosswalk = read(f'docs/grade{grade}-subcategory-crosswalk.json')
        extra = {r['subcategory_id'] for r in crosswalk['mapping'] if r['role'] == 'enrichment'}
        manifest = read(f'packages/mobile/src/generated/grade{grade}Lessons.generated.json')
        for l in manifest['lessons']:
            counts[l['key']] = len(l['cardIds'])
        for l in author['lessons']:
            key = l['key']
            lessons[key] = dict(title=l['title'], codes=sorted({u['competency'] for u in l['units']}),
                                units=[{k: u[k] for k in ('id', 'competency', 'focus')} for u in l['units']])
            exclusions[key] = set(author.get('excludedCardIds', []))
            enrichment[key] = extra
            for code in lessons[key]['codes']:
                by_code[code].append(key)
    for path in reserved:
        data = (ROOT / path).read_bytes()
        pins[path] = hashlib.sha256(data).hexdigest()
        doc = json.loads(data)
        reserved_sources = {cards[r['id']]['factId'] for r in doc['rows']}
        pending = {id for id in pending if cards[id]['factId'] not in reserved_sources}
    proposals, queues = {}, defaultdict(deque)
    for id in sorted(pending):
        c, t = cards[id], tags.get(id)
        if not t or t[3] < .2:
            continue
        codes = t[5] if len(t) > 5 and t[5] else [t[0]]
        keys = sorted({key for code in codes for key in by_code.get(code, [])
                       if id not in exclusions[key] and
                       (not c.get('cats') or not set(c['cats']) <= enrichment[key])})
        if not keys:
            continue
        proposals[id] = keys
        for key in keys:
            queues[key].append(id)
    # Prefer thin pools, taking one card per lesson each round. The distinct source
    # constraint avoids spending one packet on multiple wordings of the same fact.
    order = sorted(queues, key=lambda key: (counts[key], key))
    rows, selected_ids, selected_sources = [], set(), set()
    while len(rows) < limit:
        added = False
        for key in order:
            q = queues[key]
            while q and (q[0] in selected_ids or cards[q[0]]['factId'] in selected_sources):
                q.popleft()
            if not q:
                continue
            id = q.popleft()
            c = cards[id]
            selected_ids.add(id)
            selected_sources.add(c['factId'])
            rows.append(dict(id=id, card=c, copySha256=copy_digest(c),
                             proposedLessons={k: lessons[k] for k in proposals[id]}))
            added = True
            if len(rows) == limit:
                break
        if not added:
            break
    return dict(schema=1, scope='REVIEW CANDIDATES ONLY. No approvals. Read current English, Tagalog and Cebuano titles, bodies and emphasis; verify science and each proposed placement. Preserve uncertainty as a hold.',
                grades=grades, requestedLimit=limit, evidencePins=pins, rows=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--grades', type=int, nargs='+', required=True, choices=range(3, 11))
    parser.add_argument('--limit', type=int, default=150)
    parser.add_argument('--exclude-packet', action='append', default=[])
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert 1 <= args.limit <= 500, 'Use bounded review packets of 1–500 cards'
    assert len(args.grades) == len(set(args.grades)), 'Duplicate grade'
    result = prepare(sorted(args.grades), args.limit, args.exclude_packet)
    # A reserved packet is immutable; callers choose a new output for another batch.
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x') as f:
        f.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(dict(candidates=len(result['rows']), approvals=0, path=str(args.out),
                         sha256=hashlib.sha256(args.out.read_bytes()).hexdigest())))


if __name__ == '__main__':
    main()
