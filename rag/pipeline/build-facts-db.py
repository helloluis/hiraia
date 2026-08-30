#!/usr/bin/env python3
"""Move the grounding fact bank out of the JS bundle and into the card database.

`packages/shared/src/rag/facts.generated.ts` WAS a 43.5 MB TypeScript array of all 50,279
facts, imported as `RagStore`'s default constructor argument (deleted; this script replaces it).
Metro does not tree-shake, so it landed in the bundle as 41.2 MB of Hermes bytecode — measured
with the toolchain's own hermesc, and STORED uncompressed in the APK because React Native's
gradle plugin adds the bundle extension to `noCompress`. As rows in this database the same
content costs 17.8 MB deflated. (The Hermes UTF-16 penalty that hurt the card pool barely
applies here: only 14.3% of the bank's characters sit in strings containing non-ASCII —
Tagalog and Cebuano are written almost entirely in plain Latin letters.) This is the same
pathology the card feed already fixed by moving its text into
`packages/mobile/assets/data/cards.db`, so the facts go into the SAME database rather than a
second one.

Three tables, written next to `card_text` / `search_token` / `card_question`:

  fact(ord, id, domain, topic, grades, terms, tl, en, bis, source, generator, reviewed)
      One row per bank line. `ord` is the ZERO-BASED LINE NUMBER of the JSONL and is the
      load-bearing column: `vectors-labse.i8.bin` is positional (vector i belongs to bank
      row i) and `RagStore.attachSemantic` refuses an index whose count disagrees, so `ord`
      is the only thing keeping the lexical rows and the semantic vectors describing the
      same fact. Nothing may reorder it.

  fact_token(token, df, ords)
      The inverted index over RagStore's OWN tokenisation (mirrored below and proven
      identical, not assumed — see --verify-tokens). `df` is the document frequency
      RagStore counts, so idf = log(1 + (N - df + 0.5) / (df + 0.5)) is recoverable
      verbatim from this row plus fact_meta's count.

      Scoring is not a flat overlap: a token in `topic` scores 8, in `terms` 4, in the
      ACTIVE language's body 1, and in the English body 0.5 as a code-switch bridge, taking
      the FIRST of those that applies. A posting therefore has to carry WHICH FIELDS the
      token hit, not just which document, or the weight cannot be reconstructed — so each
      posting is an (ord, mask) pair with bits 1=topic 2=terms 4=tl 8=en 16=bis.

      `ords` packs those pairs as ASCENDING-BY-ORD DELTAS: base36 gap in [0-9A-Z], then one
      character from MASK_ALPHABET (31 values, disjoint from the base36 digits) which both
      carries the mask and ends the entry. No separators, no fixed widths. The obvious
      `12345:7,12346:9,…` spelling was measured first and costs 19.5 MB against this one's
      5.9 MB (6.9 vs 3.3 MB deflated) — 13.6 MB of a phone's storage for a format nobody
      reads by eye. It is also the FASTER shape at query time, which is the real reason:
      `ang` has df 49,037 and the stripped-to-nothing fallback path does score raw stop
      words, so a `split(',')` posting list would allocate ~49k throwaway strings per such
      token on a budget phone, while this decodes by scanning characters into two integers.
      Round-tripped against the source postings on every build (see _decode).

  fact_meta(key, value)
      `count` and `bankHash`, using the same md5-of-the-file convention as
      `vectors-labse.meta.json` — so a stale database is caught the way `attachSemantic`
      catches a stale vectors blob, and the two stamps can be compared to each other.

Runs as part of `build-cards-db.py` (which recreates cards.db from scratch, so the facts
have to be written after it), or standalone against an existing database:

  python3 rag/pipeline/build-facts-db.py
  python3 rag/pipeline/build-facts-db.py --check          # ordinal + content + index proofs
  python3 rag/pipeline/build-facts-db.py --replay /tmp/rag-baseline.json   # score parity
  python3 rag/pipeline/build-facts-db.py --verify-tokens /tmp/tok-py.txt
"""
import json, os, re, sys, hashlib, sqlite3, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BANK = os.path.join(ROOT, 'rag/bank/science-facts.jsonl')
OUT_DB = os.path.join(ROOT, 'packages/mobile/assets/data/cards.db')

