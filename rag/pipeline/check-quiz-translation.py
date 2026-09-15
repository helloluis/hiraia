#!/usr/bin/env python3
"""Rows whose sentence-length options are all still English while the question is translated.

Default: rag/bank/quiz-bank.jsonl. Pass --db path/to/cards.db to check the shipping table.
Exits 1 when any language still has a hit — that is the regression gate.

Rows in rag/bank/quiz-legit-english.json are skipped: a reviewer looked at them and recorded
WHY the English is correct (a verbatim quotation, a chemical name, a local species name whose
gloss is the English common name). Those cannot be detected by the length/capitalisation
heuristic in quiz_xlate_rules.py, and translating them makes the deck worse — but they are
listed one by one, with a reason each, so the exemption stays auditable and cannot quietly
grow into a mute-button. The count of skipped rows is always printed.
"""
import argparse, json, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quiz_xlate_rules import is_sentence_option

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BANK = os.path.join(ROOT, 'rag', 'bank', 'quiz-bank.jsonl')
LEGIT = os.path.join(ROOT, 'rag', 'bank', 'quiz-legit-english.json')
IDS_OUT = '/tmp/quiz-untranslated-ids.txt'


def legit_english_ids():
    """Reviewed ids whose English options are correct as they stand.

    The allowlist is written in QUIZ ids, because that is what a reviewer reads. The
    card_question table is keyed by factId instead, so the bank is used to carry each
    exemption across to the database — otherwise the DB half of the gate silently skips
    nothing and the two halves disagree about the same row.
    """
    try:
        with open(LEGIT, encoding='utf-8') as f:
            quiz_ids = {k for k in json.load(f) if not k.startswith('_')}
    except FileNotFoundError:
        return set()
    out = set(quiz_ids)
    try:
        with open(BANK, encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                r = json.loads(line)
                if r.get('id') in quiz_ids and r.get('factId'):
                    out.add(r['factId'])
    except FileNotFoundError:
        pass
    return out


def row_from_bank(r):
    return r.get('id'), r.get('q') or {}, r.get('options') or []


def row_from_card_question(fid, payload):
    q = payload.get('q') or {}
    return fid, q, payload.get('o') or payload.get('options') or []


def is_bad(q, options, lang):
    longs = [o for o in options if is_sentence_option((o or {}).get('en'))]
    if not longs:
        return False
    if (q.get(lang) or '').strip() == (q.get('en') or '').strip():
        return False
    return all((o.get(lang) or '').strip() == (o.get('en') or '').strip() for o in longs)


def iter_bank(path):
    with open(path, encoding='utf-8') as f:
        for line in f:
            if not line.strip():
                continue
            yield row_from_bank(json.loads(line))


def iter_db(path):
    db = sqlite3.connect(path)
    try:
        rows = db.execute('SELECT factId, json FROM card_question').fetchall()
    except sqlite3.OperationalError as e:
        print(f'ERR: {path}: {e}', file=sys.stderr)
        sys.exit(2)
    db.close()
    for fid, blob in rows:
        yield row_from_card_question(fid, json.loads(blob))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', default=BANK, help='quiz-bank.jsonl (default)')
    ap.add_argument('--db', help='packages/mobile/assets/data/cards.db (card_question table)')
    ap.add_argument('--ids-out', default=IDS_OUT)
    a = ap.parse_args()
    src = iter_db(a.db) if a.db else iter_bank(a.bank)
    label = a.db or a.bank
    bad = {'tl': set(), 'bis': set()}
    n = 0
    for rid, q, options in src:
        n += 1
        for lang in ('tl', 'bis'):
            if is_bad(q, options, lang):
                bad[lang].add(rid)
    legit = legit_english_ids()
    skipped = (bad['tl'] | bad['bis']) & legit
    for lang in bad:
        bad[lang] -= legit
    u = bad['tl'] | bad['bis']
    print(f'{os.path.relpath(label, ROOT) if os.path.isabs(label) else label}: {n} rows')
    print(f'tl {len(bad["tl"])} | bis {len(bad["bis"])} | union {len(u)}'
          f' | {len(skipped)} reviewed-legit skipped')
    with open(a.ids_out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(u)))
        if u:
            f.write('\n')
    sys.exit(1 if u else 0)


if __name__ == '__main__':
    main()
