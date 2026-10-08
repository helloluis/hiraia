#!/usr/bin/env python3
"""Account for every actual main-bank card ID without treating tags as approvals.

This is an inventory/review-queue builder, never a content-admission tool. Admission
remains in the exact-copy, lesson-specific lesson_examples validator.
"""
import argparse
import csv
import hashlib
import io
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def inventory(root=ROOT):
    pins = {}

    def read(path):
        raw = (root / path).read_bytes()
        pins[path] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw)

    cards = read('packages/mobile/src/generated/cardsIndex.generated.json')['cards']
    ids = {c['id'] for c in cards}
    assert len(ids) == len(cards), 'Duplicate bank card ID'
    core, examples, by_grade = set(), set(), {}
    for grade in range(3, 11):
        lessons = read(f'packages/mobile/src/generated/grade{grade}Lessons.generated.json')['lessons']
        required = {id for l in lessons for id in l['coreCardIds']}
        extra = {id for l in lessons for id in l['relatedCardIds']}
        assert required | extra == {id for l in lessons for id in l['cardIds']}
        core.update(required)
        examples.update(extra)
        by_grade[str(grade)] = dict(allCurriculumCards=len(required | extra),
                                   mainBankCards=len((required | extra) & ids),
                                   supplementalCards=len((required | extra) - ids))
    excluded = read('packages/mobile/src/data/curriculumTagExclusions.json')
    nonselections = {}
    for name in ('term2-pilot', 'full-year'):
        path = f'rag/pipeline/{name}-review.json'
        for row in read(path).get('findings', []):
            if row.get('kind') == 'not-selected':
                for id in row['cardIds']:
                    nonselections[id] = path
    catalog = read('rag/pipeline/lesson-examples-review.json')
    withheld = {row['id']: row['reason'] for row in catalog.get('notAdmitted', [])}
    rows = []
    for card in sorted(cards, key=lambda c: c['id']):
        id, fact = card['id'], card['factId']
        if id in core:
            state, reason = 'curriculum-core', 'Reviewed required lesson card'
        elif id in examples:
            state, reason = 'curriculum-example', 'Reviewed optional lesson example'
        elif fact in excluded:
            state, reason = 'explicit-hold', 'curriculumTagExclusions.json'
        elif id in nonselections:
            state, reason = 'explicit-hold', nonselections[id]
        elif id in withheld:
            state, reason = 'explicit-hold', withheld[id]
        else:
            state, reason = 'needs-current-review', 'No current curriculum admission; tags alone cannot admit this card'
        rows.append(dict(id=id, factId=fact, disposition=state, reason=reason))
    counts = Counter(r['disposition'] for r in rows)
    assert sum(counts.values()) == len(ids)
    used = (core | examples) & ids
    return rows, dict(schema=1, unit='unique main-bank card IDs', mainBankCards=len(ids),
                      curriculumCards=len(used), curriculumPercent=100 * len(used) / len(ids),
                      outsideCurriculumCards=len(ids - used),
                      supplementalCurriculumCards=len((core | examples) - ids),
                      dispositions=dict(sorted(counts.items())), grades=by_grade,
                      evidencePins=pins,
                      limitations=['Disposition inventory is not a fresh scientific approval of every card.',
                                   'Explicit holds and pending reviews do not enter optional reading.',
                                   'Reachability does not measure actual student views or mastery.'])


def serialize(rows, summary):
    out = io.StringIO(newline='')
    writer = csv.DictWriter(out, fieldnames=['id', 'factId', 'disposition', 'reason'], dialect='excel-tab')
    writer.writeheader()
    writer.writerows(rows)
    data = out.getvalue().encode()
    summary = dict(summary, ledgerSha256=hashlib.sha256(data).hexdigest())
    return data, (json.dumps(summary, indent=2, ensure_ascii=False) + '\n').encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    rows, summary = inventory()
    ledger, report = serialize(rows, summary)
    files = {'cards.tsv': ledger, 'summary.json': report}
    if args.check:
        for name, data in files.items():
            assert (args.out / name).read_bytes() == data, f'Stale card inventory: {name}'
    else:
        args.out.mkdir(parents=True, exist_ok=True)
        for name, data in files.items():
            (args.out / name).write_bytes(data)
    print(json.dumps({k: v for k, v in summary.items() if k != 'evidencePins'}, indent=2))


if __name__ == '__main__':
    main()