# The nine fields of ScienceFact, in declaration order. A bank row may carry extras (18 rows
# have `unverified`); the retired TS exporter dropped them too, so the shipped bank has never
# contained them and dropping them here changes nothing. `loadFactBank` drops them the same
# way, so a Node consumer's fact objects stay identical to the phone's.
FIELDS = ('id', 'domain', 'topic', 'grades', 'terms', 'fact', 'source', 'generator', 'reviewed')

# ---------------------------------------------------------------------------------------
# The retriever's tokeniser, mirrored EXACTLY (packages/shared/src/rag/tokenize.ts).
#
#   text.toLowerCase().split(/[^a-z0-9ñáéíóúàèìòù]+/i).filter(t => t.length >= 3).map(stem)
#
# Two details are easy to get wrong and both change the index: the length filter runs BEFORE
# stemming (so "cats" survives as "cat" but "ads" is dropped whole), and the plural collapse
# only fires above four characters and skips the -ss/-us/-is/-os/-as/-ous tails that protect
# proper nouns (Venus) and Tagalog/Cebuano words. `--verify-tokens` proves the mirror rather
# than trusting this comment.
# ---------------------------------------------------------------------------------------
MIN_TOKEN_LEN = 3
_SPLIT = re.compile(r'[^a-z0-9ñáéíóúàèìòù]+', re.I)
_KEEP_TAIL = re.compile(r'(ss|us|is|os|as|ous)$')


def stem(t: str) -> str:
    if len(t) > 4 and t.endswith('ies'):
        return t[:-3] + 'y'
    if len(t) > 4 and t.endswith('s') and not _KEEP_TAIL.search(t):
        return t[:-1]
    return t


def tokenize(text: str) -> list:
    return [stem(t) for t in _SPLIT.split((text or '').lower()) if len(t) >= MIN_TOKEN_LEN]


# field bits, in RagStore's weight-priority order (topic > terms > body > en-bridge)
F_TOPIC, F_TERMS, F_TL, F_EN, F_BIS = 1, 2, 4, 8, 16

# --- the posting encoding (see the module docstring) ---
# Delta digits are uppercase base36; the mask character is drawn from an alphabet that
# shares no character with them, so it doubles as the entry terminator. 31 entries because
# a posting always hits at least one field, and all 31 combinations do occur in this bank.
B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
MASK_ALPHABET = 'abcdefghijklmnopqrstuvwxyz.-_~!'


def _b36(n: int) -> str:
    s = ''
    while n:
        s = B36[n % 36] + s
        n //= 36
    return s or '0'


def _encode(postings) -> str:
    """[(ord, mask), ...] ascending -> the packed `ords` string."""
    out = []
    prev = -1  # so the first gap is >= 1 and never encodes as an empty string
    for o, m in postings:
        out.append(_b36(o - prev) + MASK_ALPHABET[m - 1])
        prev = o
    return ''.join(out)


def _decode(s: str):
    """The inverse, used to prove every row round-trips before the build is accepted."""
    out, gap, prev = [], 0, -1
    for ch in s:
        i = B36.find(ch)
        if i >= 0:
            gap = gap * 36 + i
        else:
            prev += gap
            out.append((prev, MASK_ALPHABET.index(ch) + 1))
            gap = 0
    return out


def load_bank(path=BANK):
    rows = []
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        rows.append({k: r[k] for k in FIELDS})
    return rows


def field_sets(f):
    """The five token sets RagStore builds per fact, in bit order."""
    return (
        set(tokenize(f['topic'])),
        set(tokenize(' '.join(f['terms']))),
        set(tokenize(f['fact']['tl'])),
        set(tokenize(f['fact']['en'])),
        set(tokenize(f['fact']['bis'])),
    )


