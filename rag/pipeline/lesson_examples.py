"""Explicit reading examples alongside (not in place of) frozen teaching units.

The catalog binds the current trilingual copy and its lesson-specific evidence.
Inherited English approvals must still match the original manual review packet.
Neither competency tags nor category/keyword matches alone admit a new example.
"""
import hashlib
import json
from pathlib import Path

CATALOG = 'rag/pipeline/lesson-examples-review.json'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def copy_digest(card):
    return digest({k: card.get(k) for k in ('factId', 'fact', 'title', 'emphasis')})


def validate_examples(review, cards, lessons, tags, available, exclusions, overrides, source,
                      superseded_ids=()):
    assert review['schema'] == 1, 'Unknown example review schema'
    memberships = {}
    for key, ids in review['relatedCardIds'].items():
        assert key in lessons, f'Unknown example lesson: {key}'
        assert len(ids) == len(set(ids)), f'Duplicate example: {key}'
        for id in ids:
            memberships.setdefault(id, set()).add(key)
    assert set(memberships) == set(review['cards']), 'Example evidence/membership mismatch'
    assert not {r['id'] for r in review.get('notAdmitted', [])} & set(memberships), \
        'Rejected additional copy was admitted'
    for id, keys in memberships.items():
        c = cards[id]
        evidence = review['cards'][id]
        assert id in available and c['factId'] not in exclusions, f'Unavailable/excluded example: {id}'
        assert c['factId'] == evidence['factId'], f'Changed example identity: {id}'
        assert copy_digest(c) == evidence['copySha256'], f'Changed example copy: {id}'
        assert set(evidence['reviewedFor']) == keys, f'Example lesson evidence mismatch: {id}'
        for lang in ('en', 'tl', 'bis'):
            assert c['fact'].get(lang, '').strip() and c['title'].get(lang, '').strip(), id
            assert all(span in c['fact'][lang] for span in c.get('emphasis', {}).get(lang, [])), id
        t = tags.get(id)
        codes = set((t[5] if len(t) > 5 and t[5] else [t[0]]) if t else [])
        assert t and t[3] >= .2, f'Unmapped example: {id}'
        for key, proof in evidence['reviewedFor'].items():
            lesson = lessons[key]
            assert id not in lesson['excludedCardIds'], f'Grade-excluded example: {id}'
            assert codes & set(lesson['codes']), f'Wrong competency for example: {id}/{key}'
            assert not c.get('cats') or not set(c['cats']) <= set(lesson['enrichment']), f'Enrichment-only example: {id}'
            assert proof['reason'].strip(), f'Missing example rationale: {id}'
            if proof['kind'] == 'manual-recovery':
                assert id not in superseded_ids, f'Newer core review rejected inherited example: {id}'
                decision = source(proof['reviewFile'])[id]
                packet = source(proof['packetFile'])[id]
                assert decision['disposition'] == 'recover_core' and decision['translationsChecked'], id
                assert decision['factId'] == packet['factId'] == c['factId'], id
                assert digest(packet['copy']) == decision['textHash'] == packet['textHash'], id
                assert packet['copy']['en'] == c['fact']['en'], f'Inherited English changed: {id}'
                assert any(e['lesson'] == key for e in decision['evidence']), f'Inherited lesson changed: {id}'
                assert codes & set(lesson['codes']) & set(decision['codes']), id
                current = overrides.get(c['factId'], {})
                assert current.get('disposition') == 'correct' and current.get('id') == id, id
                assert current.get('notes', '').endswith('Evidence: ' + proof['reviewFile']), f'Recovery superseded: {id}'
            else:
                assert proof['kind'] == 'full-copy-review' and proof['reviewedAt'], f'Unknown example evidence: {id}'
                if proof.get('decisionFile'):
                    decision = source(proof['decisionFile'])[id]
                    assert decision['decision'] == 'accept', f'Held current-copy review: {id}'
                    assert decision['copySha256'] == evidence['copySha256'], f'Stale current-copy decision: {id}'
                    assert set(decision['checkedLanguages']) == {'en', 'tl', 'bis'}, id
                    assert decision['reviewedFor'].get(key) == proof['reason'], f'Changed review rationale: {id}/{key}'
    return review['relatedCardIds']


def load_examples(root, cards):
    root = Path(root)
    read = lambda p: json.loads((root / p).read_text())
    review = read(CATALOG)
    lessons = {}
    for grade in review['grades']:
        author = read(f'rag/pipeline/grade{grade}-lessons.authoring.json')
        cross = read(f'docs/grade{grade}-subcategory-crosswalk.json')['mapping']
        enrichment = [r['subcategory_id'] for r in cross if r['role'] == 'enrichment']
        for lesson in author['lessons']:
            lessons[lesson['key']] = dict(
                codes=[u['competency'] for u in lesson['units']],
                excludedCardIds=author.get('excludedCardIds', []), enrichment=enrichment)
    sources = {}
    def source(path):
        if path not in sources:
            assert path.startswith(('tools/curriculum-recovery/', 'tools/curriculum-bank-audit/reviews/')), 'Unexpected example review location'
            raw = (root / path).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == review['sourceFiles'][path], f'Changed example evidence: {path}'
            rows = [json.loads(s) for s in raw.splitlines() if s.strip()] if path.endswith('.jsonl') else json.loads(raw)
            sources[path] = {r['id']: r for r in rows}
            assert len(sources[path]) == len(rows), f'Duplicate inherited review identity: {path}'
        return sources[path]
    result = validate_examples(
        review, cards, lessons, read('packages/mobile/src/generated/curriculumTags.generated.json'),
        {c['id'] for c in read('packages/mobile/src/generated/cardsIndex.generated.json')['cards']},
        read('packages/mobile/src/data/curriculumTagExclusions.json'),
        read('packages/mobile/src/data/curriculumTagOverrides.json')['factoids'], source,
        {id for name in ('term2-pilot', 'full-year')
         for finding in read(f'rag/pipeline/{name}-review.json').get('findings', [])
         if finding.get('kind') == 'not-selected' for id in finding['cardIds']})
    assert set(sources) == set(review['sourceFiles']), 'Unused example evidence source'
    return result
