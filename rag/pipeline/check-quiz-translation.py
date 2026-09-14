#!/usr/bin/env python3
"""Rows whose sentence-length options are all still English while the question is translated.

Default: rag/bank/quiz-bank.jsonl. Pass --db path/to/cards.db to check the shipping table.
Exits 1 when any language still has a hit — that is the regression gate.
"""
import argparse, json, os, sqlite3, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from quiz_xlate_rules import is_sentence_option

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BANK = os.path.join(ROOT, 'rag', 'bank', 'quiz-bank.jsonl')
IDS_OUT = '/tmp/quiz-untranslated-ids.txt'


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
    u = bad['tl'] | bad['bis']
    print(f'{os.path.relpath(label, ROOT) if os.path.isabs(label) else label}: {n} rows')
    print(f'tl {len(bad["tl"])} | bis {len(bad["bis"])} | union {len(u)}')
    with open(a.ids_out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(u)))
        if u:
            f.write('\n')
    sys.exit(1 if u else 0)


if __name__ == '__main__':
    main()