def build_facts(db, bank_path=BANK, quiet=False):
    """Write fact / fact_token / fact_meta into an OPEN sqlite connection."""
    rows = load_bank(bank_path)
    bank_hash = hashlib.md5(open(bank_path, 'rb').read()).hexdigest()[:12]

    for t in ('fact', 'fact_token', 'fact_meta'):
        db.execute(f'DROP TABLE IF EXISTS {t}')
    db.execute('''CREATE TABLE fact(
        ord INTEGER PRIMARY KEY,
        id TEXT UNIQUE,
        domain TEXT, topic TEXT,
        grades TEXT, terms TEXT,
        tl TEXT, en TEXT, bis TEXT,
        source TEXT, generator TEXT, reviewed INTEGER)''')
    db.executemany(
        'INSERT INTO fact VALUES(' + ','.join('?' * 12) + ')',
        [(
            i, f['id'], f['domain'], f['topic'],
            # grades is int[] and terms is string[]; both are round-tripped as compact JSON
            # so `JSON.parse` hands back the exact array the bundled bank had — a separator
            # join would be smaller but would have to guess at types on the way back.
            json.dumps(f['grades'], separators=(',', ':')),
            json.dumps(f['terms'], ensure_ascii=False, separators=(',', ':')),
            f['fact']['tl'], f['fact']['en'], f['fact']['bis'],
            f['source'], f['generator'], 1 if f['reviewed'] else 0,
        ) for i, f in enumerate(rows)])

    # ---- the inverted index, carrying the field mask each posting needs to be scoreable ----
    post = collections.defaultdict(list)  # token -> [(ord, mask), ...] ascending by ord
    for i, f in enumerate(rows):
        sets = field_sets(f)
        mask_of = {}
        for bit, s in zip((F_TOPIC, F_TERMS, F_TL, F_EN, F_BIS), sets):
            for t in s:
                mask_of[t] = mask_of.get(t, 0) | bit
        for t, m in mask_of.items():
            post[t].append((i, m))

    db.execute('CREATE TABLE fact_token(token TEXT PRIMARY KEY, df INTEGER, ords TEXT)')
    rows_tok = []
    for t, p in post.items():
        packed = _encode(p)
        # A decode bug here would not crash anything — it would quietly shift retrieval
        # scores, which is the one thing this move is not allowed to do. So every row is
        # checked, on every build, against the postings it came from.
        assert _decode(packed) == p, f'posting round-trip failed for {t!r}'
        rows_tok.append((t, len(p), packed))
    db.executemany('INSERT INTO fact_token VALUES(?,?,?)', rows_tok)

    db.execute('CREATE TABLE fact_meta(key TEXT PRIMARY KEY, value TEXT)')
    db.executemany('INSERT INTO fact_meta VALUES(?,?)', [
        ('count', str(len(rows))),
        ('bankHash', bank_hash),
        # recorded so a reader never has to hardcode the scoring constants it is reproducing
        ('fieldBits', json.dumps({'topic': F_TOPIC, 'terms': F_TERMS, 'tl': F_TL, 'en': F_EN, 'bis': F_BIS},
                                 separators=(',', ':'))),
        ('fieldWeight', json.dumps({'topic': 8, 'terms': 4, 'body': 1, 'bridge': 0.5},
                                   separators=(',', ':'))),
        ('idf', 'log(1 + (N - df + 0.5) / (df + 0.5))'),
        ('ordsEncoding', f'base36-delta[{B36[:10]}A-Z] + mask char [{MASK_ALPHABET}] (index = mask-1)'),
    ])
    db.commit()

    if not quiet:
        postings = sum(len(p) for p in post.values())
        print(f'  fact:       {len(rows):,} rows, bankHash {bank_hash}')
        print(f'  fact_token: {len(post):,} tokens, {postings:,} postings')
    return len(rows), len(post)


OUT_IDX = os.path.join(ROOT, 'packages/mobile/src/generated/cardsIndex.generated.json')


def db_version(path=OUT_DB):
    """The database's CONTENT hash — what cardDb compares against its on-disk copy.

    Lives here rather than in build-cards-db.py because both scripts have to agree on it:
    the app copies the bundled database only when the stamp DIFFERS, so a facts-only rebuild
    that left the stamp alone would ship a new asset the app then ignores — the exact failure
    the stamp was introduced to kill, arriving through a different door.
    """
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()[:12]


def restamp(db_path=OUT_DB, index_path=OUT_IDX):
    """Write the current database's hash into the resident index. For a STANDALONE facts
    build; build-cards-db.py stamps inline because it is holding the index in memory."""
    index = json.load(open(index_path))
    index['dbVersion'] = db_version(db_path)
    json.dump(index, open(index_path, 'w'), ensure_ascii=False, separators=(',', ':'))
    return index['dbVersion']


