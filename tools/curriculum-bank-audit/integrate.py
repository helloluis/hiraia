#!/usr/bin/env python3
"""Integrate individually reviewed, exact-copy supplemental examples.

The review files must already be inspected and saved in this tool's reviews folder.
This command does not infer approvals from tags or generate model judgments.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'rag/pipeline'))
from lesson_examples import CATALOG, copy_digest, validate_examples


def integrate(paths, root=ROOT):
    read = lambda p: json.loads((root / p).read_text())
    raw = (root / CATALOG).read_bytes()
    review = json.loads(raw)
    bank = {c['id']: c for c in read('rag/pipeline/cardsPool.app.json')['cards']}
    lessons, current_ids = {}, set()
    for grade in range(3, 11):
        authored = read(f'rag/pipeline/grade{grade}-lessons.authoring.json')
        cross = read(f'docs/grade{grade}-subcategory-crosswalk.json')['mapping']
        enrichment = [r['subcategory_id'] for r in cross if r['role'] == 'enrichment']
        for lesson in authored['lessons']:
            lessons[lesson['key']] = dict(codes=[u['competency'] for u in lesson['units']],
                                        excludedCardIds=authored.get('excludedCardIds', []), enrichment=enrichment)
        current_ids.update(id for l in read(f'packages/mobile/src/generated/grade{grade}Lessons.generated.json')['lessons'] for id in l['cardIds'])
    rejected = {r['id'] for r in review.get('notAdmitted', [])}
    encountered, accepted, holds = set(), [], []
    for path in paths:
        assert path.startswith('tools/curriculum-bank-audit/reviews/') and '..' not in Path(path).parts, path
        data = (root / path).read_bytes()
        rows = [json.loads(line) for line in data.splitlines() if line.strip()]
        for row in rows:
            id = row['id']
            assert id not in encountered, f'Duplicate review decision: {id}'
            encountered.add(id)
            assert id not in current_ids and id not in review['cards'], f'Already admitted card: {id}'
            card = bank[id]
            assert copy_digest(card) == row['copySha256'], f'Copy changed after review: {id}'
            assert set(row['checkedLanguages']) == {'en', 'tl', 'bis'} and row['reason'].strip(), id
            assert row['decision'] in ('accept', 'hold') and isinstance(row['reviewedFor'], dict), id
            if row['decision'] == 'hold':
                assert not row['reviewedFor'], f'Held card with approved placements: {id}'
                if id not in rejected:
                    review.setdefault('notAdmitted', []).append(dict(id=id, factId=card['factId'], reason=row['reason'], decisionFile=path))
                    rejected.add(id)
                holds.append(id)
                continue
            assert row['reviewedFor'] and id not in rejected, f'Missing approval or unresolved hold: {id}'
            proofs = {}
            for key, reason in row['reviewedFor'].items():
                assert key in lessons and reason.strip(), f'Invalid lesson rationale: {id}/{key}'
                proofs[key] = dict(kind='full-copy-review', reviewedAt='2026-10-08', reason=reason, decisionFile=path)
                review['relatedCardIds'].setdefault(key, []).append(id)
            review['cards'][id] = dict(factId=card['factId'], copySha256=row['copySha256'], reviewedFor=proofs)
            accepted.append(id)
        if any(r['decision'] == 'accept' for r in rows):
            review['sourceFiles'][path] = hashlib.sha256(data).hexdigest()
    cache = {}

    def source(path):
        if path not in cache:
            data = (root / path).read_bytes()
            assert hashlib.sha256(data).hexdigest() == review['sourceFiles'][path], path
            rows = [json.loads(line) for line in data.splitlines() if line.strip()] if path.endswith('.jsonl') else json.loads(data)
            cache[path] = {row['id']: row for row in rows}
            assert len(cache[path]) == len(rows), path
        return cache[path]

    validate_examples(review, bank, lessons, read('packages/mobile/src/generated/curriculumTags.generated.json'),
                      {c['id'] for c in read('packages/mobile/src/generated/cardsIndex.generated.json')['cards']},
                      read('packages/mobile/src/data/curriculumTagExclusions.json'),
                      read('packages/mobile/src/data/curriculumTagOverrides.json')['factoids'], source,
                      {id for name in ('term2-pilot', 'full-year') for row in read(f'rag/pipeline/{name}-review.json').get('findings', [])
                       if row.get('kind') == 'not-selected' for id in row['cardIds']})
    assert set(cache) == set(review['sourceFiles'])
    review['method'] += ' October 8 bank expansion admits only fresh, exact current-copy decisions pinned in tools/curriculum-bank-audit/reviews; September automatic tag reviews were rejected as admission authority.'
    return raw, review, dict(accepted=accepted, held=holds, inputFiles=paths)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', action='append', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    raw, result, summary = integrate(args.review)
    args.out.mkdir(parents=True, exist_ok=False)
    data = (json.dumps(result, indent=2, ensure_ascii=False) + '\n').encode()
    (args.out / 'before.json').write_bytes(raw)
    (args.out / 'candidate.json').write_bytes(data)
    summary.update(beforeSha256=hashlib.sha256(raw).hexdigest(), afterSha256=hashlib.sha256(data).hexdigest(), applied=args.apply)
    if args.apply:
        assert (ROOT / CATALOG).read_bytes() == raw, 'Catalog changed during validation'
        (ROOT / CATALOG).write_bytes(data)
    (args.out / 'receipt.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(dict(accepted=len(summary['accepted']), held=len(summary['held']), applied=args.apply)))


if __name__ == '__main__':
    main()
