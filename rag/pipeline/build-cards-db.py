#!/usr/bin/env python3
"""Split the card inventory: a small resident INDEX, and the text in SQLite.

The pool used to be imported straight into the JS bundle, and that is the most expensive
place it could live. Two multipliers stack there: Hermes stores any string containing
non-ASCII as UTF-16, and nearly every Tagalog and Cebuano string qualifies, so ~50 MB of JSON
became ~100 MB of bytecode; and the bundle is STORED in the APK rather than deflated (measured:
111.1 MB -> 111.1 MB, 0% ratio) while everything around it compresses. The same content gzips
to 13 MB.

The split follows what the app actually reads. Sequencing a feed — the term index, the
category shelves, the illustration cooldown, the domain filters — touches ids, terms, slug,
cats, topic and domain, which is 7.4 MB of the 27.5. It never reads a card's prose. The
trilingual fact text, titles and emphasis spans are 19.0 MB and are needed only for the one
card on screen.

So the index stays resident and every adjacency decision stays SYNCHRONOUS — no rewrite of
nextChoices, no async render path — and the text moves to a database that is queried for the
handful of cards actually being shown.

  python3 rag/pipeline/build-cards-db.py
  -> packages/mobile/assets/data/cards.db             (ships; the APK deflates it)
  -> packages/mobile/src/generated/cardsIndex.generated.json  (bundled, small)
"""
import json, os, gzip, zlib, struct, sqlite3, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'packages/mobile/src/generated/cardsPool.generated.json')
QUESTIONS = os.path.join(ROOT, 'packages/mobile/src/data/cards-questions.json')
OUT_DB = os.path.join(ROOT, 'packages/mobile/assets/data/cards.db')
OUT_IDX = os.path.join(ROOT, 'packages/mobile/src/generated/cardsIndex.generated.json')
OUT_TOKENS = os.path.join(ROOT, 'packages/mobile/assets/data/tokens.bin')
SEP = '\x1f'  # unit separator: never occurs in the content, so joins are lossless