def table_bytes(db):
    """Per-table on-disk bytes, via dbstat (page-accurate, not an estimate)."""
    try:
        return dict(db.execute(
            "SELECT name, SUM(pgsize) FROM dbstat GROUP BY name ORDER BY 2 DESC").fetchall())
    except sqlite3.OperationalError:
        return {}


RAGSTORE_TS = os.path.join(ROOT, 'packages/shared/src/rag/RagStore.ts')


def _query_rules():
    """QUERY_STOP + COLLOQUIAL, READ OUT OF RagStore.ts rather than restated here.

    build-cards-db.py already pulls `SEARCH_STOP` out of cards.ts for the same reason: a
    second copy of a list this long does not stay in sync, and the failure mode is not a
    crash but a quietly different ranking. If the TypeScript ever moves, this raises instead
    of silently indexing against a stale list.
    """
    src = open(RAGSTORE_TS, encoding='utf-8').read()
    i = src.index('const QUERY_STOP = new Set(')
    # The declaration is preceded by a long comment that itself quotes identifiers in
    # backticks, so anchor on the template literal that FEEDS `.split(/\s+/)`, not the first
    # backtick after the name.
    m = re.search(r'`([^`]*)`\s*\.split\(', src[i:], re.S)
    assert m, 'QUERY_STOP template literal did not parse'
    stop = set(m.group(1).split())
    assert len(stop) > 100, f'QUERY_STOP looks wrong ({len(stop)} words)'
    j = src.index('const COLLOQUIAL')
    colloquial = re.findall(r"\[/(.+?)/gi,\s*'(.*?)'\]", src[j:src.index('];', j)])
    assert colloquial, 'COLLOQUIAL did not parse'
    return stop, colloquial


def replay(baseline_path, db_path=OUT_DB):
    """Re-score the parity probes using ONLY the database, and diff against the baseline.

    The point of the tables is not that they hold the right bytes — `check` proves that — but
    that they hold ENOUGH to reproduce `RagStore.search` exactly. This is the proof, and it is
    also the reference implementation the JS reader has to match: same field-weight priority,
    same idf, same seen-penalty, and the same two orderings that are easy to lose. Floating
    point addition is not associative, so the per-document sum must visit the query tokens in
    the SAME order RagStore's Set iterates them (first appearance in the stripped query), and
    the final sort must be stable over ASCENDING ord, because that is what JS's stable sort
    gives ties and the bank has a great many ties.
    """
    import math
    base = json.load(open(baseline_path))
    db = sqlite3.connect(db_path)
    N = int(db.execute("SELECT value FROM fact_meta WHERE key='count'").fetchone()[0])
    ids = [r[0] for r in db.execute('SELECT id FROM fact ORDER BY ord')]
    STOP, COLLOQUIAL = _query_rules()
    W_TOPIC, W_TERMS, W_BODY, W_BRIDGE = 8.0, 4.0, 1.0, 0.5
    CONTEXT_WEIGHT, SEEN_PENALTY = 0.35, 0.25
    LANG_BIT = {'tagalog': F_TL, 'english': F_EN, 'cebuano': F_BIS}

    cache = {}

    def postings(tok):
        if tok not in cache:
            row = db.execute('SELECT df, ords FROM fact_token WHERE token=?', (tok,)).fetchone()
            cache[tok] = (0.0, ()) if not row else (
                math.log(1 + (N - row[0] + 0.5) / (row[0] + 0.5)), _decode(row[1]))
        return cache[tok]

    def strip(text):
        for pat, to in COLLOQUIAL:
            text = re.sub(pat, to, text, flags=re.I)
        seen, out = set(), []
        for t in tokenize(text):
            if t not in STOP and t not in seen:  # dedup preserving first-appearance order
                seen.add(t)
                out.append(t)
        return out

    def weight(mask, bit):
        if mask & F_TOPIC:
            return W_TOPIC
        if mask & F_TERMS:
            return W_TERMS
        if mask & bit:
            return W_BODY
        if bit != F_EN and mask & F_EN:
            return W_BRIDGE
        return 0.0

    def search(q, lang, context, seen_ids, top_k):
        bit = LANG_BIT[lang]
        stripped = strip(q)
        ctx_stripped = strip(context)
        using_ctx = not stripped and bool(ctx_stripped)
        if stripped:
            q_tokens = stripped
        elif using_ctx:
            q_tokens = ctx_stripped
        else:
            q_tokens, seenset = [], set()
            for t in tokenize(q):  # the raw-token fallback keeps stop words
                if t not in seenset:
                    seenset.add(t)
                    q_tokens.append(t)
        if not q_tokens:
            return []
        qset = set(q_tokens)
        ctx_tokens = [] if using_ctx else [t for t in ctx_stripped if t not in qset]

        score, ctx_score = {}, {}
        for t in q_tokens:  # RagStore's Set order — see the docstring
            idf, post = postings(t)
            for o, m in post:
                w = weight(m, bit)
                if w:
                    score[o] = score.get(o, 0.0) + w * idf
        for t in ctx_tokens:
            idf, post = postings(t)
            for o, m in post:
                w = weight(m, bit)
                if w:
                    ctx_score[o] = ctx_score.get(o, 0.0) + w * idf

        hits = []
        for o in sorted(score):  # ascending ord == RagStore's doc iteration order
            s = score[o]
            if s <= 0:
                continue
            # A seen fact is demoted AND loses its context boost, exactly as RagStore does it:
            # the previous answer's text IS the context, so boosting it would re-surface the
            # fact the novelty penalty is trying to move past.
            total = s * SEEN_PENALTY if ids[o] in seen_ids else s + CONTEXT_WEIGHT * ctx_score.get(o, 0.0)
            hits.append((total, o))
        hits.sort(key=lambda x: -x[0])  # stable -> ties stay in ord order
        return [(ids[o], f'{s:.6f}') for s, o in hits[:top_k]]

    bad = 0
    for p in base['probes']:
        got = search(p['q'], p['lang'], p['context'], set(p['seen']), base['topK'])
        want = [(a, b) for a, b in p['hits']]
        if got != want:
            bad += 1
            if bad <= 5:
                print(f'  DIFF [{p["lang"]}] {p["q"]!r}\n    want {want[:4]}\n    got  {got[:4]}')
    db.close()
    print(f'\n  {len(base["probes"]) - bad}/{len(base["probes"])} probes reproduced from the database'
          f' — {"IDENTICAL" if not bad else str(bad) + " DIFFER"}')
    return bad


