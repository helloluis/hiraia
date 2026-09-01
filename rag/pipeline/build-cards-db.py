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

The same database now also carries the tutor's grounding fact bank, which had the same
problem in `packages/shared/src/rag/facts.generated.ts` — see build-facts-db.py, which this
script calls so that one command produces the whole asset.

  python3 rag/pipeline/build-cards-db.py
  -> packages/mobile/assets/data/cards.db             (ships; the APK deflates it)
  -> packages/mobile/src/generated/cardsIndex.generated.json  (bundled, small)
"""
import json, os, gzip, hashlib, importlib.util, zlib, struct, sqlite3, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
POOL = os.path.join(ROOT, 'rag/pipeline/cardsPool.app.json')
QUESTIONS = os.path.join(ROOT, 'packages/mobile/src/data/cards-questions.json')
OUT_DB = os.path.join(ROOT, 'packages/mobile/assets/data/cards.db')
OUT_IDX = os.path.join(ROOT, 'packages/mobile/src/generated/cardsIndex.generated.json')
OUT_TOKENS = os.path.join(ROOT, 'packages/mobile/assets/data/tokens.bin')
SEP = '\x1f'  # unit separator: never occurs in the content, so joins are lossless

# The fact-bank half of this database. A hyphenated filename is not importable and renaming
# it would break the pipeline docs that name it, so it is loaded by path.
_spec = importlib.util.spec_from_file_location('build_facts_db', os.path.join(HERE, 'build-facts-db.py'))
_facts_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_facts_mod)
build_facts = _facts_mod.build_facts
db_version = _facts_mod.db_version


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
    _block = _src[_i:_src.index('])', _i)]
    # Strip the // comments FIRST. One apostrophe in a comment ("the query's idf mass") re-pairs
    # every quote after it, so the extractor silently returns 74 entries of prose instead of the
    # word list — the index then ships with a stop list the app does not have, which is the exact
    # desynchronisation build-apk.sh guards against. Caught in the act while adding the particles.
    _block = _re.sub(r'//[^\n]*', '', _block)
    STOP = set(_re.findall(r"'([^']+)'", _block))
    # A stop word is one lower-case word. Anything else means the parse slipped, and a silently
    # wrong stop list is far more expensive than a failed build.
    _bad = sorted(w for w in STOP if not _re.fullmatch(r'[a-z0-9ñ-]+', w))
    if _bad:
        raise SystemExit(f'build-cards-db: SEARCH_STOP parse produced non-words: {_bad[:5]}')

    # ...and the same TOKEN PATTERN, parsed out of searchTokens() for the same reason. It used
    # to be restated here as `[a-z0-9]+` while the app matches `[a-z0-9ñ]+`, so no word
    # containing an ñ was ever indexed: `pinatubo` reached ffct-33873 and `piñatubo` reached
    # nothing, and `el niño` / `la niña` — MATATAG weather content — were permanently out of
    # vocabulary. Two tokenisers that must agree exactly are one declaration, not two.
    _j = _src.index('function searchTokens(')
    _pat = _re.search(r'\.match\(/([^/]+)/[a-z]*\)', _src[_j:_src.index('\n}', _j)]).group(1)
    _TOK = _re.compile(_pat)
    print(f'  tokeniser: /{_pat}/ (parsed from searchTokens), {len(STOP)} stop words')

    def toks(x):
        return [t for t in _TOK.findall((x or '').lower())
                if len(t) > 2 and t not in STOP]

    # SALIENCE, alongside the postings. A posting used to say only "this card contains this
    # token", which is field-blind: topic, terms and all three prose languages were unioned into
    # one bag. That is exactly the evidence searchCards was missing — with no card-side signal it
    # could only measure how much of the QUERY a card covers, so every card containing a
    # one-word query tied at 1.000 and the first one scanned won (see searchCards' ABOUTNESS
    # SHARE). Rank is a property of the (token, card) PAIR, i.e. of a posting, so it is computed
    # here and shipped beside `ords` rather than rebuilt on the phone: an eager head index over
    # all the cards is the 427 ms boot cost this file exists to have deleted.
    #
    #   rank 0     the token is in the card's `topic`
    #   rank i+1   the token is in `terms[i]` — `terms` is salience-ordered by the bank, subject
    #              first, so position IS centrality and it is the only such signal that works in
    #              all three languages (`topic` is English-only for all but 58 of the cards)
    #   255        the token occurs only in the prose (PROSE_RANK in cards.ts)
    # One byte per posting, parallel to `ords`. Exact — no quantisation.
    PROSE_BYTE = 255
    inv = collections.defaultdict(list)
    head_rank = collections.defaultdict(dict)  # token -> {card ordinal: rank}
    # WIDTH, alongside the rank: how many content words the slot that gave a token its rank is
    # made of. A slot carries 1/(1+rank) of salience and that salience is SHARED by the words
    # that name it, so `lightning` is all of the topic "what lightning is" and half of the topic
    # "Volcanic Lightning". Without it every rank-0 match ties and the tie fell through to the
    # card-size divisor H(|head|), which is not language-neutral: an ffct card carries its
    # Tagalog and Cebuano synonyms in `terms` (mean head 16.0) where an English-only DepEd card
    # carries none (mean head 7.6), so the least-annotated card won and "lightning" answered
    # with *Volcanic Lightning*, "water" with *Subsoil Water*, "araw" with *Sikat ng Araw at
    # Biodiversity*. Width is a property of the (token, card) PAIR, like rank, so it ships as a
    # second byte beside `ranks`.
    head_width = collections.defaultdict(dict)  # token -> {card ordinal: slot width}
    # Distinct head tokens per card, so cards.ts can normalise by the card's OWN salience mass
    # H(|head|). A card with a small focused head whose subject IS the query token must beat a
    # card with twenty terms that mentions it fifth; without this divisor it cannot.
    head_size = bytearray(len(cards))
    widest = 0
    for i, c in enumerate(cards):
        f = c.get('fact') or {}
        rank = {}
        width = {}
        _topic = set(toks(c.get('topic')))
        for tok in _topic:
            if tok not in rank:
                rank[tok] = 0
                width[tok] = len(_topic)
        for j, x in enumerate(c.get('terms') or []):
            _slot = set(toks(x))
            for tok in _slot:
                if rank.get(tok, 1 << 30) > j + 1:
                    rank[tok] = j + 1
                    width[tok] = len(_slot)
        t = set(rank)
        for k in ('en', 'tl', 'bis'):
            t.update(toks(f.get(k)))
        for tok in t:
            inv[tok].append(i)
        for tok, r in rank.items():
            head_rank[tok][i] = r
            head_width[tok][i] = width[tok]
        widest = max(widest, len(rank))
        # 255 heads is far past anything in this corpus (the widest is printed below); the cap
        # is here so the array stays one byte per card and can never overflow silently.
        head_size[i] = min(len(rank), 255)
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

    db.execute('CREATE TABLE search_token('
               'token TEXT PRIMARY KEY, df INTEGER, ords TEXT, ranks BLOB, widths BLOB)')
    st_rows = []
    postings = 0
    widest_slot = 0
    for tok, ords in inv.items():
        hr = head_rank.get(tok) or {}
        hw = head_width.get(tok) or {}
        # 254 is the deepest expressible head rank; 255 means "prose only" and must stay
        # reserved, so a head rank that somehow reached it is clamped rather than aliased.
        # A width is a DIVISOR, so the prose postings that never read it carry 1, not 0.
        st_rows.append((tok, len(ords), ','.join(map(str, ords)),
                        bytes(min(hr[o], 254) if o in hr else PROSE_BYTE for o in ords),
                        bytes(min(max(hw.get(o, 1), 1), 255) for o in ords)))
        postings += len(ords)
        widest_slot = max([widest_slot] + list(hw.values()))
    db.executemany('INSERT INTO search_token VALUES(?,?,?,?,?)', st_rows)
    # One row, one blob: |head| per card, addressed by pool ordinal exactly like `ords`.
    db.execute('CREATE TABLE search_meta(key TEXT PRIMARY KEY, value BLOB)')
    db.execute('INSERT INTO search_meta VALUES(?,?)', ('head_sizes', bytes(head_size)))
    print(f'  search_token: {len(inv):,} tokens, {postings:,} postings '
          f'(+{2*postings/1e6:.1f} MB of salience ranks + slot widths, widest slot {widest_slot})')
    print(f'  search_meta:  head sizes for {len(cards):,} cards, widest head {widest} tokens')

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

    # ---------- the grounding fact bank, in the SAME database ----------
    # The tutor's 50,279-fact bank had the identical problem the cards had, one file over:
    # `packages/shared/src/rag/facts.generated.ts` is 43.5 MB of TypeScript that Metro cannot
    # tree-shake. It lands here rather than in a second database because there is no reason for
    # a phone to carry two, and because this script recreates cards.db from scratch — so the
    # facts have to be written BEFORE the VACUUM and before the content stamp below, or every
    # rebuild would silently drop them.
    build_facts(db)

    db.commit()
    db.execute('VACUUM')
    db.close()

    # Ships UNCOMPRESSED. The APK deflates .db assets itself (measured below), so gzipping
    # it here would only buy the same bytes at the cost of needing a gunzip in JS — and
    # expo-sqlite needs a real file on disk either way.
    raw = open(OUT_DB, 'rb').read()

    # Stamp the database's CONTENT into the resident index so the app can tell a new database
    # from the copy it already wrote. cardDb copies the bundled db only when the file is
    # ABSENT, so without this every rebuild shipped an asset the app then ignored — the deck
    # kept serving whatever database it created on first launch, however old. The index is
    # written here rather than above because the stamp needs the finished file.
    index['dbVersion'] = db_version(OUT_DB)
    json.dump(index, open(OUT_IDX, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'  dbVersion: {index["dbVersion"]}')
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
