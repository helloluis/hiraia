"""Reviewed science corrections applied after generation, before shipping.

Edit pilot-content-corrections.json when reviewing its translations. Keeping these
repairs at the pipeline boundary prevents regeneration from restoring old claims.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name('pilot-content-corrections.json')


def corrections():
    return json.loads(SOURCE.read_text())['corrections']


def correct_cards(cards):
    by_id = {r['id']: r for r in corrections() if 'id' in r}
    for card in cards:
        patch = by_id.get(card['id'])
        if not patch:
            continue
        assert card['factId'] == patch['factId'], card['id']
        for field in ('fact', 'slug'):
            if field in patch:
                card[field] = patch[field]
        # Emphasis is exact-substring metadata. Preserve valid spans; do not guess
        # replacement words after a science correction changes the sentence.
        if 'emphasis' in card:
            card['emphasis'] = {
                lang: [s for s in spans if s in card['fact'][lang]]
                for lang, spans in card['emphasis'].items()
            }
            assert all(s in card['fact'][lang] for lang, spans in card['emphasis'].items() for s in spans)


def correct_questions(questions):
    patches = {r['factId']: r['question'] for r in corrections() if 'question' in r}
    for q in questions:
        if q['f'] in patches:
            q.update(patches[q['f']])


def apply_to_sources():
    pool_path = ROOT / 'rag/pipeline/cardsPool.app.json'
    pool = json.loads(pool_path.read_text())
    correct_cards(pool['cards'])
    pool_path.write_text(json.dumps(pool, ensure_ascii=False))
    patches = {r['factId']: r for r in corrections()}
    for filename, key in [('science-facts.jsonl', 'id'), ('quiz-bank.jsonl', 'factId')]:
        path = ROOT / 'rag/bank' / filename
        output = []
        count = 0
        for line in path.read_text().splitlines(keepends=True):
            row = json.loads(line) if line.strip() else {}
            patch = patches.get(row.get(key))
            if patch and 'fact' in patch:
                if key == 'id':
                    row['fact'] = patch['fact']
                elif 'question' in patch:
                    q = patch['question']
                    row.update(q=q['q'], options=q['o'], answer=q['a'], explanation=q['e'], difficulty=q['d'])
                line = json.dumps(row, ensure_ascii=False) + '\n'
                count += 1
            output.append(line)
        path.write_text(''.join(output))
        print(filename, count, 'corrected rows')


if __name__ == '__main__':
    apply_to_sources()