def check(db_path=OUT_DB, bank_path=BANK, sample=500):
    """Prove the database says exactly what the bank file says.

    Three things, in the order they would bite. ORDINAL ALIGNMENT first, because it is the
    silent one: the vectors blob is positional, so an `ord` that is off by a single row makes
    every fact retrieve someone else's illustration and someone else's embedding while every
    test still passes. Then the CONTENT of the row, so the reconstructed ScienceFact is
    byte-for-byte the object the bundle used to hold. Then the INVERTED INDEX, rebuilt from
    the fact rows and compared against the stored postings — the check that the table can
    actually reproduce a score.
    """
    import random
    db = sqlite3.connect(db_path)
    bank = load_bank(bank_path)
    meta = dict(db.execute('SELECT key, value FROM fact_meta').fetchall())
    fails = 0

    def ok(label, good, detail=''):
        nonlocal fails
        if not good:
            fails += 1
        print(f'  {"PASS" if good else "FAIL"}  {label}{("  " + detail) if detail else ""}')

    ok('fact_meta.count matches the bank file',
       meta.get('count') == str(len(bank)), f'{meta.get("count")} vs {len(bank)}')
    ok('fact_meta.bankHash matches md5(science-facts.jsonl)',
       meta.get('bankHash') == hashlib.md5(open(bank_path, "rb").read()).hexdigest()[:12],
       meta.get('bankHash', '?'))
    vmeta = os.path.join(ROOT, 'packages/mobile/assets/rag/vectors-labse.meta.json')
    if os.path.exists(vmeta):
        v = json.load(open(vmeta))
        ok('vectors blob agrees (count + bankHash) — attachSemantic would accept',
           v['count'] == len(bank) and v['bankHash'] == meta.get('bankHash'),
           f'blob count {v["count"]}, bankHash {v["bankHash"]}')

    n = db.execute('SELECT COUNT(*) FROM fact').fetchone()[0]
    ok('fact row count', n == len(bank), f'{n}')
    lo, hi = db.execute('SELECT MIN(ord), MAX(ord) FROM fact').fetchone()
    ok('ord is a dense 0..N-1 range', lo == 0 and hi == len(bank) - 1, f'{lo}..{hi}')

    # --- ordinal alignment on a random sample, read back out of the file by LINE number ---
    rnd = random.Random(20260829)
    ords = sorted(rnd.sample(range(len(bank)), min(sample, len(bank))))
    want = {}
    with open(bank_path, encoding='utf-8') as fh:
        wanted = set(ords)
        for i, line in enumerate(fh):
            if i in wanted:
                want[i] = json.loads(line)['id']
    got = dict(db.execute(
        f'SELECT ord, id FROM fact WHERE ord IN ({",".join("?" * len(ords))})', ords).fetchall())
    bad = [o for o in ords if got.get(o) != want[o]]
    ok(f'{len(ords)} random ords: fact.id == the id on that line of the JSONL',
       not bad, f'{len(ords) - len(bad)}/{len(ords)} matched' + (f', first bad ord {bad[0]}' if bad else ''))

    # --- full content round-trip: every row, rebuilt into the ScienceFact shape ---
    mismatch = None
    for (o, i, dom, top, gr, te, tl, en, bis, src, gen, rev) in db.execute(
            'SELECT * FROM fact ORDER BY ord'):
        rebuilt = {'id': i, 'domain': dom, 'topic': top, 'grades': json.loads(gr),
                   'terms': json.loads(te), 'fact': {'tl': tl, 'en': en, 'bis': bis},
                   'source': src, 'generator': gen, 'reviewed': bool(rev)}
        if rebuilt != bank[o]:
            mismatch = (o, i)
            break
    ok(f'all {len(bank)} rows round-trip to the exact ScienceFact object',
       mismatch is None, '' if mismatch is None else f'first mismatch at ord {mismatch[0]} ({mismatch[1]})')

    # --- the inverted index reproduces itself from the fact rows ---
    post = collections.defaultdict(list)
    for i, f in enumerate(bank):
        m = {}
        for bit, s in zip((F_TOPIC, F_TERMS, F_TL, F_EN, F_BIS), field_sets(f)):
            for t in s:
                m[t] = m.get(t, 0) | bit
        for t, k in sorted(m.items()):
            post[t].append((i, k))
    stored = {t: (d, s) for t, d, s in db.execute('SELECT token, df, ords FROM fact_token')}
    ok('fact_token covers exactly the bank vocabulary',
       set(stored) == set(post), f'{len(stored)} tokens vs {len(post)}')
    bad_df = [t for t, (d, _) in stored.items() if d != len(post.get(t, ()))]
    ok('df equals the number of facts carrying the token (RagStore\'s df)', not bad_df,
       f'{len(bad_df)} wrong')
    bad_p = [t for t, (_, s) in stored.items() if _decode(s) != post.get(t)]
    ok('every postings list decodes back to (ord, mask) exactly', not bad_p, f'{len(bad_p)} wrong')

    db.close()
    print(f'\n  {"ALL CHECKS PASS" if not fails else str(fails) + " CHECK(S) FAILED"}')
    return fails