def main():
    pool = json.load(open(POOL))
    cards = pool['cards']
    os.makedirs(os.path.dirname(OUT_DB), exist_ok=True)

    # ---------- the resident index: everything sequencing needs, nothing it does not ----------
    slim = []
    for c in cards:
        row = {
            'id': c['id'],
            'factId': c.get('factId') or '',
            'domain': c.get('domain') or '',
            'topic': c.get('topic') or '',
            'slug': c.get('slug') or '',
            'terms': c.get('terms') or [],
        }
        # optional fields are omitted rather than nulled — 29,737 nulls is real bytes
        if c.get('cats'):
            row['cats'] = c['cats']
        if c.get('grade'):
            row['grade'] = c['grade']
        slim.append(row)
    index = {'taxonomy': pool.get('taxonomy') or [], 'cards': slim}
    # (written at the end — the search pass below adds `questionFactIds` to it)

    # ---------- the database: the prose, plus the quiz banks ----------
    if os.path.exists(OUT_DB):
        os.remove(OUT_DB)
    db = sqlite3.connect(OUT_DB)
    db.execute('PRAGMA page_size=4096')
    db.execute('''CREATE TABLE card_text(
        id TEXT PRIMARY KEY,
        tl TEXT, en TEXT, bis TEXT,
        title_tl TEXT, title_en TEXT, title_bis TEXT,
        emph_tl TEXT, emph_en TEXT, emph_bis TEXT,
        poster INTEGER, quarter INTEGER, competency TEXT, source_module TEXT)''')
    rows = []
    for c in cards:
        f = c.get('fact') or {}
        t = c.get('title') or {}
        e = c.get('emphasis') or {}
        rows.append((
            c['id'], f.get('tl') or '', f.get('en') or '', f.get('bis') or '',
            t.get('tl') or '', t.get('en') or '', t.get('bis') or '',
            SEP.join(e.get('tl') or []), SEP.join(e.get('en') or []), SEP.join(e.get('bis') or []),
            1 if c.get('poster') else 0, c.get('quarter'), c.get('competency') or '',
            c.get('source_module') or ''))
    db.executemany('INSERT INTO card_text VALUES(' + ','.join('?' * 14) + ')', rows)

    # ---------- the search index ----------
    # searchCards used to tokenise every card's three languages at BOOT to build this. That
    # is the one thing that genuinely needed the whole inventory resident, so it is
    # precomputed here: token -> the card ordinals carrying it, plus a document frequency for
    # idf. 46,177 tokens, ~8 MB — too big to bundle, trivial to look up.
    import re as _re
    # The SAME stop list searchTokens() applies in cards.ts, read from it rather than
    # restated — the token sets feed both the search index and textJaccard's duplicate
    # check, and a set that differs from what the app used to build would quietly shift a
    # threshold that took a sweep to tune.
    _src = open(os.path.join(ROOT, 'packages/mobile/src/data/cards.ts')).read()
    _i = _src.index('const SEARCH_STOP = new Set([')
    STOP = set(_re.findall(r"'([^']+)'", _src[_i:_src.index('])', _i)]))

    def toks(x):
        return [t for t in _re.findall(r'[a-z0-9]+', (x or '').lower())
                if len(t) > 2 and t not in STOP]

    inv = collections.defaultdict(list)
    for i, c in enumerate(cards):
        f = c.get('fact') or {}
        t = set(toks(c.get('topic')))
        for x in (c.get('terms') or []):
            t.update(toks(x))
        for k in ('en', 'tl', 'bis'):
            t.update(toks(f.get(k)))
        for tok in t:
            inv[tok].append(i)
    # ---------- the token index, as a flat binary ----------
    # textJaccard compares two cards' whole vocabularies to catch the bank holding the same
    # fact twice in different words ("abaca-fiber-stripping" vs "abaca-fiber-bundle"). It runs
    # INSIDE nextChoices, so it must be synchronous and exact — a 24-way MinHash was tried and
    # agreed with the 0.35 threshold on only 73% of pairs in the 0.20-0.55 decision band,
    # which is the entire job of the check.
    #
    # The sets are only ever intersected, so they do not need to be strings. Hashing each
    # token to an int (CRC32, zero collisions across all 46,177) and storing them sorted in
    # one Int32Array gives an exact answer in 5.7 MB that loads by wrapping a buffer — no
    # parse, and no JS objects on the heap.
    #
    # Layout: [n+1 offsets][all tokens], both Int32LE. Card i owns tokens[off[i]:off[i+1]].
    offs = [0]
    flat = []
    for c in cards:
        f = c.get('fact') or {}
        t = set(toks(c.get('topic')))
        for x in (c.get('terms') or []):
            t.update(toks(x))
        for k in ('en', 'tl', 'bis'):
            t.update(toks(f.get(k)))
        flat.extend(sorted(zlib.crc32(x.encode()) & 0x7FFFFFFF for x in t))
        offs.append(len(flat))
    buf = struct.pack(f'<{len(offs)}i', *offs) + struct.pack(f'<{len(flat)}i', *flat)
    with open(OUT_TOKENS, 'wb') as fh:
        fh.write(struct.pack('<i', len(cards)))
        fh.write(buf)
    print(f'  tokens.bin: {len(flat):,} slots, {(len(buf)+4)/1e6:.1f} MB')

    db.execute('CREATE TABLE search_token(token TEXT PRIMARY KEY, df INTEGER, ords TEXT)')
    db.executemany('INSERT INTO search_token VALUES(?,?,?)',
                   [(tok, len(ords), ','.join(map(str, ords))) for tok, ords in inv.items()])
    print(f'  search_token: {len(inv):,} tokens')

    # ---------- the MCQ bank, keyed the way the interject asks for it ----------
    # questionForFact(factId) is a point lookup, so the table is keyed by factId and only the
    # SET of ids that have a question needs to be resident (see the index below).
    qs = json.load(open(QUESTIONS))
    qlist = qs if isinstance(qs, list) else (qs.get('questions') or list(qs.values())[0])
    db.execute('CREATE TABLE card_question(factId TEXT PRIMARY KEY, json TEXT)')
    seen = set()
    qrows = []
    for q in qlist:
        fid = q.get('f')
        if not fid or fid in seen:
            continue
        seen.add(fid)
        qrows.append((fid, json.dumps(q, ensure_ascii=False, separators=(',', ':'))))
    db.executemany('INSERT INTO card_question VALUES(?,?)', qrows)
    print(f'  card_question: {len(qrows):,} keyed by factId')
    index['questionFactIds'] = sorted(seen)

    # The practice-quiz sample used to be stored here as a `quiz_bank` table. It is gone
    # for two reasons: quiz mode is archived (see archive/quiz-mode/), and nothing ever read
    # the table anyway — the feature imported its JSON directly, so the sample shipped TWICE,
    # 2.2 MB in the JS bundle and another 2.26 MB of never-read rows in this database.
    # The interject's own MCQs live in card_question above, keyed the way it looks them up.

    db.commit()
    db.execute('VACUUM')
    db.close()

    # Ships UNCOMPRESSED. The APK deflates .db assets itself (measured below), so gzipping
    # it here would only buy the same bytes at the cost of needing a gunzip in JS — and
    # expo-sqlite needs a real file on disk either way.
    json.dump(index, open(OUT_IDX, 'w'), ensure_ascii=False, separators=(',', ':'))

    raw = open(OUT_DB, 'rb').read()
    gz = gzip.compress(raw, 9)  # reported only, to show what the APK will do with it

    idx = os.path.getsize(OUT_IDX)
    before = os.path.getsize(POOL) + os.path.getsize(QUESTIONS)
    print(f'\n  was inlined in the JS bundle : {before/1e6:6.1f} MB of JSON (~2x as bytecode)')
    print(f'  resident index (bundled)     : {idx/1e6:6.1f} MB')
    print(f'  tokens.bin (asset)           : {os.path.getsize(OUT_TOKENS)/1e6:6.1f} MB')
    print(f'  cards.db (asset on disk)     : {len(raw)/1e6:6.1f} MB')
    print(f'    deflates in the APK to about : {len(gz)/1e6:6.1f} MB')
    print(f'  {len(cards):,} cards')


if __name__ == '__main__':
    main()
