#!/usr/bin/env python3
"""Verify full-year review decisions and generate the per-week coverage inventory.

Run normally to CHECK the frozen English review and report. --record-review is
only for explicitly reviewed changes; it is not an automatic content approval.
This checks provenance/structure, not scientific truth, fluency or pupil mastery.
"""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path
from lesson_examples import load_examples

ROOT = Path(__file__).resolve().parents[2]
LOCK = 'rag/pipeline/full-year-review-lock.json'
REPORT = 'docs/full-year-curriculum-coverage.json'
LANGS = ('en', 'tl', 'bis')


def read(path):
    return json.loads((ROOT / path).read_text())


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def trilingual(value, context):
    assert all(isinstance(value.get(lang), str) and value[lang].strip() for lang in LANGS), context


def inventory():
    schedule = read('packages/shared/src/curriculum/three-term-2026.json')
    placement = schedule['competencies']
    reviews = [read(f'rag/pipeline/{name}-review.json') for name in ('term2-pilot', 'full-year')]
    units, codes, related = {}, set(), {}
    for review in reviews:
        assert not set(units) & review['units'].keys(), 'Duplicate reviewed units'
        assert not codes & set(review['codes']), 'Duplicate reviewed codes'
        units.update(review['units'])
        codes.update(review['codes'])
        for key, ids in review['relatedCardIds'].items():
            related.setdefault(key, set()).update(ids)
    assert codes == {code for code, row in placement.items() if row['status'] == 'listed'}
    cards = {c['id']: c for c in read('rag/pipeline/cardsPool.app.json')['cards']}
    questions = {q['f']: q for q in read('packages/mobile/src/data/cards-questions.json')['questions']}
    for grade in range(3, 11):
        supp = read(f'packages/mobile/src/data/grade{grade}LessonSupplement.json')
        for card in supp['cards']:
            assert card['id'] not in cards, card['id']
            cards[card['id']] = card
        questions.update(supp['questions'])  # same precedence as lessonSupplement.ts
    sources = []
    for source in schedule['sources']:
        assert hashlib.sha256((ROOT / source['referenceFile']).read_bytes()).hexdigest() == source['sha256']
        sources.append(source)
    examples = load_examples(ROOT, cards)
    manifests = [read(f'packages/mobile/src/generated/grade{g}Lessons.generated.json') for g in range(3, 11)]
    reviewed_cards, seen_units, rows = set(), set(), []
    for manifest in manifests:
        for lesson in manifest['lessons']:
            listed = set(lesson['codes']) & codes
            if not listed:
                continue  # Retained legacy supporting lessons are not BOW coverage.
            approved = set(related.get(lesson['key'], []))
            for unit in lesson['units']:
                if unit['competency'] not in listed:
                    continue
                assert unit['id'] in units, unit['id']
                expected = units[unit['id']]
                assert set(unit['cardIds']) == set(expected['cardIds']), unit['id']
                assert set(unit['quizCardIds']) == set(expected['quizCardIds']), unit['id']
                assert unit['cardIds'] and unit['quizCardIds'], unit['id']
                assert set(unit['quizCardIds']) <= set(unit['cardIds']), unit['id']
                assert len({cards[c]['factId'] for c in unit['cardIds']}) == len(unit['cardIds']), unit['id']
                assert all(cards[c]['factId'] in questions for c in unit['quizCardIds']), unit['id']
                seen_units.add(unit['id'])
                approved.update(unit['cardIds'])
            # Additional reading has its own exact-copy evidence. It must not
            # silently expand or rewrite the frozen October teaching review.
            extra = set(examples.get(lesson['key'], []))
            assert set(lesson['cardIds']) <= approved | extra, f"Unreviewed reserve: {lesson['key']}"
            assert extra <= set(lesson['cardIds']), f"Missing reviewed examples: {lesson['key']}"
            reviewed_cards.update(set(lesson['cardIds']) & approved)
            for code in lesson['codes']:
                if code not in listed:
                    continue
                row = placement[code]
                selected = [u for u in lesson['units'] if u['competency'] == code]
                rows.append(dict(code=code, **row, sourceLessonKey=lesson['key'], units=selected))
    assert seen_units == set(units), 'Review contains missing/extra units'
    assert {row['code'] for row in rows} == codes
    assert len(rows) == len(codes)
    # Bind the review to actual English teaching and effective question bytes.
    # Translation edits do not invalidate this English review, but still pass the
    # structural/emphasis guards and need a native language reviewer.
    english = {}
    for card_id in sorted(reviewed_cards):
        card = cards[card_id]
        trilingual(card['fact'], card_id)
        trilingual(card['title'], card_id)
        for lang, spans in card.get('emphasis', {}).items():
            assert all(span in card['fact'][lang] for span in spans), f'{card_id}: emphasis/{lang}'
        q = questions.get(card['factId'])
        english_q = None
        if q:
            assert q['f'] == card['factId'], card_id
            assert len(q['o']) >= 3 and 0 <= q['a'] < len(q['o']), card_id
            for value in [q['q'], q['e'], *q['o']]:
                trilingual(value, card_id)
            for lang in LANGS:
                assert len({o[lang] for o in q['o']}) == len(q['o']), f'{card_id}: duplicate choices/{lang}'
            english_q = dict(q=q['q']['en'], o=[o['en'] for o in q['o']], a=q['a'], e=q['e']['en'])
        english[card_id] = digest(dict(factId=card['factId'], title=card['title']['en'], fact=card['fact']['en'], question=english_q))
    # Corrections outside the lesson selections must also reach their source banks.
    bank = {r['id']: r for r in map(json.loads, (ROOT / 'rag/bank/science-facts.jsonl').read_text().splitlines())}
    corrections = read('rag/pipeline/full-year-content-corrections.json')['corrections']
    for patch in corrections:
        if 'id' in patch:
            card = cards[patch['id']]
            for key in ('fact', 'title', 'topic', 'slug'):
                if key in patch:
                    assert card[key] == patch[key], f"{patch['id']}: stale {key}"
            for lang, spans in card.get('emphasis', {}).items():
                assert all(s in card['fact'][lang] for s in spans), patch['id']
        if patch['factId'] in bank:
            assert bank[patch['factId']]['fact'] == patch['fact'], patch['factId']
            if 'topic' in patch:
                assert bank[patch['factId']]['topic'] == patch['topic'], patch['factId']
        if patch['factId'] in questions and 'question' in patch:
            assert questions[patch['factId']] == patch['question'], patch['factId']
    correction_english = []
    for patch in corrections:
        row = {key: patch[key] for key in ('id', 'factId', 'topic', 'slug') if key in patch}
        row.update({key: patch[key]['en'] for key in ('title', 'fact') if key in patch})
        if 'question' in patch:
            q = patch['question']
            row['question'] = dict(q=q['q']['en'], o=[o['en'] for o in q['o']], a=q['a'], e=q['e']['en'])
        correction_english.append(row)
    lock = dict(schema=1, sourceHashes={s['referenceFile']: s['sha256'] for s in sources},
                decisions=digest(dict(units=units, related={k: sorted(v) for k, v in related.items()})),
                englishContentHashes=english, corrections=digest(correction_english))
    weeks = []
    for grade in range(3, 11):
        for term in range(1, 4):
            for week in range(1, 12):
                active = [r for r in rows if r['grade'] == grade and r['term'] == term and r['weeks'][0] <= week <= r['weeks'][1]]
                weeks.append(dict(grade=grade, term=term, week=week,
                                  headings=list(dict.fromkeys(r['heading'] for r in active)),
                                  codes=[r['code'] for r in active]))
    report = dict(schema=1, date='2026-10-05',
                  scope='Science Grades 3–10, all three terms; official blocks overlap weeks as printed, not a prescribed weekly sequence.',
                  limitations='Reviewed teaching and reasoning questions; practical skills require teacher observation. No native-language or whole-discovery-library certification.',
                  sources=sources, counts=dict(competencies=len(codes), units=len(units), selectedCards=len(reviewed_cards)),
                  byWeek=weeks, competencies=rows)
    return lock, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record-review', action='store_true', help='record explicitly reviewed English/decision changes')
    parser.add_argument('--check-db', action='store_true', help='also verify corrected text in the built card/quiz/grounding database')
    args = parser.parse_args()
    lock, report = inventory()
    for path, data in ((LOCK, lock), (REPORT, report)):
        if args.record_review:
            (ROOT / path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        else:
            assert read(path) == data, f'{path}: review changed; inspect differences before recording a new review'
    if args.check_db:
        with sqlite3.connect(f'file:{ROOT}/packages/mobile/assets/data/cards.db?mode=ro', uri=True) as db:
            db.row_factory = sqlite3.Row
            for patch in read('rag/pipeline/full-year-content-corrections.json')['corrections']:
                if 'id' in patch:
                    card = db.execute('SELECT * FROM card_text WHERE id=?', (patch['id'],)).fetchone()
                    assert card, patch['id']
                    for lang in LANGS:
                        assert card[lang] == patch['fact'][lang], patch['id']
                        if 'title' in patch:
                            assert card['title_' + lang] == patch['title'][lang], patch['id']
                fact = db.execute('SELECT * FROM fact WHERE id=?', (patch['factId'],)).fetchone()
                if fact:
                    assert all(fact[lang] == patch['fact'][lang] for lang in LANGS), patch['factId']
                    if 'topic' in patch:
                        assert fact['topic'] == patch['topic'], patch['factId']
                q = db.execute('SELECT json FROM card_question WHERE factId=?', (patch['factId'],)).fetchone()
                if q and 'question' in patch:
                    assert json.loads(q[0]) == patch['question'], patch['factId']
    print(json.dumps(report['counts']))


if __name__ == '__main__':
    main()