def main():
    if '--check' in sys.argv:
        sys.exit(1 if check() else 0)
    if '--replay' in sys.argv:
        a = sys.argv[sys.argv.index('--replay') + 1:]
        sys.exit(1 if replay(a[0] if a else '/tmp/rag-baseline.json') else 0)
    if '--verify-tokens' in sys.argv:
        out = sys.argv[sys.argv.index('--verify-tokens') + 1]
        lines = []
        for f in load_bank():
            s = '|'.join(' '.join(sorted(x)) for x in field_sets(f))
            lines.append(hashlib.md5(s.encode()).hexdigest())
        open(out, 'w').write('\n'.join(lines) + '\n')
        print(f'{len(lines)} facts hashed -> {out}')
        return

    before = os.path.getsize(OUT_DB) if os.path.exists(OUT_DB) else 0
    db = sqlite3.connect(OUT_DB)
    build_facts(db)
    db.execute('VACUUM')
    for name, size in table_bytes(db).items():
        print(f'    {name:<16} {size/1e6:7.1f} MB')
    db.close()
    after = os.path.getsize(OUT_DB)
    print(f'\n  cards.db: {before/1e6:.1f} MB -> {after/1e6:.1f} MB')
    if os.path.exists(OUT_IDX):
        print(f'  dbVersion: {restamp()}')


if __name__ == '__main__':
    main()
